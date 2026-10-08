import { messageText } from "./llm-ir.ts";
import type {
  Agent,
  AgentDirectory,
  AgentIR,
  TreeIR,
  LowerInputIR,
  AllToolsAcrossTree,
  Lower,
  CompilerReadyIR,
  IsPermissioned,
  LlmIR,
  LoweredIR,
  ToolRejectMessage,
  UserMessage,
} from "./llm-ir.ts";
import { downconvert, lower, pendingToolCalls } from "./ir-operations.ts";
import type { LoadedTools, ToolCall, ToolExtensionIR, ToolReturn } from "./tool-def.ts";
import { combineSignals } from "./signals.ts";
import { Input } from "./input.ts";
import { err, ok, type Result } from "./result.ts";
import { OwnershipLock } from "./ownership-lock.ts";
import { waitForPermissionDecision, type PermissionGate } from "./permissions.ts";
import {
  trajectoryArc,
  type AllFinishReasons,
  type TrajectoryArcEvents,
  type TrajectoryArcFinish,
  type TrajectoryArcParams,
} from "./trajectory-arc.ts";

export type InputControl = {
  enqueueSteering(content: UserMessage["content"]): Promise<void>;
};

export type RunningControl = InputControl & {
  interrupt(): Promise<void>;
};

export type RetryControl = {
  retry(): void;
};

export type RectifyControl = RetryControl & {
  // Trims history back past the most recent user message and fires the rewind event with its
  // content (or null when there is no user message), so the client can offer it for editing;
  // the loop resumes waiting for input.
  rewind(): Promise<void>;
};

export type ClearControl = {
  clear(): void;
};

/*
 * What an arc identifies as: the trajectory's own conversation, or a delegation — named by
 * its subagent and locatable by the hops that led to it, outermost first.
 */
export type ScopeHop<Name extends string = string> = { subagent: Name; toolCallId: string };

export type ScopeRoot = { root: true };
export type ScopeSubagent<Name extends string> = {
  root: false;
  subagent: Name;
  scope: { path: readonly ScopeHop[] };
};

// The delegation scopes of an agent directory, every depth included. Concrete directories
// retain their exact names; an abstract string-indexed directory terminates as string rather
// than recursing through an unknown tree forever.
type SubagentScopes<Agents extends AgentDirectory> = string extends keyof Agents
  ? ScopeSubagent<string>
  : {
      [K in keyof Agents & string]: ScopeSubagent<K> | SubagentScopes<Agents[K]["agents"]>;
    }[keyof Agents & string];

// Any scope such a tree's arcs can identify with: the root conversation, or a delegation.
// Payloads that don't vary by arc still narrow on subagent exactly, like the modes do.
export type ArcScope<A extends Agent<any, any, any>> = ScopeRoot | SubagentScopes<A["agents"]>;

/*
 * What the trajectory is doing right now. Modes carry control objects: the only actions a client
 * can take in a mode are the ones its control exposes. Controls check that they are still the
 * live control before acting, so stale calls (double presses, mirrors lagging reality) are no-ops.
 *
 * The only terminal mode is "aborted" — run() resolves once the exit signal fires, and never
 * otherwise; everything else parks waiting on a control.
 *
 * Every mode names the arc that holds the loop through its `scope`. An arc's tool-call arms
 * carry that arc's own calls, so clients can switch on the arc and get exact tool types; the
 * root-only arms below belong to the root alone.
 */

// The mode arms any arc sits in while the loop moves through it.
type SharedArcModes<A extends Agent<any, any, any>> =
  | { mode: "responding"; control: RunningControl }
  | { mode: "compacting"; control: RunningControl }
  | { mode: "autofix-json"; control: RunningControl }
  | { mode: "autofix-tool"; tool: string; control: RunningControl }
  | {
      mode: "request-error-retrying";
      error: string;
      attempt: number;
      delayMs: number;
      control: RunningControl;
    }
  | {
      mode: "tool-call";
      toolCalls: Array<ToolCall<A["tools"]>>;
      control: RunningControl;
    }
  | {
      mode: "running-tool";
      toolCalls: Array<ToolCall<A["tools"]>>;
      toolCall: ToolCall<A["tools"]>;
      control: RunningControl;
    }
  | { mode: "payment-error"; requestError: string; control: RetryControl }
  | { mode: "rate-limit-error"; requestError: string; control: RetryControl }
  | { mode: "auth-error"; authError: string; control: RetryControl & ClearControl }
  | ([IsPermissioned<A>] extends [true]
      ? {
          mode: "tool-call-permission";
          toolCalls: Array<ToolCall<A["tools"]>>;
          toolCall: ToolCall<A["tools"]>;
          control: { interrupt(): Promise<void> };
        }
      : never);

// Arms only the root arc can be in: children never await input, and inside a trajectory
// request/compaction failures are terminal records, so they never park for rectification.
type RootOnlyModes =
  | { mode: "ready-for-request"; control: InputControl }
  | {
      mode: "request-error";
      requestError: string;
      curl: string | null;
      control: RectifyControl;
    }
  | {
      mode: "compaction-error";
      requestError: string;
      curl: string | null;
      control: RectifyControl;
    }
  | { mode: "aborted" };

// Distributes both unions into flat members, so root/subagent names and modes are ordinary
// top-level discriminants that preserve every member's correlated payload types.
type WithArcScope<Scope, Modes> = Scope extends unknown
  ? Modes extends unknown
    ? Scope & Modes
    : never
  : never;

// Modes fired from subagent arcs, one entry per name at any depth, carrying that arc's typed
// calls. Concrete directories retain exact names and calls; abstract directories terminate
// with their declared string-indexed agent type.
type SubagentModes<Agents extends AgentDirectory> = (string extends keyof Agents
  ? WithArcScope<ScopeSubagent<string>, SharedArcModes<Agents[string]>>
  : {
      [K in keyof Agents & string]:
        | WithArcScope<ScopeSubagent<K>, SharedArcModes<Agents[K]>>
        | SubagentModes<Agents[K]["agents"]>;
    }[keyof Agents & string]) &
  SharedArcModes<any>;

export type TrajectoryMode<A extends Agent<any, any, any>> =
  | WithArcScope<ScopeRoot, RootOnlyModes | SharedArcModes<A>>
  | SubagentModes<A["agents"]>;

// onMessage fires for the active arc's history appends, carrying that arc's exact IR
// universe: narrow the scope to know whose IRs these are. Subagent appends also carry the
// immediate trajectory whose ir array received the append and the top-level trajectory that
// contains it. A persisting client can overwrite the one root-history object even when the
// append came from a nested child, while other clients can address the immediate parent.
type ScopedSubagentMessages<
  Root extends Agent<any, any, any>,
  Parent extends Agent<any, any, any>,
> = string extends keyof Parent["agents"]
  ? ScopeSubagent<string> & {
      ir: AgentIR<Parent["agents"][string]>;
      scope: {
        path: readonly ScopeHop[];
        parentSubagentIR: Extract<AgentIR<Parent>, { role: "subagent-trajectory" }>;
        toplevelSubagentIR: Extract<AgentIR<Root>, { role: "subagent-trajectory" }>;
      };
    }
  : {
      [K in keyof Parent["agents"] & string]:
        | (ScopeSubagent<K> & {
            ir: AgentIR<Parent["agents"][K]>;
            scope: {
              path: readonly ScopeHop[];
              parentSubagentIR: Extract<
                AgentIR<Parent>,
                { role: "subagent-trajectory"; subagent: K }
              >;
              toplevelSubagentIR: Extract<AgentIR<Root>, { role: "subagent-trajectory" }>;
            };
          })
        | ScopedSubagentMessages<Root, Parent["agents"][K]>;
    }[keyof Parent["agents"] & string];

type ScopedMessages<A extends Agent<any, any, any>> =
  | (ScopeRoot & { ir: AgentIR<A> })
  | ScopedSubagentMessages<A, A>;

// The arc-sourced events' payloads don't vary by arc, so they carry the tree's exact scope
// union as top-level discriminants alongside the original payload.
type ScopedArcEvents<A extends Agent<any, any, any>> = {
  [K in keyof Omit<TrajectoryArcEvents<A>, "onMessage">]: WithArcScope<
    ArcScope<A>,
    { payload: Omit<TrajectoryArcEvents<A>, "onMessage">[K] }
  >;
};

/*
 * Trajectory events are notifications only: handlers never feed back into the loop. onMessage
 * fires for every canonical history append; modeChange fires for every transition; arc events
 * are forwarded with their scope. rewind and steeringChange stay unscoped: both only ever
 * happen at the root, where children never park for rectification (inside a trajectory,
 * request/compaction failures are terminal) and never consume steering at all.
 */
export type TrajectoryEvents<A extends Agent<any, any, any>> = ScopedArcEvents<A> & {
  onMessage: ScopedMessages<A>;
  modeChange: { mode: TrajectoryMode<A> };
  rewind: { removed: readonly AgentIR<A>[]; content: UserMessage["content"] | null };
  // Post-mutation steering snapshot, split by when it reaches the model: "upcoming" folds into
  // the very next request (the loop is parked waiting for input), while "queued" waits behind
  // in-flight work. A client can render a queued-steering affordance without consulting mode.
  steeringChange: {
    upcoming: readonly UserMessage["content"][];
    queued: readonly UserMessage["content"][];
  };
};

export type TrajectoryHandler<A extends Agent<any, any, any>> = Partial<{
  [K in keyof TrajectoryEvents<A>]: (event: TrajectoryEvents<A>[K]) => void | Promise<void>;
}>;

// Why model resolution can fail before an arc starts: a missing/expired credential is reported
// as an auth error without burning a doomed provider request.
export type TrajectoryModelError = { type: "auth-error"; authError: string };

type RuntimeData<A extends Agent<any, any, any>, Model> = {
  model: Model;
  contextWindow: number;
  tools: Partial<LoadedTools<A["tools"]>>;
};

// One system prompt per subagent anywhere in the tree, keyed by subagent name; the root's is
// systemPrompt, as today. Declaration stays cheap: each level's own child names are a direct
// keyof, while descendant levels fold in through the intersection of their subtrees'
// catalogues — the same shape the tree's merged tool map uses.
export type SubagentPromptCatalogue<A extends Agent<any, any, any>> = {
  [K in Extract<keyof A["agents"], string>]: (signal: AbortSignal) => Promise<string>;
} & DescendantCatalogues<A["agents"]>;

type DescendantCatalogues<Agents extends AgentDirectory> = UnionToIntersection<
  | {}
  | {
      [K in keyof Agents]: SubagentPromptCatalogue<Agents[K]>;
    }[keyof Agents]
>;

type UnionToIntersection<U> = (U extends U ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

export type TrajectoryParams<A extends Agent<any, any, any>, Model> = Omit<
  TrajectoryArcParams<A, Model>,
  "handler" | "abortSignal" | "model" | "contextWindow" | "tools" | "lowerMessages"
> & {
  agent: A;
  // Exit-level signal: firing it ends the trajectory (lands in the "aborted" mode).
  abortSignal: AbortSignal;
  handler?: TrajectoryHandler<A>;
  // Re-resolved each active step, so a retry always sees fresh credentials and config; a
  // resolution error lands in the same mode as the equivalent compiler finish.
  model: () => Promise<Result<{ model: Model; contextWindow: number }, TrajectoryModelError>>;
  // One loader for every tool in the tree (root + descendants), passed once: the runner
  // filters each arc's subset from the merged map as it drives that arc's agent.
  loadTools: (signal: AbortSignal) => Promise<Partial<AllToolsAcrossTree<A>>>;
  // The client's extension pass handles non-trajectory IR from every agent in the tree.
  // Libocto sends contiguous runs to this callback and handles trajectories and recursion
  // itself. Neither callback inputs nor outputs can contain subagent trajectories.
  lowerMessages: (messages: Array<LowerInputIR<A>>) => Array<Lower<A>>;
  // A system prompt for every other agent in the tree; the root's is systemPrompt, as today.
  subagentPrompts: SubagentPromptCatalogue<A>;
  // Caps any single tool output, counted after lowering; defaults to 20% of the context window
  // so one huge result can't push history past autocompaction's reach.
  maxToolOutput?: number;
  // Counts the tokens in a lowered message sequence: maxToolOutput measures the delta a tool
  // output adds to history, since exact tokenizers aren't summable and can't necessarily count
  // an unpaired tool output in isolation. The default estimates ~4 chars/token over text;
  // clients with a real tokenizer can inject exact counts.
  countTokens?: (irs: Array<LoweredIR<A["tools"]>>) => number;
  // Builds the error for a tool output rejected by maxToolOutput, which ends up in the model's
  // context: only the client knows which recovery advice fits its tools.
  toolContentTooLargeError: (ir: LlmIR<A>) => Promise<string>;
  // Drives stepping: the default runs steps in a loop until one reports the trajectory ended,
  // but clients can supply their own driver (e.g. one backed by a durable queue that serializes
  // state between steps).
  loopController?: TrajectoryLoopController;
  // The gate is required exactly when the agent is permission-branded: rejecting a call produces
  // tool-reject IRs, which only exist in a permissioned agent's history universe.
} & ([IsPermissioned<A>] extends [true] ? { permission: PermissionGate<A> } : Record<never, never>);

// Multiple steering entries fold into one user message: text parts join with "\n", and image
// parts follow in push order.
function coalesceUserMessageContent(
  contents: Array<UserMessage["content"]>,
): UserMessage["content"] {
  const text: string[] = [];
  const images: UserMessage["content"] = [];
  for (const content of contents) {
    for (const part of content) {
      if (part.type === "text") text.push(part.content);
      else images.push(part);
    }
  }
  return [{ type: "text", content: text.join("\n") }, ...images];
}

async function waitSteeringOrExit(
  steering: Input<UserMessage["content"]>,
  exit: AbortSignal,
): Promise<Result<Array<UserMessage["content"]>, "aborted">> {
  if (exit.aborted) return err("aborted");
  let onAbort!: () => void;
  const aborted = new Promise<Result<Array<UserMessage["content"]>, "aborted">>(resolve => {
    onAbort = () => resolve(err("aborted"));
    exit.addEventListener("abort", onAbort, { once: true });
  });
  const winner = await Promise.race([steering.get().then(ok), aborted]);
  exit.removeEventListener("abort", onAbort);
  return winner;
}

const ABORTED_TOOL_SKIP_REASON = "The user aborted the response, so this tool was skipped";
const REJECTED_TOOL_SKIP_REASON = "A previous tool call was rejected, so this tool was skipped";
const FAILED_TOOL_SKIP_REASON = "The tool batch failed unexpectedly, so this tool was skipped";
const EXIT_RUNNING_TOOL_SKIP_REASON =
  "The user exited while this tool was running, so its output was not recorded";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- consumed by the arc kill synthesis
const INTERRUPTED_BY_USER_REASON = "The user interrupted this subagent.";

type RunArgsFor<Def> = Def extends { run: (args: infer Args) => unknown } ? Args : never;

export type TrajectoryLoopController = (step: () => Promise<boolean>) => Promise<void>;

export async function defaultLoopController(step: () => Promise<boolean>): Promise<void> {
  while (await step()) continue;
}

export const DEFAULT_MAX_TOOL_OUTPUT_FRACTION = 0.2;

// ~4 characters per token for English text:
// https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
function defaultCountTokens(irs: Array<LoweredIR<any>>): number {
  let text = "";
  for (const ir of irs) text += messageText(ir);
  return Math.ceil(text.length / 4);
}

// LlmIR's extension-IR leg is an unresolved indexed type for a generic A, which defeats TS's
// discriminated narrowing on role; an explicit predicate still narrows.
function isUserMessage(ir: LlmIR<any>): ir is UserMessage {
  return ir.role === "user";
}

// How an error mode resolves: "retry" resumes work, "rewind" trims history to the given
// target, and "await-input" clears the error.
type Rectification =
  | { type: "retry" }
  | { type: "rewind"; target: "last-user-message" }
  | { type: "await-input" };

// Builds the one-shot promise a needs-rectification step awaits; the exit signal resolves
// err("aborted") so the step can end as usual without waiting on a control that may never
// fire. Once any control resolves it — or the exit fires — the rectification is dead: controls
// that mutate state (rewind) must check live before acting.
function rectifiable(exit: AbortSignal): {
  resolved: Promise<Result<Rectification, "aborted">>;
  live: boolean;
  resolve(rectification: Rectification): void;
} {
  let resolvePromise!: (r: Result<Rectification, "aborted">) => void;
  const resolved = new Promise<Result<Rectification, "aborted">>(resolve => {
    resolvePromise = resolve;
  });
  const onAbort = () => {
    channel.live = false;
    resolvePromise(err("aborted"));
  };
  const channel = {
    resolved,
    live: true,
    resolve(rectification: Rectification): void {
      channel.live = false;
      exit.removeEventListener("abort", onAbort);
      resolvePromise(ok(rectification));
    },
  };
  if (exit.aborted) onAbort();
  else exit.addEventListener("abort", onAbort, { once: true });
  return channel;
}

// Each arc runs only the tools its agent declares, picked out of the one tree-wide map
// by that agent's tool-map keys. The retype below is a narrowing, not a conversion: the merged
// map's entry under any key is the loaded definition of exactly the tool declared there.
function arcTools<A extends Agent<any, any, any>>(
  agent: A,
  all: Partial<AllToolsAcrossTree<A>>,
): Partial<LoadedTools<A["tools"]>> {
  const tools = {} as Partial<LoadedTools<A["tools"]>>;
  for (const key of Object.keys(agent.tools) as Array<keyof A["tools"]>) {
    const def = all[key as keyof AllToolsAcrossTree<A>];
    type DeclaredDef = LoadedTools<A["tools"]>[keyof A["tools"]];
    if (def) {
      tools[key] = def as DeclaredDef;
    }
  }
  return tools;
}

export class Trajectory<A extends Agent<any, any, any>, Model> {
  private readonly history: Array<AgentIR<A>>;
  private _mode: TrajectoryMode<A>;
  private turnController = new AbortController();
  private readonly steering = new Input<UserMessage["content"]>();
  private readonly permissionGate: PermissionGate<A> | undefined;
  private stepState:
    | { type: "wait-for-input" }
    | { type: "wait-for-tool" }
    | { type: "needs-rectification"; resolved: Promise<Result<Rectification, "aborted">> } = {
    type: "wait-for-input",
  };
  private awaitingSteering = true;
  private _finish: Promise<void> = Promise.resolve();
  private readonly ownership = new OwnershipLock();
  // The arc-facing lowering the runner builds once from the client's extension pass: every
  // level down-converted, then lower() applied over the result.
  private readonly lower: (messages: Array<TreeIR<A>>) => Array<CompilerReadyIR<A>>;

  constructor(private readonly params: TrajectoryParams<A, Model>) {
    this.history = [...params.messages];
    this.lower = messages => lower<A>(downconvert<A>(params.lowerMessages)(messages));
    this._mode = { root: true, mode: "ready-for-request", control: this.inputControl() };
    // The permission param is conditional on the IsPermissioned brand, which TS can't reduce
    // for a generic A; check for its presence at runtime instead.
    this.permissionGate =
      "permission" in params ? (params.permission as PermissionGate<A>) : undefined;
    params.abortSignal.addEventListener(
      "abort",
      () => {
        this._finish = this._finish.then(async () => {
          await this.markExitSkips();
          await this.setMode({ root: true, mode: "aborted" });
        });
      },
      { once: true },
    );
  }

  get mode(): TrajectoryMode<A> {
    return this._mode;
  }

  get messages(): ReadonlyArray<AgentIR<A>> {
    return [...this.history];
  }

  private inputControl(): InputControl {
    return {
      enqueueSteering: async content => {
        this.steering.push(content);
        await this.emitSteeringChange();
      },
    };
  }

  private interruptControl(): { interrupt(): Promise<void> } {
    return {
      interrupt: async () => {
        this.steering.clear();
        this.turnController.abort();
        await this.emitSteeringChange();
      },
    };
  }

  private runningControl(): RunningControl {
    return { ...this.inputControl(), ...this.interruptControl() };
  }

  private async setMode(mode: TrajectoryMode<A>): Promise<void> {
    // Exit is terminal: in-flight awaits can still resolve afterwards and try to set a mode,
    // but only "aborted" may land once the exit signal has fired.
    if (this.params.abortSignal.aborted && mode.mode !== "aborted") return;
    this._mode = mode;
    await this.params.handler?.modeChange?.({ mode });
  }

  // Parks the trajectory until the user sends input. The ready announce is suppressed when
  // steering is already buffered, since the next step consumes it immediately.
  private async awaitInput(): Promise<void> {
    this.stepState = { type: "wait-for-input" };
    if (this.steering.peek().length > 0) return;
    await this.setMode({
      root: true,
      mode: "ready-for-request",
      control: this.inputControl(),
    });
  }

  // Everything the loop appends lives in the permissioned universe; AgentIR narrows that by the
  // agent's permission capability, which TS can't reduce for a generic A.
  private async appendIr(ir: LlmIR<A> | ToolRejectMessage<A["tools"]>): Promise<void> {
    const agentIr = ir as AgentIR<A>;
    this.history.push(agentIr);
    await this.params.handler?.onMessage?.({ root: true, ir: agentIr });
  }

  private pendingToolCalls(): Array<ToolCall<A["tools"]>> {
    return pendingToolCalls<A>(downconvert<A>(this.params.lowerMessages)(this.history));
  }

  // Fires on the exit signal: when the process dies mid-batch, every call without a recorded
  // answer gets a skip marker, since nothing may run after this. Markers append one at a time,
  // awaiting onMessage each time: the client owns serialization and must have finished
  // persisting before run() resolves.
  private async markExitSkips(): Promise<void> {
    const owner = this.ownership.consume();
    const running = this._mode.mode === "running-tool" ? this._mode.toolCall.toolCallId : null;
    for (const toolCall of this.pendingToolCalls()) {
      await owner.ifOwner(async () => {
        await this.appendIr({
          role: "tool-skip-output",
          toolCall,
          reason:
            toolCall.toolCallId === running
              ? EXIT_RUNNING_TOOL_SKIP_REASON
              : ABORTED_TOOL_SKIP_REASON,
        });
      });
    }
  }

  private async emitSteeringChange(): Promise<void> {
    const pending = [...this.steering.peek()];
    await this.params.handler?.steeringChange?.(
      this.awaitingSteering ? { upcoming: pending, queued: [] } : { upcoming: [], queued: pending },
    );
  }

  private async runArc(
    model: Model,
    contextWindow: number,
    tools: Partial<LoadedTools<A["tools"]>>,
  ): Promise<TrajectoryArcFinish<AllFinishReasons<A>>> {
    const history = this.history;
    const params = this.params;

    // The arc's overloads narrow finish reasons by which budgets are passed; the trajectory
    // forwards whatever the client configured, so it must consider every reason.
    return trajectoryArc.run<A, Model>({
      model,
      contextWindow,
      tools,
      messages: history,
      toolData: params.toolData,
      runCompiler: params.runCompiler,
      lowerMessages: this.lower,
      systemPrompt: params.systemPrompt,
      transport: params.transport,
      errorCorrection: params.errorCorrection,
      validationRetries: params.validationRetries,
      requestErrorRetries: params.requestErrorRetries,
      abortSignal: combineSignals([params.abortSignal, this.turnController.signal]),
      handler: {
        startResponse: async event => {
          await this.setMode({ root: true, mode: "responding", control: this.runningControl() });
          await params.handler?.startResponse?.({ root: true, payload: event });
        },
        responseProgress: async event => {
          await params.handler?.responseProgress?.({ root: true, payload: event });
        },
        startCompaction: async event => {
          await this.setMode({ root: true, mode: "compacting", control: this.runningControl() });
          await params.handler?.startCompaction?.({ root: true, payload: event });
        },
        compactionProgress: async event => {
          await params.handler?.compactionProgress?.({ root: true, payload: event });
        },
        autofixingJson: async event => {
          await this.setMode({ root: true, mode: "autofix-json", control: this.runningControl() });
          await params.handler?.autofixingJson?.({ root: true, payload: event });
        },
        autofixingTool: async event => {
          await this.setMode({
            root: true,
            mode: "autofix-tool",
            tool: event.tool,
            control: this.runningControl(),
          });
          await params.handler?.autofixingTool?.({ root: true, payload: event });
        },
        requestRetry: async event => {
          await this.setMode({
            root: true,
            mode: "request-error-retrying",
            error: event.error.requestError,
            attempt: event.attempt,
            delayMs: event.delayMs,
            control: this.runningControl(),
          });
          await params.handler?.requestRetry?.({ root: true, payload: event });
        },
        onResponseHeaders: async event => {
          await params.handler?.onResponseHeaders?.({ root: true, payload: event });
        },
        onMessage: ir => this.appendIr(ir),
      },
    });
  }

  async step(): Promise<boolean> {
    this.turnController = new AbortController();
    const signal = combineSignals([this.params.abortSignal, this.turnController.signal]);
    let runtimeData: Result<RuntimeData<A, Model>, TrajectoryModelError> | undefined = undefined;
    switch (this.stepState.type) {
      case "wait-for-input": {
        this.awaitingSteering = true;
        const waited = await waitSteeringOrExit(this.steering, this.params.abortSignal);
        this.awaitingSteering = false;
        if (!waited.success) return false;
        await this.emitSteeringChange();
        await this.appendIr({ role: "user", content: coalesceUserMessageContent(waited.data) });
        break;
      }
      case "wait-for-tool": {
        runtimeData = await this.loadRuntimeData(signal);
        if (!runtimeData.success) {
          await this.authError(runtimeData.error.authError);
          return !this.params.abortSignal.aborted;
        }
        const batch = await this.runToolBatch(runtimeData.data);
        if (!batch.success) {
          if (this.params.abortSignal.aborted) return false;
          await this.awaitInput();
          return true;
        }
        break;
      }
      case "needs-rectification": {
        const resolved = await this.stepState.resolved;
        if (!resolved.success) return false;
        if (this.pendingToolCalls().length > 0) {
          this.stepState = { type: "wait-for-tool" };
          return true;
        }
        if (resolved.data.type !== "retry") {
          await this.awaitInput();
          return true;
        }
        break;
      }
    }
    if (this.params.abortSignal.aborted) return false;
    runtimeData ||= await this.loadRuntimeData(signal);
    if (!runtimeData.success) {
      await this.authError(runtimeData.error.authError);
      return !this.params.abortSignal.aborted;
    }
    await this.respond(runtimeData.data);
    if (this.params.abortSignal.aborted) return false;
    return true;
  }

  async run(): Promise<void> {
    const loopController = this.params.loopController ?? defaultLoopController;
    await loopController(() => this.step());
    await this._finish;
  }

  private async loadRuntimeData(
    signal: AbortSignal,
  ): Promise<Result<RuntimeData<A, Model>, TrajectoryModelError>> {
    const [modelResult, allTools] = await Promise.all([
      this.params.model(),
      this.params.loadTools(signal),
    ]);
    if (!modelResult.success) return modelResult;
    return ok({ ...modelResult.data, tools: arcTools(this.params.agent, allTools) });
  }

  private async respond({ model, contextWindow, tools }: RuntimeData<A, Model>): Promise<void> {
    const queued = this.steering.take();
    if (queued.length > 0) {
      await this.emitSteeringChange();
      await this.appendIr({ role: "user", content: coalesceUserMessageContent(queued) });
    }
    const reason = (await this.runArc(model, contextWindow, tools)).reason;

    switch (reason.type) {
      case "abort":
      case "needs-response": {
        await this.awaitInput();
        return;
      }
      case "request-tool": {
        this.stepState = { type: "wait-for-tool" };
        return;
      }
      case "request-error":
      case "compaction-error": {
        await this.rectify(reason.type, reason.requestError, reason.curl);
        return;
      }
      case "payment-error":
      case "rate-limit-error": {
        await this.retryableError(reason.type, reason.requestError);
        return;
      }
      case "auth-error": {
        await this.authError(reason.authError);
        return;
      }
      case "request-error-retry-budget-exceeded": {
        const error = reason.error;
        if (error.type === "rate-limit-error") {
          await this.retryableError("rate-limit-error", error.requestError);
          return;
        }
        await this.rectify("request-error", error.requestError, error.curl);
        return;
      }
      case "validation-retry-budget-exceeded": {
        await this.rectify("request-error", reason.error, null);
        return;
      }
    }
  }

  private async authError(authError: string): Promise<void> {
    const rectification = rectifiable(this.params.abortSignal);
    this.stepState = { type: "needs-rectification", resolved: rectification.resolved };
    await this.setMode({
      root: true,
      mode: "auth-error",
      authError,
      control: {
        retry: () => rectification.resolve({ type: "retry" }),
        clear: () => rectification.resolve({ type: "await-input" }),
      },
    });
  }

  private async rectify(
    error: "request-error" | "compaction-error",
    requestError: string,
    curl: string | null,
  ): Promise<void> {
    const rectification = rectifiable(this.params.abortSignal);
    this.stepState = { type: "needs-rectification", resolved: rectification.resolved };
    await this.setMode({
      root: true,
      mode: error,
      requestError,
      curl,
      control: {
        retry: () => rectification.resolve({ type: "retry" }),
        rewind: async () => {
          if (!rectification.live) return;
          let removed: readonly AgentIR<A>[] = [];
          let content: UserMessage["content"] | null = null;
          for (let index = this.history.length - 1; index >= 0; index--) {
            const ir = this.history[index] as LlmIR<A>;
            if (!isUserMessage(ir)) continue;
            removed = this.history.slice(index);
            content = ir.content;
            this.history.length = index;
            break;
          }
          this.steering.clear();
          rectification.resolve({ type: "rewind", target: "last-user-message" });
          await this.emitSteeringChange();
          await this.params.handler?.rewind?.({ removed, content });
        },
      },
    });
  }

  private async retryableError(
    error: "payment-error" | "rate-limit-error",
    requestError: string,
  ): Promise<void> {
    const rectification = rectifiable(this.params.abortSignal);
    this.stepState = { type: "needs-rectification", resolved: rectification.resolved };
    await this.setMode({
      root: true,
      mode: error,
      requestError,
      control: {
        retry: () => rectification.resolve({ type: "retry" }),
      },
    });
  }

  private async runTool(
    toolCall: ToolCall<A["tools"]>,
    signal: AbortSignal,
    tools: Partial<LoadedTools<A["tools"]>>,
    contextWindow: number,
  ): Promise<LlmIR<A>> {
    const def = Object.values(tools).find(loaded => loaded?.name === toolCall.name);
    if (def == null) {
      return { role: "tool-runtime-error", toolCall, error: `No tool named ${toolCall.name}` };
    }
    const output: Result<ToolReturn<string, ToolExtensionIR<any>>, string> = await def.run({
      signal,
      transport: this.params.transport,
      toolCall: {
        toolCallId: toolCall.toolCallId,
        original: { name: toolCall.name, arguments: toolCall.original },
        parsed: { name: toolCall.name, arguments: toolCall.parsed },
      },
      data: this.params.toolData,
    } as RunArgsFor<typeof def>);
    if (!output.success) {
      return { role: "tool-runtime-error", toolCall, error: output.error };
    }
    if (output.data.type === "invoke-subagent") {
      throw new Error(`Subagent invocation is not supported: ${output.data.name}`);
    }

    let ir: LlmIR<A>;
    if (output.data.type === "output") {
      ir = { role: "tool-output", toolCall, content: output.data.content };
    } else {
      const _: "custom-ir" = output.data.type;
      // Tool factories brand their custom IRs into the agent's IR universe, but that branding
      // can't be reduced for a generic A.
      ir = output.data.data as LlmIR<A>;
    }

    // Token counts and lowering aren't summable, and exact tokenizers can't necessarily count
    // an unpaired tool output in isolation, so measure the delta the output adds to the full
    // lowered history.
    const countTokens = this.params.countTokens ?? defaultCountTokens;
    const maxToolOutput =
      this.params.maxToolOutput ?? Math.floor(contextWindow * DEFAULT_MAX_TOOL_OUTPUT_FRACTION);
    const tokens =
      countTokens(this.lower([...this.history, ir]).map(({ converted }) => converted)) -
      countTokens(this.lower(this.history).map(({ converted }) => converted));
    if (tokens >= maxToolOutput) {
      return {
        role: "tool-runtime-error",
        toolCall,
        error: await this.params.toolContentTooLargeError(ir),
      };
    }
    return ir;
  }

  private async runToolBatch({
    tools,
    contextWindow,
  }: RuntimeData<A, Model>): Promise<Result<null, "aborted">> {
    // Keep the batch snapshot for mode payloads only; execution progress comes from the IR.
    const toolCalls = this.pendingToolCalls();
    const owner = this.ownership.lease();
    const signal = combineSignals([this.params.abortSignal, this.turnController.signal]);
    await this.setMode({
      root: true,
      mode: "tool-call",
      toolCalls,
      control: this.runningControl(),
    });

    let skipReason: string | null = null;
    let steering: UserMessage["content"] | null = null;
    let aborted = false;

    try {
      while (true) {
        const toolCall = this.pendingToolCalls()[0];
        if (toolCall == null) break;

        if (this.permissionGate != null) {
          // The permission mode is conditional on the IsPermissioned brand, which TS can't reduce
          // for a generic A; the gate's presence proves it at runtime.
          await this.setMode({
            root: true,
            mode: "tool-call-permission",
            toolCalls,
            toolCall,
            control: this.interruptControl(),
          } as TrajectoryMode<A>);
          const decision = await waitForPermissionDecision(this.permissionGate, toolCall, signal);
          if (!decision.success) {
            skipReason = ABORTED_TOOL_SKIP_REASON;
            aborted = true;
            break;
          }
          if (decision.data.decision === "reject") {
            await owner.ifOwner(async () => {
              await this.appendIr({ role: "tool-reject", toolCall });
            });
            skipReason = REJECTED_TOOL_SKIP_REASON;
            steering = decision.data.steering;
            break;
          }
        }

        if (signal.aborted) {
          skipReason = ABORTED_TOOL_SKIP_REASON;
          aborted = true;
          break;
        }

        await this.setMode({
          root: true,
          mode: "running-tool",
          toolCalls,
          toolCall,
          control: this.runningControl(),
        });
        const result = await this.runTool(toolCall, signal, tools, contextWindow);
        await owner.ifOwner(async () => {
          await this.appendIr(result);
        });

        if (signal.aborted) {
          skipReason = ABORTED_TOOL_SKIP_REASON;
          aborted = true;
          break;
        }
      }
    } catch (e) {
      // The throw strands unanswered calls, breaking tool pairing; mark them skipped so a
      // crashed trajectory still leaves a hydratable history. Already-recorded answers stay.
      for (const toolCall of this.pendingToolCalls()) {
        await owner.ifOwner(async () => {
          await this.appendIr({
            role: "tool-skip-output",
            toolCall,
            reason: FAILED_TOOL_SKIP_REASON,
          });
        });
      }
      throw e;
    }

    if (skipReason != null) {
      for (const toolCall of this.pendingToolCalls()) {
        await owner.ifOwner(async () => {
          await this.appendIr({
            role: "tool-skip-output",
            toolCall,
            reason: skipReason,
          });
        });
      }
    }
    if (steering != null) {
      await owner.ifOwner(async () => {
        await this.appendIr({ role: "user", content: steering });
      });
    }
    if (aborted) return err("aborted");
    return ok(null);
  }
}

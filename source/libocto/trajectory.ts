import { messageText } from "./llm-ir.ts";
import type {
  Agent,
  AgentDirectory,
  AgentIR,
  TreeIR,
  TreeToolCall,
  LowerInputIR,
  AllToolsAcrossTree,
  LowerOutputIR,
  CompilerReadyIR,
  IsPermissioned,
  LlmIR,
  LoweredIR,
  ToolRejectMessage,
  UserMessage,
} from "./llm-ir.ts";
import { downconvert, inspectHistory, inspectSubagentTrajectory, lower } from "./ir-operations.ts";
import type {
  ActiveHistory,
  HistoryInspection,
  SubagentTrajectoryInspection,
} from "./ir-operations.ts";
export type { SubagentTrajectoryInspection } from "./ir-operations.ts";
import type { MultimodalConfig } from "./modalities.ts";
import { subagentPrompt, userInterruptReason } from "./compilers/ir-prompts.ts";
import type { LoadedTools, ToolCall, ToolExtensionIR, ToolReturn } from "./tool-def.ts";
import { combineSignals } from "./signals.ts";
import { Input } from "./input.ts";
import { err, ok, type Result } from "./result.ts";
import { OwnershipLock, type OwnershipLockRef } from "./ownership-lock.ts";
import { waitForPermissionDecision, type PermissionGate } from "./permissions.ts";
import {
  trajectoryArc,
  type AllFinishReasons,
  type AgentToolData,
  type ErrorCorrection,
  type ToolDataFor,
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

export type EditControl<A extends Agent<any, any, any>> = {
  // Trims history from `target` onwards and fires rewind with the removed span; when the
  // target is a user message, its content rides along so the client can offer it for editing.
  rewindTo(target: AgentIR<A>): Promise<void>;
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
type SharedArcModes<Call, Permissioned extends boolean> =
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
      toolCalls: Array<Call>;
      control: RunningControl;
    }
  | {
      mode: "running-tool";
      toolCalls: Array<Call>;
      toolCall: Call;
      control: RunningControl;
    }
  | { mode: "payment-error"; requestError: string; control: RetryControl }
  | { mode: "rate-limit-error"; requestError: string; control: RetryControl }
  | { mode: "auth-error"; authError: string; control: RetryControl & ClearControl }
  | ([Permissioned] extends [true]
      ? {
          mode: "tool-call-permission";
          toolCalls: Array<Call>;
          toolCall: Call;
          control: { interrupt(): Promise<void> };
        }
      : never);

// Arms only the root arc can be in: children never await input, and inside a trajectory
// request/compaction failures are terminal records, so they never park for rectification.
type RootOnlyModes<A extends Agent<any, any, any>> =
  | { mode: "ready-for-request"; control: InputControl & EditControl<A> }
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
// with their declared string-indexed agent type. Apply the inspection bound once, outside
// recursion: repeating this same intersection at every depth multiplies generic union work.
type SubagentModes<Agents extends AgentDirectory> = SubagentModeUnion<Agents> &
  SharedArcModes<ToolCall<any>, true>;

type SubagentModeUnion<Agents extends AgentDirectory> = string extends keyof Agents
  ? WithArcScope<
      ScopeSubagent<string>,
      SharedArcModes<ToolCall<Agents[string]["tools"]>, IsPermissioned<Agents[string]>>
    >
  : {
      [K in keyof Agents & string]:
        | WithArcScope<
            ScopeSubagent<K>,
            SharedArcModes<ToolCall<Agents[K]["tools"]>, IsPermissioned<Agents[K]>>
          >
        | SubagentModeUnion<Agents[K]["agents"]>;
    }[keyof Agents & string];

export type TrajectoryMode<A extends Agent<any, any, any>> =
  | WithArcScope<
      ScopeRoot,
      RootOnlyModes<A> | SharedArcModes<ToolCall<A["tools"]>, IsPermissioned<A>>
    >
  | (SubagentModes<A["agents"]> & {
      scope: { parentSubagentIR: Extract<TreeIR<A>, { role: "subagent-trajectory" }> };
    });

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
  [K in keyof Omit<TrajectoryArcEvents<A>, "onMessage">]: ArcScope<A> & {
    payload: Omit<TrajectoryArcEvents<A>, "onMessage">[K];
  };
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

export type TrajectoryToolLoadError = { type: "quit" } | { type: "fatal"; error: string };

type RuntimeData<A extends Agent<any, any, any>, Model> = {
  model: Model;
  contextWindow: number;
  modalities: MultimodalConfig | null;
  tools: Partial<AllToolsAcrossTree<A>>;
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

// Correction maps and data are shared by every arc, just like the loaded tool catalogue.
type TreeErrorCorrection<A extends Agent<any, any, any>> = ErrorCorrection<A> &
  UnionToIntersection<
    {} | { [K in keyof A["agents"]]: TreeErrorCorrection<A["agents"][K]> }[keyof A["agents"]]
  >;

export type TrajectoryParams<A extends Agent<any, any, any>, Model> = Omit<
  TrajectoryArcParams<A, Model>,
  | "handler"
  | "abortSignal"
  | "model"
  | "contextWindow"
  | "tools"
  | "lowerMessages"
  | "toolData"
  | "errorCorrection"
> & {
  agent: A;
  toolData: AgentToolData<A> &
    UnionToIntersection<ToolDataFor<AllToolsAcrossTree<A>[keyof AllToolsAcrossTree<A>]>>;
  errorCorrection?: TreeErrorCorrection<A>;
  // Exit-level signal: firing it ends the trajectory (lands in the "aborted" mode).
  abortSignal: AbortSignal;
  handler?: TrajectoryHandler<A>;
  // Re-resolved each active step, so a retry always sees fresh credentials and config; a
  // resolution error lands in the same mode as the equivalent compiler finish.
  model: (
    invocation: Extract<TreeIR<A>, { role: "tool-invoke-subagent" }> | null,
  ) => Promise<
    Result<
      { model: Model; contextWindow: number; modalities: MultimodalConfig | null },
      TrajectoryModelError
    >
  >;
  // One loader for every tool in the tree (root + descendants), passed once: the runner
  // filters each arc's subset from the merged map as it drives that arc's agent.
  loadTools: (
    signal: AbortSignal,
  ) => Promise<Result<Partial<AllToolsAcrossTree<A>>, TrajectoryToolLoadError>>;
  // The client's extension pass handles non-trajectory IR from every agent in the tree.
  // Libocto sends contiguous runs to this callback and handles trajectories and recursion
  // itself. Neither callback inputs nor outputs can contain subagent trajectories.
  // Model-independent execution-state inspections pass null; modalities control rendering,
  // not which calls an IR answers or whether a trajectory is terminal.
  lowerMessages: (
    messages: Array<LowerInputIR<A>>,
    modalities: MultimodalConfig | null,
  ) => Array<LowerOutputIR<A>>;
  // A system prompt for every other agent in the tree; the root's is systemPrompt, as today.
  subagentPrompts: SubagentPromptCatalogue<A>;
  // Caps any single tool output, counted after lowering; defaults to 20% of the context window
  // so one huge result can't push history past autocompaction's reach.
  maxToolOutput?: number;
  // Counts the tokens in a lowered message sequence from any agent in the tree: maxToolOutput
  // measures the delta a tool output adds to history, since exact tokenizers aren't summable
  // and can't necessarily count an unpaired tool output in isolation. The default estimates
  // ~4 chars/token over text; clients with a real tokenizer can inject exact counts.
  countTokens?: (irs: Array<CompilerReadyIR<A>["converted"]>) => number;
  // Builds the error for a tool output from any agent in the tree rejected by maxToolOutput,
  // which ends up in the model's context: only the client knows which recovery advice fits its tools.
  toolContentTooLargeError: (ir: TreeIR<A>) => Promise<string>;
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

// Each operation receives only the tools declared by its selected agent. The catalogue
// stays tree-wide; filtering changes neither the loaded definitions nor their schemas.
function arcTools<A extends Agent<any, any, any>>(
  agent: { tools: object },
  all: Partial<AllToolsAcrossTree<A>>,
): Partial<AllToolsAcrossTree<A>> {
  const tools: Partial<AllToolsAcrossTree<A>> = {};
  for (const key of Object.keys(agent.tools) as Array<keyof AllToolsAcrossTree<A>>) {
    const def = all[key];
    if (def) tools[key] = def;
  }
  return tools;
}

export class Trajectory<A extends Agent<any, any, any>, Model> {
  private readonly history: Array<AgentIR<A>>;
  private _mode: TrajectoryMode<A>;
  private turnController = new AbortController();
  private readonly steering = new Input<UserMessage["content"]>();
  private readonly permissionGate: PermissionGate<A> | undefined;
  private awaitingSteering = true;
  private _finish: Promise<void> = Promise.resolve();
  private readonly ownership = new OwnershipLock();
  // Every level is downconverted, then lower() is applied using the resolved model's modalities.
  private readonly lower: (
    messages: Array<TreeIR<A>>,
    modalities: MultimodalConfig | null,
  ) => Array<CompilerReadyIR<A>>;

  constructor(private readonly params: TrajectoryParams<A, Model>) {
    this.history = [...params.messages];
    this.lower = (messages, modalities) =>
      lower<A>(downconvert<A>(irs => params.lowerMessages(irs, modalities))(messages));
    this._mode = { root: true, mode: "ready-for-request", control: this.readyControl() };
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

  inspectSubagentTrajectory(
    trajectory: TreeIR<A> & { role: "subagent-trajectory"; ir: Array<TreeIR<A>> },
  ): SubagentTrajectoryInspection {
    return inspectSubagentTrajectory<A>(
      downconvert<A>(irs => this.params.lowerMessages(irs, null))(trajectory.ir),
    );
  }

  private inputControl(): InputControl {
    return {
      enqueueSteering: async content => {
        this.steering.push(content);
        await this.emitSteeringChange();
      },
    };
  }

  private readyControl(): InputControl & EditControl<A> {
    return { ...this.inputControl(), ...this.editControl() };
  }

  private editControl(): EditControl<A> {
    return {
      rewindTo: async target => {
        // Only a parked root loop may trim; stale controls and unknown targets are no-ops.
        if (this.params.abortSignal.aborted) return;
        const mode = this._mode;
        if (mode.mode !== "ready-for-request" || !mode.root) return;
        const index = this.history.indexOf(target);
        if (index < 0) return;
        const removed = this.history.splice(index);
        const first = removed[0] as LlmIR<A> | undefined;
        const content = first != null && isUserMessage(first) ? first.content : null;
        this.steering.clear();
        await this.emitSteeringChange();
        await this.params.handler?.rewind?.({ removed, content });
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

  private setArcMode(
    location: ActiveHistory<A>,
    mode: SharedArcModes<TreeToolCall<A>, true>,
  ): Promise<void> {
    // The calls and scope belong to the same selected operation. Permission modes are only
    // emitted when the tree-wide gate exists; the public union retains both correlations.
    return this.setMode({ ...this.scope(location), ...mode } as TrajectoryMode<A>);
  }

  private async announceReady(
    inspection: Extract<HistoryInspection<A>, { action: "wait-for-input" }>,
  ): Promise<void> {
    if (this.steering.peek().length > 0) return;
    await this.setMode({
      root: inspection.location.root,
      mode: "ready-for-request",
      control: this.readyControl(),
    });
  }

  private inspect(): HistoryInspection<A> {
    const inspected = inspectHistory(
      this.params.agent,
      this.history,
      downconvert<A>(irs => this.params.lowerMessages(irs, null))(this.history),
    );
    if (!inspected.success) throw new Error(inspected.error);
    return inspected.data;
  }

  private lowerForLocation(
    location: ActiveHistory<A>,
    modalities: MultimodalConfig | null,
  ): (messages: Array<TreeIR<A>>) => Array<CompilerReadyIR<A>> {
    const lowerMessages = (messages: Array<TreeIR<A>>) => this.lower(messages, modalities);
    if (location.root) return lowerMessages;
    const directive = subagentPrompt(location.scope.parentSubagentIR.task);
    return messages =>
      lowerMessages(messages).map(pair => {
        if (pair.converted.role !== "lowered-checkpoint") return pair;
        return {
          original: pair.original,
          converted: {
            ...pair.converted,
            content: [...pair.converted.content, { type: "text", content: "\n\n" }, ...directive],
          },
        };
      });
  }

  private scope(location: ActiveHistory<A>): ArcScope<A> {
    return (
      location.root
        ? { root: true }
        : { root: false, subagent: location.subagent, scope: location.scope }
    ) as ArcScope<A>;
  }

  private async appendIr(
    location: ActiveHistory<A>,
    ir: TreeIR<A> | ToolRejectMessage<A["tools"]>,
  ): Promise<void> {
    // The selected history is a member of this tree, not a root history. The operation's
    // producer supplies its own agent's IR; rejects are only produced when the gate exists.
    const history = location.history as Array<TreeIR<A>>;
    history.push(ir as TreeIR<A>);
    const event = { ...this.scope(location), ir };
    // Scope and IR are correlated by the operation, including after its terminal append.
    await this.params.handler?.onMessage?.(event as ScopedMessages<A>);
  }

  // Fires on the exit signal: when the process dies mid-batch, every call without a recorded
  // answer gets a skip marker, since nothing may run after this. Markers append one at a time,
  // awaiting onMessage each time: the client owns serialization and must have finished
  // persisting before run() resolves.
  private async markExitSkips(): Promise<void> {
    const owner = this.ownership.consume();
    const inspection = this.inspect();
    const running = this._mode.mode === "running-tool" ? this._mode.toolCall.toolCallId : null;
    await this.closeInterruptedWork(inspection.location, owner, running);
  }

  private async closeInterruptedWork(
    location: ActiveHistory<A>,
    owner: OwnershipLockRef,
    running: string | null,
  ): Promise<void> {
    while (true) {
      const inspection = this.inspect();
      if (inspection.location.history === location.history) {
        for (const toolCall of inspection.pendingCalls) {
          await owner.ifOwner(async () => {
            await this.appendIr(location, {
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
      // Response-phase aborts now mark themselves in the arc; don't double-mark.
      const tail = location.history[location.history.length - 1] as LlmIR<any> | undefined;
      if (
        tail?.role !== "interrupted-by-user" &&
        (!location.root || this.inspect().action !== "wait-for-input")
      ) {
        await owner.ifOwner(async () => {
          await this.appendIr(location, {
            role: "interrupted-by-user",
            reason: location.root ? userInterruptReason() : INTERRUPTED_BY_USER_REASON,
          });
        });
      }
      if (location.root) return;
      const next = this.inspect();
      // Another owner may have taken over shutdown while persistence was awaited.
      if (next.location.history === location.history) return;
      location = next.location;
      running = null;
    }
  }

  private async emitSteeringChange(): Promise<void> {
    const pending = [...this.steering.peek()];
    await this.params.handler?.steeringChange?.(
      this.awaitingSteering ? { upcoming: pending, queued: [] } : { upcoming: [], queued: pending },
    );
  }

  private async runArc(
    location: ActiveHistory<A>,
    { model, contextWindow, tools: allTools, modalities }: RuntimeData<A, Model>,
  ): Promise<
    TrajectoryArcFinish<
      Exclude<AllFinishReasons<A>, { type: "request-tool" }> | { type: "request-tool" }
    >
  > {
    const params = this.params;
    const owner = this.ownership.lease();
    const scope = this.scope(location);
    const lowerMessages = this.lowerForLocation(location, modalities);
    const systemPrompt = location.root
      ? params.systemPrompt
      : params.subagentPrompts[location.subagent as keyof SubagentPromptCatalogue<A>];

    // The selected agent B is in A's tree. Narrow the shared catalogues to B at this boundary;
    // the arc still runs with B's history and tools, never with a child retyped as the root.
    const run = <B extends Agent<any, any, any>>(agent: B, history: Array<AgentIR<B>>) =>
      trajectoryArc.run<B, Model>({
        model,
        contextWindow,
        tools: arcTools<A>(agent, allTools) as Partial<LoadedTools<B["tools"]>>,
        messages: history,
        toolData: params.toolData as AgentToolData<B>,
        runCompiler: params.runCompiler,
        lowerMessages: irs =>
          lowerMessages(irs as Array<TreeIR<A>>) as Array<CompilerReadyIR<A> & CompilerReadyIR<B>>,
        systemPrompt,
        transport: params.transport,
        errorCorrection: params.errorCorrection as ErrorCorrection<B> | undefined,
        validationRetries: params.validationRetries,
        requestErrorRetries: params.requestErrorRetries,
        abortSignal: combineSignals([params.abortSignal, this.turnController.signal]),
        handler: {
          startResponse: async event => {
            await this.setArcMode(location, { mode: "responding", control: this.runningControl() });
            await params.handler?.startResponse?.({ ...scope, payload: event });
          },
          responseProgress: async event => {
            await params.handler?.responseProgress?.({ ...scope, payload: event });
          },
          responseProgressRollback: async event => {
            await params.handler?.responseProgressRollback?.({ ...scope, payload: event });
          },
          startCompaction: async event => {
            await this.setArcMode(location, { mode: "compacting", control: this.runningControl() });
            await params.handler?.startCompaction?.({ ...scope, payload: event });
          },
          compactionProgress: async event => {
            await params.handler?.compactionProgress?.({ ...scope, payload: event });
          },
          autofixingJson: async event => {
            await this.setArcMode(location, {
              mode: "autofix-json",
              control: this.runningControl(),
            });
            await params.handler?.autofixingJson?.({ ...scope, payload: event });
          },
          autofixingTool: async event => {
            await this.setArcMode(location, {
              mode: "autofix-tool",
              tool: event.tool,
              control: this.runningControl(),
            });
            await params.handler?.autofixingTool?.({ ...scope, payload: event });
          },
          requestRetry: async event => {
            await this.setArcMode(location, {
              mode: "request-error-retrying",
              error: event.error.requestError,
              attempt: event.attempt,
              delayMs: event.delayMs,
              control: this.runningControl(),
            });
            await params.handler?.requestRetry?.({ ...scope, payload: event });
          },
          onResponseHeaders: async event => {
            await params.handler?.onResponseHeaders?.({ ...scope, payload: event });
          },
          onMessage: ir => owner.ifOwner(() => this.appendIr(location, ir as TreeIR<A>)),
        },
      });
    return run(location.agent, location.history);
  }

  private async startSubagent({
    location,
    tail,
  }: Extract<HistoryInspection<A>, { action: "invoke-subagent" }>): Promise<void> {
    // The invocation and child directory belong to the selected parent in A's tree.
    await this.appendIr(location, {
      role: "subagent-trajectory",
      subagent: tail.subagent,
      toolCall: tail.toolCall,
      task: tail.message,
      ir: [{ role: "user", content: subagentPrompt(tail.message) }],
    } as TreeIR<A>);
  }

  async step(): Promise<boolean> {
    if (this.params.abortSignal.aborted) return false;
    this.turnController = new AbortController();
    this.awaitingSteering = false;

    let inspection = this.inspect();
    while (inspection.action === "rectify" || inspection.action === "invoke-subagent") {
      if (inspection.action === "rectify") {
        const resolved = await this.rectify(inspection);
        if (!resolved.success) return false;
      } else {
        await this.startSubagent(inspection);
      }
      if (this.params.abortSignal.aborted) return false;
      inspection = this.inspect();
      if (this.turnController.signal.aborted) {
        await this.closeInterruptedWork(inspection.location, this.ownership.lease(), null);
        return true;
      }
    }

    const active = inspection;
    const location = active.location;
    const work = await (async (): Promise<
      | Extract<HistoryInspection<A>, { action: "run-tools" }>
      | { action: "respond" }
      | { action: "quit" }
    > => {
      if (active.action === "respond" || active.action === "run-tools") return active;
      this.awaitingSteering = true;
      await this.announceReady(active);
      const waited = await waitSteeringOrExit(this.steering, this.params.abortSignal);
      this.awaitingSteering = false;
      if (!waited.success) return { action: "quit" };
      await this.emitSteeringChange();
      await this.appendIr(location, {
        role: "user",
        content: coalesceUserMessageContent(waited.data),
      });
      return { action: "respond" };
    })();

    if (work.action === "quit" || this.params.abortSignal.aborted) return false;
    const runtimeData = await this.loadRuntimeData(location, this.params.abortSignal);
    if (!runtimeData.success) {
      switch (runtimeData.error.type) {
        case "quit":
          return false;
        case "fatal": {
          const { error } = runtimeData.error;
          const owner = this.ownership.consume();
          if (work.action === "run-tools") {
            const [first, ...remaining] = work.pendingCalls;
            await owner.ifOwner(() =>
              this.appendIr(work.location, {
                role: "tool-runtime-error",
                toolCall: first,
                error,
              }),
            );
            for (const toolCall of remaining) {
              await owner.ifOwner(() =>
                this.appendIr(work.location, {
                  role: "tool-skip-output",
                  toolCall,
                  reason: FAILED_TOOL_SKIP_REASON,
                }),
              );
            }
          }
          throw new Error(error);
        }
        case "auth-error":
          if (this.params.abortSignal.aborted) return false;
          await this.appendIr(location, {
            role: "auth-error",
            authError: runtimeData.error.authError,
          });
          return true;
      }
    }
    if (this.params.abortSignal.aborted) return false;
    let runtime = runtimeData.data;
    if (work.action === "run-tools") {
      const batch = await this.runToolBatch(work, runtime);
      if (!batch.success) {
        if (this.params.abortSignal.aborted) return false;
        await this.closeInterruptedWork(location, this.ownership.lease(), null);
        return true;
      }
      if (this.params.abortSignal.aborted) return false;
      inspection = this.inspect();
      if (inspection.action === "invoke-subagent") {
        await this.startSubagent(inspection);
        if (this.params.abortSignal.aborted) return false;
        inspection = this.inspect();
        if (this.turnController.signal.aborted) {
          await this.closeInterruptedWork(inspection.location, this.ownership.lease(), null);
          return true;
        }
      }
      if (inspection.action !== "respond") return true;
      if (inspection.location.history !== location.history) {
        const model = await this.params.model(
          inspection.location.root ? null : inspection.location.invocation,
        );
        if (this.params.abortSignal.aborted) return false;
        if (!model.success) {
          await this.appendIr(inspection.location, {
            role: "auth-error",
            authError: model.error.authError,
          });
          return true;
        }
        runtime = { ...runtime, ...model.data };
      }
    }
    await this.respond(inspection.location, runtime);
    return !this.params.abortSignal.aborted;
  }

  async run(): Promise<void> {
    const loopController = this.params.loopController ?? defaultLoopController;
    await loopController(() => this.step());
    await this._finish;
  }

  private async loadRuntimeData(
    location: ActiveHistory<A>,
    signal: AbortSignal,
  ): Promise<Result<RuntimeData<A, Model>, TrajectoryModelError | TrajectoryToolLoadError>> {
    const [modelResult, toolsResult] = await Promise.all([
      this.params.model(location.root ? null : location.invocation),
      this.params.loadTools(signal),
    ]);
    if (!modelResult.success) return modelResult;
    if (!toolsResult.success) return toolsResult;
    return ok({ ...modelResult.data, tools: toolsResult.data });
  }

  private async respond(
    location: ActiveHistory<A>,
    runtimeData: RuntimeData<A, Model>,
  ): Promise<void> {
    if (location.root) {
      const queued = this.steering.take();
      if (queued.length > 0) {
        await this.emitSteeringChange();
        await this.appendIr(location, {
          role: "user",
          content: coalesceUserMessageContent(queued),
        });
      }
    }
    const { reason } = await this.runArc(location, runtimeData);
    if (reason.type === "abort" && !this.params.abortSignal.aborted) {
      await this.closeInterruptedWork(location, this.ownership.lease(), null);
    }
  }

  private async rectify({
    location,
    tail,
    pendingCalls,
  }: Extract<HistoryInspection<A>, { action: "rectify" }>): Promise<
    Result<Rectification, "aborted">
  > {
    const rectification = rectifiable(this.params.abortSignal);
    const retry = () => rectification.resolve({ type: "retry" });

    switch (tail.role) {
      case "auth-error":
        await this.setArcMode(location, {
          mode: "auth-error",
          authError: tail.authError,
          control: { retry, clear: () => rectification.resolve({ type: "await-input" }) },
        });
        break;
      case "payment-error":
      case "rate-limit-error":
        await this.setArcMode(location, {
          mode: tail.role,
          requestError: tail.requestError,
          control: { retry },
        });
        break;
      case "request-error":
      case "compaction-error":
      case "validation-retry-budget-exceeded": {
        await this.setMode({
          root: true,
          mode: tail.role === "compaction-error" ? "compaction-error" : "request-error",
          requestError:
            tail.role === "validation-retry-budget-exceeded" ? tail.error : tail.requestError,
          curl: tail.role === "validation-retry-budget-exceeded" ? null : tail.curl,
          control: {
            retry,
            rewind: async () => {
              if (!rectification.live) return;
              rectification.live = false;
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
              await this.emitSteeringChange();
              await this.params.handler?.rewind?.({ removed, content });
              if (this.inspect().action !== "wait-for-input") {
                await this.appendIr(location, { role: "error-dismissed" });
              }
              rectification.resolve({ type: "rewind", target: "last-user-message" });
            },
          },
        });
        break;
      }
    }

    const resolved = await rectification.resolved;
    if (!resolved.success || resolved.data.type === "rewind") return resolved;
    if (this.params.abortSignal.aborted) return err("aborted");
    const retrying = resolved.data.type === "retry" || !location.root || pendingCalls.length > 0;
    await this.appendIr(location, { role: retrying ? "error-retry" : "error-dismissed" });
    return resolved;
  }

  private async runTool(
    inspection: Extract<HistoryInspection<A>, { action: "run-tools" }>,
    signal: AbortSignal,
    tools: Partial<AllToolsAcrossTree<A>>,
    contextWindow: number,
    modalities: MultimodalConfig | null,
  ): Promise<TreeIR<A>> {
    const toolCall = inspection.pendingCalls[0];
    const defs = Object.values<AllToolsAcrossTree<A>[keyof AllToolsAcrossTree<A>] | undefined>(
      tools,
    );
    const def = defs.find(loaded => loaded?.name === toolCall.name);
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
      // The loaded tool's subagent dependency belongs to the selected agent's directory.
      return {
        role: "tool-invoke-subagent",
        toolCall,
        subagent: output.data.name,
        message: output.data.message,
        model: output.data.model,
      } as TreeIR<A>;
    }

    let ir: TreeIR<A>;
    if (output.data.type === "output") {
      ir = { role: "tool-output", toolCall, content: output.data.content };
    } else {
      const _: "custom-ir" = output.data.type;
      // The loaded tool's branded extension belongs to the selected agent in A's tree.
      ir = output.data.data as TreeIR<A>;
    }

    // Token counts and lowering aren't summable, and exact tokenizers can't necessarily count
    // an unpaired tool output in isolation, so measure the delta the output adds to the full
    // lowered history.
    const countTokens = this.params.countTokens ?? defaultCountTokens;
    const maxToolOutput =
      this.params.maxToolOutput ?? Math.floor(contextWindow * DEFAULT_MAX_TOOL_OUTPUT_FRACTION);
    const history = inspection.location.history;
    const lowerMessages = this.lowerForLocation(inspection.location, modalities);
    const tokens =
      countTokens(lowerMessages([...history, ir]).map(({ converted }) => converted)) -
      countTokens(lowerMessages(history).map(({ converted }) => converted));
    if (tokens >= maxToolOutput) {
      return {
        role: "tool-runtime-error",
        toolCall,
        error: await this.params.toolContentTooLargeError(ir),
      };
    }
    return ir;
  }

  private async runToolBatch(
    inspection: Extract<HistoryInspection<A>, { action: "run-tools" }>,
    runtimeData: RuntimeData<A, Model>,
  ): Promise<Result<null, "aborted">> {
    const { location } = inspection;
    const tools = arcTools<A>(location.agent, runtimeData.tools);
    const toolCalls = inspection.pendingCalls;
    const owner = this.ownership.lease();
    const signal = combineSignals([this.params.abortSignal, this.turnController.signal]);
    await this.setArcMode(location, {
      mode: "tool-call",
      toolCalls,
      control: this.runningControl(),
    });

    const skipPending = async (reason: string) => {
      const current = this.inspect();
      if (current.location.history !== location.history) return;
      for (const toolCall of current.pendingCalls) {
        await owner.ifOwner(async () => {
          await this.appendIr(location, { role: "tool-skip-output", toolCall, reason });
        });
      }
    };
    let current: HistoryInspection<A> = inspection;
    let skipReason: string | null = null;
    let steering: UserMessage["content"] | null = null;
    let aborted = false;

    try {
      while (current.action === "run-tools" && current.location.history === location.history) {
        const toolCall = current.pendingCalls[0];
        if (this.permissionGate != null) {
          await this.setArcMode(location, {
            mode: "tool-call-permission",
            toolCalls,
            toolCall,
            control: this.interruptControl(),
          });
          const decision = await waitForPermissionDecision(this.permissionGate, toolCall, signal);
          if (!decision.success) {
            skipReason = ABORTED_TOOL_SKIP_REASON;
            aborted = true;
            break;
          }
          if (decision.data.decision === "reject") {
            await owner.ifOwner(async () => {
              await this.appendIr(location, { role: "tool-reject", toolCall });
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
        await this.setArcMode(location, {
          mode: "running-tool",
          toolCalls,
          toolCall,
          control: this.runningControl(),
        });
        const result = await this.runTool(
          current,
          signal,
          tools,
          runtimeData.contextWindow,
          runtimeData.modalities,
        );
        await owner.ifOwner(async () => {
          await this.appendIr(location, result);
        });
        if (signal.aborted) {
          skipReason = ABORTED_TOOL_SKIP_REASON;
          aborted = true;
          break;
        }
        current = this.inspect();
      }
    } catch (e) {
      await skipPending(FAILED_TOOL_SKIP_REASON);
      throw e;
    }

    if (skipReason != null) await skipPending(skipReason);
    if (steering != null) {
      await owner.ifOwner(async () => {
        await this.appendIr(location, { role: "user", content: steering });
      });
    }
    if (aborted) return err("aborted");
    return ok(null);
  }
}

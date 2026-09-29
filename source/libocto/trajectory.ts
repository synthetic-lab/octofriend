import { messageText } from "./llm-ir.ts";
import type {
  Agent,
  AgentIR,
  IsPermissioned,
  LlmIR,
  LoweredIR,
  ToolRejectMessage,
  UserMessage,
} from "./llm-ir.ts";
import type { LoadedTools, ToolCall, ToolExtensionIR, ToolReturn } from "./tool-def.ts";
import { combineSignals } from "./signals.ts";
import { Input } from "./input.ts";
import { err, ok, type Result } from "./result.ts";
import { waitForPermissionDecision, type PermissionGate } from "./permissions.ts";
import {
  trajectoryArc,
  type AllFinishReasons,
  type TrajectoryArcEvents,
  type TrajectoryArcFinish,
  type TrajectoryArcParams,
} from "./trajectory-arc.ts";

export type InputControl = {
  enqueueSteering(content: UserMessage["content"]): void;
};

export type RunningControl = InputControl & {
  interrupt(): void;
};

export type RetryControl = {
  retry(): void;
};

export type RectifyControl = RetryControl & {
  // Trims history back past the most recent user message and fires the rewind event with its
  // content (or null when there is no user message), so the client can offer it for editing;
  // the loop resumes waiting for input.
  rewind(): void;
};

export type ClearControl = {
  clear(): void;
};

/*
 * What the trajectory is doing right now. Modes carry control objects: the only actions a client
 * can take in a mode are the ones its control exposes. Controls check that they are still the
 * live control before acting, so stale calls (double presses, mirrors lagging reality) are no-ops.
 *
 * The only terminal mode is "aborted" — run() resolves once the exit signal fires, and never
 * otherwise; everything else parks waiting on a control.
 */
export type TrajectoryMode<A extends Agent<any, any, any>> =
  | { mode: "ready-for-request"; control: InputControl }
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
  | { mode: "payment-error"; requestError: string; control: RetryControl }
  | { mode: "rate-limit-error"; requestError: string; control: RetryControl }
  | { mode: "auth-error"; authError: string; control: RetryControl & ClearControl }
  | { mode: "aborted" }
  | ([IsPermissioned<A>] extends [true]
      ? {
          mode: "tool-call-permission";
          toolCalls: Array<ToolCall<A["tools"]>>;
          toolCall: ToolCall<A["tools"]>;
          control: { interrupt(): void };
        }
      : never);

/*
 * Trajectory events are notifications only: handlers never feed back into the loop. onMessage
 * fires for every canonical history append; modeChange fires for every transition; arc events
 * are forwarded unchanged.
 */
export type TrajectoryEvents<A extends Agent<any, any, any>> = Omit<
  TrajectoryArcEvents<A>,
  "onMessage"
> & {
  onMessage: AgentIR<A>;
  modeChange: TrajectoryMode<A>;
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

export type TrajectoryParams<A extends Agent<any, any, any>, Model> = Omit<
  TrajectoryArcParams<A, Model>,
  "handler" | "abortSignal" | "model" | "contextWindow" | "tools"
> & {
  // Exit-level signal: firing it ends the trajectory (lands in the "aborted" mode).
  abortSignal: AbortSignal;
  handler?: TrajectoryHandler<A>;
  // Re-resolved before every arc, so a retry always sees fresh credentials and config; a
  // resolution error lands in the same mode as the equivalent compiler finish.
  model: () => Promise<Result<{ model: Model; contextWindow: number }, TrajectoryModelError>>;
  loadTools: (signal: AbortSignal) => Promise<Partial<LoadedTools<A["tools"]>>>;
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

type RunArgsFor<Def> = Def extends { run: (args: infer Args) => unknown } ? Args : never;

export type TrajectoryLoopController = (step: () => Promise<boolean>) => Promise<void>;

export async function defaultLoopController(step: () => Promise<boolean>): Promise<void> {
  while (await step()) continue;
}

const DEFAULT_MAX_TOOL_OUTPUT_FRACTION = 0.2;

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

// How an error mode resolves: "retry" re-runs the arc, "rewind" trims history to the given
// target, and "await-input" ignores the error entirely; the latter two hand the loop back to
// the user's input.
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

export class Trajectory<A extends Agent<any, any, any>, Model> {
  private readonly history: Array<AgentIR<A>>;
  private _mode: TrajectoryMode<A>;
  private turnController = new AbortController();
  private readonly steering = new Input<UserMessage["content"]>();
  private readonly permissionGate: PermissionGate<A> | undefined;
  private stepState:
    | { type: "wait-for-input" }
    | {
        type: "wait-for-tool";
        toolCalls: Array<ToolCall<A["tools"]>>;
        tools: Partial<LoadedTools<A["tools"]>>;
        contextWindow: number;
      }
    | { type: "needs-rectification"; resolved: Promise<Result<Rectification, "aborted">> } = {
    type: "wait-for-input",
  };
  private awaitingSteering = true;

  constructor(private readonly params: TrajectoryParams<A, Model>) {
    this.history = [...params.messages];
    this._mode = { mode: "ready-for-request", control: this.inputControl() };
    // The permission param is conditional on the IsPermissioned brand, which TS can't reduce
    // for a generic A; check for its presence at runtime instead.
    this.permissionGate =
      "permission" in params ? (params.permission as PermissionGate<A>) : undefined;
  }

  get mode(): TrajectoryMode<A> {
    return this._mode;
  }

  get messages(): ReadonlyArray<AgentIR<A>> {
    return [...this.history];
  }

  private inputControl(): InputControl {
    return {
      enqueueSteering: content => {
        this.steering.push(content);
        this.emitSteeringChange();
      },
    };
  }

  private interruptControl(): { interrupt(): void } {
    return {
      interrupt: () => {
        this.steering.clear();
        this.emitSteeringChange();
        this.turnController.abort();
      },
    };
  }

  private runningControl(): RunningControl {
    return { ...this.inputControl(), ...this.interruptControl() };
  }

  private async setMode(mode: TrajectoryMode<A>): Promise<void> {
    this._mode = mode;
    await this.params.handler?.modeChange?.(mode);
  }

  // Parks the trajectory until the user sends input. The ready announce is suppressed when
  // steering is already buffered, since the next step consumes it immediately.
  private async awaitInput(): Promise<void> {
    this.stepState = { type: "wait-for-input" };
    if (this.steering.peek().length > 0) return;
    await this.setMode({ mode: "ready-for-request", control: this.inputControl() });
  }

  // Everything the loop appends lives in the permissioned universe; AgentIR narrows that by the
  // agent's permission capability, which TS can't reduce for a generic A.
  private appendIr(ir: LlmIR<A> | ToolRejectMessage<A["tools"]>): void {
    const agentIr = ir as AgentIR<A>;
    this.history.push(agentIr);
    this.params.handler?.onMessage?.(agentIr);
  }

  private emitSteeringChange(): void {
    const pending = this.steering.peek();
    void this.params.handler?.steeringChange?.(
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
      lowerMessages: params.lowerMessages,
      systemPrompt: params.systemPrompt,
      transport: params.transport,
      errorCorrection: params.errorCorrection,
      validationRetries: params.validationRetries,
      requestErrorRetries: params.requestErrorRetries,
      abortSignal: combineSignals([params.abortSignal, this.turnController.signal]),
      handler: {
        startResponse: event => {
          void this.setMode({ mode: "responding", control: this.runningControl() });
          params.handler?.startResponse?.(event);
        },
        responseProgress: event => params.handler?.responseProgress?.(event),
        startCompaction: event => {
          void this.setMode({ mode: "compacting", control: this.runningControl() });
          params.handler?.startCompaction?.(event);
        },
        compactionProgress: event => params.handler?.compactionProgress?.(event),
        autofixingJson: event => {
          void this.setMode({ mode: "autofix-json", control: this.runningControl() });
          params.handler?.autofixingJson?.(event);
        },
        autofixingTool: event => {
          void this.setMode({
            mode: "autofix-tool",
            tool: event.tool,
            control: this.runningControl(),
          });
          params.handler?.autofixingTool?.(event);
        },
        requestRetry: event => {
          void this.setMode({
            mode: "request-error-retrying",
            error: event.error.requestError,
            attempt: event.attempt,
            delayMs: event.delayMs,
            control: this.runningControl(),
          });
          params.handler?.requestRetry?.(event);
        },
        onResponseHeaders: event => params.handler?.onResponseHeaders?.(event),
        onMessage: ir => this.appendIr(ir),
      },
    });
  }

  async step(): Promise<boolean> {
    this.turnController = new AbortController();
    switch (this.stepState.type) {
      case "wait-for-input": {
        this.awaitingSteering = true;
        const waited = await waitSteeringOrExit(this.steering, this.params.abortSignal);
        this.awaitingSteering = false;
        if (!waited.success) return false;
        this.emitSteeringChange();
        this.appendIr({ role: "user", content: coalesceUserMessageContent(waited.data) });
        break;
      }
      case "wait-for-tool": {
        const batch = await this.runToolBatch(this.stepState);
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
        if (resolved.data.type !== "retry") {
          await this.awaitInput();
          return true;
        }
        break;
      }
    }
    if (this.params.abortSignal.aborted) return false;
    await this.respond();
    if (this.params.abortSignal.aborted) return false;
    return true;
  }

  async run(): Promise<void> {
    const loopController = this.params.loopController ?? defaultLoopController;
    await loopController(() => this.step());
    await this.setMode({ mode: "aborted" });
  }

  private async respond(): Promise<void> {
    const queued = this.steering.take();
    if (queued.length > 0) {
      this.emitSteeringChange();
      this.appendIr({ role: "user", content: coalesceUserMessageContent(queued) });
    }
    const [modelResult, tools] = await Promise.all([
      this.params.model(),
      this.params.loadTools(combineSignals([this.params.abortSignal, this.turnController.signal])),
    ]);
    if (!modelResult.success) {
      await this.authError(modelResult.error.authError);
      return;
    }
    const reason = (
      await this.runArc(modelResult.data.model, modelResult.data.contextWindow, tools)
    ).reason;

    switch (reason.type) {
      case "abort":
      case "needs-response": {
        await this.awaitInput();
        return;
      }
      case "request-tool": {
        this.stepState = {
          type: "wait-for-tool",
          toolCalls: reason.toolCalls,
          tools,
          contextWindow: modelResult.data.contextWindow,
        };
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
        await this.rectify(
          "request-error",
          "The model repeatedly produced invalid tool calls",
          null,
        );
        return;
      }
    }
  }

  private async authError(authError: string): Promise<void> {
    const rectification = rectifiable(this.params.abortSignal);
    this.stepState = { type: "needs-rectification", resolved: rectification.resolved };
    await this.setMode({
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
      mode: error,
      requestError,
      curl,
      control: {
        retry: () => rectification.resolve({ type: "retry" }),
        rewind: () => {
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
          this.emitSteeringChange();
          rectification.resolve({ type: "rewind", target: "last-user-message" });
          void this.params.handler?.rewind?.({ removed, content });
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
      countTokens(this.params.lowerMessages([...this.history, ir])) -
      countTokens(this.params.lowerMessages(this.history));
    if (tokens >= maxToolOutput) {
      return {
        role: "tool-runtime-error",
        toolCall,
        error: await this.params.toolContentTooLargeError(ir),
      };
    }
    return ir;
  }

  private async runToolBatch(batch: {
    toolCalls: Array<ToolCall<A["tools"]>>;
    tools: Partial<LoadedTools<A["tools"]>>;
    contextWindow: number;
  }): Promise<Result<null, "aborted">> {
    const { toolCalls } = batch;
    const signal = combineSignals([this.params.abortSignal, this.turnController.signal]);
    await this.setMode({ mode: "tool-call", toolCalls, control: this.runningControl() });

    let stoppedAt: { from: number; reason: string } | null = null;
    let steering: UserMessage["content"] | null = null;
    let aborted = false;

    let index = 0;
    try {
      for (; index < toolCalls.length; index++) {
        const toolCall = toolCalls[index];

        if (this.permissionGate != null) {
          // The permission mode is conditional on the IsPermissioned brand, which TS can't reduce
          // for a generic A; the gate's presence proves it at runtime.
          await this.setMode({
            mode: "tool-call-permission",
            toolCalls,
            toolCall,
            control: this.interruptControl(),
          } as TrajectoryMode<A>);
          const decision = await waitForPermissionDecision(this.permissionGate, toolCall, signal);
          if (!decision.success) {
            stoppedAt = { from: index, reason: ABORTED_TOOL_SKIP_REASON };
            aborted = true;
            break;
          }
          if (decision.data.decision === "reject") {
            this.appendIr({ role: "tool-reject", toolCall });
            stoppedAt = { from: index + 1, reason: REJECTED_TOOL_SKIP_REASON };
            steering = decision.data.steering;
            break;
          }
        }

        if (signal.aborted) {
          stoppedAt = { from: index, reason: ABORTED_TOOL_SKIP_REASON };
          aborted = true;
          break;
        }

        await this.setMode({
          mode: "running-tool",
          toolCalls,
          toolCall,
          control: this.runningControl(),
        });
        const result = await this.runTool(toolCall, signal, batch.tools, batch.contextWindow);
        this.appendIr(result);

        // A settled tool always keeps its recorded output; an abort only skips what never ran.
        if (signal.aborted) {
          stoppedAt = { from: index + 1, reason: ABORTED_TOOL_SKIP_REASON };
          aborted = true;
          break;
        }
      }
    } catch (e) {
      // The throw strands every call from this one on with no answer, breaking tool pairing;
      // mark them skipped so a crashed trajectory still leaves a hydratable history.
      for (const toolCall of toolCalls.slice(index)) {
        this.appendIr({ role: "tool-skip-output", toolCall, reason: FAILED_TOOL_SKIP_REASON });
      }
      throw e;
    }

    if (stoppedAt != null) {
      for (const toolCall of toolCalls.slice(stoppedAt.from)) {
        this.appendIr({ role: "tool-skip-output", toolCall, reason: stoppedAt.reason });
      }
    }
    if (steering != null) this.appendIr({ role: "user", content: steering });
    if (aborted) return err("aborted");
    return ok(null);
  }
}

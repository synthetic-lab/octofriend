import { ImageInfo } from "../utils/image-utils.ts";
import { BUILTIN_IR_ROLES } from "./ir-roles.ts";
import type { BuiltinIRRole } from "./ir-roles.ts";
import type { CompilerUsage } from "./compilers/compiler-interface.ts";
import type {
  ToolCall,
  ToolExtensionIR,
  ToolFactory,
  ToolFactoryRequirements,
  ToolMap,
  ToolSubagentNames,
} from "./tool-def.ts";

/*
 * LLM IR
 * -------------------------------------------------------------------------------------------------
 *
 * This defines a set of base IRs, which can be extended by callers using an Extra type.
 *
 * LLM compilers only accept the unextended base IRs. However, callers can use additional IR types
 * and convert them in a pre-compile pass to the lowered types, and tools can declare specific
 * IR extension requirements and can return those extended IRs, to help track richer information
 * that might be useful for pre-compile optimization passes.
 */

/*
 * IRs are all defined in terms of agents. Agents specify what tools they use, what subagents they
 * have, and what extended IRs they use.
 */
export type Agent<
  Extra extends ToolExtensionIR<any>,
  SubagentDirectory extends AgentDirectory,
  Tools extends ToolMap<Extract<keyof SubagentDirectory, string>, Extra>,
> = {
  tools: Tools;
  agents: SubagentDirectory;
};

// A named directory of agents
export type AgentDirectory = {
  [name: string]: Agent<any, any, any>;
};

/*
 * Permissioned vs permissionless agents
 * -------------------------------------------------------------------------------------------------
 *
 * A permissioned agent is driven by a loop that gates tool calls behind permission checks, which
 * means its history can contain tool-reject IRs (the only IR a permission gate can produce that a
 * tool cannot). A permissionless agent — e.g. a simple research agent whose tools all always run —
 * never produces rejects, so its IR universe excludes them and exhaustive switches over IR roles
 * never need a reject case.
 *
 * The capability is tracked via a unique-symbol brand assigned by definePermissionedAgent, and is
 * uniform across a tree (see ValidateAgentSubagents): every subagent of a permissioned agent is
 * permissioned, and no subagent of a permissionless agent is. The two constructor functions make
 * the choice obvious at the definition site and in review, and the tree holds no mixes, so the
 * runner never needs a runtime probe to know which way it goes.
 */
declare const permissionedAgentBrand: unique symbol;

export type PermissionedBrand = {
  readonly [permissionedAgentBrand]: true;
};

export type IsPermissioned<A extends Agent<any, any, any>> = A extends PermissionedBrand
  ? true
  : false;

export type PermissionedAgent<
  Extra extends ToolExtensionIR<any>,
  SubagentDirectory extends AgentDirectory,
  Tools extends ToolMap<Extract<keyof SubagentDirectory, string>, Extra>,
> = Agent<Extra, SubagentDirectory, Tools> & PermissionedBrand;

export type PermissionlessAgent<
  Extra extends ToolExtensionIR<any>,
  SubagentDirectory extends AgentDirectory,
  Tools extends ToolMap<Extract<keyof SubagentDirectory, string>, Extra>,
> = Agent<Extra, SubagentDirectory, Tools>;

// Helper functions to define agents with compile-time safety guarantees. They're identity functions
// that run compile-time validation on the passed-in agent and assign the correct type + branding.
export function definePermissionedAgent<
  A extends { tools: ToolMap<any, any>; agents: AgentDirectory },
>(a: A & ValidateAgentSubagents<A, true>): A & PermissionedBrand {
  return a as unknown as A & PermissionedBrand;
}

export function definePermissionlessAgent<
  A extends { tools: ToolMap<any, any>; agents: AgentDirectory },
>(a: A & ValidateAgentSubagents<A, false>): A {
  return a;
}

// Back-compat alias. Defines a permissionless agent; prefer the explicit name in new code.
export const defineAgent = definePermissionlessAgent;

// An IR that defines sub-agent trajectories
export type AgentTrajectory<
  Agents extends AgentDirectory,
  Name extends keyof Agents,
  Tools extends ToolMap<any, any>,
> = {
  role: "subagent-trajectory";
  subagent: Name;
  ir: Array<AgentIR<Agents[Name]>>;
  // The parent tool call that delegated to the subagent.
  toolCall: ToolCall<Tools>;
};

// The trajectory leg of a full IR universe: one member per subagent, so subagent can be used as a
// discriminant to narrow the child IR universe and the parent tool call like any other IR role.
export type AllTrajectories<Agents extends AgentDirectory, Tools extends ToolMap<any, any>> = {
  [K in keyof Agents]: AgentTrajectory<Agents, K, Tools>;
}[keyof Agents];

// Every subagent name anywhere in the agent tree, as one flat union: tree-wide params
// (e.g. the system prompt catalogue) key off this rather than a single level's directory.
export type AllSubagentNames<A extends Agent<any, any, any>> =
  | Extract<keyof A["agents"], string>
  | {
      [K in keyof A["agents"]]: AllSubagentNames<A["agents"][K]>;
    }[keyof A["agents"]];

// The tool maps of every level in the tree, intersected into one. A key used at more than one
// level must be the same factory, so one loaded entry serves every level declaring it.
type TreeToolMap<A extends Agent<any, any, any>> = UnionToIntersection<
  | A["tools"]
  | {
      [K in keyof A["agents"]]: TreeToolMap<A["agents"][K]>;
    }[keyof A["agents"]]
>;

type UnionToIntersection<U> = (U extends U ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

// What the one tree-wide loader produces: every level's tools, merged by key, each entry the
// loaded definition of exactly the tool declared under that key. The value conditionals stay
// deferred so no ToolMap constraint has to be proven through the opaque intersection above —
// LoadedTools needs the same per-key formula, but can rely on its ToolMap constraint instead.
// The runner filters each arc's subset out of this merged map.
export type AllToolsAcrossTree<A extends Agent<any, any, any>> = {
  [K in keyof TreeToolMap<A>]: TreeToolMap<A>[K] extends ToolFactory<
    infer D,
    infer S,
    infer P,
    infer Subs,
    infer E
  >
    ? Exclude<Awaited<ReturnType<ToolFactory<D, S, P, Subs, E>>>, null>
    : never;
};

// A type guard to check whether an AgentTrajectory belongs to a specific named subagent. This is
// useful since different subagents may have different tools, so you can narrow which tools an
// if-statement needs to check for by first checking which subagent you're dealing with.
// For example:
//
// if(trajectoryIsNamed(ir, "research")) {
//   // Only tools and subagents that the research subagent has access to are accessible here
// }
export function trajectoryIsNamed<
  T extends AgentDirectory,
  K extends keyof T,
  Tools extends ToolMap<any, any>,
>(
  trajectory: AllTrajectories<T, Tools>,
  subagent: K,
): trajectory is Extract<AllTrajectories<T, Tools>, { subagent: K }> {
  return trajectory.subagent === subagent;
}

// A helpful function for checking *all* possible subagent names, and narrowing each one down in a
// callback. For example, if you had "explore" and "research" subagents, you might call:
//
// trajectoryCond(ir, {
//   explore: exploreIr => {
//     // exploreIr is guaranteed to be an explore subagent trajectory
//     // any tools and subagents are narrowed to only what's accessible to the explore subagent
//   },
//   research: researchIr => {
//     // researchIr is guaranteed to be a research subagent trajectory
//     // any tools and subagents are narrowed to only what's accessible to the research subagent
//   },
// });
//
// Like Lisp-like `cond` expressions, `trajectoryCond` returns whatever the cond arms return. It
// can take either synchronous handlers, or async handlers. If it takes sync handlers, it returns
// a non-promise; if it takes async handlers, it returns a promise that you can await.
//
// For example:
//
// const output = await trajectoryCond(ir, {
//   explore: async (exploreIr) => {
//     return someOutput;
//   },
//   research: async (researchIr) => {
//     return someOtherOutput;
//   },
// });
//
// Note that the handlers must be all-async, or all-sync; you can't mix sync and async.
export function trajectoryCond<
  T extends AgentDirectory,
  Name extends keyof T,
  C extends CondHandlerMap<T, Name>,
>(
  trajectory: AllTrajectories<T, any> & { subagent: Name },
  conditions: C & CondHandlerAsyncValidation<C>,
): CondReturn<C> {
  for (const [k, v] of Object.entries(conditions) as Array<
    [keyof C, (self: AgentTrajectory<T, Name, any>) => unknown]
  >) {
    if (k === trajectory.subagent) {
      return v(trajectory as AgentTrajectory<T, Name, any>) as CondReturn<C>;
    }
  }
  throw new Error("Impossible");
}
type CondHandlerMap<T extends AgentDirectory, Name extends keyof T> = {
  [K in Name]: (self: AgentTrajectory<T, K, any>) => unknown;
};
type CondHandlerReturn<C> = C[keyof C] extends (...args: any) => infer Ret ? Ret : never;
declare const mixedCondHandlerReturns: unique symbol;

// cond(...) preserves sync handlers as sync returns and async handlers as Promise returns. A plain
// conditional return type is not enough, because TypeScript can infer a mixed table as
// `string | Promise<string>`. This parameter-side validation rejects handler maps where some
// branches return PromiseLike values and others return non-Promise values.
type CondHandlerAsyncValidation<C> =
  Extract<CondHandlerReturn<C>, PromiseLike<unknown>> extends never
    ? unknown
    : Exclude<CondHandlerReturn<C>, PromiseLike<unknown>> extends never
      ? unknown
      : { readonly [mixedCondHandlerReturns]: never };

// Once mixed sync/async tables are rejected, cond(...) can return exactly what callers expect:
// sync tables return their handler value directly, async tables return one Promise for the awaited
// handler value union.
type CondReturn<C> =
  Extract<CondHandlerReturn<C>, PromiseLike<unknown>> extends never
    ? CondHandlerReturn<C>
    : Promise<Awaited<CondHandlerReturn<C>>>;

export type MalformedToolRequest = {
  type: "malformed-tool-request";
  error: string;
  call: {
    original: {
      name: string;
      arguments: any;
    };
  };
  toolCallId: string;
};

export type AnthropicAssistantData = {
  thinkingBlocks: Array<
    | {
        type: "thinking";
        thinking: string;
        signature: string;
      }
    | {
        type: "redacted_thinking";
        data: string;
      }
  >;
};

export type Content = {
  content: Array<
    | {
        type: "text";
        content: string;
      }
    | {
        type: "image";
        image: ImageInfo;
      }
  >;
};

export type Checkpoint = Content & {
  role: "checkpoint";
};

export type LoweredCheckpoint = Content & {
  role: "lowered-checkpoint";
};

export type AssistantMessage<T extends ToolMap<any, any>> = {
  role: "assistant";
  content: string;
  reasoningContent?: string | null;
  openai?: {
    encryptedReasoningContent?: string | null;
    reasoningId?: string;
  };
  anthropic?: AnthropicAssistantData;
  toolCalls?: Array<ToolCall<T> | MalformedToolRequest>;
  usage: CompilerUsage;
};

export type UserMessage = Content & {
  role: "user";
};

export type ToolOutputMessage<T extends ToolMap<any, any>> = Content & {
  role: "tool-output";
  toolCall: ToolCall<T>;
};

export type ToolRuntimeErrorMessage<T extends ToolMap<any, any>> = {
  role: "tool-runtime-error";
  toolCall: ToolCall<T>;
  error: string;
};

export type ToolValidationErrorMessage<T extends ToolMap<any, any>> = {
  role: "tool-validation-error";
  toolCall: ToolCall<T>;
  error: string;

  // TODO: remove this, if the validation is aborted treat it like an assistant message abort
  aborted: boolean;
};

export type ToolParseErrorMessage = {
  role: "tool-parse-error";
  malformedRequest: MalformedToolRequest;
};

export type ToolSkipOutputMessage<T extends ToolMap<any, any>> = {
  role: "tool-skip-output";
  toolCall: ToolCall<T>;
  reason: string;
};

/*
 * A tool call that was rejected by the harness (e.g. a user denied a permission prompt).
 *
 * Rejects only exist for permissioned agents (see definePermissionedAgent): an agent loop that
 * runs a permission gate is the only thing that can produce one. They are permissioned-only
 * history IRs — never compiler-facing — because lower(...) converts every tool-reject to a
 * tool-skip-output before any compiler can see it. This mirrors Checkpoint, which similarly
 * exists in CheckpointedIR but not LoweredIR.
 */
export type ToolRejectMessage<T extends ToolMap<any, any>> = {
  role: "tool-reject";
  toolCall: ToolCall<T>;
};

export type RequestErrorIR = {
  role: "request-error";
  requestError: string;
  curl: string;
};

export type CompactionErrorIR = {
  role: "compaction-error";
  requestError: string;
  curl: string | null;
};

export type ValidationRetryBudgetExceededIR = {
  role: "validation-retry-budget-exceeded";
  error: string;
};

export type InterruptedByUserIR = {
  role: "interrupted-by-user";
  reason: string;
};

export type ToolSubagentInvoke<T extends ToolMap<any, any>, SubagentName extends string> = {
  role: "tool-invoke-subagent";
  toolCall: ToolCall<T>;
  subagent: SubagentName;
  message: UserMessage["content"];
};

/*
 * All compiler-ready base IR types, with no extension IR types and no subagent trajectories.
 *
 * Raw Checkpoint IR is intentionally not part of LoweredIR. Checkpoints only make sense before the
 * final lowering pass, because lower(...) must first discard everything before the most recent
 * checkpoint. To make that easy to enforce at compile time, callers target CheckpointedIR with raw
 * Checkpoints, and lower(...) converts the surviving checkpoint to LoweredCheckpoint before any
 * compiler can see it.
 */
export type LoweredIR<T extends ToolMap<any, any>> =
  | AssistantMessage<T>
  | UserMessage
  | ToolOutputMessage<T>
  | ToolRuntimeErrorMessage<T>
  | ToolValidationErrorMessage<T>
  | ToolParseErrorMessage
  | ToolSkipOutputMessage<T>
  | LoweredCheckpoint;

/*
 * LoweredIR with pre-compiler checkpoints.
 *
 * This is the shape user-space lowering passes should target after converting custom extension IRs,
 * but before calling libocto's final lower(...). It is identical to LoweredIR except that it carries
 * raw Checkpoints instead of LoweredCheckpoints, forcing the final checkpoint slicing/conversion pass
 * to happen before compiler use.
 */
export type CheckpointedIR<T extends ToolMap<any, any>> =
  | Exclude<LoweredIR<T>, LoweredCheckpoint>
  | Checkpoint
  | RequestErrorIR
  | CompactionErrorIR
  | ValidationRetryBudgetExceededIR
  | InterruptedByUserIR;

/*
 * Compiler-ready IR plus subagent trajectories.
 *
 * This is the shape callers should produce after lowering their custom IR extensions, but before
 * deciding how to represent nested subagent trajectories for a concrete compiler.
 */
export type LoweredIRWithTrajectories<A extends Agent<any, any, any>> =
  | LoweredIR<A["tools"]>
  | AllTrajectories<A["agents"], A["tools"]>;

export type CheckpointedIRWithTrajectories<A extends Agent<any, any, any>> =
  | CheckpointedIR<A["tools"]>
  | AllTrajectories<A["agents"], A["tools"]>
  | ToolSubagentInvoke<A["tools"], Extract<keyof A["agents"], string>>;

/*
 * All IR types including extensions.
 *
 * Allows passing in arbitrary extra IR types via the Agent's tool map. Useful for IR types
 * that not all clients might use, e.g. file IO types which may have prompt optimizations.
 */
type ToolExtra<T> = T extends ToolFactoryRequirements<any, infer Extra> ? Extra : never;
// The extension IRs an agent's tools can produce: the extra-IR leg of LlmIR, which client
// lowering passes convert and libocto never interprets.
export type AgentExtra<A extends Agent<any, any, any>> = ToolExtra<A["tools"][keyof A["tools"]]>;

export type LlmIR<A extends Agent<any, any, any>> =
  | CheckpointedIRWithTrajectories<A>
  | AgentExtra<A>;

/*
 * The two final IR rolesets, per agent permission capability.
 *
 * PermissionlessIR is the universe for agents that never gate tool calls: no tool-reject IR can
 * appear. PermissionedIR adds tool-reject for agents driven by a permission-checking loop.
 * AgentIR resolves whichever one applies to a given agent type, so arc/loop signatures written in
 * terms of AgentIR stay exact for both kinds of agent.
 */
export type PermissionlessIR<A extends Agent<any, any, any>> = LlmIR<A>;

export type PermissionedIR<A extends Agent<any, any, any>> =
  | LlmIR<A>
  | ToolRejectMessage<A["tools"]>;

export type AgentIR<A extends Agent<any, any, any>> =
  | LlmIR<A>
  | (A extends PermissionedBrand ? ToolRejectMessage<A["tools"]> : never);

/*
 * The widest shape lower(...) accepts: pre-lowering IRs plus permissioned-only rejects, which
 * lower(...) converts to tool-skip-outputs. Neither raw checkpoints (converted to
 * LoweredCheckpoint) nor rejects survive lowering, so compilers only ever see LoweredIR.
 */
export type PreLoweredIR<A extends Agent<any, any, any>> =
  | CheckpointedIR<A["tools"]>
  | PreLoweredTrajectories<A["agents"], A["tools"]>
  | ToolSubagentInvoke<A["tools"], Extract<keyof A["agents"], string>>
  | ([IsPermissioned<A>] extends [true] ? ToolRejectMessage<A["tools"]> : never);

// AgentTrajectory may carry arbitrary IR, since trajectories are living transcripts, not compiler
// inputs. By contrast, lower(...) accepts only this recursively-constrained variant: every nested
// trajectory's ir field may only contain IRs that lower(...) and the arc already know how to
// transform, never extension IRs that only the defining client knows how to lower.
export type PreLoweredTrajectories<
  Agents extends AgentDirectory,
  Tools extends ToolMap<any, any>,
> = {
  [K in keyof Agents]: PreLoweredTrajectory<Agents[K], Extract<K, string>, Tools>;
}[keyof Agents];

type PreLoweredTrajectory<
  Child extends Agent<any, any, any>,
  Name extends string,
  Tools extends ToolMap<any, any>,
> = {
  role: "subagent-trajectory";
  subagent: Name;
  ir: Array<RecursiveLowered<Child>>;
  toolCall: ToolCall<Tools>;
};

/*
 * One level lowered to built-in roles by the client's conversion pass. Nested trajectories
 * still carry their children's raw IR, including extensions. Recursive downconversion turns
 * this into PreLoweredIR, which contains no extensions at any depth.
 */
export type ShallowLoweredIR<A extends Agent<any, any, any>> =
  | CheckpointedIR<A["tools"]>
  | RawTrajectories<A["agents"], A["tools"]>
  | ToolSubagentInvoke<A["tools"], Extract<keyof A["agents"], string>>
  | ([IsPermissioned<A>] extends [true] ? ToolRejectMessage<A["tools"]> : never);

export type IRConversion<Original, Converted> = {
  original: Original;
  converted: Converted;
};

export type Lower<A extends Agent<any, any, any>> = IRConversion<AgentIR<A>, ShallowLoweredIR<A>>;

export type RecursiveLowered<A extends Agent<any, any, any>> = IRConversion<
  AgentIR<A>,
  PreLoweredIR<A>
>;

export type CompilerReadyIR<A extends Agent<any, any, any>> = IRConversion<
  AgentIR<A> | DescendantOriginals<A["agents"]>,
  LoweredIR<A["tools"]> | DescendantOutputs<A["agents"]>
>;

type DescendantOriginals<Agents extends AgentDirectory> = string extends keyof Agents
  ? AgentIR<Agents[string]>
  : {
      [K in keyof Agents]: AgentIR<Agents[K]> | DescendantOriginals<Agents[K]["agents"]>;
    }[keyof Agents];

type DescendantOutputs<Agents extends AgentDirectory> = string extends keyof Agents
  ? LoweredIR<Agents[string]["tools"]>
  : {
      [K in keyof Agents]: LoweredIR<Agents[K]["tools"]> | DescendantOutputs<Agents[K]["agents"]>;
    }[keyof Agents];

// The trajectory leg of the shallow-lowered stage: one member per subagent, insides still the
// child's own full IR universe, extensions and level-branded rejects included.
export type RawTrajectories<Agents extends AgentDirectory, Tools extends ToolMap<any, any>> = {
  [K in keyof Agents]: {
    role: "subagent-trajectory";
    subagent: Extract<K, string>;
    ir: Array<AgentIR<Agents[K]>>;
    toolCall: ToolCall<Tools>;
  };
}[keyof Agents];

/*
 * Returns the tool call ID that an IR answers, or null if the IR is not tool-output-shaped.
 *
 * The parameter is expressed in terms of the genuinely generic IR types rather than a single
 * "all built-in IRs" union type: AgentTrajectory is invariant in its agent directory, so no
 * monomorphic AgentTrajectory instantiation (even AgentTrajectory<any, any, any>) accepts every
 * trajectory — the type parameters must be quantified at the function level.
 *
 * Every tool extension IR (see ToolExtensionIR) carries the tool call it answers by definition,
 * so non-built-in IRs are answered unconditionally. The built-in shapes are switched
 * exhaustively: adding a new built-in IR role breaks compilation of the default branch,
 * forcing an explicit decision here.
 */
function isBuiltinRole(role: string): role is BuiltinIRRole {
  return role in BUILTIN_IR_ROLES;
}

function isBuiltinIR<
  Role extends string,
  T extends AgentDirectory,
  Tools extends ToolMap<any, any>,
>(
  ir:
    | LoweredIR<any>
    | Checkpoint
    | ToolRejectMessage<any>
    | RequestErrorIR
    | CompactionErrorIR
    | ValidationRetryBudgetExceededIR
    | InterruptedByUserIR
    | AllTrajectories<T, Tools>
    | ToolSubagentInvoke<any, string>
    | ToolExtensionIR<Role>,
): ir is
  | LoweredIR<any>
  | Checkpoint
  | ToolRejectMessage<any>
  | RequestErrorIR
  | CompactionErrorIR
  | ValidationRetryBudgetExceededIR
  | InterruptedByUserIR
  | AllTrajectories<T, Tools>
  | ToolSubagentInvoke<any, string> {
  return isBuiltinRole(ir.role);
}

export function answeredToolCallId<
  Role extends string,
  T extends AgentDirectory,
  Tools extends ToolMap<any, any>,
>(
  ir:
    | LoweredIR<any>
    | Checkpoint
    | ToolRejectMessage<any>
    | RequestErrorIR
    | CompactionErrorIR
    | ValidationRetryBudgetExceededIR
    | InterruptedByUserIR
    | AllTrajectories<T, Tools>
    | ToolSubagentInvoke<any, string>
    | ToolExtensionIR<Role>,
): string | null {
  if (!isBuiltinIR(ir)) return ir.toolCall.toolCallId;
  switch (ir.role) {
    case "tool-parse-error":
      return ir.malformedRequest.toolCallId;
    case "assistant":
    case "user":
    case "checkpoint":
    case "lowered-checkpoint":
    case "tool-invoke-subagent":
    case "request-error":
    case "compaction-error":
    case "validation-retry-budget-exceeded":
    case "interrupted-by-user":
      return null;
    case "subagent-trajectory":
    case "tool-output":
    case "tool-runtime-error":
    case "tool-validation-error":
    case "tool-skip-output":
    case "tool-reject":
      return ir.toolCall.toolCallId;
    default: {
      const _exhaustive: never = ir;
      return _exhaustive;
    }
  }
}

export function messageText<T extends ToolMap<any, any>>(msg: LoweredIR<T>): string {
  switch (msg.role) {
    case "assistant":
      return (msg.content ?? "") + (msg.reasoningContent ?? "");
    case "user":
    case "tool-output":
    case "lowered-checkpoint":
      return contentText(msg.content);
    case "tool-runtime-error":
    case "tool-validation-error":
      return msg.error;
    case "tool-parse-error":
      return (msg.malformedRequest.call.original.arguments ?? "") + msg.malformedRequest.error;
    case "tool-skip-output":
      return msg.reason;
  }
}

export function contentText(content: Content["content"]): string {
  return content
    .map(part => {
      if (part.type === "text") return part.content;
      return `Image file: ${part.image.filePath}`;
    })
    .join("\n");
}

type AssertNever<T extends never> = T;
// Keeps BUILTIN_IR_ROLES in sync with the roles of the built-in IR shapes handled above.
// Indexed access (rather than assignability) keeps this insensitive to AgentTrajectory's
// invariance in its agent directory.
type _BuiltinIRRolesMatch = AssertNever<
  | Exclude<
      | LoweredIR<any>["role"]
      | Checkpoint["role"]
      | ToolRejectMessage<any>["role"]
      | RequestErrorIR["role"]
      | CompactionErrorIR["role"]
      | ValidationRetryBudgetExceededIR["role"]
      | InterruptedByUserIR["role"]
      | AgentTrajectory<any, any, any>["role"]
      | ToolSubagentInvoke<any, string>["role"],
      BuiltinIRRole
    >
  | Exclude<
      BuiltinIRRole,
      | LoweredIR<any>["role"]
      | Checkpoint["role"]
      | ToolRejectMessage<any>["role"]
      | RequestErrorIR["role"]
      | CompactionErrorIR["role"]
      | ValidationRetryBudgetExceededIR["role"]
      | InterruptedByUserIR["role"]
      | AgentTrajectory<any, any, any>["role"]
      | ToolSubagentInvoke<any, string>["role"]
    >
>;

/*
 * Agent dependency compile-time validation/branding
 * -------------------------------------------------------------------------------------------------
 *
 * Checks that for a given agent with subagents, all tools that declare subagent dependencies have
 * those dependencies satisfied. For example, if a `research` tool expects to be able to invoke a
 * `research` subagent, and you use the research tool but don't define a research subagent, you'll
 * get a compile error.
 */
declare const missingToolSubagents: unique symbol;
declare const mixedPermissionTree: unique symbol;

type RequiredToolSubagentNames<Tools> = ToolSubagentNames<Tools[keyof Tools]>;

// Type used to validate that the given agent's tools have all of their subagent dependencies
// fulfilled, and that the permission capability is uniform down the tree: every subagent of a
// permissioned agent is permissioned, and no subagent of a permissionless agent is. Mixed trees
// would need a runtime capability probe per arc to know which ones may gate; uniformity keeps
// the "permission" param's presence the single source of truth for the whole tree, and keeps
// histories honest — a permissionless arc's universe promises never to contain tool-rejects.
// Recursively narrows the given type until it's either {} (all dependencies are satisfied), or
// an impossible-to-construct type via a non-existent unique symbol, which will cause a useful
// compile error.
//
// The current node's own capability arrives as an argument — the constructor function's choice,
// since a payload under construction never carries its own brand — and threads to every deeper
// node unchanged, with each level's own directory checked against it.
type ValidateAgentSubagents<A, Permissioned extends boolean> = A extends {
  tools: infer Tools;
  agents: infer SubagentDirectory extends AgentDirectory;
}
  ? Exclude<
      RequiredToolSubagentNames<Tools>,
      Extract<keyof SubagentDirectory, string>
    > extends never
    ? {
        agents: {
          [K in keyof SubagentDirectory]: ValidateAgentSubagents<
            SubagentDirectory[K],
            Permissioned
          >;
        } & ValidateChildCapabilities<Permissioned, SubagentDirectory>;
      }
    : {
        readonly [missingToolSubagents]: Exclude<
          RequiredToolSubagentNames<Tools>,
          Extract<keyof SubagentDirectory, string>
        >;
      }
  : never;

type ValidateChildCapabilities<
  Permissioned extends boolean,
  SubagentDirectory extends AgentDirectory,
> = [Permissioned] extends [true]
  ? Exclude<SubagentDirectory[keyof SubagentDirectory], PermissionedBrand> extends never
    ? unknown
    : {
        readonly [mixedPermissionTree]: "a permissioned tree must be permissioned down to its leaves";
      }
  : Extract<SubagentDirectory[keyof SubagentDirectory], PermissionedBrand> extends never
    ? unknown
    : {
        readonly [mixedPermissionTree]: "a permissionless tree must be permissionless down to its leaves";
      };

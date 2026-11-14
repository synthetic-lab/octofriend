import type {
  AgentDirectory,
  AgentIR,
  CompilerReadyIR,
  LoweredIR,
  LowerOutputIR,
  PermissionedAgent,
  PreLoweredIR,
  RecursiveLowered,
  ShallowLoweredIR,
  TreeIR,
  TreeToolCall,
} from "./llm-ir.ts";
import type { ActiveHistory } from "./ir-operations.ts";
import type { ToolCall, ToolFactory } from "./tools/tool-def.ts";

// The optimized traversal must project directory entries, not individual members of a
// union-valued entry. Nor may an any entry swallow its typed siblings before projection.
type ReadAgent = PermissionedAgent<
  never,
  {},
  {
    read: ToolFactory<
      unknown,
      unknown,
      { name: "read"; arguments: { path: string } },
      string,
      never,
      never
    >;
  },
  {}
>;
type WriteAgent = PermissionedAgent<
  never,
  {},
  {
    write: ToolFactory<
      unknown,
      unknown,
      { name: "write"; arguments: { text: string } },
      number,
      never,
      never
    >;
  },
  {}
>;
type Root<Agents extends AgentDirectory> = PermissionedAgent<never, Agents, {}, {}>;
type UnionChild = ReadAgent | WriteAgent;
type UnionRoot = Root<{ child: UnionChild }>;
type AbstractRoot = Root<Record<string, UnionChild>>;
type AnySiblingRoot = Root<{ typed: ReadAgent; opaque: any }>;

type Expect<T extends true> = T;
type Equivalent<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

// These are the previous, per-entry projections; inspection intersections are compared
// by assignability rather than syntactic equality, like agent-tree.compiletest.ts.
type _unionOriginals = Expect<
  Equivalent<TreeIR<UnionRoot>, AgentIR<UnionRoot> | AgentIR<UnionChild>>
>;
type _unionShallow = Expect<
  Equivalent<
    LowerOutputIR<UnionRoot>["converted"],
    ShallowLoweredIR<UnionRoot> | ShallowLoweredIR<UnionChild>
  >
>;
type _unionRecursive = Expect<
  Equivalent<
    RecursiveLowered<UnionRoot>["converted"],
    PreLoweredIR<UnionRoot> | PreLoweredIR<UnionChild>
  >
>;
type _unionCompiler = Expect<
  Equivalent<
    CompilerReadyIR<UnionRoot>["converted"],
    LoweredIR<UnionRoot["tools"]> | LoweredIR<UnionChild["tools"]>
  >
>;
type _abstractOriginals = Expect<
  Equivalent<TreeIR<AbstractRoot>, AgentIR<AbstractRoot> | AgentIR<UnionChild>>
>;
type _abstractShallow = Expect<
  Equivalent<
    LowerOutputIR<AbstractRoot>["converted"],
    ShallowLoweredIR<AbstractRoot> | ShallowLoweredIR<UnionChild>
  >
>;
type _abstractRecursive = Expect<
  Equivalent<
    RecursiveLowered<AbstractRoot>["converted"],
    PreLoweredIR<AbstractRoot> | PreLoweredIR<UnionChild>
  >
>;
type _abstractCompiler = Expect<
  Equivalent<
    CompilerReadyIR<AbstractRoot>["converted"],
    LoweredIR<AbstractRoot["tools"]> | LoweredIR<UnionChild["tools"]>
  >
>;

// IsPermissioned<any> is boolean, so its shallow/pre-lowered IR has no rejects. A typed
// permissioned sibling must nevertheless retain its reject and exact tool-call schema.
type ReadReject = Extract<AgentIR<ReadAgent>, { role: "tool-reject" }>;
type _anySiblingShallowReject = Expect<
  Equivalent<
    Extract<LowerOutputIR<AnySiblingRoot>["converted"], { role: "tool-reject" }>["toolCall"],
    ReadReject["toolCall"]
  >
>;
type _anySiblingRecursiveReject = Expect<
  Equivalent<
    Extract<RecursiveLowered<AnySiblingRoot>["converted"], { role: "tool-reject" }>["toolCall"],
    ReadReject["toolCall"]
  >
>;

// Tool-call projection uses the same boxed traversal, retaining per-entry union semantics
// and stopping at abstract directories rather than recursively expanding their constraints.
type _unionCalls = Expect<Equivalent<TreeToolCall<UnionRoot>, ToolCall<UnionChild["tools"]>>>;
type _abstractCalls = Expect<Equivalent<TreeToolCall<AbstractRoot>, ToolCall<UnionChild["tools"]>>>;
type _leafCalls = Expect<Equivalent<TreeToolCall<ReadAgent>, ToolCall<ReadAgent["tools"]>>>;
type _emptyCalls = Expect<Equivalent<TreeToolCall<Root<{}>>, never>>;

type NestedRoot = PermissionedAgent<
  never,
  { branch: Root<{ reader: ReadAgent; writer: WriteAgent }> },
  ReadAgent["tools"],
  {}
>;
type NestedCalls = TreeToolCall<NestedRoot>;
type _nestedCalls = Expect<
  Equivalent<NestedCalls, ToolCall<ReadAgent["tools"]> | ToolCall<WriteAgent["tools"]>>
>;
type _nestedReadArguments = Expect<
  Equivalent<Extract<NestedCalls, { name: "read" }>["original"], { path: string }>
>;
type _nestedReadParsed = Expect<
  Equivalent<Extract<NestedCalls, { name: "read" }>["parsed"], string>
>;
type _nestedWriteParsed = Expect<
  Equivalent<Extract<NestedCalls, { name: "write" }>["parsed"], number>
>;

function inspectNestedCall(call: NestedCalls) {
  if (call.name === "read") {
    // @ts-expect-error A read call does not acquire the sibling write tool's arguments.
    call.original.text;
  } else {
    // @ts-expect-error Descendant parsed arguments must not widen to any.
    const parsed: string = call.parsed;
  }
}

// Moving the inspection intersection outside recursion must retain each child's own history,
// not turn it into the entire tree's history through the shared inspection bound.
function inspectNestedHistory(location: ActiveHistory<NestedRoot>) {
  if (location.root || location.subagent !== "writer") return;
  const history: Array<AgentIR<WriteAgent>> = location.history;
  const name: "writer" = location.scope.parentSubagentIR.subagent;
  const top: "branch" = location.scope.toplevelSubagentIR.subagent;
  // @ts-expect-error A writer history cannot become the sibling reader's history.
  const readerHistory: Array<AgentIR<ReadAgent>> = location.history;
  // @ts-expect-error The reader's tools must not appear on the writer agent.
  location.agent.tools.read;
}

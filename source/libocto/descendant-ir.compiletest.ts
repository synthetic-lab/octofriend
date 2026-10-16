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
} from "./llm-ir.ts";
import type { ToolFactory } from "./tool-def.ts";

// The optimized traversal must project directory entries, not individual members of a
// union-valued entry. Nor may an any entry swallow its typed siblings before projection.
type ReadAgent = PermissionedAgent<
  never,
  {},
  {
    read: ToolFactory<unknown, { name: "read"; arguments: { path: string } }, string, never, never>;
  }
>;
type WriteAgent = PermissionedAgent<
  never,
  {},
  {
    write: ToolFactory<
      unknown,
      { name: "write"; arguments: { text: string } },
      number,
      never,
      never
    >;
  }
>;
type Root<Agents extends AgentDirectory> = PermissionedAgent<never, Agents, {}>;
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

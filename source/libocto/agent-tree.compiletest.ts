import { prompt } from "./system-prompt.ts";
import { t } from "structural";
import { fileReadIR } from "./tools/file-ir.ts";
import type {
  Agent,
  AgentExtra,
  AgentIR,
  SubagentIR,
  TreeIR,
  LowerInputIR,
  CompilerReadyIR,
  RecursiveLowered,
  ShallowLoweredIR,
  LoweredIR,
  AllSubagentNames,
  AllToolsAcrossTree,
  LowerOutputIR,
  IRConversion,
  PreLoweredIR,
} from "./llm-ir.ts";
import { definePermissionedAgent, definePermissionlessAgent, messageText } from "./llm-ir.ts";
import { downconvert, lower, lowerMessages, meaningfulTailIR } from "./ir-operations.ts";
import type { ActiveHistory, ClientLowerOutputIR } from "./ir-operations.ts";
import type { LoadedTools, ToolCall } from "./tools/tool-def.ts";
import { ToolBuilder } from "./tools/tool-def.ts";
import { ok } from "./result.ts";
import type {
  Trajectory,
  TrajectoryEvents,
  TrajectoryMode,
  TrajectoryParams,
} from "./trajectory.ts";

/*
 * Compile-only test: the agent-tree surface — tree-wide subagent names, the merged tool map,
 * the subagent prompt catalogue, and the definition-time rules (subagent dependencies must
 * be declared; the permission capability is uniform down the tree). Each block moves a
 * type fact the runner relies on into the typechecker.
 */

function expectType<T>(_: T) {}

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const testPrompt = prompt.declare(async () => "Test prompt");

const builder = new ToolBuilder<unknown>();

const searchTool = builder
  .declare({ name: "search", description: "Searches", ArgumentsSchema: t.subtype({ q: t.str }) })
  .define(async () => ({
    run: async () => ok({ type: "output" as const, content: [] }),
  }));

const noteTool = builder
  .declare({ name: "note", description: "Notes", ArgumentsSchema: t.subtype({ note: t.str }) })
  .withCustomIR({
    result: toolCall => (args: { text: string }) => ({
      role: "note" as const,
      toolCall,
      text: args.text,
    }),
  })
  .define(async () => ({
    run: async ({ customIR }) => customIR.result({ text: "hi" }),
  }));

const delegateTool = builder
  .declare({
    name: "delegate",
    description: "Delegates",
    ArgumentsSchema: t.subtype({ what: t.str }),
    subagents: ["research"] as const,
  })
  .define(async () => ({
    run: async () => ok({ type: "invoke-subagent" as const, name: "research", message: [] }),
  }));

// The capability is uniform down the tree: a permissioned tree's every subagent is
// permissioned, and no permissionless agent's subagent is. Research and grandchild are both
// permissioned because Root is.
const _grandchild = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: {},
});
const _research = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: { grandchild: _grandchild },
});
const _root = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool, note: noteTool, delegate: delegateTool },
  agents: { research: _research },
});
type Root = typeof _root;
const _single = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: {},
});
type Single = typeof _single;

const readTool = builder
  .declare({ name: "read", description: "Reads", ArgumentsSchema: t.subtype({ filePath: t.str }) })
  .withCustomIR({ fileReadIR })
  .define(async () => ({ run: async () => ok({ type: "output" as const, content: [] }) }));
const fileChild = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { read: readTool },
  agents: {},
});
const fileRoot = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: { child: fileChild },
});

// The standard pass handles file extras automatically, including descendant-only reads.
const convertTreeFiles = downconvert<typeof fileRoot>(lowerMessages, null);
void convertTreeFiles;

type FileRoles = "file-read" | "file-mutate";
type _noGlobalFileIR = Expect<Equal<Extract<AgentIR<Single>, { role: FileRoles }>, never>>;
type _fileExtraOnlyOnDeclaringAgent = Expect<
  Equal<AgentExtra<typeof fileChild>["role"], "file-read">
>;
type _noParentFileExtra = Expect<Equal<AgentExtra<typeof fileRoot>, never>>;
type _filePassthrough = Expect<
  Equal<
    Extract<ClientLowerOutputIR<typeof fileRoot>["converted"], { role: FileRoles }>["role"],
    "file-read"
  >
>;
type _noUndeclaredFilePassthrough = Expect<
  Equal<Extract<ClientLowerOutputIR<Single>["converted"], { role: FileRoles }>, never>
>;
type _filesFullyLowered = Expect<
  Equal<
    Extract<ReturnType<typeof convertTreeFiles>[number]["converted"], { role: FileRoles }>,
    never
  >
>;
type _customExtrasStillRequireConversion = Expect<
  Equal<
    typeof lowerMessages extends TrajectoryParams<Root, null>["lowerMessages"] ? true : false,
    false
  >
>;
type _modalitiesArgumentRequired = Expect<
  Equal<Parameters<typeof downconvert<typeof fileRoot>>["length"], 2>
>;

// Subagent names span the whole tree, not one level's directory.
type _names = Expect<Equal<AllSubagentNames<Root>, "research" | "grandchild">>;
type _noNames = Expect<Equal<AllSubagentNames<Single>, never>>;

// The merged tool map: every level's keys, shared keys shared, values exact per key.
type _treeKeys = Expect<Equal<keyof AllToolsAcrossTree<Root>, "search" | "note" | "delegate">>;
expectType<Partial<AllToolsAcrossTree<Single>>>(
  undefined as unknown as Partial<LoadedTools<Single["tools"]>>,
);

// A declared key takes exactly the loaded definition of the tool declared under it — never
// another tool's definition, even when that definition loaded perfectly fine.
type SearchDef = AllToolsAcrossTree<Root>["search"];
const searchDef = {} as SearchDef;
const wrongDefs: Partial<AllToolsAcrossTree<Root>> = {
  search: searchDef,
  // We expect an error here because a declared key takes exactly its own tool's definition
  // @ts-expect-error
  delegate: searchDef,
};

// Prompts belong to the definitions rather than a separate trajectory catalogue.
expectType<typeof testPrompt>(_root.systemPrompt);
expectType<typeof testPrompt>(_research.systemPrompt);
expectType<typeof testPrompt>(_grandchild.systemPrompt);
// @ts-expect-error Every agent definition must declare its system prompt.
definePermissionlessAgent({ tools: { search: searchTool }, agents: {} });
definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: {},
  // @ts-expect-error Raw subagent definitions must declare prompts too.
  agents: { child: { tools: {}, agents: {} } },
});

const dataTool = builder
  .withData<{ tool: boolean }>()
  .declare({ name: "data", description: "Uses data", ArgumentsSchema: t.subtype({}) })
  .define(async () => ({ run: async () => ok({ type: "output" as const, content: [] }) }));
const promptDataLeaf = definePermissionlessAgent({
  systemPrompt: prompt.withData<{ leaf: string }>().declare(async ({ data }) => data.leaf),
  tools: {},
  agents: {},
});
const promptDataMiddle = definePermissionlessAgent({
  systemPrompt: prompt.withData<{ middle: number }>().declare(async ({ data }) => `${data.middle}`),
  tools: {},
  agents: { leaf: promptDataLeaf },
});
const promptDataRoot = definePermissionlessAgent({
  systemPrompt: prompt
    .withData<{ root: string }>()
    .withData<{ version: number }>()
    .declare(async ({ data }) => `${data.root}:${data.version}`),
  tools: { data: dataTool },
  agents: { middle: promptDataMiddle },
});
type PromptData = Awaited<ReturnType<TrajectoryParams<typeof promptDataRoot, null>["getData"]>>;
const resolvePromptData: TrajectoryParams<typeof promptDataRoot, null>["getData"] = async () => ({
  root: "root",
  version: 1,
  middle: 2,
  leaf: "leaf",
  tool: true,
});
expectType<Promise<PromptData>>(resolvePromptData());
// @ts-expect-error Data required by descendant prompts cannot be omitted.
const _missingPromptData: typeof resolvePromptData = async () => ({
  root: "root",
  version: 1,
  middle: 2,
  tool: true,
});

const noDataAgent = definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: {},
  agents: {},
});
const resolveNoData: TrajectoryParams<typeof noDataAgent, null>["getData"] = async () => ({});
expectType<Promise<{}>>(resolveNoData());

const conflictingPromptData = definePermissionlessAgent({
  systemPrompt: prompt.withData<{ shared: string }>().declare(async ({ data }) => data.shared),
  tools: {},
  agents: {
    child: definePermissionlessAgent({
      systemPrompt: prompt
        .withData<{ shared: number }>()
        .declare(async ({ data }) => `${data.shared}`),
      tools: {},
      agents: {},
    }),
  },
});
type ConflictingData = Awaited<
  ReturnType<TrajectoryParams<typeof conflictingPromptData, null>["getData"]>
>;
type _conflictingPromptData = Expect<Equal<ConflictingData["shared"], never>>;

// Model resolution requires an explicit invocation or null, retaining each parent's tool types.
const resolveModel: TrajectoryParams<Root, null>["model"] = async invocation => {
  if (invocation !== null) {
    expectType<string | undefined>(invocation.model);
    if (invocation.subagent === "grandchild") {
      expectType<"search">(invocation.toolCall.name);
      expectType<string>(invocation.toolCall.parsed.q);
      // @ts-expect-error Grandchild invocations cannot carry the root-only delegate arguments.
      invocation.toolCall.parsed.what;
    } else if (invocation.toolCall.name === "delegate") {
      expectType<string>(invocation.toolCall.parsed.what);
      // @ts-expect-error Parsed arguments retain their schema rather than becoming any.
      invocation.toolCall.parsed.q;
    }
  }
  return ok({ provider: null, model: "test-model", contextWindow: 1000, modalities: null });
};
void resolveModel(null);
// @ts-expect-error The argument is required, even for root model resolution.
void resolveModel();
// @ts-expect-error Root resolution must explicitly pass null, not undefined.
void resolveModel(undefined);

// Extras resolve per agent, from its own tools.
type _extraHasNote = Expect<Equal<AgentExtra<Root>["role"], "note">>;
type _noExtra = Expect<Equal<AgentExtra<Single>, never>>;

// The client's extension pass handles every agent's extras, not just the root's. Libocto
// handles trajectory wrappers itself and sends their contents to the same callback, so the
// callback covers the whole tree but never receives or returns a trajectory.
const pass: TrajectoryParams<Root, null>["lowerMessages"] = irs => {
  const out: Array<LowerOutputIR<Root>> = [];
  for (const original of irs) {
    if (original.role === "note") {
      out.push({
        original,
        converted: { role: "tool-output", toolCall: original.toolCall, content: [] },
      });
      continue;
    }
    out.push({ original, converted: original });
  }
  return out;
};

type _lowerOriginal = Expect<Equal<LowerOutputIR<Root>["original"], LowerInputIR<Root>>>;
type _recursiveOriginal = Expect<Equal<RecursiveLowered<Root>["original"], TreeIR<Root>>>;

// The inspection bounds are intersections, so check the converted unions by assignability
// in both directions rather than requiring TypeScript to normalize their representation.
function inspectTreeConversions(
  shallow: LowerOutputIR<Root>["converted"],
  recursive: RecursiveLowered<Root>["converted"],
  ownShallow:
    | ShallowLoweredIR<Root>
    | ShallowLoweredIR<typeof _research>
    | ShallowLoweredIR<typeof _grandchild>,
  ownRecursive:
    | PreLoweredIR<Root>
    | PreLoweredIR<typeof _research>
    | PreLoweredIR<typeof _grandchild>,
) {
  expectType<typeof ownShallow>(shallow);
  expectType<typeof shallow>(ownShallow);
  expectType<typeof ownRecursive>(recursive);
  expectType<typeof recursive>(ownRecursive);
}
type _leafCompilerPair = Expect<
  Equal<CompilerReadyIR<Single>, IRConversion<AgentIR<Single>, LoweredIR<Single["tools"]>>>
>;
type _subagentIR = Expect<Equal<SubagentIR<Root>, AgentIR<typeof _research>>>;
type _leafSubagentIR = Expect<Equal<SubagentIR<Single>, never>>;

function inspectMessageText(ir: CompilerReadyIR<typeof fileRoot>["converted"]) {
  expectType<string>(messageText(ir));
}
void inspectMessageText;

function inspectConversionTypes(
  raw: Array<AgentIR<Root>>,
  shallow: Array<LowerOutputIR<Root>>,
  recursive: Array<RecursiveLowered<Root>>,
  trajectory: Extract<AgentIR<Root>, { role: "subagent-trajectory" }>,
  extra: AgentExtra<Root>,
) {
  // @ts-expect-error Final lowering requires paired IR, not bare history.
  lower<Root>(raw);
  // Client output contains no trajectories, so it already fits recursive lowering.
  expectType<Array<CompilerReadyIR<Root>>>(lower<Root>(shallow));
  expectType<Array<CompilerReadyIR<Root>>>(lower<Root>(recursive));
  // @ts-expect-error Raw child histories still need recursive conversion.
  lower<Root>([{ original: trajectory, converted: trajectory }]);
  // @ts-expect-error The client callback cannot receive trajectories.
  pass([trajectory], null);
  // @ts-expect-error Nor can it manufacture trajectories from custom IR.
  expectType<LowerOutputIR<Root>>({ original: extra, converted: trajectory });
  // @ts-expect-error Even trajectory-to-trajectory pairs are owned by libocto, not clients.
  expectType<LowerOutputIR<Root>>({ original: trajectory, converted: trajectory });
}

function inspectGenericChildLowering<A extends Agent<any, any, any, any>>(
  history: Array<RecursiveLowered<A["agents"][keyof A["agents"]]>>,
): Array<CompilerReadyIR<A>> {
  return lower(history);
}

const _conversionRoot = definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: {},
  agents: { child: _root },
});
type ConversionRoot = typeof _conversionRoot;
type ConvertedRoot = CompilerReadyIR<ConversionRoot>;

// Tree-wide conversion sees descendant-only tools and extensions without granting them to
// either the root's own history or a child that did not declare them.
const treePass: TrajectoryParams<ConversionRoot, null>["lowerMessages"] = messages =>
  messages.map(original => ({
    original,
    converted:
      original.role === "note"
        ? { role: "tool-output", toolCall: original.toolCall, content: [] }
        : original,
  }));

function inspectTreeInput(
  childIR: AgentIR<Root>,
  childOutput: Extract<AgentIR<Root>, { role: "tool-output" }>,
  parentExtra: AgentExtra<Root>,
) {
  expectType<TreeIR<ConversionRoot>>(childIR);
  expectType<Array<LowerOutputIR<ConversionRoot>>>(treePass([childOutput], null));
  expectType<Array<RecursiveLowered<ConversionRoot>>>(
    downconvert<ConversionRoot>(treePass, null)([childIR]),
  );
  expectType<LowerOutputIR<ConversionRoot>>({ original: childOutput, converted: childOutput });
  expectType<RecursiveLowered<ConversionRoot>>({ original: childOutput, converted: childOutput });
  // @ts-expect-error A root's own history does not include descendant-only tool outputs.
  expectType<AgentIR<ConversionRoot>>(childOutput);
  // @ts-expect-error A child's history does not gain parent-only extensions.
  expectType<AgentIR<typeof _research>>(parentExtra);
  // @ts-expect-error Neither does a tree-wide view of that child's subtree.
  expectType<TreeIR<typeof _research>>(parentExtra);
}

type _treeInput = Expect<
  Equal<
    Parameters<TrajectoryParams<ConversionRoot, null>["lowerMessages"]>[0],
    Array<LowerInputIR<ConversionRoot>>
  >
>;
type _childTools = Expect<
  Equal<
    Extract<
      LowerOutputIR<ConversionRoot>["converted"],
      { role: "tool-output" }
    >["toolCall"]["name"],
    "search" | "note" | "delegate"
  >
>;
type _recursiveChildTools = Expect<
  Equal<
    Extract<
      RecursiveLowered<ConversionRoot>["converted"],
      { role: "tool-output" }
    >["toolCall"]["name"],
    "search" | "note" | "delegate"
  >
>;
type _childArguments = Expect<
  Equal<
    Extract<
      Extract<LowerOutputIR<ConversionRoot>["converted"], { role: "tool-output" }>["toolCall"],
      { name: "search" }
    >["parsed"],
    Extract<ToolCall<Root["tools"]>, { name: "search" }>["parsed"]
  >
>;
type _leafTreeIR = Expect<Equal<TreeIR<Single>, AgentIR<Single>>>;
type _leafLower = Expect<
  Equal<LowerOutputIR<Single>, IRConversion<AgentIR<Single>, ShallowLoweredIR<Single>>>
>;
type _leafRecursive = Expect<
  Equal<RecursiveLowered<Single>, IRConversion<AgentIR<Single>, PreLoweredIR<Single>>>
>;

void inspectTreeConversions;
void inspectTreeInput;
type _descendantExtension = Expect<
  Equal<Extract<ConvertedRoot["original"], { role: "note" }>, AgentExtra<Root>>
>;
type _descendantTools = Expect<
  Equal<
    Extract<ConvertedRoot["converted"], { role: "tool-output" }>["toolCall"]["name"],
    "search" | "note" | "delegate"
  >
>;

void inspectConversionTypes;
void inspectGenericChildLowering;

function inspectMeaningfulTailIR(
  trajectory: Trajectory<Root, null>,
  child: Extract<AgentIR<Root>, { role: "subagent-trajectory" }>,
) {
  const rootIRs = [...trajectory.meaningfulTailIR()];
  const childIRs = [...meaningfulTailIR(child.ir)];
  type Boundary = { role: "request-snapshot-begin" | "request-snapshot-end" };
  type _rootIR = Expect<Equal<(typeof rootIRs)[number], Exclude<AgentIR<Root>, Boundary>>>;
  type _childIR = Expect<
    Equal<(typeof childIRs)[number], Exclude<AgentIR<typeof _research>, Boundary>>
  >;
}

void inspectMeaningfulTailIR;

// The active location preserves the same agent/IR/scope correlation as message events.
function inspectActiveHistory(location: ActiveHistory<Root>) {
  if (location.root) {
    expectType<Root>(location.agent);
    expectType<Array<AgentIR<Root>>>(location.history);
    // @ts-expect-error The root has no containing trajectory.
    location.scope;
    return;
  }
  expectType<readonly { subagent: string; toolCallId: string }[]>(location.scope.path);
  expectType<Extract<AgentIR<Root>, { subagent: "research" }>>(location.scope.toplevelSubagentIR);
  if (location.subagent === "research") {
    expectType<typeof _research>(location.agent);
    expectType<Array<AgentIR<typeof _research>>>(location.history);
    expectType<Extract<AgentIR<Root>, { subagent: "research" }>>(location.scope.parentSubagentIR);
    return;
  }
  expectType<typeof _grandchild>(location.agent);
  expectType<Array<AgentIR<typeof _grandchild>>>(location.history);
  expectType<Extract<AgentIR<typeof _research>, { subagent: "grandchild" }>>(
    location.scope.parentSubagentIR,
  );
}

type _leafActiveHistory = Expect<
  Equal<ActiveHistory<Single>, { root: true } & { agent: Single; history: Array<AgentIR<Single>> }>
>;

void inspectActiveHistory;

// Message events preserve each active arc's IR universe. Every non-root event points at
// both the immediate parent trajectory and the root-history trajectory that contains it.
function inspectMessageEvent(event: TrajectoryEvents<Root>["onMessages"]) {
  if (event.root) {
    expectType<Array<AgentIR<Root>>>(event.irs);
    // We expect an error here because root appends need no subagent metadata
    // @ts-expect-error
    event.scope;
    return;
  }

  expectType<Extract<AgentIR<Root>, { role: "subagent-trajectory" }>>(
    event.scope.toplevelSubagentIR,
  );
  if (event.subagent === "research") {
    expectType<Array<AgentIR<typeof _research>>>(event.irs);
    expectType<Extract<AgentIR<Root>, { subagent: "research" }>>(event.scope.parentSubagentIR);
    return;
  }
  expectType<Array<AgentIR<typeof _grandchild>>>(event.irs);
  expectType<Extract<AgentIR<typeof _research>, { subagent: "grandchild" }>>(
    event.scope.parentSubagentIR,
  );
}

// Modes use the same top-level discriminants: the agent name narrows running tool calls to
// that arc's own tool map, while only non-root modes carry path metadata.
function inspectMode(mode: TrajectoryMode<Root>) {
  if (mode.root) {
    if (mode.mode === "running-tool") expectType<ToolCall<Root["tools"]>>(mode.toolCall);
    // We expect an error here because the root needs no subagent routing metadata
    // @ts-expect-error
    mode.scope;
    return;
  }

  expectType<readonly { subagent: string; toolCallId: string }[]>(mode.scope.path);
  if (mode.subagent === "research" && mode.mode === "running-tool") {
    expectType<ToolCall<(typeof _research)["tools"]>>(mode.toolCall);
  }
}

// The permission capability is uniform down the tree — keeping the "permission" param's
// presence the single source of truth — and both directions of a mix are rejected. Each
// violation surfaces on the parent's agents line.
definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  // We expect an error here because a permissionless tree may not carry permissioned subagents
  // @ts-expect-error
  agents: {
    research: definePermissionedAgent({
      systemPrompt: testPrompt,
      tools: { search: searchTool },
      agents: {},
    }),
  },
});

definePermissionedAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  // We expect an error here because a permissioned tree may not carry permissionless subagents
  // @ts-expect-error
  agents: {
    research: definePermissionlessAgent({
      systemPrompt: testPrompt,
      tools: { search: searchTool },
      agents: {},
    }),
  },
});

// The uniformity rule applies at every depth. The violation surfaces twice — on the parent
// of the offender (mid's agents map carries the mixed-tree flag) and on the offender itself
// — so both spans carry a directive.
definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: {
    // We expect an error here because a permissionless tree may not carry permissioned subagents
    // @ts-expect-error
    mid: definePermissionlessAgent({
      systemPrompt: testPrompt,
      tools: { search: searchTool },
      // We expect an error here because a permissionless tree may not carry permissioned subagents
      // @ts-expect-error
      agents: {
        bad: definePermissionedAgent({
          systemPrompt: testPrompt,
          tools: { search: searchTool },
          agents: {},
        }),
      },
    }),
  },
});

// We expect an error here because the delegate tool declares a research subagent dependency
// this agent does not satisfy
// @ts-expect-error
const _undeclaredSubagent = definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: { delegate: delegateTool },
  agents: {},
});

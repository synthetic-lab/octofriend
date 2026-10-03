import { t } from "structural";
import type { AgentExtra, AllSubagentNames, AllToolsAcrossTree, ExtraFreeIR } from "./llm-ir.ts";
import { definePermissionedAgent, definePermissionlessAgent } from "./llm-ir.ts";
import type { LoadedTools, ToolCall } from "./tool-def.ts";
import { ToolBuilder } from "./tool-def.ts";
import { ok } from "./result.ts";
import type { TrajectoryParams } from "./trajectory.ts";

/*
 * Compile-only test: the agent-tree surface — tree-wide subagent names, the merged tool map,
 * the subagent prompt catalogue, and the definition-time rules (subagent dependencies must
 * be declared, only permissioned agents may declare permissioned children). Each block moves
 * a type fact the runner relies on into the typechecker.
 */

function expectType<T>(_: T) {}

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

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

const _grandchild = definePermissionlessAgent({ tools: { search: searchTool }, agents: {} });
const _research = definePermissionlessAgent({
  tools: { search: searchTool },
  agents: { grandchild: _grandchild },
});
const _root = definePermissionedAgent({
  tools: { search: searchTool, note: noteTool, delegate: delegateTool },
  agents: { research: _research },
});
type Root = typeof _root;
const _single = definePermissionedAgent({ tools: { search: searchTool }, agents: {} });
type Single = typeof _single;

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

// Subagent prompts: required, one per name anywhere in the tree.
const prompts: TrajectoryParams<Root, null>["subagentPrompts"] = {
  research: signal => Promise.resolve("research prompt"),
  grandchild: signal => Promise.resolve("grandchild prompt"),
};
// We expect an error here because the catalogue must cover every subagent in the tree —
// grandchild is missing
// @ts-expect-error
const _missingPrompt: TrajectoryParams<Root, null>["subagentPrompts"] = {
  research: signal => Promise.resolve("research prompt"),
};
// An agentless tree takes an empty catalogue.
const none: TrajectoryParams<Single, null>["subagentPrompts"] = {};

// Extras resolve per agent, from its own tools.
type _extraHasNote = Expect<Equal<AgentExtra<Root>["role"], "note">>;
type _noExtra = Expect<Equal<AgentExtra<Single>, never>>;

// The client's extension pass: it converts its own extra IRs to builtin IRs and returns
// everything else untouched. Trajectory legs pass through with their insides still raw —
// down-converting those deeper levels is libocto's recursion, not the client's — and
// anything the client didn't define (a child's own extras) is never named here.
const pass: TrajectoryParams<Root, null>["lowerMessages"] = irs => {
  const out: Array<ExtraFreeIR<Root>> = [];
  for (const ir of irs) {
    if (ir.role === "note") {
      out.push({ role: "tool-output", toolCall: ir.toolCall, content: [] });
      continue;
    }
    out.push(ir);
  }
  return out;
};

// Only permissioned agents may declare permissioned children.
const _okBrandedChild = definePermissionedAgent({
  tools: { search: searchTool },
  agents: { research: definePermissionedAgent({ tools: { search: searchTool }, agents: {} }) },
});
const _badBrandedChild = definePermissionlessAgent({
  tools: { search: searchTool },
  // We expect an error here because only permissioned agents may declare permissioned children
  // @ts-expect-error
  agents: { research: definePermissionedAgent({ tools: { search: searchTool }, agents: {} }) },
});

// The permission rule applies at every depth. The violation surfaces twice — on the parent
// of the offender (mid's agents map) and on the offender itself — so both spans carry a
// directive.
definePermissionlessAgent({
  tools: { search: searchTool },
  agents: {
    // We expect an error here because only permissioned agents may declare permissioned children
    // @ts-expect-error
    mid: definePermissionlessAgent({
      tools: { search: searchTool },
      // We expect an error here because only permissioned agents may declare permissioned children
      // @ts-expect-error
      agents: {
        bad: definePermissionedAgent({ tools: { search: searchTool }, agents: {} }),
      },
    }),
  },
});

// We expect an error here because the delegate tool declares a research subagent dependency
// this agent does not satisfy
// @ts-expect-error
const _undeclaredSubagent = definePermissionlessAgent({
  tools: { delegate: delegateTool },
  agents: {},
});

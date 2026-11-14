import { t } from "structural";
import type { AgentExtra, IsPermissioned } from "./llm-ir.ts";
import { agent } from "./llm-ir.ts";
import { ok } from "./result.ts";
import { prompt } from "./system-prompt.ts";
import { ToolBuilder } from "./tools/tool-def.ts";
import type { TrajectoryParams } from "./trajectory.ts";

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
const dataTool = builder
  .withData<{ tool: boolean }>()
  .declare({ name: "data", description: "Uses data", ArgumentsSchema: t.subtype({}) })
  .define(async () => ({ run: async () => ok({ type: "output" as const, content: [] }) }));

const grandchild = agent.definePermissioned({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: {},
});
const research = agent.definePermissioned({
  systemPrompt: testPrompt,
  tools: { search: searchTool },
  agents: { grandchild },
});

const composed = agent
  .use({ tools: { search: searchTool }, agents: { research } })
  .use({ tools: { note: noteTool, delegate: delegateTool } });
const composedPermissioned = composed.definePermissioned({
  systemPrompt: testPrompt,
  tools: {},
  agents: {},
});
const composedPermissionless = composed.definePermissionless({
  systemPrompt: testPrompt,
  tools: {},
  agents: {},
});

type _composedTools = Expect<
  Equal<keyof typeof composedPermissioned.tools, "search" | "note" | "delegate">
>;
type _composedChild = Expect<Equal<typeof composedPermissioned.agents.research, typeof research>>;
type _composedRootPermission = Expect<IsPermissioned<typeof composedPermissioned>>;
type _composedNestedPermission = Expect<
  IsPermissioned<typeof composedPermissioned.agents.research.agents.grandchild>
>;
type _composedRootPermissionless = Expect<
  Equal<IsPermissioned<typeof composedPermissionless>, false>
>;
type _composedNestedPermissionless = Expect<
  Equal<IsPermissioned<typeof composedPermissionless.agents.research.agents.grandchild>, false>
>;
type _composedExtension = Expect<Equal<AgentExtra<typeof composedPermissionless>["role"], "note">>;

// Tool and subagent conflicts are checked independently, and only at the current tree node.
const sameNameAcrossNamespaces = agent
  .use({ tools: { shared: searchTool } })
  .use({ agents: { shared: grandchild } })
  .definePermissionless({ systemPrompt: testPrompt, tools: {}, agents: {} });
expectType<typeof searchTool>(sameNameAcrossNamespaces.tools.shared);
agent
  .use({ tools: { duplicate: searchTool } })
  // @ts-expect-error A later fragment cannot replace a tool at the same agent node.
  .use({ tools: { duplicate: noteTool } });
agent
  .use({ agents: { duplicate: grandchild } })
  // @ts-expect-error A later fragment cannot replace a child, even with a different child tree.
  .use({ agents: { duplicate: research } });

// Invocation-tool dependencies are checked against the accumulated tree at final definition.
const splitDependencies = agent
  .use({ tools: { delegate: delegateTool } })
  .use({ agents: { research } })
  .definePermissioned({ systemPrompt: testPrompt, tools: {}, agents: {} });
expectType<typeof research>(splitDependencies.agents.research);
agent
  .use({ tools: { delegate: delegateTool } })
  // @ts-expect-error The final definition still lacks the delegate tool's research subagent.
  .definePermissionless({ systemPrompt: testPrompt, tools: {}, agents: {} });

const composedData = agent.use({ tools: { data: dataTool } }).definePermissionless({
  systemPrompt: prompt.withData<{ composed: string }>().declare(async ({ data }) => data.composed),
  tools: {},
  agents: {},
});
const resolveComposedData: TrajectoryParams<typeof composedData, null>["getData"] = async () => ({
  composed: "value",
  tool: true,
});
expectType<Promise<{ composed: string; tool: boolean }>>(resolveComposedData());

// Dependencies of raw fragment children are local to each child's directory, not its parent.
const invalidChild = agent.use({
  agents: {
    research,
    child: { systemPrompt: testPrompt, tools: { delegate: delegateTool }, agents: {} },
  },
});
invalidChild.definePermissioned({
  systemPrompt: testPrompt,
  tools: {},
  // @ts-expect-error The raw child still lacks its own research agent.
  agents: {},
});
invalidChild.definePermissionless({
  systemPrompt: testPrompt,
  tools: {},
  // @ts-expect-error The same dependency must be checked regardless of final permissions.
  agents: {},
});

const withMetadata = agent.use({ tools: { search: searchTool } }).definePermissioned({
  systemPrompt: testPrompt,
  tools: { note: noteTool },
  agents: { research },
  metadata: { label: "retained", enabled: true } as const,
});
type _mergedMetadata = Expect<
  Equal<typeof withMetadata.metadata, { readonly label: "retained"; readonly enabled: true }>
>;
type _mergedFinalTools = Expect<Equal<keyof typeof withMetadata.tools, "search" | "note">>;

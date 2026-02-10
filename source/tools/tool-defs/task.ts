import { t } from "structural";
import { unionAll } from "../../types.ts";
import { defineTool, ToolDef, ToolError } from "../common.ts";
import { discoverAgents, Agent } from "../agents/index.ts";
import { runSubAgent } from "../agents/agent-runner.ts";
import { useTaskStore } from "../../task-manager.ts";

type TaskToolCall = {
  name: "task";
  arguments: {
    agentType: string;
    prompt: string;
    files?: string[];
    timeout?: number;
    model?: string;
  };
};

export default defineTool(async function (signal, transport, config) {
  const agents = await discoverAgents(transport, signal, config);

  // If no agents available, return null (tool won't be registered)
  if (agents.length === 0) {
    return null;
  }

  const agentNames = agents.map(a => a.name);
  const agentNameSchemas = agentNames.map(name => t.value(name));

  // Build agent descriptions for the schema comment
  const agentDescriptions = agents.map(a => `${a.name}: ${a.description}`).join("\n");

  const ArgumentsSchema = t.subtype({
    agentType: agentNameSchemas.length === 0 ? t.never : unionAll(agentNameSchemas),
    prompt: t.str.comment("The task prompt to send to the sub-agent"),
    files: t.optional(
      t
        .array(t.str)
        .comment(
          "Optional array of file paths to provide as context to the sub-agent. " +
            "All files must exist and be readable.",
        ),
    ),
    timeout: t.optional(
      t.num.comment("Optional timeout in milliseconds for the sub-agent execution. Be generous."),
    ),
    model: t.optional(
      t.str.comment(
        "Optional model nickname override for this sub-agent execution. Takes precedence over agent's static model.",
      ),
    ),
  });

  const Schema = t.subtype({
    name: t.value("task"),
    arguments: ArgumentsSchema,
  }).comment(`
    Delegate a task to a specialized sub-agent.

    Available agents:
    ${agentDescriptions}

    Use this tool when you need specialized expertise or want to parallelize work.
    The sub-agent will execute independently and return its result.

    IMPORTANT: When you have multiple independent tasks, call this tool multiple times in PARALLEL.
    Do not wait for one task to complete before starting another. All tasks run concurrently.
    Example: If you need to explore 5 different areas, make 5 Task calls at once, not sequentially.
  `);

  return {
    Schema,
    ArgumentsSchema,

    async validate(_abortSignal, transport, call) {
      const { agentType, files } = call.arguments;

      // Validate agent type exists
      if (!agentNames.includes(agentType)) {
        return new ToolError(
          `Unknown agent type: "${agentType}". Available agents: ${agentNames.join(", ")}`,
        );
      }

      // Validate files exist if provided
      if (files && files.length > 0) {
        for (const filePath of files) {
          const exists = await transport.pathExists(_abortSignal, filePath);
          if (!exists) {
            return new ToolError(`File does not exist: ${filePath}`);
          }
        }
      }

      return null;
    },

    async run(abortSignal, transport, call, cfg, _modelOverride) {
      const { agentType, prompt, files, timeout, model } = call.arguments;

      const agent = agents.find(a => a.name === agentType)!;

      // Create a task in the task store for tracking
      const taskId = useTaskStore.getState().createTask(agent.name, prompt, files || []);

      // Call the sub-agent runner with task tracking
      const result = await runSubAgent({
        agent,
        prompt,
        files: files || [],
        timeout: timeout || 60000,
        abortSignal,
        config: cfg,
        transport,
        model,
        taskId,
      });

      return {
        content: result.content,
        lines: result.content.split("\n").length,
      };
    },
  } satisfies ToolDef<t.GetType<typeof Schema>>;
});

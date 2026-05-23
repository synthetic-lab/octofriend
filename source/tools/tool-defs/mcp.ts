import { t } from "structural";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOL, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { Config } from "../../config.ts";
import { getModelFromConfig } from "../../config.ts";
import { Result, ok, err, flatten } from "../../result.ts";

// Types ported from:
// https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/types.ts
type ResourceContents = {
  uri: string;
  mimeType?: string;
};
type MCPResult = {
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        mimeType: string;
        data: string;
      }
    | {
        type: "audio";
        mimeType: string;
        data: string;
      }
    | (ResourceContents & {
        type: "resource_link";
      })
    | {
        type: "resource";
        resource:
          | (ResourceContents & {
              text: string;
            })
          | (ResourceContents & {
              blob: string;
            });
      }
  >;
};

// Cache for MCP clients to avoid reconnecting
const clientCache = new Map<string, Client>();

export async function getMcpClient(
  serverName: string,
  config: Config,
): Promise<Result<Client, string>> {
  // Check cache first
  if (clientCache.has(serverName)) {
    return ok(clientCache.get(serverName)!);
  }

  const result = await connectMcpServer(serverName, config);
  if (!result.success) return result;

  const client = result.data;
  clientCache.set(serverName, client);

  return ok(client);
}

export async function connectMcpServer(
  serverName: string,
  config: Config,
  log: boolean = false,
): Promise<Result<Client, string>> {
  const serverConfig = config.mcpServers?.[serverName];

  if (!serverConfig) {
    return err(`MCP server "${serverName}" not found in config. Please add it to mcpServers.`);
  }

  const client = new Client({
    name: `octofriend-${serverName}`,
    version: "1.0.0",
  });

  const baseEnvEntries = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] != null,
  );

  const baseEnv: Record<string, string> = Object.fromEntries(baseEnvEntries);

  const env: Record<string, string> = serverConfig.env
    ? { ...baseEnv, ...serverConfig.env }
    : baseEnv;

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env,
    stderr: log ? "inherit" : "ignore",
  });

  try {
    await client.connect(transport);
    return ok(client);
  } catch (error) {
    return err(`MCP error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function shutdownMcpClients(): Promise<void> {
  const entries = Array.from(clientCache.entries());
  clientCache.clear();

  for (const [serverName, client] of entries) {
    try {
      await client.close();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: failed to close MCP client "${serverName}": ${reason}`);
    }
  }
}

export default TOOL.declare({
  name: "mcp",
  description: `
Interact with Model Context Protocol (MCP) servers to access external tools and resources.

MCP servers provide specialized tools like filesystem access, database queries, web scraping,
or integration with external services. Each server runs as a separate process and exposes
tools that can be called with specific arguments.
`.trim(),
  ArgumentsSchema: t.subtype({
    server: t.str.comment("Name of the MCP server to use"),
    tool: t.str.comment("Name of the tool to call"),
    arguments: t.optional(t.dict(t.str)),
  }),
}).define(async ({ data }) => {
  const hasMcp = data.mcpServers != null && Object.keys(data.mcpServers).length > 0;
  if (!hasMcp) return null;

  return {
    async run({ signal, toolCall, data }) {
      const {
        server: serverName,
        tool: toolName,
        arguments: toolArgs = {},
      } = toolCall.parsed.arguments;

      // Helper to race any promise against the abort signal
      const withAbort = async <T>(p: Promise<T>): Promise<Result<T, string>> => {
        if (signal.aborted) return err(USER_ABORTED_ERROR_MESSAGE);
        try {
          const value = await new Promise<Result<T, string>>((resolve, reject) => {
            const onAbort = () => {
              signal.removeEventListener("abort", onAbort);
              reject(new Error(USER_ABORTED_ERROR_MESSAGE));
            };
            signal.addEventListener("abort", onAbort);
            p.then(
              v => {
                signal.removeEventListener("abort", onAbort);
                resolve(ok(v));
              },
              e => {
                signal.removeEventListener("abort", onAbort);
                reject(e);
              },
            );
          });
          return value;
        } catch (error) {
          if (signal.aborted) return err(USER_ABORTED_ERROR_MESSAGE);
          return err(`MCP error: ${error instanceof Error ? error.message : String(error)}`);
        }
      };

      const client = flatten(await withAbort(getMcpClient(serverName, data)));
      if (!client.success) return client;

      // List available tools to check if the requested tool exists
      const tools = await withAbort(client.data.listTools());
      if (!tools.success) return tools;
      const tool = tools.data.tools.find(t => t.name === toolName);

      if (!tool) {
        const availableTools = tools.data.tools.map(t => t.name).join(", ");
        return err(
          `Tool "${toolName}" not found in MCP server "${serverName}". Available tools: ${availableTools}`,
        );
      }

      // Call the tool (cannot truly cancel, but we can ignore result post-abort)
      const mcpResult = await withAbort(
        client.data.callTool({
          name: toolName,
          arguments: toolArgs,
        }) as Promise<MCPResult>,
      );
      if (!mcpResult.success) return mcpResult;

      // Worst case, the response sizes will be one token per byte. Cap responses to the context
      // length
      const model = getModelFromConfig(data, null);
      const MAX_SIZE = model.context;

      for (const content of mcpResult.data.content) {
        if (content.type === "text" && content.text.length > MAX_SIZE) {
          return err(
            `Text content too large: ${content.text.length} bytes (max: ${MAX_SIZE} bytes)`,
          );
        }
        if (content.type === "resource") {
          if ("text" in content.resource && content.resource.text.length > MAX_SIZE) {
            return err(
              `Resource text content too large: ${content.resource.text.length} bytes (max: ${MAX_SIZE} bytes)`,
            );
          }
        }
      }

      // Format the result
      let output = "";
      for (const content of mcpResult.data.content) {
        if (content.type === "text") {
          output += content.text + "\n";
        } else if (content.type === "image") {
          output += `[Image: ${content.mimeType}, ${content.data.length} bytes]\n`;
        } else if (content.type === "audio") {
          output += `[Audio: ${content.mimeType}, ${content.data.length} bytes]\n`;
        } else if (content.type === "resource_link") {
          output += `[Resource Link: ${content.uri}`;
          if (content.mimeType) {
            output += ` (${content.mimeType})`;
          }
          output += `]\n`;
        } else if (content.type === "resource") {
          const resource = content.resource;
          if ("text" in resource) {
            output += `[Resource: ${resource.uri}]\n${resource.text}\n`;
          } else {
            // blob variant
            output += `[Resource: ${resource.uri} (${resource.mimeType || "application/octet-stream"})]\n`;
            output += `[Binary data: ${resource.blob.length} bytes]\n`;
          }
        }
      }

      return ok({
        type: "output",
        content: [{ type: "text", content: output.trim() }],
      });
    },
  };
});

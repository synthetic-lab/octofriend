import { t } from "structural";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolError, ToolDef } from "../common.ts";
import { Config } from "../../config.ts";

// Types ported from:
// https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/types.ts
type ResourceContents = {
  uri: string,
  mimeType?: string,
};
type MCPResult = {
  content: Array<{
    type: "text",
    text: string,
  } | {
    type: "image",
    mimeType: string,
    data: string,
  } | {
    type: "audio",
    mimeType: string,
    data: string,
  } | (ResourceContents & {
    type: "resource_link",
  }) | {
    type: "resource",
    resource: (ResourceContents & {
      text: string,
    }) | ( ResourceContents & {
      blob: string,
    }),
  }>
};

const ArgumentsSchema = t.subtype({
  server: t.str.comment("Name of the MCP server to use"),
  tool: t.str.comment("Name of the tool to call"),
  arguments: t.optional(t.dict(t.str)),
});

const Schema = t.subtype({
  name: t.value("mcp"),
  arguments: ArgumentsSchema,
}).comment(`
  Interact with Model Context Protocol (MCP) servers to access external tools and resources.

  MCP servers provide specialized tools like filesystem access, database queries, web scraping,
  or integration with external services. Each server runs as a separate process and exposes
  tools that can be called with specific arguments.
`);

// Cache for MCP clients to avoid reconnecting
const clientCache = new Map<string, Client>();

export async function getMcpClient(serverName: string, config: Config): Promise<Client> {
  // Check cache first
  if (clientCache.has(serverName)) {
    return clientCache.get(serverName)!;
  }

  const serverConfig = config.mcpServers?.[serverName];

  if (!serverConfig) {
    throw new ToolError(`MCP server "${serverName}" not found in config. Please add it to mcpServers.`);
  }

  const client = new Client({
    name: `octofriend-${serverName}`,
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: serverConfig.env || {},
  });

  await client.connect(transport);
  clientCache.set(serverName, client);
  return client;
}

export default {
  Schema,
  ArgumentsSchema,
  validate: async () => null,
  async run(call, _, config) {
    const { server: serverName, tool: toolName, arguments: toolArgs = {} } = call.tool.arguments;

    try {
      const client = await getMcpClient(serverName, config);

      // List available tools to check if the requested tool exists
      const tools = await client.listTools();
      const tool = tools.tools.find(t => t.name === toolName);

      if (!tool) {
        const availableTools = tools.tools.map(t => t.name).join(', ');
        throw new ToolError(
          `Tool "${toolName}" not found in MCP server "${serverName}". Available tools: ${availableTools}`
        );
      }

      // Call the tool
      const result = await client.callTool({
        name: toolName,
        arguments: toolArgs,
      }) as MCPResult;

      // Format the result
      let output = '';
      for (const content of result.content) {
        if (content.type === 'text') {
          output += content.text + '\n';
        } else if (content.type === 'image') {
          output += `[Image: ${content.mimeType}]\n`;
        } else if (content.type === 'resource') {
          output += `[Resource: ${content.resource.uri}]\n`;
        }
      }

      return output.trim();
    } catch (error) {
      if (error instanceof ToolError) {
        throw error;
      }
      throw new ToolError(`MCP error: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

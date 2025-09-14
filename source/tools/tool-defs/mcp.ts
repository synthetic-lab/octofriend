import { t } from "structural";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolError, ToolDef, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { Config } from "../../config.ts";
import { getModelFromConfig } from "../../config.ts";

// Sanitize text to prevent injection and formatting issues
function sanitizeText(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .trim();
}

// Sanitize server and tool names to prevent path traversal and injection
function sanitizeName(name: string): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[^a-zA-Z0-9_.-]/g, '') // Only allow safe characters
    .replace(/^\.+/, '') // Remove leading dots
    .substring(0, 100); // Reasonable length limit
}

// Validate and sanitize MCP arguments
function sanitizeMcpArgs(args: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(args)) {
    if (typeof key === 'string' && typeof value === 'string') {
      // Sanitize both keys and values
      const safeKey = sanitizeText(key);
      const safeValue = sanitizeText(value);
      if (safeKey && safeKey.length < 1000) {
        sanitized[safeKey] = safeValue;
      }
    }
  }
  
  return sanitized;
}

// Safely convert number to prevent overflow
function safeNumber(value: number, defaultValue: number, max: number): number {
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return defaultValue;
  return Math.min(Math.max(0, num), max);
}

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

// Cache for MCP clients to avoid reconnecting with config validation
const clientCache = new Map<string, { client: Client, configHash: string }>();

// Generate a hash from the relevant parts of the config for caching
function generateConfigHash(serverName: string, config: Config): string {
  const serverConfig = config.mcpServers?.[serverName];
  if (!serverConfig) return '';
  
  // Create a simple hash from command and args
  const commandStr = sanitizeText(serverConfig.command || '');
  const argsStr = Array.isArray(serverConfig.args) 
    ? serverConfig.args.map(arg => sanitizeText(arg)).join(',') 
    : '';
  
  return `${serverName}:${commandStr}:${argsStr}`;
}

export async function getMcpClient(serverName: string, config: Config): Promise<Client> {
  const sanitizedServerName = sanitizeName(serverName);
  const configHash = generateConfigHash(sanitizedServerName, config);
  
  // Check if we have a cached client with matching config
  if (clientCache.has(sanitizedServerName)) {
    const cached = clientCache.get(sanitizedServerName)!;
    if (cached.configHash === configHash) {
      return cached.client;
    }
    // Config has changed, remove old client
    try {
      await cached.client.close();
    } catch (e) {
      // Ignore close errors
    }
    clientCache.delete(sanitizedServerName);
  }

  const client = await connectMcpServer(sanitizedServerName, config);
  clientCache.set(sanitizedServerName, { client, configHash });

  return client;
}

export async function connectMcpServer(
  serverName: string,
  config: Config,
  log: boolean = false
): Promise<Client> {
  const sanitizedServerName = sanitizeName(serverName);
  const serverConfig = config.mcpServers?.[sanitizedServerName];

  if (!serverConfig) {
    throw new ToolError(`MCP server "${sanitizeText(serverName)}" not found in config. Please add it to mcpServers.`);
  }

  // Validate and sanitize command
  if (typeof serverConfig.command !== 'string' || serverConfig.command.trim() === '') {
    throw new ToolError(`MCP server "${sanitizedServerName}" command must be a non-empty string`);
  }
  
  const sanitizedCommand = sanitizeText(serverConfig.command);
  if (!sanitizedCommand) {
    throw new ToolError(`MCP server "${sanitizedServerName}" command contains only unsafe characters`);
  }
  
  // Validate and sanitize arguments
  const sanitizedArgs = Array.isArray(serverConfig.args) 
    ? serverConfig.args.map(arg => {
        if (typeof arg !== 'string') return '';
        return sanitizeText(arg);
      }).filter(arg => arg.length > 0)
    : [];
  
  // Limit number of arguments to prevent abuse
  if (sanitizedArgs.length > 100) {
    throw new ToolError(`MCP server "${sanitizedServerName}" has too many arguments (max 100)`);
  }

  // Prepare environment variables
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  
  // Filter out undefined values to ensure all environment variables are strings
  for (const key in env) {
    if (env[key] === undefined) {
      delete env[key];
    }
  }
  
  // Merge user-provided environment variables from config
  if (serverConfig.env && typeof serverConfig.env === 'object') {
    for (const [key, value] of Object.entries(serverConfig.env)) {
      if (typeof key === 'string' && typeof value === 'string') {
        const sanitizedKey = sanitizeText(key);
        const sanitizedValue = sanitizeText(value);
        if (sanitizedKey && sanitizedKey.length < 1000) {
          env[sanitizedKey] = sanitizedValue;
        }
      }
    }
  }

  const client = new Client({
    name: `octofriend-${sanitizedServerName}`,
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: sanitizedCommand,
    args: sanitizedArgs,
    stderr: log ? "inherit" : "ignore",
    env, // Pass the merged environment variables
  });

  await client.connect(transport);
  return client;
}

export default {
  Schema,
  ArgumentsSchema,
  validate: async () => null,
  async run(abortSignal, _, call, config, modelOverride) {
    // Validate and sanitize inputs
    const { server: serverName, tool: toolName, arguments: toolArgs = {} } = call.tool.arguments;
    
    if (typeof serverName !== 'string' || serverName.trim() === '') {
      throw new ToolError('Server name is required and must be a non-empty string');
    }
    
    if (typeof toolName !== 'string' || toolName.trim() === '') {
      throw new ToolError('Tool name is required and must be a non-empty string');
    }
    
    // Sanitize critical inputs
    const sanitizedServerName = sanitizeName(serverName);
    const sanitizedName = sanitizeName(toolName);
    const sanitizedArgs = sanitizeMcpArgs(toolArgs);
    
    if (!sanitizedServerName) {
      throw new ToolError('Invalid server name: contains only unsafe characters');
    }
    
    if (!sanitizedName) {
      throw new ToolError('Invalid tool name: contains only unsafe characters');
    }

    // Helper to race any promise against the abort signal
    const withAbort = async <T>(p: Promise<T>): Promise<T> => {
      if (abortSignal.aborted) throw new ToolError(USER_ABORTED_ERROR_MESSAGE);
      return await new Promise<T>((resolve, reject) => {
        const onAbort = () => {
          abortSignal.removeEventListener('abort', onAbort);
          reject(new ToolError(USER_ABORTED_ERROR_MESSAGE));
        };
        abortSignal.addEventListener('abort', onAbort);
        p.then((v) => {
          abortSignal.removeEventListener('abort', onAbort);
          resolve(v);
        }, (e) => {
          abortSignal.removeEventListener('abort', onAbort);
          reject(e);
        });
      });
    };

    try {
      const client = await withAbort(getMcpClient(sanitizedServerName, config));

      // List available tools to check if the requested tool exists
      const tools = await withAbort(client.listTools());
      const tool = tools.tools.find(t => t.name === sanitizedName);

      if (!tool) {
        const availableTools = tools.tools.map(t => t.name).join(', ');
        throw new ToolError(
          `Tool "${sanitizedName}" not found in MCP server "${sanitizedServerName}". Available tools: ${availableTools}`
        );
      }

      // Call the tool (cannot truly cancel, but we can ignore result post-abort)
      const result = await withAbort(client.callTool({
        name: sanitizedName,
        arguments: sanitizedArgs,
      }) as Promise<MCPResult>);

      // Worst case, the response sizes will be one token per byte. Cap responses to the context
      // length
      const model = getModelFromConfig(config, modelOverride);
      const SAFE_MAX_SIZE = safeNumber(model.context, 1000000, 10000000); // 1MB default, 10MB max

      for (const content of result.content) {
        if (content.type === 'text') {
          const textLength = safeNumber(content.text.length, 0, SAFE_MAX_SIZE);
          if (textLength > SAFE_MAX_SIZE) {
            throw new ToolError(
              `Text content too large: ${safeNumber(textLength, 0, Number.MAX_SAFE_INTEGER)} bytes (max: ${SAFE_MAX_SIZE} bytes)`
            );
          }
        }
        if (content.type === 'resource') {
          if ('text' in content.resource) {
            const textLength = safeNumber(content.resource.text.length, 0, SAFE_MAX_SIZE);
            if (textLength > SAFE_MAX_SIZE) {
              throw new ToolError(
                `Resource text content too large: ${safeNumber(textLength, 0, Number.MAX_SAFE_INTEGER)} bytes (max: ${SAFE_MAX_SIZE} bytes)`
              );
            }
          }
        }
      }

      // Format the result
      let output = '';
      for (const content of result.content) {
        if (content.type === 'text') {
          output += content.text + '\n';
        } else if (content.type === 'image') {
          output += `[Image: ${content.mimeType}, ${content.data.length} bytes]\n`;
        } else if (content.type === 'audio') {
          output += `[Audio: ${content.mimeType}, ${content.data.length} bytes]\n`;
        } else if (content.type === 'resource_link') {
          output += `[Resource Link: ${content.uri}`;
          if (content.mimeType) {
            output += ` (${content.mimeType})`;
          }
          output += `]\n`;
        } else if (content.type === 'resource') {
          const resource = content.resource;
          if ('text' in resource) {
            output += `[Resource: ${resource.uri}]\n${resource.text}\n`;
          } else {
            // blob variant
            output += `[Resource: ${resource.uri} (${resource.mimeType || 'application/octet-stream'})]\n`;
            output += `[Binary data: ${resource.blob.length} bytes]\n`;
          }
        }
      }

      return { content: output.trim() };
    } catch (error) {
      if (error instanceof ToolError) {
        throw error;
      }
      throw new ToolError(`MCP error: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

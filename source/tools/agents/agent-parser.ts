import YAML from "yaml";

export interface Agent {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  skills?: string[];
  hooks?: Record<string, unknown>;
  systemPrompt: string;
  path: string;
  agentFilePath: string;
}

export function parseAgentContent(content: string, filePath: string): Agent | null {
  // Normalize line endings to \n for consistent parsing
  const normalizedContent = content.replace(/\r\n/g, "\n");

  // Check for frontmatter delimiter
  if (!normalizedContent.startsWith("---\n")) {
    return null;
  }

  // Find the closing delimiter
  const closingIndex = normalizedContent.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return null;
  }

  // Extract frontmatter YAML
  const frontmatter = normalizedContent.slice(4, closingIndex);
  const bodyStart = closingIndex + 5; // Skip \n---\n or \n---\r\n

  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatter);
  } catch {
    return null;
  }

  // Validate frontmatter is an object
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const frontmatterObj = parsed as Record<string, unknown>;

  // Check required fields (using bracket notation for index signature)
  if (
    typeof frontmatterObj["name"] !== "string" ||
    typeof frontmatterObj["description"] !== "string"
  ) {
    return null;
  }

  // Validate and normalize tools if present
  let tools: string[] | undefined;
  if ("tools" in frontmatterObj) {
    if (!Array.isArray(frontmatterObj["tools"])) {
      return null;
    }
    // Validate all items are strings
    if (!frontmatterObj["tools"].every(t => typeof t === "string")) {
      return null;
    }
    tools = frontmatterObj["tools"] as string[];
  }

  // Validate and normalize disallowedTools if present
  let disallowedTools: string[] | undefined;
  if ("disallowedTools" in frontmatterObj) {
    if (!Array.isArray(frontmatterObj["disallowedTools"])) {
      return null;
    }
    // Validate all items are strings
    if (!frontmatterObj["disallowedTools"].every(t => typeof t === "string")) {
      return null;
    }
    disallowedTools = frontmatterObj["disallowedTools"] as string[];
  }

  // Validate permissionMode if present
  let permissionMode: string | undefined;
  if ("permissionMode" in frontmatterObj) {
    if (typeof frontmatterObj["permissionMode"] !== "string") {
      return null;
    }
    permissionMode = frontmatterObj["permissionMode"];
  }

  // Validate and normalize skills if present
  let skills: string[] | undefined;
  if ("skills" in frontmatterObj) {
    if (!Array.isArray(frontmatterObj["skills"])) {
      return null;
    }
    // Validate all items are strings
    if (!frontmatterObj["skills"].every(s => typeof s === "string")) {
      return null;
    }
    skills = frontmatterObj["skills"] as string[];
  }

  // Validate hooks if present (basic validation - just ensure it's an object)
  let hooks: Record<string, unknown> | undefined;
  if ("hooks" in frontmatterObj) {
    if (
      typeof frontmatterObj["hooks"] !== "object" ||
      frontmatterObj["hooks"] === null ||
      Array.isArray(frontmatterObj["hooks"])
    ) {
      return null;
    }
    hooks = frontmatterObj["hooks"] as Record<string, unknown>;
  }

  // Extract system prompt (content after frontmatter)
  let systemPrompt = normalizedContent.slice(bodyStart).trim();

  // Remove leading newline if present after ---
  if (systemPrompt.startsWith("\n")) {
    systemPrompt = systemPrompt.slice(1);
  }

  // Calculate the agent path (directory containing AGENT.md)
  const path = filePath.replace(/\/AGENT\.md$/, "");

  return {
    name: frontmatterObj["name"],
    description: frontmatterObj["description"],
    model: typeof frontmatterObj["model"] === "string" ? frontmatterObj["model"] : undefined,
    tools,
    disallowedTools,
    permissionMode,
    skills,
    hooks,
    systemPrompt,
    path,
    agentFilePath: filePath,
  };
}

export function validateAgent(agent: Agent): string[] {
  const errors: string[] = [];

  // Required fields
  if (!agent.name || agent.name.trim() === "") {
    errors.push("name is required");
  }

  if (!agent.description || agent.description.trim() === "") {
    errors.push("description is required");
  }

  // Name format validation (alphanumeric with hyphens, no consecutive or trailing hyphens)
  if (agent.name) {
    // Must start with alphanumeric
    if (!/^[a-zA-Z0-9]/.test(agent.name)) {
      errors.push(
        "name must start with alphanumeric character and contain only alphanumeric characters and hyphens",
      );
    }
    // No consecutive hyphens
    if (agent.name.includes("--")) {
      errors.push(
        "name must start with alphanumeric character and contain only alphanumeric characters and hyphens",
      );
    }
    // No trailing hyphens
    if (agent.name.endsWith("-")) {
      errors.push(
        "name must start with alphanumeric character and contain only alphanumeric characters and hyphens",
      );
    }
    // Max length 64
    if (agent.name.length > 64) {
      errors.push("name exceeds 64 characters");
    }
  }

  // Name must match directory
  if (agent.name && agent.path) {
    const dirName = agent.path.split("/").pop() || "";
    if (agent.name !== dirName) {
      errors.push("name must match directory name");
    }
  }

  // Description max length
  if (agent.description && agent.description.length > 1024) {
    errors.push("description exceeds 1024 characters");
  }

  // Model validation
  if ("model" in agent && agent.model !== undefined) {
    if (agent.model === "") {
      errors.push("model cannot be empty");
    }
  }

  // Tools validation
  if ("tools" in agent && agent.tools !== undefined) {
    if (!Array.isArray(agent.tools)) {
      errors.push("tools must be an array");
    } else {
      // Check all items are strings
      if (!agent.tools.every(t => typeof t === "string")) {
        errors.push("tool names must be strings");
      }
      // Validate tool name format (lowercase, alphanumeric with underscores and hyphens)
      for (const tool of agent.tools) {
        if (typeof tool === "string" && !/^[a-z0-9_-]+$/.test(tool)) {
          errors.push(`invalid tool name: ${tool}`);
        }
      }
    }
  }

  // DisallowedTools validation
  if ("disallowedTools" in agent && agent.disallowedTools !== undefined) {
    if (!Array.isArray(agent.disallowedTools)) {
      errors.push("disallowedTools must be an array");
    } else {
      // Check all items are strings
      if (!agent.disallowedTools.every(t => typeof t === "string")) {
        errors.push("disallowed tool names must be strings");
      }
      // Validate tool name format
      for (const tool of agent.disallowedTools) {
        if (typeof tool === "string" && !/^[a-z0-9_-]+$/.test(tool)) {
          errors.push(`invalid disallowed tool name: ${tool}`);
        }
      }
    }
  }

  // PermissionMode validation
  if ("permissionMode" in agent && agent.permissionMode !== undefined) {
    const validModes = ["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"];
    if (!validModes.includes(agent.permissionMode)) {
      errors.push(`permissionMode must be one of: ${validModes.join(", ")}`);
    }
  }

  // Skills validation
  if ("skills" in agent && agent.skills !== undefined) {
    if (!Array.isArray(agent.skills)) {
      errors.push("skills must be an array");
    } else {
      // Check all items are strings
      if (!agent.skills.every(s => typeof s === "string")) {
        errors.push("skill names must be strings");
      }
    }
  }

  return errors;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toPromptXML(agents: Agent[]): string {
  if (agents.length === 0) {
    return "";
  }

  let xml = "<available_agents>\n";

  for (const agent of agents) {
    xml += "  <agent>\n";
    xml += `    <name>${escapeXml(agent.name)}</name>\n`;
    xml += `    <description>${escapeXml(agent.description)}</description>\n`;
    xml += `    <location>${escapeXml(agent.agentFilePath)}</location>\n`;

    if (agent.model !== undefined) {
      xml += `    <model>${escapeXml(agent.model)}</model>\n`;
    }

    if (agent.tools !== undefined && agent.tools.length > 0) {
      xml += `    <tools>${escapeXml(agent.tools.join(", "))}</tools>\n`;
    }

    if (agent.disallowedTools !== undefined && agent.disallowedTools.length > 0) {
      xml += `    <disallowed_tools>${escapeXml(agent.disallowedTools.join(", "))}</disallowed_tools>\n`;
    }

    if (agent.permissionMode !== undefined) {
      xml += `    <permission_mode>${escapeXml(agent.permissionMode)}</permission_mode>\n`;
    }

    if (agent.skills !== undefined && agent.skills.length > 0) {
      xml += `    <skills>${escapeXml(agent.skills.join(", "))}</skills>\n`;
    }

    xml += "  </agent>\n";
  }

  xml += "</available_agents>";

  return xml;
}

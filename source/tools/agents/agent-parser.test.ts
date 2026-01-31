import { describe, it, expect } from "vitest";
import { parseAgentContent, validateAgent, toPromptXML, Agent } from "./agent-parser.ts";

describe("agent-parser", () => {
  describe("parseAgentContent", () => {
    it("parses a full agent file with all fields", () => {
      const content = `---
name: code-reviewer
description: Reviews code for bugs, style issues, and best practices.
model: claude-3-5-sonnet-20241022
tools:
  - file_read
  - file_write
  - bash
---

You are a meticulous code reviewer. Analyze code for:
- Bugs and logical errors
- Performance issues
- Security vulnerabilities
- Style guide compliance

Be thorough but constructive in your feedback.
`;

      const agent = parseAgentContent(content, "/agents/code-reviewer/AGENT.md");

      expect(agent).not.toBeNull();
      expect(agent!.name).toBe("code-reviewer");
      expect(agent!.description).toBe("Reviews code for bugs, style issues, and best practices.");
      expect(agent!.model).toBe("claude-3-5-sonnet-20241022");
      expect(agent!.tools).toEqual(["file_read", "file_write", "bash"]);
      expect(agent!.systemPrompt).toBe(
        "You are a meticulous code reviewer. Analyze code for:\n- Bugs and logical errors\n- Performance issues\n- Security vulnerabilities\n- Style guide compliance\n\nBe thorough but constructive in your feedback.",
      );
      expect(agent!.path).toBe("/agents/code-reviewer");
      expect(agent!.agentFilePath).toBe("/agents/code-reviewer/AGENT.md");
    });

    it("parses a minimal agent file", () => {
      const content = `---
name: my-agent
description: A simple agent.
---

You are a helpful assistant.
`;

      const agent = parseAgentContent(content, "/agents/my-agent/AGENT.md");

      expect(agent).not.toBeNull();
      expect(agent!.name).toBe("my-agent");
      expect(agent!.description).toBe("A simple agent.");
      expect(agent!.model).toBeUndefined();
      expect(agent!.tools).toBeUndefined();
      expect(agent!.systemPrompt).toBe("You are a helpful assistant.");
    });

    it("parses an agent with empty tools array", () => {
      const content = `---
name: no-tools-agent
description: An agent with no tools.
tools: []
---

Just chat with the user.
`;

      const agent = parseAgentContent(content, "/agents/no-tools-agent/AGENT.md");

      expect(agent).not.toBeNull();
      expect(agent!.tools).toEqual([]);
    });

    it("returns null for missing frontmatter", () => {
      const content = "# Just Markdown\n\nNo frontmatter here.";
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });

    it("returns null for unclosed frontmatter", () => {
      const content = `---
name: broken
description: Missing closing delimiter
`;
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });

    it("returns null for missing required name field", () => {
      const content = `---
description: Missing name field
---

Content here.
`;
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });

    it("returns null for missing required description field", () => {
      const content = `---
name: no-description
---

Content here.
`;
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });

    it("handles CRLF line endings", () => {
      const content =
        "---\r\nname: crlf-agent\r\ndescription: Works with Windows line endings.\r\n---\r\n\r\nSystem prompt.";
      const agent = parseAgentContent(content, "/test/AGENT.md");

      expect(agent).not.toBeNull();
      expect(agent!.name).toBe("crlf-agent");
      expect(agent!.description).toBe("Works with Windows line endings.");
    });

    it("handles invalid YAML in frontmatter", () => {
      const content = `---
name: test
description: Test agent
model: [invalid yaml :::
---

Content.
`;
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });

    it("handles non-array tools field", () => {
      const content = `---
name: bad-tools
description: Invalid tools field
tools: "not-an-array"
---

Content.
`;
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });

    it("handles tools with non-string items", () => {
      const content = `---
name: bad-tool-items
description: Invalid tool items
tools:
  - file_read
  - 123
  - true
---

Content.
`;
      const agent = parseAgentContent(content, "/test/AGENT.md");
      expect(agent).toBeNull();
    });
  });

  describe("validateAgent", () => {
    it("validates a correct agent", () => {
      const agent: Agent = {
        name: "valid-agent",
        description: "A valid agent description.",
        systemPrompt: "You are helpful.",
        path: "/agents/valid-agent",
        agentFilePath: "/agents/valid-agent/AGENT.md",
      };

      const errors = validateAgent(agent);
      expect(errors).toHaveLength(0);
    });

    it("validates a correct agent with all optional fields", () => {
      const agent: Agent = {
        name: "full-agent",
        description: "A full agent description.",
        model: "claude-3-opus-20240229",
        tools: ["file_read", "bash"],
        systemPrompt: "You are helpful.",
        path: "/agents/full-agent",
        agentFilePath: "/agents/full-agent/AGENT.md",
      };

      const errors = validateAgent(agent);
      expect(errors).toHaveLength(0);
    });

    it("requires name", () => {
      const agent: Agent = {
        name: "",
        description: "Has description.",
        systemPrompt: "",
        path: "",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors).toContain("name is required");
    });

    it("requires description", () => {
      const agent: Agent = {
        name: "no-desc",
        description: "",
        systemPrompt: "",
        path: "/agents/no-desc",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors).toContain("description is required");
    });

    it("validates name format (alphanumeric with hyphens)", () => {
      const agent: Agent = {
        name: "-invalid-name",
        description: "Description.",
        systemPrompt: "",
        path: "",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("alphanumeric"))).toBe(true);
    });

    it("validates name format (no consecutive hyphens)", () => {
      const agent: Agent = {
        name: "invalid--name",
        description: "Description.",
        systemPrompt: "",
        path: "",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("alphanumeric"))).toBe(true);
    });

    it("validates name format (no trailing hyphens)", () => {
      const agent: Agent = {
        name: "invalid-name-",
        description: "Description.",
        systemPrompt: "",
        path: "",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("alphanumeric"))).toBe(true);
    });

    it("validates name matches directory", () => {
      const agent: Agent = {
        name: "agent-one",
        description: "Description.",
        systemPrompt: "",
        path: "/agents/agent-two",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("must match directory"))).toBe(true);
    });

    it("validates name length (max 64 chars)", () => {
      const agent: Agent = {
        name: "a".repeat(65),
        description: "Description.",
        systemPrompt: "",
        path: "",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("exceeds 64"))).toBe(true);
    });

    it("validates description length (max 1024 chars)", () => {
      const agent: Agent = {
        name: "test",
        description: "a".repeat(1025),
        systemPrompt: "",
        path: "/agents/test",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("description exceeds"))).toBe(true);
    });

    it("validates model format when provided", () => {
      const agent: Agent = {
        name: "test",
        description: "Description.",
        model: "",
        systemPrompt: "",
        path: "/agents/test",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("model cannot be empty"))).toBe(true);
    });

    it("validates tools is array when provided", () => {
      const agent: Agent = {
        name: "test",
        description: "Description.",
        tools: "not-an-array" as unknown as string[],
        systemPrompt: "",
        path: "/agents/test",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("tools must be an array"))).toBe(true);
    });

    it("validates tools items are strings", () => {
      const agent: Agent = {
        name: "test",
        description: "Description.",
        tools: ["file_read", 123 as unknown as string, "bash"],
        systemPrompt: "",
        path: "/agents/test",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("tool names must be strings"))).toBe(true);
    });

    it("validates tool name format", () => {
      const agent: Agent = {
        name: "test",
        description: "Description.",
        tools: ["valid-tool", "InvalidTool"],
        systemPrompt: "",
        path: "/agents/test",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors.some(e => e.includes("invalid tool name"))).toBe(true);
    });

    it("allows mixed case names", () => {
      const agent: Agent = {
        name: "MyAgent",
        description: "Description.",
        systemPrompt: "",
        path: "/agents/MyAgent",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors).toHaveLength(0);
    });

    it("allows underscores in tool names", () => {
      const agent: Agent = {
        name: "test",
        description: "Description.",
        tools: ["file_read", "bash_exec", "git_status"],
        systemPrompt: "",
        path: "/agents/test",
        agentFilePath: "",
      };

      const errors = validateAgent(agent);
      expect(errors).toHaveLength(0);
    });
  });

  describe("toPromptXML", () => {
    it("generates XML for agents", () => {
      const agents: Agent[] = [
        {
          name: "code-reviewer",
          description: "Reviews code for bugs.",
          systemPrompt: "",
          path: "/agents/code-reviewer",
          agentFilePath: "/agents/code-reviewer/AGENT.md",
        },
        {
          name: "test-writer",
          description: "Writes unit tests.",
          model: "claude-3-haiku-20240307",
          tools: ["file_read", "file_write"],
          systemPrompt: "",
          path: "/agents/test-writer",
          agentFilePath: "/agents/test-writer/AGENT.md",
        },
      ];

      const xml = toPromptXML(agents);

      expect(xml).toContain("<available_agents>");
      expect(xml).toContain("</available_agents>");
      expect(xml).toContain("<name>code-reviewer</name>");
      expect(xml).toContain("<description>Reviews code for bugs.</description>");
      expect(xml).toContain("<location>/agents/code-reviewer/AGENT.md</location>");
      expect(xml).toContain("<name>test-writer</name>");
      expect(xml).toContain("<model>claude-3-haiku-20240307</model>");
      expect(xml).toContain("<tools>file_read, file_write</tools>");
    });

    it("returns empty string for empty agents array", () => {
      expect(toPromptXML([])).toBe("");
    });

    it("escapes XML special characters", () => {
      const agents: Agent[] = [
        {
          name: "test-agent",
          description: 'Uses <tags> & "quotes"',
          systemPrompt: "",
          path: "/agents/test-agent",
          agentFilePath: "/agents/test-agent/AGENT.md",
        },
      ];

      const xml = toPromptXML(agents);

      expect(xml).toContain("&lt;tags&gt;");
      expect(xml).toContain("&amp;");
      expect(xml).toContain("&quot;quotes&quot;");
    });

    it("omits optional fields when not present", () => {
      const agents: Agent[] = [
        {
          name: "minimal-agent",
          description: "Minimal agent.",
          systemPrompt: "",
          path: "/agents/minimal-agent",
          agentFilePath: "/agents/minimal-agent/AGENT.md",
        },
      ];

      const xml = toPromptXML(agents);

      expect(xml).toContain("<name>minimal-agent</name>");
      expect(xml).not.toContain("<model>");
      expect(xml).not.toContain("<tools>");
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { Transport } from "../../transports/transport-common.ts";
import { Config } from "../../config.ts";
import { Agent, discoverAgents } from "./index.ts";

type MockDirEntry = { entry: string; isDirectory: boolean };

function createMockTransport(fileSystem: Map<string, string | MockDirEntry[]>): Transport {
  return {
    readFile: vi.fn(async (signal: AbortSignal, file: string) => {
      if (signal.aborted) throw new Error("Aborted");
      const content = fileSystem.get(file);
      if (typeof content === "string") return content;
      throw new Error(`File not found: ${file}`);
    }),
    writeFile: vi.fn(async () => {}),
    pathExists: vi.fn(async (signal: AbortSignal, file: string) => {
      if (signal.aborted) throw new Error("Aborted");
      return fileSystem.has(file);
    }),
    isDirectory: vi.fn(async (signal: AbortSignal, file: string) => {
      if (signal.aborted) throw new Error("Aborted");
      const content = fileSystem.get(file);
      return Array.isArray(content);
    }),
    mkdir: vi.fn(async () => {}),
    readdir: vi.fn(async (signal: AbortSignal, dirpath: string) => {
      if (signal.aborted) throw new Error("Aborted");
      const content = fileSystem.get(dirpath);
      if (Array.isArray(content)) return content;
      throw new Error(`Directory not found: ${dirpath}`);
    }),
    modTime: vi.fn(async () => Date.now()),
    resolvePath: vi.fn(async (_signal: AbortSignal, path: string) => path),
    shell: vi.fn(async () => ""),
    cwd: vi.fn(async () => "/project"),
    close: vi.fn(async () => {}),
  };
}

function createValidAgentContent(name: string, description = "A test agent"): string {
  return `---
name: ${name}
description: ${description}
---

You are a helpful ${name} agent.
`;
}

describe("discoverAgents", () => {
  describe("discovering from multiple directories", () => {
    it("discovers agents from built-in, user, and project-local paths", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "user-agent", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/user-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/user-agent/AGENT.md",
          createValidAgentContent("user-agent"),
        ],
        ["/project/.agents/agents", [{ entry: "project-agent", isDirectory: true }]],
        ["/project/.agents/agents/project-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        [
          "/project/.agents/agents/project-agent/AGENT.md",
          createValidAgentContent("project-agent"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.cwd = vi.fn(async () => "/project");
      transport.shell = vi.fn(async (_signal, command) => {
        if (command === "echo $HOME") return "/home/user\n";
        return "";
      });

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain("user-agent");
      expect(agents.map(a => a.name)).toContain("project-agent");
    });

    it("includes custom paths from config", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/custom/agents", [{ entry: "custom-agent", isDirectory: true }]],
        ["/custom/agents/custom-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/custom/agents/custom-agent/AGENT.md", createValidAgentContent("custom-agent")],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
        agents: {
          paths: ["/custom/agents"],
        },
      } as Config;

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("custom-agent");
    });

    it("skips non-existent directories gracefully", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "user-agent", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/user-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/user-agent/AGENT.md",
          createValidAgentContent("user-agent"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.pathExists = vi.fn(async (signal: AbortSignal, file: string) => {
        if (signal.aborted) throw new Error("Aborted");
        // /project/.agents/agents doesn't exist
        if (file === "/project/.agents/agents") return false;
        return fileSystem.has(file);
      });
      transport.shell = vi.fn(async () => "/home/user\n");
      transport.cwd = vi.fn(async () => "/project");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("user-agent");
    });
  });

  describe("parsing and validating agents", () => {
    it("parses valid agent files correctly", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "code-reviewer", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/code-reviewer",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/code-reviewer/AGENT.md",
          `---
name: code-reviewer
description: Reviews code for bugs and style issues.
model: claude-3-5-sonnet-20241022
tools:
  - file_read
  - bash
---

You are a meticulous code reviewer. Analyze code for bugs and performance issues.
`,
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("code-reviewer");
      expect(agents[0].description).toBe("Reviews code for bugs and style issues.");
      expect(agents[0].model).toBe("claude-3-5-sonnet-20241022");
      expect(agents[0].tools).toEqual(["file_read", "bash"]);
      expect(agents[0].systemPrompt).toContain("You are a meticulous code reviewer");
    });

    it("validates agents and skips invalid ones", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        [
          "/home/user/.config/agents/agents",
          [
            { entry: "valid-agent", isDirectory: true },
            { entry: "invalid-agent", isDirectory: true },
          ],
        ],
        [
          "/home/user/.config/agents/agents/valid-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/valid-agent/AGENT.md",
          createValidAgentContent("valid-agent"),
        ],
        [
          "/home/user/.config/agents/agents/invalid-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        // Name doesn't match directory
        [
          "/home/user/.config/agents/agents/invalid-agent/AGENT.md",
          createValidAgentContent("wrong-name"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("valid-agent");
    });
  });

  describe("handling duplicate agent names", () => {
    it("skips duplicate agent names and keeps first occurrence", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "my-agent", isDirectory: true }]],
        ["/home/user/.config/agents/agents/my-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        [
          "/home/user/.config/agents/agents/my-agent/AGENT.md",
          createValidAgentContent("my-agent", "First agent"),
        ],
        ["/project/.agents/agents", [{ entry: "my-agent", isDirectory: true }]],
        ["/project/.agents/agents/my-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        [
          "/project/.agents/agents/my-agent/AGENT.md",
          createValidAgentContent("my-agent", "Duplicate agent"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");
      transport.cwd = vi.fn(async () => "/project");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("my-agent");
      expect(agents[0].description).toBe("First agent");
    });

    it("logs error when skipping duplicate agent names", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "my-agent", isDirectory: true }]],
        ["/home/user/.config/agents/agents/my-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/home/user/.config/agents/agents/my-agent/AGENT.md", createValidAgentContent("my-agent")],
        ["/project/.agents/agents", [{ entry: "my-agent", isDirectory: true }]],
        ["/project/.agents/agents/my-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/project/.agents/agents/my-agent/AGENT.md", createValidAgentContent("my-agent")],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");
      transport.cwd = vi.fn(async () => "/project");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      // Mock logger to verify error is logged
      const loggerSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await discoverAgents(transport, new AbortController().signal, config);

      // Should log error about duplicate
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate agent name"));

      loggerSpy.mockRestore();
    });
  });

  describe("handling invalid agent files", () => {
    it("skips agent files that fail to parse", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        [
          "/home/user/.config/agents/agents",
          [
            { entry: "valid-agent", isDirectory: true },
            { entry: "broken-agent", isDirectory: true },
          ],
        ],
        [
          "/home/user/.config/agents/agents/valid-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/valid-agent/AGENT.md",
          createValidAgentContent("valid-agent"),
        ],
        [
          "/home/user/.config/agents/agents/broken-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        // Missing frontmatter
        [
          "/home/user/.config/agents/agents/broken-agent/AGENT.md",
          "# Just markdown\n\nNo frontmatter.",
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("valid-agent");
    });

    it("logs error when failing to parse agent file", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "broken-agent", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/broken-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        ["/home/user/.config/agents/agents/broken-agent/AGENT.md", "# No frontmatter"],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const loggerSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await discoverAgents(transport, new AbortController().signal, config);

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse agent file"));

      loggerSpy.mockRestore();
    });

    it("logs error when agent validation fails", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "invalid-agent", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/invalid-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        // Name doesn't match directory
        [
          "/home/user/.config/agents/agents/invalid-agent/AGENT.md",
          createValidAgentContent("wrong-name"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const loggerSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await discoverAgents(transport, new AbortController().signal, config);

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("Agent validation failed"));

      loggerSpy.mockRestore();
    });

    it("handles read errors gracefully", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        [
          "/home/user/.config/agents/agents",
          [
            { entry: "valid-agent", isDirectory: true },
            { entry: "error-agent", isDirectory: true },
          ],
        ],
        [
          "/home/user/.config/agents/agents/valid-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/valid-agent/AGENT.md",
          createValidAgentContent("valid-agent"),
        ],
        [
          "/home/user/.config/agents/agents/error-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.readFile = vi.fn(async (signal: AbortSignal, file: string) => {
        if (signal.aborted) throw new Error("Aborted");
        if (file.includes("error-agent")) {
          throw new Error("Permission denied");
        }
        const content = fileSystem.get(file);
        if (typeof content === "string") return content;
        throw new Error(`File not found: ${file}`);
      });
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const loggerSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("valid-agent");
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("Error reading agent file"));

      loggerSpy.mockRestore();
    });
  });

  describe("walking subdirectories recursively", () => {
    it("discovers agents in nested subdirectories", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        [
          "/home/user/.config/agents/agents",
          [
            { entry: "category-a", isDirectory: true },
            { entry: "category-b", isDirectory: true },
          ],
        ],
        [
          "/home/user/.config/agents/agents/category-a",
          [{ entry: "nested-agent", isDirectory: true }],
        ],
        [
          "/home/user/.config/agents/agents/category-a/nested-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/category-a/nested-agent/AGENT.md",
          createValidAgentContent("nested-agent"),
        ],
        [
          "/home/user/.config/agents/agents/category-b",
          [{ entry: "deep-agent", isDirectory: true }],
        ],
        [
          "/home/user/.config/agents/agents/category-b/deep-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/category-b/deep-agent/AGENT.md",
          createValidAgentContent("deep-agent"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain("nested-agent");
      expect(agents.map(a => a.name)).toContain("deep-agent");
    });

    it("handles deeply nested directory structures", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "level1", isDirectory: true }]],
        ["/home/user/.config/agents/agents/level1", [{ entry: "level2", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/level1/level2",
          [{ entry: "level3", isDirectory: true }],
        ],
        [
          "/home/user/.config/agents/agents/level1/level2/level3",
          [{ entry: "deep-nested-agent", isDirectory: true }],
        ],
        [
          "/home/user/.config/agents/agents/level1/level2/level3/deep-nested-agent",
          [{ entry: "AGENT.md", isDirectory: false }],
        ],
        [
          "/home/user/.config/agents/agents/level1/level2/level3/deep-nested-agent/AGENT.md",
          createValidAgentContent("deep-nested-agent"),
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("deep-nested-agent");
    });

    it("ignores non-AGENT.md files", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "my-agent", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/my-agent",
          [
            { entry: "AGENT.md", isDirectory: false },
            { entry: "README.md", isDirectory: false },
            { entry: "notes.txt", isDirectory: false },
          ],
        ],
        ["/home/user/.config/agents/agents/my-agent/AGENT.md", createValidAgentContent("my-agent")],
        ["/home/user/.config/agents/agents/my-agent/README.md", "# Readme"],
        ["/home/user/.config/agents/agents/my-agent/notes.txt", "Some notes"],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("my-agent");
    });
  });

  describe("respecting abort signals", () => {
    it("stops discovery when abort signal is triggered", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        [
          "/home/user/.config/agents/agents",
          [
            { entry: "agent1", isDirectory: true },
            { entry: "agent2", isDirectory: true },
          ],
        ],
        ["/home/user/.config/agents/agents/agent1", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/home/user/.config/agents/agents/agent1/AGENT.md", createValidAgentContent("agent1")],
        ["/home/user/.config/agents/agents/agent2", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/home/user/.config/agents/agents/agent2/AGENT.md", createValidAgentContent("agent2")],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const controller = new AbortController();
      const config: Config = {
        yourName: "test",
        models: [],
      };

      // Abort after first readdir call
      let readdirCount = 0;
      transport.readdir = vi.fn(async (signal: AbortSignal, dirpath: string) => {
        readdirCount++;
        if (readdirCount > 1) {
          controller.abort();
        }
        if (signal.aborted) throw new Error("Aborted");
        const content = fileSystem.get(dirpath);
        if (Array.isArray(content)) return content;
        throw new Error(`Directory not found: ${dirpath}`);
      });

      const agents = await discoverAgents(transport, controller.signal, config);

      // Should have stopped early due to abort
      expect(agents.length).toBeLessThan(2);
    });

    it("checks abort signal during file reading", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "agent1", isDirectory: true }]],
        ["/home/user/.config/agents/agents/agent1", [{ entry: "AGENT.md", isDirectory: false }]],
      ]);

      const controller = new AbortController();
      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");
      transport.readFile = vi.fn(async (signal: AbortSignal) => {
        if (signal.aborted) throw new Error("Aborted");
        controller.abort();
        return createValidAgentContent("agent1");
      });

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, controller.signal, config);

      expect(agents).toHaveLength(0);
    });

    it("checks abort signal between directories", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "agent1", isDirectory: true }]],
        ["/home/user/.config/agents/agents/agent1", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/home/user/.config/agents/agents/agent1/AGENT.md", createValidAgentContent("agent1")],
        ["/project/.agents/agents", [{ entry: "agent2", isDirectory: true }]],
        ["/project/.agents/agents/agent2", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/project/.agents/agents/agent2/AGENT.md", createValidAgentContent("agent2")],
      ]);

      const controller = new AbortController();
      const transport = createMockTransport(fileSystem);

      let pathExistsCount = 0;
      transport.pathExists = vi.fn(async (signal: AbortSignal, file: string) => {
        pathExistsCount++;
        if (pathExistsCount > 1) {
          controller.abort();
        }
        if (signal.aborted) throw new Error("Aborted");
        return fileSystem.has(file);
      });
      transport.shell = vi.fn(async () => "/home/user\n");
      transport.cwd = vi.fn(async () => "/project");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, controller.signal, config);

      // Should only have agents from first directory
      expect(agents.length).toBeLessThan(2);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when no agents are found", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", []],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toEqual([]);
    });

    it("handles empty directories gracefully", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "empty-dir", isDirectory: true }]],
        ["/home/user/.config/agents/agents/empty-dir", []],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toEqual([]);
    });

    it("handles directories without AGENT.md files", async () => {
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/home/user/.config/agents/agents", [{ entry: "no-agent-dir", isDirectory: true }]],
        [
          "/home/user/.config/agents/agents/no-agent-dir",
          [
            { entry: "README.md", isDirectory: false },
            { entry: "src", isDirectory: true },
          ],
        ],
        [
          "/home/user/.config/agents/agents/no-agent-dir/src",
          [{ entry: "main.ts", isDirectory: false }],
        ],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
      };

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      expect(agents).toEqual([]);
    });

    it("prevents duplicate file paths from being processed twice", async () => {
      // Same path included twice via different config paths
      const fileSystem = new Map<string, string | MockDirEntry[]>([
        ["/custom/agents", [{ entry: "my-agent", isDirectory: true }]],
        ["/custom/agents/my-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        ["/custom/agents/my-agent/AGENT.md", createValidAgentContent("my-agent")],
        ["/symlink/agents", [{ entry: "my-agent", isDirectory: true }]],
        ["/symlink/agents/my-agent", [{ entry: "AGENT.md", isDirectory: false }]],
        // Same content, different path (simulating symlink or duplicate config)
        ["/symlink/agents/my-agent/AGENT.md", createValidAgentContent("my-agent")],
      ]);

      const transport = createMockTransport(fileSystem);
      transport.shell = vi.fn(async () => "/home/user\n");

      const config: Config = {
        yourName: "test",
        models: [],
        agents: {
          paths: ["/custom/agents", "/symlink/agents"],
        },
      } as Config;

      const agents = await discoverAgents(transport, new AbortController().signal, config);

      // Should only have one agent even though file exists in two paths
      expect(agents).toHaveLength(1);
    });
  });
});

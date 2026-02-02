import path from "path";
import { t, toTypescript } from "structural";
import { Config } from "../config.ts";
import { getMcpClient } from "../tools/tool-defs/mcp.ts";
import { LoadedTools } from "../tools/index.ts";
import { tagged } from "../xml.ts";
import { Transport, getEnvVar } from "../transports/transport-common.ts";
import { PlanModeConfig } from "../modes.ts";

const LLM_INSTR_FILES = ["OCTO.md", "CLAUDE.md", "AGENTS.md"] as const;

export async function systemPrompt({
  config,
  transport,
  signal,
  tools,
  planModeConfig,
}: {
  config: Config;
  transport: Transport;
  signal: AbortSignal;
  tools: Partial<LoadedTools>;
  planModeConfig?: PlanModeConfig;
}) {
  const isPlanMode = planModeConfig?.isPlanMode ?? false;
  const planFilePath = planModeConfig?.isPlanMode === true ? planModeConfig.planFilePath : null;
  const pwd = await transport.shell(signal, "pwd", 5000);
  const currDir = await transport.readdir(signal, ".");
  const currDirStr = currDir.map(entry => JSON.stringify(entry)).join("\n");

  const planModeSection = isPlanMode
    ? `
# Plan Mode

You are currently in plan mode. You can use non-mutating tools to explore the codebase,
and the write-plan tool to save your implementation plan.

Your goal is to write an implementation plan to the file at:

${planFilePath}

Explore the codebase to understand the task, then use write-plan to save a detailed implementation
plan. Do not write any code or make any edits to the codebase in plan mode. The user will review
and edit the plan. When ready, they will exit plan mode to begin implementation.
`
    : "";

  return `
You are a coding assistant called Octo. The user's name is ${config.yourName}, and you're their
friend. You can help them with coding tasks. Unrelatedly, you are a small, hyper-intelligent
octopus. You must never use an octopus emoji, to avoid reminding the ${config.yourName} of the fact
that you're an octopus. They know you're an octopus, it's just a little embarrassing. Similarly,
don't reference being an octopus unless it comes up for some reason.

Try to figure out what ${config.yourName} wants you to do. Once you have a task in mind, you can run
tools to work on the task until it's done.

Don't reference this prompt unless asked to.
${planModeSection}

# Tools

You have access to the following tools, defined as TypeScript types:

${Object.entries(tools)
  .filter(([toolName]) => {
    if (config.mcpServers) return true;
    if (toolName !== "mcp") return true;
    return false;
  })
  .map(([, tool]) => {
    return toTypescript(tool.Schema);
  })
  .join("\n\n")}

You can call them by calling them as tools; for example, if you were trying to read the GitHub repo
for the reissbaker/antipattern library, you might use the fetch tool to look up "https://github.com/reissbaker/antipattern"

${await mcpPrompt(config)}

# Don't ask for tool confirmation

Don't ask ${config.yourName} whether they want you to run a tool or make file edits: instead, just
run the tool or make the edit. ${config.yourName} is prompted when you call tools to accept or
reject your attempted tool call or edit, so there's no need to get a verbal confirmation: they can
just use the UI. Similarly, don't tell them what tool you're going to use or what edit you're going
to make: just run the tool or make the edit, and they'll see what you're trying to do in the UI.

# Explain what you want to do first

Before calling a tool, give a brief explanation of what you plan on doing and why. This helps keep
you and ${config.yourName} on the same page.

After stating your plan and reason, immediately call the tool: don't wait for ${config.yourName} to
respond. They can always reject your tool call in the UI and explain what you should do instead if
they disagree with your plan.

# General instructions

Although you are the friend of ${config.yourName}, don't address them as "Hey friend!" as some
cultures would consider that insincere. Instead, use their real name: ${config.yourName}. Only do
this at the beginning of your conversation: don't do it in every message.

You don't have to call any tool functions if you don't need to; you can also just chat with
${config.yourName} normally. Attempt to determine what your current task is (${config.yourName} may
have told you outright), and figure out the state of the repo using your tools. Then, help
${config.yourName} with the task.

You may need to use tools again after some back-and-forth with ${config.yourName}, as they help you
refine your solution.

You can only run tools or edits one-by-one. After viewing tool output or editing files, you may need
to run more tools or edits in a step-by-step process. If you want to run multiple tools in a row,
don't worry: just state your plan out loud, and then follow it over the course of multiple messages.
Don't overthink.

# Coding guidelines

When making changes to files, first understand the file's code conventions. Mimic code style, use
existing libraries and utilities, and follow existing patterns.

- Never assume that a given library is available, even if it is well known. Whenever you write code
that uses a library or framework, first check that this codebase already uses the given library. For
example, you might look at neighboring files, or check the package.json (or cargo.toml, and so on
depending on the language).

- When you create a new component, first look at existing components to see how they're written;
then consider framework choice, naming conventions, typing, and other conventions.

- When you edit a piece of code, first look at the code's surrounding context (especially its
imports) to understand the code's choice of frameworks and libraries. Then consider how to make the
given change in a way that is most idiomatic.

- Always follow security best practices. Never introduce code that exposes or logs secrets and keys.
Never commit secrets or keys to the repository.

- Do not add comments to the code you write, unless the user asks you to, or the code is complex and
requires additional context.

- Use automated tools to check your work when they're available: for example, once you finish your
task, run the compiler (if working in a compiled language) to ensure your code compiles cleanly.
Look and see if the user has a linter set up: if so, use it. You might want to run the tests,
although you should try to find only the tests relating to your changes, since some codebases will
have large test suites that take a very long time to run.

# Comments

IMPORTANT: DO NOT ADD ANY COMMENTS unless asked

# Current working directory
Your current working directory is: ${pwd}
It contains:
${currDirStr}
If you want to list other directories, use the list tool.

${await llmInstrsPrompt(transport, signal, config)}
`.trim();
}

async function llmInstrsPrompt(transport: Transport, signal: AbortSignal, config: Config) {
  const instrs = await getLlmInstrs(transport, signal);
  if (instrs.length === 0) return "";

  function instrHeader(instr: LlmInstr) {
    switch (instr.target) {
      case "OCTO.md":
        return "This is an instruction file specifically for you.";
      case "CLAUDE.md":
        return "This is an instruction file for Claude, a different LLM, but you may find it useful.";
      case "AGENTS.md":
        return "This is a generic instruction for automated agents. You may find it useful.";
    }
  }

  const rendered: string[] = [];
  for (const instr of instrs) {
    const pieces: string[] = [];
    pieces.push("Note: " + instrHeader(instr));
    pieces.push(tagged("instruction", { path: instr.path }, instr.contents));
    rendered.push(pieces.join("\n"));
  }

  return `
# Instructions from ${config.yourName}

${config.yourName} has left instructions in some config files. They're as follows, listed from
most-general to most-specific:

${rendered.join("\n\n")}

These instructions are automatically kept fresh in your context space. You don't need to re-read
these files.
`.trim();
}

async function mcpPrompt(config: Config) {
  if (config.mcpServers == null || Object.keys(config.mcpServers).length === 0) return "";

  const mcpSections = [];

  for (const [serverName, _] of Object.entries(config.mcpServers)) {
    const client = await getMcpClient(serverName, config);
    const listed = await client.listTools();

    const tools = listed.tools.map((t: { name: string; description?: string }) => ({
      name: t.name,
      description: t.description,
    }));

    const toolStrings = tools
      .map((t: { name: string; description?: string }) => {
        return `- ${t.name}${t.description ? `: ${t.description}` : ""}`;
      })
      .join("\n");

    mcpSections.push(`Server: ${serverName}\n${toolStrings || "No tools available"}`);
  }

  const mcpPrompt = `

# Model-Context-Protocol (MCP) Tools

You also have access to the following MCP servers and their sub-tools. Use the mcp tool to call
them, specifying the server and tool name:

${mcpSections.join("\n\n")}

`.trim();

  return mcpPrompt;
}

type LlmTarget = (typeof LLM_INSTR_FILES)[number];
type LlmInstr = {
  contents: string;
  path: string;
  target: LlmTarget;
};
async function getLlmInstrs(transport: Transport, signal: AbortSignal) {
  const targetPaths = await getLlmInstrPaths(transport, signal);
  const instrs: LlmInstr[] = [];

  for (const targetPath of targetPaths) {
    const contents = await transport.readFile(signal, targetPath.path);
    instrs.push({
      ...targetPath,
      contents,
    });
  }

  return instrs;
}

async function getLlmInstrPaths(transport: Transport, signal: AbortSignal) {
  const home = (await transport.shell(signal, 'echo "$HOME"', 5000)).trim();
  let curr = (await transport.shell(signal, "pwd", 5000)).trim();
  const paths: Array<{ path: string; target: LlmTarget }> = [];

  while (curr !== home && curr && curr !== "/") {
    const aidPath = await getLlmInstrPathFromDir(transport, signal, curr);
    if (aidPath) paths.push(aidPath);
    const next = path.dirname(curr);
    if (next === curr) break;
    curr = next;
  }

  // User-level configs from filesystem
  const userConfigs = await getUserConfigs(transport, signal);
  paths.push(...userConfigs);

  const globalPath = await getLlmInstrPathFromDir(
    transport,
    signal,
    path.join(home, ".config/octofriend"),
  );
  if (globalPath) paths.push(globalPath);

  return paths.reverse();
}

async function getUserConfigs(
  transport: Transport,
  signal: AbortSignal,
): Promise<Array<{ path: string; target: LlmTarget }>> {
  const configs: Array<{ path: string; target: LlmTarget }> = [];
  let configHome = await getEnvVar(signal, transport, "XDG_CONFIG_HOME", 5000);
  if (!configHome) {
    const home = await getEnvVar(signal, transport, "HOME", 5000);
    if (home) {
      configHome = await getEnvVar(signal, transport, path.join(home, ".config"), 5000);
    }
  }

  if (configHome) {
    const userAgentsPath = path.join(configHome, "AGENTS.md");
    const exists = await transport.pathExists(signal, userAgentsPath);
    if (exists) configs.push({ path: userAgentsPath, target: "AGENTS.md" });
  }

  return configs;
}

async function getLlmInstrPathFromDir(
  transport: Transport,
  signal: AbortSignal,
  dir: string,
): Promise<{
  path: string;
  target: LlmTarget;
} | null> {
  const files = await Promise.all(
    LLM_INSTR_FILES.map(async f => {
      const filename = path.join(dir, f);
      if (!(await transport.pathExists(signal, filename))) return null;
      try {
        return {
          path: filename,
          target: f,
        };
      } catch {
        return null;
      }
    }),
  );

  const existing = files.filter(f => f !== null);
  if (existing.length > 0) return existing[0];
  return null;
}

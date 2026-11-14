import { describe, expect, it } from "bun:test";
import { t } from "structural";
import { agent } from "./llm-ir.ts";
import { ok } from "./result.ts";
import { prompt } from "./system-prompt.ts";
import { ToolBuilder } from "./toolkits/tool-def.ts";

const testPrompt = prompt.declare(async () => "Test prompt");
const builder = new ToolBuilder<unknown>();
const firstTool = builder
  .declare({ name: "first", description: "First", ArgumentsSchema: t.subtype({}) })
  .define(async () => ({ run: async () => ok({ type: "output" as const, content: [] }) }));
const secondTool = builder
  .declare({ name: "second", description: "Second", ArgumentsSchema: t.subtype({}) })
  .define(async () => ({ run: async () => ok({ type: "output" as const, content: [] }) }));

const firstChild = agent.definePermissionless({
  systemPrompt: testPrompt,
  tools: {},
  agents: {},
});
const secondChild = agent.definePermissionless({
  systemPrompt: testPrompt,
  tools: { second: secondTool },
  agents: {},
});
const toolkitTools = { first: firstTool };
const base = agent.use({ tools: toolkitTools, agents: { firstChild } });
const extended = base.use({ tools: { second: secondTool }, agents: { secondChild } });

describe("agent composition", () => {
  it("accumulates toolkits immutably and returns plain agents with unchanged children", () => {
    const baseResult = base.definePermissionless({
      systemPrompt: testPrompt,
      tools: {},
      agents: {},
    });
    const result = extended.definePermissioned({
      systemPrompt: testPrompt,
      tools: {},
      agents: {},
    });

    expect(Object.keys(baseResult)).toEqual(["systemPrompt", "tools", "agents"]);
    expect(Object.keys(baseResult.tools)).toEqual(["first"]);
    expect(Object.keys(baseResult.agents)).toEqual(["firstChild"]);
    expect(baseResult.systemPrompt === testPrompt).toBe(true);
    expect(baseResult.tools.first === firstTool).toBe(true);
    expect(baseResult.agents.firstChild === firstChild).toBe(true);

    expect(Object.keys(result)).toEqual(["systemPrompt", "tools", "agents"]);
    expect(Object.keys(result.tools)).toEqual(["first", "second"]);
    expect(Object.keys(result.agents)).toEqual(["firstChild", "secondChild"]);
    expect(result.systemPrompt === testPrompt).toBe(true);
    expect(result.tools.first === firstTool).toBe(true);
    expect(result.tools.second === secondTool).toBe(true);
    expect(result.agents.firstChild === firstChild).toBe(true);
    expect(result.agents.secondChild === secondChild).toBe(true);
    expect(toolkitTools).toEqual({ first: firstTool });
  });

  it("rejects duplicate tools and duplicate subagents at use and final definition", () => {
    expect(() =>
      // @ts-expect-error Deliberately bypass compile-time rejection to test runtime behavior.
      base.use({ tools: { first: secondTool } }),
    ).toThrow('Cannot use toolkit: tool "first" is already defined');
    expect(() =>
      // @ts-expect-error Deliberately bypass compile-time rejection to test runtime behavior.
      base.use({ agents: { firstChild: secondChild } }),
    ).toThrow('Cannot use toolkit: subagent "firstChild" is already defined');
    expect(() =>
      // @ts-expect-error Deliberately bypass compile-time rejection to test runtime behavior.
      base.definePermissionless({
        systemPrompt: testPrompt,
        tools: { first: firstTool },
        agents: {},
      }),
    ).toThrow('Cannot use toolkit: tool "first" is already defined');
    expect(() =>
      // @ts-expect-error Deliberately bypass compile-time rejection to test runtime behavior.
      base.definePermissionless({
        systemPrompt: testPrompt,
        tools: {},
        agents: { firstChild },
      }),
    ).toThrow('Cannot use toolkit: subagent "firstChild" is already defined');
  });

  it("allows the same name in the tool and subagent namespaces", () => {
    const result = agent
      .use({ tools: { shared: firstTool } })
      .use({ agents: { shared: firstChild } })
      .definePermissionless({ systemPrompt: testPrompt, tools: {}, agents: {} });

    expect(result.tools.shared).toBe(firstTool);
    expect(result.agents.shared).toBe(firstChild);
  });
});

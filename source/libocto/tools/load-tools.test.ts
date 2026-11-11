import { describe, expect, it } from "bun:test";
import { t } from "structural";
import { LocalTransport } from "../../transports/local.ts";
import { definePermissionlessAgent } from "../llm-ir.ts";
import { err, ok } from "../result.ts";
import { prompt } from "../system-prompt.ts";
import { AbortError } from "../transport.ts";
import { ToolBuilder } from "./tool-def.ts";
import { loadAgentTools } from "./load-tools.ts";

type RootData = { root: string };
type ChildData = { child: number };
const testPrompt = prompt.declare(async () => "Test prompt");
let sharedLoads = 0;

const sharedTool = new ToolBuilder<RootData & ChildData>()
  .declare({ name: "shared", description: "Shared", ArgumentsSchema: t.subtype({}) })
  .define(async () => {
    sharedLoads++;
    return { run: async () => ok({ type: "output", content: [] }) };
  });
const childTool = new ToolBuilder<ChildData>()
  .declare({ name: "child", description: "Child", ArgumentsSchema: t.subtype({}) })
  .define(async () => ({
    run: async () => ok({ type: "output", content: [] }),
  }));
const unavailableTool = new ToolBuilder<RootData>()
  .declare({ name: "unavailable", description: "Unavailable", ArgumentsSchema: t.subtype({}) })
  .define(async () => null);

const child = definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: { shared: sharedTool, child: childTool },
  agents: {},
});
const agent = definePermissionlessAgent({
  systemPrompt: testPrompt,
  tools: { shared: sharedTool, unavailable: unavailableTool },
  agents: { child },
});

function args(data: RootData & ChildData = { root: "root", child: 1 }) {
  return {
    signal: new AbortController().signal,
    transport: new LocalTransport(),
    model: { contextWindow: 10_000 },
    data,
  };
}

describe("loadAgentTools", () => {
  it("loads root and descendant tools, deduplicates shared keys, and omits null", async () => {
    sharedLoads = 0;
    const result = await loadAgentTools(agent, args());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.type);
    expect(Object.keys(result.data)).toEqual(["shared", "child"]);
    expect(result.data.shared?.name).toBe("shared");
    expect(result.data.child?.name).toBe("child");
    expect(result.data.unavailable).toBeUndefined();
    expect(sharedLoads).toBe(1);
  });

  it("quits before invoking factories when already aborted", async () => {
    sharedLoads = 0;
    const controller = new AbortController();
    controller.abort();
    const result = await loadAgentTools(agent, { ...args(), signal: controller.signal });

    expect(result).toEqual(err({ type: "quit" }));
    expect(sharedLoads).toBe(0);
  });

  it("returns factory failures as fatal errors", async () => {
    const failing = new ToolBuilder<RootData>()
      .declare({ name: "failing", description: "Fails", ArgumentsSchema: t.subtype({}) })
      .define(async () => {
        throw new Error("load failed");
      });
    const root = definePermissionlessAgent({
      systemPrompt: testPrompt,
      tools: { failing },
      agents: {},
    });

    const result = await loadAgentTools(root, {
      ...args(),
      data: { root: "root" },
    });
    expect(result).toEqual(err({ type: "fatal", error: "load failed" }));
  });

  it("quits after an AbortError during cancellation", async () => {
    const controller = new AbortController();
    const failing = new ToolBuilder<RootData>()
      .declare({ name: "failing", description: "Fails", ArgumentsSchema: t.subtype({}) })
      .define(async () => {
        controller.abort();
        throw new AbortError();
      });
    const root = definePermissionlessAgent({
      systemPrompt: testPrompt,
      tools: { failing },
      agents: {},
    });

    const result = await loadAgentTools(root, {
      ...args(),
      signal: controller.signal,
      data: { root: "root" },
    });
    expect(result).toEqual(err({ type: "quit" }));
  });

  it("does not hide an ordinary factory failure during cancellation", async () => {
    const controller = new AbortController();
    const failing = new ToolBuilder<RootData>()
      .declare({ name: "failing", description: "Fails", ArgumentsSchema: t.subtype({}) })
      .define(async () => {
        controller.abort();
        throw new Error("ordinary failure");
      });
    const root = definePermissionlessAgent({
      systemPrompt: testPrompt,
      tools: { failing },
      agents: {},
    });

    const result = await loadAgentTools(root, {
      ...args(),
      signal: controller.signal,
      data: { root: "root" },
    });
    expect(result).toEqual(err({ type: "fatal", error: "ordinary failure" }));
  });
});

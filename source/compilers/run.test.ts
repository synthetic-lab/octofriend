import { describe, expect, it } from "vitest";
import { anthropicReasoningConfig } from "./run.ts";

describe("anthropicReasoningConfig", () => {
  it.each([
    ["claude-sonnet-5", "high"],
    ["claude-opus-5-1", "medium"],
    ["claude-haiku-6", "low"],
  ] as const)("uses adaptive thinking for %s", (model, effort) => {
    expect(anthropicReasoningConfig(model, effort)).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      outputConfig: { effort },
    });
  });

  it.each([
    ["claude-3-5-sonnet-20241022", "xhigh", 16384],
    ["claude-opus-4-1-20250805", "high", 8192],
    ["claude-sonnet-4-5", "medium", 4096],
    ["claude-haiku-3", "low", 2048],
  ] as const)("uses a token budget for %s", (model, reasoning, budgetTokens) => {
    expect(anthropicReasoningConfig(model, reasoning)).toEqual({
      thinking: { type: "enabled", budget_tokens: budgetTokens },
    });
  });

  it("does not configure thinking when reasoning is omitted", () => {
    expect(anthropicReasoningConfig("claude-sonnet-5", undefined)).toEqual({});
  });
});

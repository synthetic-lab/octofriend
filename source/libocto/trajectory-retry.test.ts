import { describe, expect, it } from "bun:test";
import { t } from "structural";
import { compilerUsage } from "./compilers/compiler-interface.ts";
import { downconvert, lower } from "./ir-operations.ts";
import {
  definePermissionedAgent,
  type AgentIR,
  type LowerOutputIR,
  type RequestErrorIR,
  type RetryBudget,
} from "./llm-ir.ts";
import { ToolBuilder, type ToolCall } from "./tool-def.ts";
import { requestSnapshot } from "./request-snapshot.ts";
import {
  countTransientErrors,
  countValidationErrors,
  latestRequestSnapshot,
  retryable,
  transientError,
} from "./trajectory-retry.ts";

const reportTool = new ToolBuilder<unknown>()
  .declare({ name: "report", description: "Reports", ArgumentsSchema: t.subtype({}) })
  .withCustomIR({
    result: toolCall => (args: { error: string }) => ({
      role: "report-result" as const,
      toolCall,
      ...args,
    }),
  })
  .define(async () => ({
    run: async ({ customIR }) => customIR.result({ error: "report failed" }),
  }));
const childAgent = definePermissionedAgent({ tools: { report: reportTool }, agents: {} });
const _testAgent = definePermissionedAgent({
  tools: { report: reportTool },
  agents: { child: childAgent },
});
type TestAgent = typeof _testAgent;
type TestIR = AgentIR<TestAgent>;
const convert = downconvert<TestAgent>(messages => {
  return messages.map((original): LowerOutputIR<TestAgent> => {
    if (original.role === "report-result") {
      return {
        original,
        converted: { role: "request-error", requestError: original.error, curl: "curl" },
      };
    }
    return { original, converted: original };
  });
});
const requestError: RequestErrorIR = {
  role: "request-error",
  requestError: "failed",
  curl: "curl",
};
const call: ToolCall<TestAgent["tools"]> = {
  type: "tool-call",
  name: "report",
  toolCallId: "c1",
  original: {},
  parsed: {},
};
const success: TestIR = { role: "assistant", content: "done", usage: compilerUsage(1, 1) };
const retryBudget: RetryBudget = { validation: 2, requestError: 2 };
const unlimited: RetryBudget = { validation: null, requestError: null };
const validationOutcome: TestIR[] = [
  {
    role: "assistant",
    content: "",
    toolCalls: [call, { ...call, toolCallId: "c2" }],
    usage: compilerUsage(1, 1),
  },
  { role: "tool-validation-error", toolCall: call, error: "invalid", aborted: false },
  {
    role: "tool-validation-error",
    toolCall: { ...call, toolCallId: "c2" },
    error: "also invalid",
    aborted: false,
  },
];
const validation = requestSnapshot(validationOutcome, retryBudget);
const request = requestSnapshot([requestError], retryBudget);

describe("trajectory retry inspection", () => {
  it("classifies existing errors without compiler transport metadata", () => {
    const cases: Array<[TestIR, boolean]> = [
      [requestError, true],
      [{ role: "compaction-error", requestError: "empty summary", curl: null }, true],
      [{ role: "rate-limit-error", requestError: "slow down" }, true],
      [{ role: "auth-error", authError: "no key" }, false],
      [{ role: "payment-error", requestError: "pay up" }, false],
      [success, false],
    ];
    for (const [ir, expected] of cases) expect(transientError(convert([ir])[0])).toBe(expected);
  });

  it("never automatically retries legacy errors", () => {
    expect(retryable(convert([requestError]))).toBe(false);
    expect(retryable(convert(validationOutcome))).toBe(false);
    expect(countTransientErrors(convert([requestError, ...request]))).toBe(1);
  });

  it("requires a complete nonempty snapshot at the active tip", () => {
    for (const irs of [
      [],
      request.slice(0, -1),
      request.slice(1),
      requestSnapshot<TestIR>([], retryBudget),
    ]) {
      const history = convert(irs);
      expect(latestRequestSnapshot(history)).toBeNull();
      expect(retryable(history)).toBe(false);
    }
    const history = convert(request);
    expect(retryable(history)).toBe(true);
    expect(latestRequestSnapshot(history)).toEqual({ retryBudget, irs: [history[1]] });
  });

  it("counts request and validation failures independently, once per snapshot", () => {
    for (const [budget, expected] of [
      [{ validation: 2, requestError: 0 }, true],
      [{ validation: 1, requestError: 100 }, false],
    ] as const) {
      const history = convert([
        ...request,
        ...validation,
        ...request,
        ...requestSnapshot(validationOutcome, budget),
      ]);
      expect(countTransientErrors(history)).toBe(2);
      expect(countValidationErrors(history)).toBe(2);
      expect(retryable(history)).toBe(expected);
    }
    for (const [budget, expected] of [
      [{ validation: 0, requestError: 2 }, true],
      [{ validation: 100, requestError: 1 }, false],
    ] as const) {
      const history = convert([
        ...validation,
        ...request,
        ...validation,
        ...requestSnapshot([requestError], budget),
      ]);
      expect(countTransientErrors(history)).toBe(2);
      expect(countValidationErrors(history)).toBe(2);
      expect(retryable(history)).toBe(expected);
    }
  });

  it.each([null, Infinity])("persists unlimited limits as null for %s", limit => {
    for (const outcome of [[requestError], validationOutcome]) {
      const snapshot = requestSnapshot(outcome, { validation: limit, requestError: limit });
      expect(snapshot[0]).toEqual({ role: "request-snapshot-begin", retryBudget: unlimited });
      const history: TestIR[] = JSON.parse(
        JSON.stringify([...request, ...validation, ...request, ...validation, ...snapshot]),
      );
      expect(latestRequestSnapshot(convert(history))?.retryBudget).toEqual(unlimited);
      expect(retryable(convert(history))).toBe(true);
    }
  });

  it.each(
    [
      requestSnapshot<TestIR>([success], retryBudget),
      requestSnapshot<TestIR>([{ ...success, toolCalls: [call] }], retryBudget),
      requestSnapshot<TestIR>([{ role: "checkpoint", content: [] }], retryBudget),
      [{ role: "error-retry" }] satisfies TestIR[],
      [{ role: "error-dismissed" }] satisfies TestIR[],
      [{ role: "interrupted-by-user", reason: "stopped" }] satisfies TestIR[],
    ].map(boundary => {
      return { boundary };
    }),
  )("resets both budgets at success or explicit reset %#", ({ boundary }) => {
    const history = convert([...request, ...validation, ...boundary, ...request, ...validation]);
    expect(countTransientErrors(history)).toBe(1);
    expect(countValidationErrors(history)).toBe(1);
  });

  it("does not retry interrupted snapshots containing validation errors", () => {
    const history = convert(
      requestSnapshot<TestIR>(
        [...validationOutcome, { role: "interrupted-by-user", reason: "stopped" }],
        unlimited,
      ),
    );
    expect(retryable(history)).toBe(false);
  });

  it("classifies converted extensions and keeps bookkeeping out of provider context", () => {
    const extension: TestIR = { role: "report-result", toolCall: call, error: "custom failure" };
    const history = convert(requestSnapshot<TestIR>([extension], retryBudget));
    expect(countTransientErrors(history)).toBe(1);
    expect(history[1].original).toBe(extension);
    expect(lower(history)).toEqual([]);
  });

  it("does not count descendants or mistake partial assistants for success", () => {
    const child: Extract<TestIR, { role: "subagent-trajectory" }> = {
      role: "subagent-trajectory",
      subagent: "child",
      task: [],
      toolCall: call,
      ir: [...request, ...request],
    };
    const history = convert([
      child,
      ...requestSnapshot<TestIR>([success, requestError], retryBudget),
    ]);
    expect(countTransientErrors(history)).toBe(1);
    const convertedChild = history[0].converted;
    if (convertedChild.role !== "subagent-trajectory") throw new Error("Expected child");
    expect(countTransientErrors(convertedChild.ir)).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { octoAgent } from "../ir/octo-ir.ts";
import type { LoweredIRWithTrajectories } from "./llm-ir.ts";
import { lowerTrajectories } from "./lower-trajectories.ts";

describe("lowerTrajectories", () => {
  it("passes through lowered IR", () => {
    const messages: Array<LoweredIRWithTrajectories<typeof octoAgent>> = [
      { role: "user", content: [{ type: "text", content: "hello" }] },
    ];

    expect(lowerTrajectories<typeof octoAgent>(messages)).toEqual(messages);
  });

  it("throws when a trajectory reaches the default lowering path", () => {
    const trajectory = { role: "trajectory" } as LoweredIRWithTrajectories<typeof octoAgent>;

    expect(() => lowerTrajectories<typeof octoAgent>([trajectory])).toThrow(
      "Subagent trajectory lowering is not implemented yet",
    );
  });
});

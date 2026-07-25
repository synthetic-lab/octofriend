import { describe, expect, it } from "vitest";
import { LocalTransport } from "./local.ts";
import { ShellOutput } from "./transport-common.ts";

describe("LocalTransport", () => {
  it("does not pass NODE_ENV to child processes", async () => {
    const previousNodeEnv = process.env["NODE_ENV"];
    const previousTestEnv = process.env["OCTO_TEST_TRANSPORT_ENV"];
    process.env["NODE_ENV"] = "production";
    process.env["OCTO_TEST_TRANSPORT_ENV"] = "retained";

    try {
      const transport = new LocalTransport();
      const output = await transport.shell(
        new AbortController().signal,
        `printf '%s:%s' "\${NODE_ENV-unset}" "$OCTO_TEST_TRANSPORT_ENV"`,
        5000,
      );

      expect(output).toBe("unset:retained");
    } finally {
      if (previousNodeEnv == null) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
      if (previousTestEnv == null) delete process.env["OCTO_TEST_TRANSPORT_ENV"];
      else process.env["OCTO_TEST_TRANSPORT_ENV"] = previousTestEnv;
    }
  });
});

describe("ShellOutput", () => {
  it("preserves output that fits within the limit", () => {
    const output = new ShellOutput(10);
    expect(output.append("01234")).toBe(true);
    expect(output.append(Buffer.from("56789"))).toBe(true);

    expect(output.getOutput()).toBe("0123456789");
  });

  it("rejects output that exceeds the limit instead of returning partial data", () => {
    const output = new ShellOutput(10);
    expect(output.append("0123456789")).toBe(true);
    expect(output.append("a")).toBe(false);

    expect(output.getOutput()).toBeNull();
  });

  it("continues rejecting chunks after the limit is exceeded", () => {
    const output = new ShellOutput(4);
    expect(output.append("abcde")).toBe(false);
    expect(output.append("x")).toBe(false);

    expect(output.getOutput()).toBeNull();
  });

  it("rejects invalid limits", () => {
    expect(() => new ShellOutput(0)).toThrow(RangeError);
    expect(() => new ShellOutput(Number.MAX_VALUE)).toThrow(RangeError);
  });
});

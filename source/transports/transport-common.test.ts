import { describe, expect, it } from "bun:test";
import { LocalTransport } from "./local.ts";
import { ShellOutput } from "./transport-common.ts";

describe("LocalTransport", () => {
  it("does not leak internal env vars into child processes", async () => {
    const previousNodeEnv = process.env["NODE_ENV"];
    const previousNapiPath = process.env["NAPI_RS_NATIVE_LIBRARY_PATH"];
    const previousCanary = process.env["CANARY_OCTO"];
    const previousTestEnv = process.env["OCTO_TEST_TRANSPORT_ENV"];
    process.env["NODE_ENV"] = "production";
    process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] = "/$bunfs/root/paintcannon.node";
    process.env["CANARY_OCTO"] = "1";
    process.env["OCTO_TEST_TRANSPORT_ENV"] = "retained";

    try {
      const transport = new LocalTransport();
      const output = await transport.shell(
        new AbortController().signal,
        `printf '%s:%s:%s:%s' "\${NODE_ENV-unset}" "\${NAPI_RS_NATIVE_LIBRARY_PATH-unset}" "\${CANARY_OCTO-unset}" "$OCTO_TEST_TRANSPORT_ENV"`,
        5000,
      );

      expect(output).toBe("unset:unset:unset:retained");
    } finally {
      if (previousNodeEnv == null) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previousNodeEnv;
      if (previousNapiPath == null) delete process.env["NAPI_RS_NATIVE_LIBRARY_PATH"];
      else process.env["NAPI_RS_NATIVE_LIBRARY_PATH"] = previousNapiPath;
      if (previousCanary == null) delete process.env["CANARY_OCTO"];
      else process.env["CANARY_OCTO"] = previousCanary;
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

  it("drains only output appended since the last drain", () => {
    const output = new ShellOutput(100);
    expect(output.hasUndrainedOutput()).toBe(false);
    expect(output.drainNewOutput()).toBe("");

    output.append("hello");
    output.append(" world");
    expect(output.hasUndrainedOutput()).toBe(true);
    expect(output.drainNewOutput()).toBe("hello world");

    expect(output.hasUndrainedOutput()).toBe(false);
    expect(output.drainNewOutput()).toBe("");

    output.append("again");
    expect(output.hasUndrainedOutput()).toBe(true);
    expect(output.drainNewOutput()).toBe("again");
    expect(output.getOutput()).toBe("hello worldagain");
  });

  it("reports no unread output and drains to empty once the limit is exceeded", () => {
    const output = new ShellOutput(5);
    output.append("abcd");
    expect(output.append("ef")).toBe(false);

    expect(output.hasUndrainedOutput()).toBe(false);
    expect(output.drainNewOutput()).toBe("");
  });
});

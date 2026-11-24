import { afterEach, describe, expect, it, jest } from "bun:test";
import * as logger from "./logger.ts";

afterEach(() => {
  logger.stopBuffering();
  logger.flush();
  logger.setVerbose(false);
});

describe("logger", () => {
  it("writes straight through when nothing is buffering", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.info("hello");

    expect(stdout.mock.calls).toEqual([["hello"]]);
    expect(logger.flush()).toEqual([]);

    stdout.mockRestore();
  });

  it("holds messages while buffering and writes them on drain", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});

    logger.startBuffering();
    logger.info("to stdout");
    logger.warn("to stderr");

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();

    logger.drain();

    expect(stdout.mock.calls).toEqual([["to stdout"]]);
    expect(stderr.mock.calls).toEqual([["to stderr"]]);

    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("keeps buffering after a drain until it is stopped explicitly", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.startBuffering();
    logger.info("first");
    logger.drain();
    logger.info("second");

    expect(stdout.mock.calls).toEqual([["first"]]);
    expect(logger.flush()).toEqual([{ target: "stdout", content: ["second"] }]);

    stdout.mockRestore();
  });

  it("writes straight through again once buffering stops", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.startBuffering();
    logger.stopBuffering();
    logger.info("direct");

    expect(stdout.mock.calls).toEqual([["direct"]]);

    stdout.mockRestore();
  });

  it("flush returns the queued items and empties the queue", () => {
    logger.startBuffering();
    logger.info("one", 2);
    logger.error("three");

    expect(logger.flush()).toEqual([
      { target: "stdout", content: ["one", 2] },
      { target: "stderr", content: ["three"] },
    ]);
    expect(logger.flush()).toEqual([]);
  });

  it("filters verbose messages until verbose logging is enabled", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.verbose("hidden");

    expect(stdout).not.toHaveBeenCalled();

    logger.setVerbose(true);
    logger.verbose("shown");

    expect(stdout.mock.calls).toEqual([["shown"]]);

    stdout.mockRestore();
  });

  it("buffers all levels on their corresponding output streams", () => {
    logger.startBuffering();

    logger.verbose("hidden");
    logger.info("info");
    logger.warn("warning");
    logger.error("error");
    logger.setVerbose(true);
    logger.verbose("verbose");

    expect(logger.flush()).toEqual([
      { target: "stdout", content: ["info"] },
      { target: "stderr", content: ["warning"] },
      { target: "stderr", content: ["error"] },
      { target: "stdout", content: ["verbose"] },
    ]);
  });
});

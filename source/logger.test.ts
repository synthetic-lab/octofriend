import { afterEach, describe, expect, it, jest } from "bun:test";
import * as logger from "./logger.ts";

afterEach(() => {
  logger.stopBuffering();
  logger.flush();
  logger.setLevel("info");
});

describe("logger", () => {
  it("writes straight through when nothing is buffering", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.log("info", "hello");

    expect(stdout.mock.calls).toEqual([["hello"]]);
    expect(logger.flush()).toEqual([]);

    stdout.mockRestore();
  });

  it("holds messages while buffering and writes them on drain", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {});

    logger.startBuffering();
    logger.log("info", "to stdout");
    logger.error("info", "to stderr");

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
    logger.log("info", "first");
    logger.drain();
    logger.log("info", "second");

    expect(stdout.mock.calls).toEqual([["first"]]);
    expect(logger.flush()).toEqual([{ target: "stdout", content: ["second"] }]);

    stdout.mockRestore();
  });

  it("writes straight through again once buffering stops", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.startBuffering();
    logger.stopBuffering();
    logger.log("info", "direct");

    expect(stdout.mock.calls).toEqual([["direct"]]);

    stdout.mockRestore();
  });

  it("flush returns the queued items and empties the queue", () => {
    logger.startBuffering();
    logger.log("info", "one", 2);
    logger.error("info", "three");

    expect(logger.flush()).toEqual([
      { target: "stdout", content: ["one", 2] },
      { target: "stderr", content: ["three"] },
    ]);
    expect(logger.flush()).toEqual([]);
  });

  it("never emits messages below the configured level", () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => {});

    logger.setLevel("info");
    logger.log("verbose", "hidden");

    expect(stdout).not.toHaveBeenCalled();

    logger.setLevel("verbose");
    logger.log("verbose", "shown");

    expect(stdout.mock.calls).toEqual([["shown"]]);

    stdout.mockRestore();
  });
});

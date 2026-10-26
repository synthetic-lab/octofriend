import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock as registryMock } from "antipattern";
import { keyboardDeps } from "../../hooks/use-keyboard.ts";
import { TransportContext } from "../../transport-context.ts";
import { MockTransport } from "../../transports/mock.ts";
import { AbortError, CommandFailedError } from "../../transports/transport-common.ts";
import { useFileSearch } from "./use-file-search.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function Harness() {
  const { isLoading } = useFileSearch("file", { debounceMs: 0, onSelect: () => {} });
  return <span>{isLoading ? "loading" : "idle"}</span>;
}

let renderer: TestRenderer.ReactTestRenderer | undefined;
let finishSearch: (() => void) | undefined;
let restoreKeyboard: () => void;

beforeEach(() => {
  restoreKeyboard = registryMock(keyboardDeps, "useKeyboard", () => {});
});

afterEach(async () => {
  try {
    act(() => renderer?.unmount());
    await act(async () => {
      finishSearch?.();
    });
  } finally {
    renderer = undefined;
    finishSearch = undefined;
    restoreKeyboard();
  }
});

async function startSearch() {
  const request = Promise.withResolvers<string>();
  const started = Promise.withResolvers<AbortSignal>();
  finishSearch = () => request.resolve("");
  const transport = new MockTransport({
    // The hook's file and pending-request caches are keyed by cwd.
    cwd: `/file-search-test/${crypto.randomUUID()}`,
    files: { ".gitignore": "" },
  });
  transport.shell = async signal => {
    started.resolve(signal);
    return request.promise;
  };

  act(() => {
    renderer = TestRenderer.create(
      <TransportContext.Provider value={transport}>
        <Harness />
      </TransportContext.Provider>,
    );
  });
  await act(async () => {
    await started.promise;
  });
  expect(renderer!.root.findByType("span").children).toEqual(["loading"]);

  return {
    signal: await started.promise,
    fail: async (error: Error) => {
      await act(async () => {
        request.reject(error);
      });
    },
  };
}

describe("useFileSearch errors", () => {
  it.each(["AbortError", "js"])("recovers from transport cancellation named %s", async name => {
    const search = await startSearch();
    const error = new AbortError();
    error.name = name;

    // A shared pending request can be cancelled while this consumer's signal is still live.
    expect(search.signal.aborted).toBe(false);
    await search.fail(error);

    expect(renderer!.root.findByType("span").children).toEqual(["idle"]);
  });

  it("recovers from native abort errors", async () => {
    const search = await startSearch();
    await search.fail(new DOMException("Aborted", "AbortError"));

    expect(renderer!.root.findByType("span").children).toEqual(["idle"]);
  });

  it("aborts an in-flight search on unmount and handles its rejection", async () => {
    const search = await startSearch();
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(search.signal.aborted).toBe(true);

    await search.fail(new AbortError());
  });

  it("recovers from a genuine search timeout", async () => {
    const search = await startSearch();
    const error = new CommandFailedError("Command timed out.\noutput: ");
    expect(search.signal.aborted).toBe(false);
    await search.fail(error);

    expect(renderer!.root.findByType("span").children).toEqual(["idle"]);
  });
});

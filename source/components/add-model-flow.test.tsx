import React from "react";
import { expect, it, mock, spyOn } from "bun:test";
import TestRenderer, { act } from "react-test-renderer";
import { PaintKeyboardEvent, type PaintCannon } from "paintcannon";
import { Div } from "paintcannon-react";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import { KeyboardProvider } from "../hooks/use-keyboard.ts";
import { CustomModelFlow } from "./add-model-flow.tsx";
import TextInput from "./text-input.tsx";

function mockFetch(
  implementation: (
    ...args: Parameters<typeof globalThis.fetch>
  ) => ReturnType<typeof globalThis.fetch>,
) {
  const fetch = Object.assign(implementation, { preconnect: globalThis.fetch.preconnect });
  return spyOn(globalThis, "fetch").mockImplementation(fetch);
}

function renderFlow(baseUrl: string, onCancel: () => void) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppContext.Provider
        value={{ paintCannon: {} as PaintCannon, exit: () => {}, waitUntilExit: async () => {} }}
      >
        <KeyboardProvider>
          <CustomModelFlow
            baseUrl={baseUrl}
            config={null}
            auth={{ type: "env", name: "OCTO_CONNECTION_TEST_KEY" }}
            onComplete={() => {}}
            onCancel={onCancel}
          />
        </KeyboardProvider>
      </AppContext.Provider>,
    );
  });
  return renderer!;
}

function press(renderer: TestRenderer.ReactTestRenderer, key: string) {
  const event = new PaintKeyboardEvent({
    type: "keydown",
    key,
    code: key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
  });
  act(() =>
    renderer.root.findByType(KeyboardProvider).findAllByType(Div)[0].props["onKeyDown"](event),
  );
}

for (const baseUrl of ["https://example.test/v1", "https://api.synthetic.new/openai/v1"]) {
  it(`keeps model input after a failed connection and advances only on success: ${baseUrl}`, async () => {
    const previous = process.env["OCTO_CONNECTION_TEST_KEY"];
    process.env["OCTO_CONNECTION_TEST_KEY"] = "test-key";
    let succeeds = false;
    const fetch = mockFetch(async url => {
      if (String(url).endsWith("/models")) return Response.json({ data: [] });
      return succeeds
        ? Response.json({ choices: [{ message: { role: "assistant", content: "hi" } }] })
        : Response.json({ error: { message: "Unknown model" } }, { status: 400 });
    });
    const view = renderFlow(baseUrl, mock());
    try {
      if (baseUrl.includes("synthetic")) press(view, "e");
      const input = view.root.findByType(TextInput);
      act(() => input.props["onChange"]("my-model"));
      await act(async () => input.props["onSubmit"]());
      expect(view.root.findByType(TextInput)).toBe(input);
      expect(input.props["value"]).toBe("my-model");
      expect(JSON.stringify(view.toJSON())).toContain("Connection failed.");
      expect(JSON.stringify(view.toJSON())).toContain("Press ESC to go back");
      await act(async () => input.props["onSubmit"]());
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(input.props["value"]).toBe("my-model");
      expect(JSON.stringify(view.toJSON())).toContain("Connection failed.");
      act(() => input.props["onChange"]("working-model"));
      expect(JSON.stringify(view.toJSON())).not.toContain("Connection failed.");
      succeeds = true;
      await act(async () => input.props["onSubmit"]());
      expect(JSON.stringify(view.toJSON())).toContain("Let's give this model a nickname");
    } finally {
      act(() => view.unmount());
      fetch.mockRestore();
      if (previous === undefined) delete process.env["OCTO_CONNECTION_TEST_KEY"];
      else process.env["OCTO_CONNECTION_TEST_KEY"] = previous;
    }
  });
}

it("goes back from model entry with Escape", () => {
  const onCancel = mock();
  const view = renderFlow("https://example.test/v1", onCancel);
  try {
    press(view, "b");
    expect(onCancel).not.toHaveBeenCalled();
    press(view, "Enter");
    expect(onCancel).not.toHaveBeenCalled();
    press(view, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  } finally {
    act(() => view.unmount());
  }
});

it("aborts an in-flight connection when Escape closes model entry", async () => {
  const previous = process.env["OCTO_CONNECTION_TEST_KEY"];
  process.env["OCTO_CONNECTION_TEST_KEY"] = "test-key";
  let signal: AbortSignal | null | undefined;
  const fetch = mockFetch(async (url, init) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [] });
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
    });
  });
  const view = renderFlow("https://example.test/v1", () => view.unmount());
  try {
    const input = view.root.findByType(TextInput);
    act(() => input.props["onChange"]("my-model"));
    await act(async () => input.props["onSubmit"]());
    expect(JSON.stringify(view.toJSON())).toContain("Testing connection...");
    expect(signal?.aborted).toBe(false);
    await act(async () => input.props["onSubmit"]());
    expect(fetch).toHaveBeenCalledTimes(2);
    press(view, "Enter");
    expect(signal?.aborted).toBe(false);
    await act(async () => press(view, "Escape"));
    expect(signal?.aborted).toBe(true);
  } finally {
    act(() => view.unmount());
    fetch.mockRestore();
    if (previous === undefined) delete process.env["OCTO_CONNECTION_TEST_KEY"];
    else process.env["OCTO_CONNECTION_TEST_KEY"] = previous;
  }
});

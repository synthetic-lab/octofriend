import React, { type ComponentProps } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, mock, spyOn } from "bun:test";
import type { PaintCannon } from "paintcannon";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import { KeyboardProvider } from "../hooks/use-keyboard.ts";
import { InputHistory } from "../input-history/index.ts";
import { MultimediaInput } from "./multimedia-input.tsx";
import TextInput from "./text-input.tsx";
import { useAppStore } from "../state.ts";
import { err } from "../libocto/result.ts";
import type { ImageInfo } from "../utils/image-utils.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function renderInput(props: ComponentProps<typeof MultimediaInput>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <AppContext.Provider
        value={{
          paintCannon: {
            hasFocus: true,
            addEventListener() {},
            removeEventListener() {},
          } as unknown as PaintCannon,
          exit() {},
          waitUntilExit: async () => {},
        }}
      >
        <KeyboardProvider>
          <MultimediaInput {...props} />
        </KeyboardProvider>
      </AppContext.Provider>,
    );
  });
  return renderer;
}

it("discards a pasted image after cancelling an edit before the editor unmounts", async () => {
  const loaded = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
  const file = new File(["image"], "image.png", { type: "image/png" });
  const bytes = spyOn(file, "bytes").mockImplementation(() => loaded.promise);
  const state = useAppStore.getState();
  useAppStore.setState({
    query: "Editing a message",
    attachedImages: [],
    pendingRewind: {
      target: { role: "user", content: [{ type: "text", content: "Editing a message" }] },
      previousDraft: { query: "Unsent draft", attachedImages: [] },
    },
  });
  const renderer = renderInput({
    inputHistory: new InputHistory([]),
    value: "Editing a message",
    onChange: mock(),
    draftNonce: state.clearNonce,
    attachedImages: [],
    addAttachedImage: state.addAttachedImage,
    removeLastAttachedImage: mock(),
    clearAttachedImages: mock(),
    onSubmit: mock(),
    modalities: { image: { enabled: true, maxSizeMB: 20, acceptedMimeTypes: ["image/png"] } },
  });
  try {
    let attaching!: Promise<void>;
    act(() => {
      attaching = renderer.root.findByType(TextInput).props["onImageFilesAttached"]([file]);
    });
    state.cancelMessageEdit();
    loaded.resolve(new Uint8Array([1, 2, 3]));
    await act(async () => {
      await attaching;
    });
    expect(useAppStore.getState().query).toBe("Editing a message");
    expect(useAppStore.getState().attachedImages).toEqual([]);
  } finally {
    bytes.mockRestore();
    act(() => renderer.unmount());
    useAppStore.setState({
      query: state.query,
      attachedImages: state.attachedImages,
      pendingRewind: state.pendingRewind,
      rewindError: state.rewindError,
      clearNonce: state.clearNonce,
    });
  }
});

it("keeps draft text and attachments when submission fails", async () => {
  const state = useAppStore.getState();
  const image: ImageInfo = {
    mimeType: "image/png",
    base64Data: "aW1hZ2U=",
    dataUrl: "data:image/png;base64,aW1hZ2U=",
    filePath: "/tmp/edited.png",
    sizeBytes: 5,
  };
  useAppStore.setState({ query: "Edited question", attachedImages: [image] });
  const onSubmit = mock(async () => err("The message is no longer available."));
  const renderer = renderInput({
    inputHistory: new InputHistory([]),
    value: "Edited question",
    onChange: state.setQuery,
    draftNonce: state.clearNonce,
    attachedImages: [image],
    addAttachedImage: state.addAttachedImage,
    removeLastAttachedImage: state.removeLastAttachedImage,
    clearAttachedImages: state.clearAttachedImages,
    onSubmit,
  });
  try {
    await act(async () => {
      renderer.root.findByType(TextInput).props["onSubmit"]();
    });
    expect(onSubmit).toHaveBeenCalledWith("Edited question", [image]);
    expect(useAppStore.getState().query).toBe("Edited question");
    expect(useAppStore.getState().attachedImages).toEqual([image]);
  } finally {
    act(() => renderer.unmount());
    useAppStore.setState({ query: state.query, attachedImages: state.attachedImages });
  }
});

import React from "react";
import type { PaintCannon } from "paintcannon";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import TextInput from "./text-input.tsx";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, mock } from "bun:test";
import { withMock } from "antipattern";
import { fetchDeps } from "../fetch.ts";
import { keyboardDeps } from "../hooks/use-keyboard.ts";
import { CustomModelFlow } from "./add-model-flow.tsx";
import { ModelSetup } from "./auto-detect-models.tsx";
import type { ShortcutSection } from "./kb-select/kb-shortcut-select.tsx";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";

it("hides alias backing models while keeping distinct models with the same display name", async () => {
  const previous = process.env["SYNTHETIC_API_KEY"];
  process.env["SYNTHETIC_API_KEY"] = "catalog-test-key";
  const onComplete = mock();
  let catalogRequests = 0;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    await withMock(
      keyboardDeps,
      "useKeyboard",
      () => {},
      async () => {
        await withMock(
          fetchDeps,
          "fetch",
          async () => {
            catalogRequests++;
            return Response.json({
              data: [
                {
                  id: "hf:existing",
                  hugging_face_id: "org/existing",
                  display_name: "Existing model",
                  context_length: 123456,
                  input_modalities: ["text"],
                },
                {
                  id: "hf:alias-target",
                  hugging_face_id: "org/alias-target",
                  display_name: "Backing model",
                  context_length: 123456,
                  input_modalities: ["text", "image"],
                },
                {
                  id: "syn:small:vision",
                  hugging_face_id: "org/alias-target",
                  display_name: "Shared label",
                  context_length: 123456,
                  input_modalities: ["text", "image"],
                },
                {
                  id: "syn:large:vision",
                  hugging_face_id: "org/alias-target",
                  display_name: "Shared label",
                  context_length: 123456,
                  input_modalities: ["text", "image"],
                },
                {
                  id: "hf:pinned",
                  hugging_face_id: "org/pinned",
                  display_name: "Shared label",
                  context_length: 123456,
                  input_modalities: ["text"],
                },
              ],
            });
          },
          async () => {
            await act(async () => {
              renderer = TestRenderer.create(
                <ModelSetup
                  config={{
                    yourName: "test",
                    models: [
                      {
                        model: "hf:existing",
                        nickname: "Existing model",
                        context: 123456,
                        baseUrl: "https://api.synthetic.new/openai/v1",
                      },
                    ],
                  }}
                  onComplete={onComplete}
                  onCancel={() => {}}
                  onOverrideDefaultApiKey={async () => {}}
                />,
              );
            });
            expect(catalogRequests).toBe(0);
            await act(async () => {
              await renderer!.root
                .findByType(KbShortcutPanel)
                .props["onSelect"]({ value: "synthetic" });
            });
            expect(catalogRequests).toBe(1);
            expect(JSON.stringify(renderer!.toJSON())).toContain(" (Shared label)");
            const panel = renderer!.root.findByType(KbShortcutPanel);
            expect(panel.props["actions"].i).toBeUndefined();
            act(() =>
              panel.props["onSelect"]({ value: { type: "model", id: "syn:large:vision" } }),
            );
            expect(panel.props["actions"].i.label.props.children).toBe("Import selected model");
            const sections: ShortcutSection<{ type: "model"; id: string }>[] =
              panel.props["shortcutItems"][0].sections;
            expect(sections.map(section => section.order.map(item => item.value.id))).toEqual([
              ["syn:large:vision"],
              ["hf:pinned"],
            ]);
            act(() => panel.props["onSelect"]({ value: { type: "model", id: "hf:pinned" } }));
            expect(panel.props["actions"].i.label.props.children).toBe("Import 2 selected models");
            act(() =>
              panel.props["onSelect"]({ value: { type: "model", id: "syn:large:vision" } }),
            );
            expect(panel.props["actions"].i.label.props.children).toBe("Import selected model");
            act(() =>
              panel.props["onSelect"]({ value: { type: "model", id: "syn:large:vision" } }),
            );
            act(() => panel.props["onSelect"]({ value: { type: "import" } }));
            expect(onComplete).toHaveBeenCalledWith([
              expect.objectContaining({
                model: "syn:large:vision",
                nickname: "Large Vision",
                baseUrl: "https://api.synthetic.new/openai/v1",
                apiEnvVar: "SYNTHETIC_API_KEY",
              }),
              {
                model: "hf:pinned",
                nickname: "Shared label (Synthetic)",
                context: 123456,
                baseUrl: "https://api.synthetic.new/openai/v1",
                apiEnvVar: "SYNTHETIC_API_KEY",
              },
            ]);
            expect(onComplete.mock.calls[0][0][0]).not.toHaveProperty("huggingFaceId");
            act(() => panel.props["onSelect"]({ value: { type: "back" } }));
            expect(catalogRequests).toBe(1);
            await act(async () => {
              await renderer!.root
                .findByType(KbShortcutPanel)
                .props["onSelect"]({ value: "synthetic" });
            });
            expect(catalogRequests).toBe(2);
          },
        );
      },
    );
  } finally {
    act(() => renderer?.unmount());
    if (previous === undefined) delete process.env["SYNTHETIC_API_KEY"];
    else process.env["SYNTHETIC_API_KEY"] = previous;
  }
});

for (const alreadyAdded of [false, true]) {
  it("offers a recommended model or manual entry when the catalog is unavailable", async () => {
    const previous = process.env["SYNTHETIC_API_KEY"];
    process.env["SYNTHETIC_API_KEY"] = "catalog-test-key";
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    try {
      await withMock(
        keyboardDeps,
        "useKeyboard",
        () => {},
        async () => {
          await withMock(
            fetchDeps,
            "fetch",
            async () => new Response("Unavailable", { status: 503 }),
            async () => {
              await act(async () => {
                renderer = TestRenderer.create(
                  <AppContext.Provider
                    value={{
                      paintCannon: {} as PaintCannon,
                      exit: () => {},
                      waitUntilExit: async () => undefined,
                    }}
                  >
                    <ModelSetup
                      config={
                        alreadyAdded
                          ? {
                              yourName: "test",
                              models: [
                                {
                                  model: "syn:large:vision",
                                  nickname: "Recommended",
                                  context: 123456,
                                  baseUrl: "https://api.synthetic.new/openai/v1",
                                },
                              ],
                            }
                          : null
                      }
                      onComplete={() => {}}
                      onCancel={() => {}}
                      onOverrideDefaultApiKey={async () => {}}
                    />
                  </AppContext.Provider>,
                );
              });
              await act(async () => {
                await renderer!.root
                  .findByType(KbShortcutPanel)
                  .props["onSelect"]({ value: "synthetic" });
              });
              const manual = renderer!.root.findByType(CustomModelFlow);
              expect(manual.props["baseUrl"]).toBe("https://api.synthetic.new/openai/v1");
              expect(manual.props["auth"]).toEqual({ type: "env", name: "SYNTHETIC_API_KEY" });
              expect(
                JSON.stringify(renderer!.toJSON()).includes("Use recommended syn:large:vision"),
              ).toBe(!alreadyAdded);
              if (!alreadyAdded) {
                expect(renderer!.root.findAllByType(TextInput)).toHaveLength(0);
                act(() => {
                  renderer!.root.findByType(KbShortcutPanel).props["onSelect"]({ value: "custom" });
                });
              }
              const input = renderer!.root.findByType(TextInput);
              expect(input.props["placeholder"]).toBeUndefined();
              expect(input.props["value"]).toBe("");
              act(() => input.props["onSubmit"]());
              expect(JSON.stringify(renderer!.toJSON())).toContain("Entry can't be empty");
              expect(JSON.stringify(renderer!.toJSON())).not.toContain("fetch failed");
            },
          );
        },
      );
    } finally {
      act(() => renderer?.unmount());
      if (previous === undefined) delete process.env["SYNTHETIC_API_KEY"];
      else process.env["SYNTHETIC_API_KEY"] = previous;
    }
  });
}

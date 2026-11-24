import React from "react";
import { expect, it } from "bun:test";
import { withMock } from "antipattern";
import type { PaintCannon } from "paintcannon";
import { AppContext } from "paintcannon-react/dist/src/hooks/use-app.js";
import TestRenderer, { act } from "react-test-renderer";
import { FirstTimeSetup } from "./first-time-setup.tsx";
import { keyboardDeps } from "./hooks/use-keyboard.ts";
import type { SyntheticModel } from "./synthetic-models.ts";

for (const variant of ["alias", "direct"] as const) {
  it(`prefers the syn:large:vision ${variant} over the recommended category`, async () => {
    const catalog: SyntheticModel[] = [
      {
        model: "hf:other/model",
        nickname: "Other Model",
        categories: ["recommended"],
        huggingFaceId: "other/model",
        context: 100000,
      },
      {
        model: "syn:large:vision",
        nickname: variant === "alias" ? "syn:large:vision" : "Kimi K3",
        aliasOf: variant === "alias" ? "Kimi K3" : undefined,
        categories: [],
        huggingFaceId: "moonshotai/Kimi-K3",
        context: 524288,
      },
    ];
    await withMock(
      keyboardDeps,
      "useKeyboard",
      () => {},
      async () => {
        let renderer: TestRenderer.ReactTestRenderer | undefined;
        try {
          act(() => {
            renderer = TestRenderer.create(
              <AppContext.Provider
                value={{
                  paintCannon: {
                    hasFocus: true,
                    addEventListener: () => {},
                    removeEventListener: () => {},
                  } as unknown as PaintCannon,
                  exit: () => {},
                  waitUntilExit: async () => undefined,
                }}
              >
                <FirstTimeSetup configPath="/unused/octofriend.json5" syntheticModels={catalog} />
              </AppContext.Provider>,
            );
          });
          const rendered = JSON.stringify(renderer!.toJSON());
          expect(rendered).toContain("Kimi K3 via Synthetic");
          expect(rendered).not.toContain("Other Model");
          expect(rendered).not.toContain("syn:large:vision");
        } finally {
          act(() => renderer?.unmount());
        }
      },
    );
  });
}

for (const variant of ["alias", "direct", "unavailable"]) {
  it(`renders the welcome screen with a preloaded ${variant} catalog`, async () => {
    const model: SyntheticModel = {
      model: "future:recommended",
      nickname: variant === "alias" ? "future:recommended" : "Kimi K3",
      aliasOf: variant === "alias" ? "Kimi K3" : undefined,
      categories: ["recommended"],
      huggingFaceId: "moonshotai/Kimi-K3",
      context: 524288,
    };
    await withMock(
      keyboardDeps,
      "useKeyboard",
      () => {},
      async () => {
        let renderer: TestRenderer.ReactTestRenderer | undefined;
        try {
          act(() => {
            renderer = TestRenderer.create(
              <AppContext.Provider
                value={{
                  paintCannon: {
                    hasFocus: true,
                    addEventListener: () => {},
                    removeEventListener: () => {},
                  } as unknown as PaintCannon,
                  exit: () => {},
                  waitUntilExit: async () => undefined,
                }}
              >
                <FirstTimeSetup
                  configPath="/unused/octofriend.json5"
                  syntheticModels={variant === "unavailable" ? [] : [model]}
                />
              </AppContext.Provider>,
            );
          });
          const rendered = JSON.stringify(renderer!.toJSON());
          expect(rendered).toContain("Synthetic");
          expect(rendered.includes("Kimi K3 via Synthetic")).toBe(variant !== "unavailable");
          expect(rendered).not.toContain("future:recommended");
          expect(rendered).not.toContain("syn:large:vision");
        } finally {
          act(() => renderer?.unmount());
        }
      },
    );
  });
}

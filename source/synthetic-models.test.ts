import { describe, expect, it } from "bun:test";
import { withMock } from "antipattern";
import { fetchDeps } from "./fetch.ts";
import { loadSyntheticModels } from "./synthetic-models.ts";

describe("Synthetic catalog", () => {
  it("lists only live models with the recommended alias first, exact context sizes, and image support", async () => {
    await withMock(
      fetchDeps,
      "fetch",
      async (url, init) => {
        expect(url).toBe("https://api.synthetic.new/openai/v1/models");
        expect(new Headers(init?.headers).has("Authorization")).toBe(false);
        return Response.json({
          data: [
            {
              id: "hf:new/model",
              hugging_face_id: "new/model",
              display_name: "Same name",
              context_length: 123456,
              input_modalities: ["text", "image"],
            },
            {
              id: "syn:large:vision",
              hugging_face_id: "new/model",
              display_name: "Same name",
              context_length: 654321,
              input_modalities: ["text", "image"],
            },
            {
              id: "hf:new/text",
              hugging_face_id: "new/text",
              display_name: "Text model",
              context_length: 99999,
              input_modalities: ["text"],
            },
          ],
        });
      },
      async () => {
        const catalog = await loadSyntheticModels(new AbortController().signal);
        expect(catalog.map(model => model.model)).toEqual([
          "syn:large:vision",
          "hf:new/model",
          "hf:new/text",
        ]);
        expect(catalog[0]).toMatchObject({
          model: "syn:large:vision",
          huggingFaceId: "new/model",
          nickname: "Same name",
          context: 654321,
        });
        expect(catalog.find(model => model.model === "hf:new/model")).toEqual({
          model: "hf:new/model",
          huggingFaceId: "new/model",
          nickname: "Same name",
          context: 123456,
          modalities: {
            image: {
              enabled: true,
              maxSizeMB: 10,
              acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
            },
          },
        });
        expect(catalog.find(model => model.model === "hf:new/text")?.modalities).toBeUndefined();
      },
    );
  });

  it("propagates cancellation", async () => {
    const controller = new AbortController();
    await withMock(
      fetchDeps,
      "fetch",
      async (_url, init) => {
        controller.abort();
        expect(init?.signal?.aborted).toBe(true);
        throw new DOMException("Aborted", "AbortError");
      },
      async () => {
        const catalog = await loadSyntheticModels(controller.signal);
        expect(catalog).toEqual([]);
      },
    );
  });

  for (const response of [
    () => new Response("Unavailable", { status: 503 }),
    () => new Response("invalid json"),
    () => Response.json({ data: [{ id: "incomplete" }] }),
    () => Response.json({ data: [] }),
    () => {
      throw new TypeError("Network unavailable");
    },
  ]) {
    it("returns no models for manual entry when the catalog is unavailable", async () => {
      await withMock(
        fetchDeps,
        "fetch",
        async () => response(),
        async () => {
          expect(await loadSyntheticModels(new AbortController().signal)).toEqual([]);
        },
      );
    });
  }
});

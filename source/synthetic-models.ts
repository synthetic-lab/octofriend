import { fetchDeps } from "./fetch.ts";
import { t } from "structural";
import { SYNTHETIC_PROVIDER, type ProviderModelConfig } from "./providers.ts";

export type SyntheticModel = ProviderModelConfig & {
  huggingFaceId: string;
  aliasOf?: string;
  categories: string[];
};

const CatalogSchema = t.subtype({
  data: t.array(
    t.subtype({
      id: t.str,
      hugging_face_id: t.str,
      display_name: t.str,
      alias_of: t.optional(t.str),
      categories: t.optional(t.array(t.str)),
      context_length: t.num,
      input_modalities: t.array(t.str),
    }),
  ),
});

export async function loadSyntheticModels(signal: AbortSignal): Promise<SyntheticModel[]> {
  let json: unknown;
  try {
    const response = await fetchDeps.fetch(`${SYNTHETIC_PROVIDER.baseUrl}/models`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) return [];
    json = await response.json();
  } catch {
    return [];
  }

  const catalog = CatalogSchema.sliceResult(json);
  if (catalog instanceof t.Err) return [];
  const models = new Map<string, SyntheticModel>();
  for (const model of catalog.data) {
    models.set(model.id, {
      model: model.id,
      huggingFaceId: model.hugging_face_id,
      nickname: model.alias_of ? model.id : model.display_name,
      aliasOf: model.alias_of,
      categories: model.categories ?? [],
      context: model.context_length,
      ...(model.input_modalities.includes("image")
        ? {
            modalities: {
              image: {
                enabled: true,
                maxSizeMB: 10,
                acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
              },
            },
          }
        : {}),
    });
  }
  return [...models.values()].sort((a, b) => {
    return (
      Number(b.categories.includes("recommended")) - Number(a.categories.includes("recommended")) ||
      Number(Boolean(b.aliasOf)) - Number(Boolean(a.aliasOf))
    );
  });
}

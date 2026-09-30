import { fetchDeps } from "./fetch.ts";
import { t } from "structural";
import { SYNTHETIC_PROVIDER, type ProviderConfig } from "./providers.ts";

export function syntheticAliasName(modelId: string): string {
  return modelId
    .slice(4)
    .split(":")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type SyntheticModel = ProviderConfig["models"][number] & { huggingFaceId: string };

const CatalogSchema = t.subtype({
  data: t.array(
    t.subtype({
      id: t.str,
      hugging_face_id: t.str,
      display_name: t.str,
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
      nickname: model.display_name,
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
    const rank = (id: string) => (id === "syn:large:vision" ? 0 : id.startsWith("syn:") ? 1 : 2);
    return rank(a.model) - rank(b.model);
  });
}

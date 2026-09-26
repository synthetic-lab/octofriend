import { fetchDeps } from "./fetch.ts";
import { t } from "structural";
import { apiKeyFromAuth, readAuthForModel, type Auth, type Config } from "./config.ts";
import { SYNTHETIC_PROVIDER, type ProviderConfig } from "./providers.ts";

const CatalogSchema = t.subtype({
  data: t.array(
    t.subtype({
      id: t.str,
      display_name: t.str,
      context_length: t.num,
      input_modalities: t.array(t.str),
    }),
  ),
});

export async function loadSyntheticModels(
  config: Config | null,
  auth: Auth | null,
  signal: AbortSignal,
): Promise<ProviderConfig["models"]> {
  let json: unknown;
  try {
    const credentials = await readAuthForModel(
      { baseUrl: SYNTHETIC_PROVIDER.baseUrl, auth: auth ?? undefined },
      config,
    );
    const headers = new Headers();
    if (credentials.ok && credentials.auth.type === "apiKey") {
      headers.set("Authorization", `Bearer ${apiKeyFromAuth(credentials.auth)}`);
    }
    const response = await fetchDeps.fetch(`${SYNTHETIC_PROVIDER.baseUrl}/models`, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) return [];
    json = await response.json();
  } catch {
    return [];
  }
  const catalog = CatalogSchema.sliceResult(json);
  if (catalog instanceof t.Err) return [];
  const models = new Map<string, ProviderConfig["models"][number]>();
  for (const model of catalog.data) {
    models.set(model.id, {
      model: model.id,
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

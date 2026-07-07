import { readAuthForModel } from "./config.ts";
import type {
  ApiKeyAuth,
  ApiKeyModelConfig,
  Config,
  CodexModelConfig,
  OAuthLoadedAuth,
} from "./config.ts";

function expectType<T>(_: T) {}

declare const apiModel: ApiKeyModelConfig;
declare const codexModel: CodexModelConfig;
declare const config: Config;

expectType<string>(apiModel.baseUrl);
// @ts-expect-error Codex models use the fixed Codex backend and do not have a base URL.
expectType<string>(codexModel.baseUrl);

async function checkReadAuthForModelTypes() {
  const apiAuth = await readAuthForModel(apiModel, config);
  if (apiAuth.ok) {
    expectType<ApiKeyAuth>(apiAuth.auth);
    // @ts-expect-error API-key models cannot resolve to OAuth auth.
    expectType<OAuthLoadedAuth>(apiAuth.auth);
  }

  const codexAuth = await readAuthForModel(codexModel, config);
  if (codexAuth.ok) {
    expectType<OAuthLoadedAuth>(codexAuth.auth);
    // @ts-expect-error Codex models cannot resolve to API-key auth.
    expectType<ApiKeyAuth>(codexAuth.auth);
  }
}

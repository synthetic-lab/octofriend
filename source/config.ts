import { t } from "structural";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
const __dir = path.dirname(fileURLToPath(import.meta.url));

const ConfigSchema = t.subtype({
  baseUrl: t.str,
  apiEnvVar: t.str,
  model: t.str,
  context: t.num,
});
const PartialConfig = t.partial(ConfigSchema);
export type Config = t.GetType<typeof ConfigSchema>;

const defaultConfig: Config = {
  baseUrl: "https://api.glhf.chat/v1",
  apiEnvVar: "GLHF_API_KEY",
  model: "hf:deepseek-ai/DeepSeek-R1",
  context: 64 * 1024,
};

export async function readConfig(path?: string): Promise<Config> {
  if(path == null) return { ...defaultConfig };

  const file = await fs.readFile(path, "utf8");
  const config = PartialConfig.slice(JSON.parse(file.trim()));
  const clone = { ...defaultConfig };
  for(const k in config) {
    const key = k as keyof Config;
    // @ts-ignore
    if(config[key]) clone[key] = config[key];
  }
  return clone;
}

export type Metadata = {
  version: string,
};

export async function readMetadata(): Promise<Metadata> {
  const packageFile = await fs.readFile(path.join(__dir, "../package.json"), "utf8");
  const packageJson = JSON.parse(packageFile);
  return {
    version: packageJson["version"],
  };
}

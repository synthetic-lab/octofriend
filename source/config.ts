import { t } from "structural";
import * as fs from "fs/promises";

const ConfigSchema = t.subtype({
  baseUrl: t.str,
  apiEnvVar: t.str,
  model: t.str,
});
const PartialConfig = t.partial(ConfigSchema);
export type Config = t.GetType<typeof ConfigSchema>;

const defaultConfig: Config = {
  baseUrl: "https://api.glhf.chat/v1",
  apiEnvVar: "GLHF_API_KEY",
  model: "hf:deepseek-ai/DeepSeek-V3-0324",
};

export async function readConfig(path?: string): Promise<Config> {
  if(path == null) return { ...defaultConfig };

  const file = await fs.readFile(path, "utf8");
  const config = PartialConfig.slice(JSON.parse(file.trim()));
  const clone = { ...defaultConfig };
  for(const k in config) {
    const key = k as keyof Config;
    if(config[key]) clone[key] = config[key];
  }
  return clone;
}

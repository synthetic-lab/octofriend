import { t } from "structural";
import readline from "readline/promises";
import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";
import json5 from "json5";
import OpenAI from "openai";
import figlet from "figlet";
import { THEME_COLOR } from "./theme.ts";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const McpServerConfigSchema = t.exact({
  command: t.str,
  args: t.optional(t.array(t.str)),
});

const ConfigSchema = t.exact({
  yourName: t.str,
  baseUrl: t.str,
  apiEnvVar: t.str,
  model: t.str,
  context: t.num,
  mcpServers: t.optional(t.dict(McpServerConfigSchema)),
});
export type Config = t.GetType<typeof ConfigSchema>;

export async function readConfig(path: string): Promise<Config> {
  const file = await fs.readFile(path, "utf8");
  return ConfigSchema.slice(json5.parse(file.trim()));
}

export async function initConfig(configPath: string): Promise<Config> {
  const welcome = figlet.textSync("Welcome!", "Elite");
  const themeStyle = chalk.hex(THEME_COLOR);
  console.log(themeStyle(welcome));
  console.log(
    "\nYou don't seem to have a config file yet, so let's get you set up for the first time.\n"
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const yourName = (await rl.question(themeStyle("What's your name? "))).trim();

  let baseUrl: string;
  let apiEnvVar: string;
  let model: string;
  while(true) {
    baseUrl = (await rl.question(
      themeStyle("What's the base URL for the API you're connecting to?") +
        " (For example, https://api.synthetic.new/v1) "
    )).trim();
    apiEnvVar = (await rl.question(
      themeStyle("What environment variable should Octo read to get the API key?") +
        " (For example, SYNTHETIC_API_KEY) "
    )).trim();
    model = (await rl.question(
      themeStyle("What's the model name for the API you're using?") +
        " (For example, hf:deepseek-ai/DeepSeek-R1-0528) "
    )).trim();

    console.log(chalk.yellow("Testing API connection:"));

    const client = new OpenAI({
      baseURL: baseUrl,
      apiKey: process.env[apiEnvVar],
    });

    try {
      await client.chat.completions.create({
        model,
        messages: [{
          role: "user",
          content: "Respond with the word 'hi' and only the word 'hi'",
        }],
      });
      break;
    } catch(e) {
      console.error(e);
      console.error("Connection failed... Let's try that again.");
    }
  }

  console.log("Connection succeeded!");

  let contextK: number | undefined = undefined;
  while(contextK == null) {
    const len = (await rl.question(
    themeStyle("What's the maximum number of tokens Octo should use per request?") +
`
(This is an estimate: leave some buffer room. Best performance is often at half the number of tokens supported by the API.)
Format the number in k: for example, ` + themeStyle("32k") + " or " + themeStyle("64k: ")
    )).trim();
    try {
      const numberStr = len.replace("k", "");
      contextK = parseInt(numberStr, 10);
    } catch {
      console.error("Couldn't parse your input. Please enter the context length, e.g. 32k, 64k");
    }
  }

  rl.close();

  const config = {
    yourName, baseUrl, apiEnvVar, model,
    context: contextK * 1024,
  };

  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, json5.stringify(config, null, 2));
  console.log("\nYou're all set up!\n");
  return config;
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

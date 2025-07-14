import React from "react";
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
  models: t.array(t.exact({
    nickname: t.str,
    baseUrl: t.str,
    apiEnvVar: t.str,
    model: t.str,
    context: t.num,
  })),
  mcpServers: t.optional(t.dict(McpServerConfigSchema)),
});
export type Config = t.GetType<typeof ConfigSchema>;

export const ConfigContext = React.createContext<Config>({
  yourName: "unknown",
  models: [],
});
export function useConfig() {
  return React.useContext(ConfigContext);
}
export function getModelFromConfig(config: Config, modelOverride: string | null) {
  if(modelOverride == null) return config.models[0];
  const matching = config.models.find(m => m.nickname === modelOverride);
  if(matching) return matching;
  return config.models[0];
}

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

  console.log(`
Octo lets you choose the LLM that powers it. You'll need a few key pieces of information, but the
first decision you have to make is what inference company to use to power your LLM (or, if you're
relatively advanced, you can run your own LLM locally on your own computer).

If you don't know what company you want to use, we'd selfishly recommend Synthetic, the
privacy-first inference company we run. You can sign up here: https://synthetic.new
`.trim());
  console.log("\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await rl.question("Press enter whenever you're ready to begin setup.")
  console.log("\n");

  let baseUrl: string;
  let apiEnvVar: string;
  let model: string;
  while(true) {
    baseUrl = (await rl.question(
      themeStyle("What's the base URL for the API you're connecting to?") +
        "\n(For example, https://api.synthetic.new/v1)" +
      "\nYou can usually find this information in your inference provider's documentation." +
      "\nBase URL: "
    )).trim();
    while(true) {
      console.log("\n");
      apiEnvVar = (await rl.question(
        themeStyle("What environment variable should Octo read to get the API key?") +
          "\n(For example, SYNTHETIC_API_KEY)" +
          "\nYou can typically find your API key on your account or settings page on your " +
          "inference provider's website.\nFor Synthetic, go to: https://synthetic.new/user-settings/api" +
          "\nAfter getting an API key, make sure to export it in your shell; for example:" +
          chalk.bold("\nexport SYNTHETIC_API_KEY=\"your-api-key-here\"") +
          "\n(If you're running a local LLM, you can use any non-empty env var.)" +
          "\nEnvironment variable name: "
      )).trim();

      if(process.env[apiEnvVar]) break;
      console.error(`
Looking in your current shell, that env var isn't set. Is there a typo? Or do you need to re-source
your .bash_profile or .zshrc?
(CTRL-C to exit, if you need to re-source this shell's config)
`.trim());
    }

    console.log("\n");
    model = (await rl.question(
      themeStyle("What's the model name for the API you're using?") +
        "\n(For example, with Synthetic, you could use hf:deepseek-ai/DeepSeek-R1-0528)" +
        "\nThis varies by inference provider: you can typically find this information in your " +
        "inference provider's documentation." +
        "\nModel name: "
    )).trim();

    console.log("\n");
    console.log(chalk.yellow("Testing API connection..."));

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

  const nickname = await rl.question(themeStyle(
    "Let's give this model a nickname so we can easily reference it later."
  ) + "\nFor example, if this was set up to talk to DeepSeek-V3-0324, you might want to call it that." +
  "\n Model nickname: ");

  let contextK: number | undefined = undefined;
  while(contextK == null) {
    console.log("\n");
    const len = (await rl.question(
    themeStyle("What's the maximum number of tokens Octo should use per request?\n") +
`You can usually find this information in the documentation for the model on your inference company's
website.

(This is an estimate: leave some buffer room. Best performance is often at half the number of tokens supported by the API.)
Format the number in k: for example, ${themeStyle("32k")} or ${themeStyle("64k: ")}

Maximum input tokens: `
    )).trim();
    try {
      const numberStr = len.replace("k", "");
      contextK = parseInt(numberStr, 10);
    } catch {
      console.error("Couldn't parse your input. Please enter the context length, e.g. 32k, 64k");
    }
  }

  console.log("\n");
  const yourName = (await rl.question("And finally... " + themeStyle("What's your name?\n") +
                                     "Your name: ")).trim();

  rl.close();

  const config = {
    yourName,
    models: [{
      baseUrl, apiEnvVar, model, nickname,
      context: contextK * 1024,
    }],
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

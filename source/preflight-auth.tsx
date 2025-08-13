import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import { Config, writeConfig, mergeEnvVar, mergeAutofixEnvVar } from "./config.ts";
import { HeightlessCenteredBox } from "./components/centered-box.tsx";

export function PreflightModelAuth({ model, config, configPath }: {
  model: Config["models"][number],
  config: Config,
  configPath: string,
}) {
  const app = useApp();
  const [ exitMessage, setExitMessage ] = useState<string | null>(null);

  useInput((_, key) => {
    if(!key.escape) setExitMessage(null);
  });

  return <Box flexDirection="column" gap={1}>
    <CustomAuthFlow
      config={config}
      baseUrl={model.baseUrl}
      onCancel={() => {setExitMessage("Press CTRL-C to exit")}}
      onComplete={async (apiEnvVar) => {
        let index = config.models.indexOf(model);
        if(index >= 0) {
          if(apiEnvVar) await writeConfig(mergeEnvVar(config, model, apiEnvVar), configPath);
        }
        app.exit();
      }}
    />

    {
      exitMessage && <HeightlessCenteredBox>
        <Text color="gray">
          { exitMessage }
        </Text>
      </HeightlessCenteredBox>
    }
  </Box>
}

export function PreflightAutofixAuth<
  K extends "diffApply" | "fixJson"
>({ autofixKey, model, config, configPath }: {
  autofixKey: K,
  model: Exclude<Config[K], undefined>,
  config: Config,
  configPath: string,
}) {
  const app = useApp();
  const [ exitMessage, setExitMessage ] = useState<string | null>(null);

  useInput((_, key) => {
    if(!key.escape) setExitMessage(null);
  });

  return <Box flexDirection="column" gap={1}>
    <CustomAuthFlow
      config={config}
      baseUrl={model.baseUrl}
      onCancel={() => {setExitMessage("Press CTRL-C to exit")}}
      onComplete={async (apiEnvVar) => {
        if(apiEnvVar) {
          await writeConfig(
            mergeAutofixEnvVar(config, autofixKey, model, apiEnvVar),
            configPath,
          );
        }
        app.exit();
      }}
    />

    {
      exitMessage && <HeightlessCenteredBox>
        <Text color="gray">
          { exitMessage }
        </Text>
      </HeightlessCenteredBox>
    }
  </Box>
}

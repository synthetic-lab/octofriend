import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { CustomAuthFlow } from "./components/add-model-flow.tsx";
import { Config, writeConfig } from "./config.ts";
import { HeightlessCenteredBox } from "./components/centered-box.tsx";

export function PreflightAuth({ model, config, configPath }: {
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
          if(apiEnvVar) {
            config.models[index] = {
              ...model,
              apiEnvVar,
            };
            await writeConfig(config, configPath);
          }
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

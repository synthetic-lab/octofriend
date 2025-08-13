import React, { useState, useCallback } from "react";
import { Box, useInput } from "ink";
import SelectInput from "ink-select-input";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Config, readKeyForModel } from "../config.ts";
import { CustomAutofixFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { SYNTHETIC_PROVIDER, keyFromName } from "./providers.ts";
import { CustomAuthFlow } from "./add-model-flow.tsx";

export type AutofixModelProps = {
  config: Config | null,
  onComplete: (diffApply: Exclude<Config["diffApply"], undefined>) => any,
  onOverrideDefaultApiKey: (apiEnvVar: string) => Promise<void>,
  onCancel: () => any,
  defaultModel: string,
  modelNickname: string,
  children: React.ReactNode,
};
export type AutofixWrapperProps = Omit<
  AutofixModelProps,
  "defaultModel" | "modelNickname" | "children"
>;

const SYNTH_KEY = keyFromName(SYNTHETIC_PROVIDER.name);

export function AutofixModelMenu({
  config, onComplete, onOverrideDefaultApiKey, onCancel, defaultModel, modelNickname, children,
}: AutofixModelProps) {
  const [step, setStep] = useState<'choose' | 'custom' | 'missing-auth'>('choose');

  useInput((_, key) => {
    if(key.escape) onCancel();
  });

  const items = [
    {
      label: `Enable ${modelNickname} via Synthetic (recommended)`,
      value: "synthetic",
    },
    {
      label: "Use a custom diff-apply model...",
      value: "custom",
    },
    {
      label: "Cancel",
      value: "cancel",
    },
  ];

  const onSelect = useCallback(async (item: (typeof items)[number]) => {
    if(item.value === "synthetic") {
      const defaultEnvVar = SYNTHETIC_PROVIDER.envVar;

      // Check if there's an override for the API key
      const envVar = config?.defaultApiKeyOverrides?.[SYNTH_KEY] || defaultEnvVar;

      if(process.env[envVar]) {
        onComplete({
          baseUrl: SYNTHETIC_PROVIDER.baseUrl,
          apiEnvVar: envVar,
          model: defaultModel,
        });
      } else {
        const key = await readKeyForModel({ baseUrl: SYNTHETIC_PROVIDER.baseUrl }, config);
        if(key !== null) {
          onComplete({
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: defaultModel,
          });
        }
        else {
          setStep('missing-auth');
        }
      }
      return;
    }

    if(item.value === "custom") setStep("custom");
    else onCancel();
  }, [ config, onCancel, onComplete ]);

  if(step === 'custom') {
    return (
      <CustomAutofixFlow
        config={config}
        onComplete={(model) => {
          const val = {
            baseUrl: model.baseUrl,
            apiEnvVar: model.apiEnvVar,
            model: model.model,
          };
          if(model.apiEnvVar == null) delete val.apiEnvVar;
          onComplete(val);
        }}
        onCancel={() => setStep('choose')}
      />
    );
  }

  if (step === 'missing-auth') {
    return <CustomAuthFlow
      config={config}
      baseUrl={SYNTHETIC_PROVIDER.baseUrl}
      onCancel={() => setStep("choose")}
      onComplete={async (envVar) => {
        if(envVar) {
          await onOverrideDefaultApiKey(envVar);
          onComplete({
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: defaultModel,
          })
        } else {
          onComplete({
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            model: defaultModel,
          });
        }
      }}
    />
  }

  return (
    <CenteredBox>
      <MenuHeader title={`Enable ${modelNickname} model`} />

      <Box marginBottom={1} flexDirection="column" gap={1}>
        { children }
      </Box>

      <SelectInput
        items={items}
        onSelect={onSelect}
        indicatorComponent={IndicatorComponent}
        itemComponent={ItemComponent}
      />
    </CenteredBox>
  );
}

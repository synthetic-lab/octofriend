import React, { useState, useCallback } from "react";
import { Box, useInput } from "ink";
import SelectInput from "ink-select-input";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Config } from "../config.ts";
import { AddModelFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { OverrideEnvVar } from "./override-env-var.tsx";
import { SYNTHETIC_PROVIDER, keyFromName } from "./providers.ts";

export type AutofixModelProps = {
  config: Config | null,
  onComplete: (diffApply: Exclude<Config["diffApply"], undefined>) => any,
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
  config, onComplete, onCancel, defaultModel, modelNickname, children,
}: AutofixModelProps) {
  const [step, setStep] = useState<'choose' | 'custom' | 'synthetic-overwrite'>('choose');

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

  const onSelect = useCallback((item: (typeof items)[number]) => {
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
        setStep('synthetic-overwrite');
      }
      return;
    }

    if(item.value === "custom") setStep("custom");
    else onCancel();
  }, [ config, onCancel, onComplete ]);

  if(step === 'custom') {
    return (
      <AddModelFlow
        onComplete={(model) => {
          onComplete({
            baseUrl: model.baseUrl,
            apiEnvVar: model.apiEnvVar,
            model: model.model,
          });
        }}
        onCancel={() => setStep('choose')}
        skipExamples={true}
      />
    );
  }

  if (step === 'synthetic-overwrite') {
    return <OverrideEnvVar onSubmit={(envVar) => {
      onComplete({
        baseUrl: SYNTHETIC_PROVIDER.baseUrl,
        apiEnvVar: envVar,
        model: defaultModel,
      })
    }} provider={SYNTHETIC_PROVIDER} />
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

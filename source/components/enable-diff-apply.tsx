import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Config } from "../config.ts";
import { AddModelFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { MenuHeader } from "./menu-panel.tsx";
import { OverrideEnvVar } from "./override-env-var.tsx";
import { SYNTHETIC_PROVIDER, keyFromName } from "./providers.ts";

export type EnableDiffApplyProps = {
  config: Config | null,
  onComplete: (diffApply: Exclude<Config["diffApply"], undefined>) => any,
  onCancel: () => any,
};

const DEFAULT_MODEL = "hf:syntheticlab/diff-apply";
const SYNTH_KEY = keyFromName(SYNTHETIC_PROVIDER.name);

export function EnableDiffApply({ config, onComplete, onCancel }: EnableDiffApplyProps) {
  const [step, setStep] = useState<'choose' | 'custom' | 'synthetic-overwrite'>('choose');

  useInput((_, key) => {
    if(key.escape) onCancel();
  });

  const items = [
    {
      label: "Enable diff-apply via Synthetic (recommended)",
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
          model: DEFAULT_MODEL,
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
        model: DEFAULT_MODEL,
      })
    }} provider={SYNTHETIC_PROVIDER} />
  }

  return (
    <CenteredBox>
      <MenuHeader title="Enable diff-apply model" />

      <Box marginBottom={1}>
        <Text>
          Even good coding models sometimes make minor mistakes generating diffs, which can cause
          slow retries and can confuse them, since models often aren't trained as well to handle
          edit failures as they are successes. Diff-apply is a fast, small model that fixes minor
          diff edit inaccuracies. It speeds up iteration and can significantly improve model
          performance.
        </Text>
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

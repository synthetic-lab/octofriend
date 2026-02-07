import React, { useState, useCallback } from "react";
import { Box, useInput } from "ink";
import { Config, readKeyForModel } from "../config.ts";
import { CustomAutofixFlow } from "./add-model-flow.tsx";
import { CenteredBox } from "./centered-box.tsx";
import { KbShortcutPanel } from "./kb-select/kb-shortcut-panel.tsx";
import { Item, ShortcutArray } from "./kb-select/kb-shortcut-select.tsx";
import { SYNTHETIC_PROVIDER, keyFromName } from "../providers.ts";
import { CustomAuthFlow } from "./add-model-flow.tsx";

export type AutofixModelProps = {
  config: Config | null;
  onComplete: (diffApply: Exclude<Config["diffApply"], undefined>) => any;
  onOverrideDefaultApiKey: (apiEnvVar: string) => Promise<void>;
  onCancel: () => any;
  defaultModel: string;
  modelNickname: string;
  children: React.ReactNode;
};
export type AutofixWrapperProps = Omit<
  AutofixModelProps,
  "defaultModel" | "modelNickname" | "children"
>;

const SYNTH_KEY = keyFromName(SYNTHETIC_PROVIDER.name);

export function AutofixModelMenu({
  config,
  onComplete,
  onOverrideDefaultApiKey,
  onCancel,
  defaultModel,
  modelNickname,
  children,
}: AutofixModelProps) {
  const [step, setStep] = useState<"choose" | "custom" | "missing-auth">("choose");

  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  const shortcutItems = [
    {
      type: "key" as const,
      mapping: {
        e: {
          label: `Enable ${modelNickname} via Synthetic (recommended)`,
          value: "synthetic",
        },
        c: {
          label: "Use a custom diff-apply model...",
          value: "custom",
        },
        b: {
          label: "Back",
          value: "back",
        },
      } as const,
    },
  ] satisfies ShortcutArray<"synthetic" | "custom" | "back">;

  const onSelect = useCallback(
    async (item: Item<"synthetic" | "custom" | "back">) => {
      if (item.value === "synthetic") {
        const defaultEnvVar = SYNTHETIC_PROVIDER.envVar;

        // Check if there's an override for the API key
        const envVar = config?.defaultApiKeyOverrides?.[SYNTH_KEY] || defaultEnvVar;

        if (process.env[envVar]) {
          onComplete({
            baseUrl: SYNTHETIC_PROVIDER.baseUrl,
            apiEnvVar: envVar,
            model: defaultModel,
          });
        } else {
          const key = await readKeyForModel({ baseUrl: SYNTHETIC_PROVIDER.baseUrl }, config);
          if (key !== null) {
            onComplete({
              baseUrl: SYNTHETIC_PROVIDER.baseUrl,
              model: defaultModel,
            });
          } else {
            setStep("missing-auth");
          }
        }
        return;
      }

      if (item.value === "custom") setStep("custom");
      else onCancel();
    },
    [config, onCancel, onComplete],
  );

  if (step === "custom") {
    return (
      <CustomAutofixFlow
        config={config}
        onComplete={model => {
          const val: Exclude<Config["diffApply"], undefined> = {
            baseUrl: model.baseUrl,
            auth: model.auth,
            model: model.model,
          };
          if (model.auth == null) delete val.auth;
          onComplete(val);
        }}
        onCancel={() => setStep("choose")}
      />
    );
  }

  if (step === "missing-auth") {
    return (
      <CustomAuthFlow
        config={config}
        baseUrl={SYNTHETIC_PROVIDER.baseUrl}
        onCancel={() => setStep("choose")}
        onComplete={async auth => {
          if (auth && auth.type === "env") {
            await onOverrideDefaultApiKey(auth.name);
            onComplete({
              baseUrl: SYNTHETIC_PROVIDER.baseUrl,
              model: defaultModel,
            });
          } else if (auth) {
            onComplete({
              baseUrl: SYNTHETIC_PROVIDER.baseUrl,
              model: defaultModel,
              auth,
            });
          } else {
            onComplete({
              baseUrl: SYNTHETIC_PROVIDER.baseUrl,
              model: defaultModel,
            });
          }
        }}
      />
    );
  }

  return (
    <KbShortcutPanel
      title={`Enable ${modelNickname} model`}
      shortcutItems={shortcutItems}
      onSelect={onSelect}
    >
      <Box marginBottom={1} flexDirection="column" gap={1}>
        {children}
      </Box>
    </KbShortcutPanel>
  );
}

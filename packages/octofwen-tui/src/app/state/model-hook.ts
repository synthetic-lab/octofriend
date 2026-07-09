import { useMemo } from "react";
import { getModelFromConfig } from "../../internal/configuration/model-selection.ts";
import { useConfig } from "../../internal/configuration/react-context.ts";
import type { ModelConfig } from "../../internal/configuration/schemas.ts";
import { useAppStore } from "./store.ts";
import type { UiState } from "./types.ts";

const selectModelOverride = (state: UiState) => {
	return state.modelOverride;
};

export function useModel(): ModelConfig {
	const modelOverride = useAppStore(selectModelOverride);
	const config = useConfig();

	return useMemo(
		() => getModelFromConfig(config, modelOverride),
		[config, modelOverride],
	);
}

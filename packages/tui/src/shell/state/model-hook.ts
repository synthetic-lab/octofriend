import { useMemo } from "react";
import { getModelFromConfig } from "../../runtime/config/model-selection.ts";
import { useConfig } from "../../runtime/config/react-context.ts";
import type { ModelConfig } from "../../runtime/config/schemas.ts";
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

import { useMemo } from "react";
import { getModelFromConfig } from "../../runtime/config/model-selection";
import { useConfig } from "../../runtime/config/react-context";
import type { ModelConfig } from "../../runtime/config/schemas";
import { useAppStore } from "./store";
import type { UiState } from "./types";

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

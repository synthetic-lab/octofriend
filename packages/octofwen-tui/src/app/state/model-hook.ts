import { useShallow } from "zustand/shallow";
import { getModelFromConfig } from "../../internal/configuration/model-selection.ts";
import { useConfig } from "../../internal/configuration/react-context.ts";
import type { ModelConfig } from "../../internal/configuration/schemas.ts";
import { useAppStore } from "./store.ts";

export function useModel(): ModelConfig {
	const { modelOverride } = useAppStore(
		useShallow((state) => ({
			modelOverride: state.modelOverride,
		})),
	);
	const config = useConfig();

	return getModelFromConfig(config, modelOverride);
}

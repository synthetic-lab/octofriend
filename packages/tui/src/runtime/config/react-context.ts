import React from "react";
import { writeConfig } from "./config-file";
import type { Config } from "./schemas";

export const ConfigContext = React.createContext<Config>({
	yourName: "unknown",
	models: [],
});
export function useConfig() {
	return React.useContext(ConfigContext);
}
export const ConfigPathContext = React.createContext("");

export const SetConfigContext = React.createContext<
	(c: Config) => void | Promise<void>
>(() => undefined);
export function useSetConfig() {
	const set = React.useContext(SetConfigContext);
	const configPath = React.useContext(ConfigPathContext);

	return React.useCallback(
		async (c: Config) => {
			await writeConfig(c, configPath);
			set(c);
		},
		[configPath, set],
	);
}

import { Box, Text, useApp } from "ink";
import { useCallback, useMemo, useState } from "react";
import { HeightlessCenteredBox } from "../../layout/boxes.tsx";
import { CustomAuthFlow } from "../../menu/models/custom-auth.tsx";
import { normalizeRenderedLineBreaks } from "../../render/lines.ts";
import {
	configMergeAutofixEnvVar,
	configMergeEnvVar,
} from "../../runtime/config/agentd-config.ts";
import { readConfig, writeConfig } from "../../runtime/config/config-file.ts";
import { readKeyForModelWithDetails } from "../../runtime/config/keys.ts";
import type { AuthError, Config } from "../../runtime/config/schemas.ts";
import { AuthCommandErrorPanel } from "./error.tsx";
import {
	applyAutofixAuthToConfig,
	applyModelAuthToConfig,
	indexOfModel,
	providerForPreflightModel,
	resolveAutofixModelFromConfig,
	resolveModelFromConfig,
	shouldMergeEnvAuthAsDefaultApiKey,
} from "./model-resolve.ts";
import { useAuthPreflightInput } from "./use-input.ts";

export function PreflightModelAuth({
	model,
	config,
	configPath,
	error,
}: {
	model: Config["models"][number];
	config: Config;
	configPath: string;
	error?: string;
}) {
	const { exit } = useApp();
	const [exitMessage, setExitMessage] = useState<string | null>(null);
	const [authError, setAuthError] = useState<AuthError | null>(null);
	const [isRetrying, setIsRetrying] = useState(false);
	const [currentModel, setCurrentModel] = useState(model);
	const currentProvider = useMemo(
		() => providerForPreflightModel(currentModel) ?? undefined,
		[currentModel.baseUrl, currentModel.type],
	);

	const validateAuth = useCallback(async () => {
		const reloadedConfig = await readConfig(configPath);
		const resolvedModel = resolveModelFromConfig(reloadedConfig, currentModel);
		setCurrentModel(resolvedModel);
		const result = await readKeyForModelWithDetails(
			resolvedModel,
			reloadedConfig,
		);
		if (result.ok === false) {
			setAuthError(result.error);
			setIsRetrying(false);
			return false;
		}
		return true;
	}, [configPath, currentModel]);

	useAuthPreflightInput({
		authError,
		exit,
		isRetrying,
		setAuthError,
		setExitMessage,
		setIsRetrying,
		validateAuth,
	});

	const cancelAuthSetup = useCallback(() => {
		setExitMessage("Press CTRL-C to exit");
	}, []);

	const completeAuthSetup = useCallback(
		async (auth?: Config["models"][number]["auth"]) => {
			let updatedConfig = await readConfig(configPath);
			let updatedModel = resolveModelFromConfig(updatedConfig, currentModel);
			const index = indexOfModel(updatedConfig.models, updatedModel);
			if (index >= 0 && auth) {
				if (shouldMergeEnvAuthAsDefaultApiKey(auth)) {
					updatedConfig = (await configMergeEnvVar(
						updatedConfig,
						updatedModel,
						auth.name,
					)) as Config;
					await writeConfig(updatedConfig, configPath);
				} else {
					const applied = applyModelAuthToConfig(
						updatedConfig,
						updatedModel,
						auth,
					);
					if (applied) {
						updatedConfig = applied.config;
						updatedModel = applied.model;
						await writeConfig(updatedConfig, configPath);
					}
				}
			}
			const resolvedModel = resolveModelFromConfig(updatedConfig, updatedModel);
			setCurrentModel(resolvedModel);
			const result = await readKeyForModelWithDetails(
				resolvedModel,
				updatedConfig,
			);
			if (result.ok) {
				exit();
			} else {
				setAuthError(result.error);
			}
		},
		[configPath, currentModel, exit],
	);

	return (
		<Box flexDirection="column" gap={1}>
			{error && (
				<HeightlessCenteredBox>
					<Box justifyContent="center">
						<Text color="red">{normalizeRenderedLineBreaks(error)}</Text>
					</Box>
				</HeightlessCenteredBox>
			)}

			{authError && authError.type === "command_failed" && (
				<AuthCommandErrorPanel authError={authError} isRetrying={isRetrying} />
			)}

			{!authError && (
				<CustomAuthFlow
					config={config}
					baseUrl={currentModel.baseUrl}
					provider={currentProvider}
					onCancel={cancelAuthSetup}
					onComplete={completeAuthSetup}
				/>
			)}

			{isRetrying && (
				<HeightlessCenteredBox>
					<Text color="gray">Retrying...</Text>
				</HeightlessCenteredBox>
			)}

			{exitMessage && (
				<HeightlessCenteredBox>
					<Text color="gray">{normalizeRenderedLineBreaks(exitMessage)}</Text>
				</HeightlessCenteredBox>
			)}
		</Box>
	);
}

export function PreflightAutofixAuth<K extends "diffApply" | "fixJson">({
	autofixKey,
	model,
	config,
	configPath,
}: {
	autofixKey: K;
	model: Exclude<Config[K], undefined>;
	config: Config;
	configPath: string;
}) {
	const { exit } = useApp();
	const [exitMessage, setExitMessage] = useState<string | null>(null);
	const [authError, setAuthError] = useState<AuthError | null>(null);
	const [isRetrying, setIsRetrying] = useState(false);
	const [currentModel, setCurrentModel] = useState(model);
	const currentProvider = useMemo(
		() => providerForPreflightModel(currentModel) ?? undefined,
		[currentModel.baseUrl, currentModel.type],
	);

	const validateAuth = useCallback(async () => {
		const reloadedConfig = await readConfig(configPath);
		const resolvedModel = resolveAutofixModelFromConfig(
			reloadedConfig,
			currentModel,
			autofixKey,
		);
		setCurrentModel(resolvedModel);
		const result = await readKeyForModelWithDetails(
			resolvedModel,
			reloadedConfig,
		);
		if (result.ok === false) {
			setAuthError(result.error);
			setIsRetrying(false);
			return false;
		}
		return true;
	}, [autofixKey, configPath, currentModel]);

	useAuthPreflightInput({
		authError,
		exit,
		isRetrying,
		setAuthError,
		setExitMessage,
		setIsRetrying,
		validateAuth,
	});

	const cancelAuthSetup = useCallback(() => {
		setExitMessage("Press CTRL-C to exit");
	}, []);

	const completeAuthSetup = useCallback(
		async (auth?: Config["models"][number]["auth"]) => {
			let updatedConfig = await readConfig(configPath);
			let updatedModel = resolveAutofixModelFromConfig(
				updatedConfig,
				currentModel,
				autofixKey,
			);
			if (auth) {
				if (shouldMergeEnvAuthAsDefaultApiKey(auth)) {
					updatedConfig = (await configMergeAutofixEnvVar(
						updatedConfig,
						autofixKey,
						updatedModel,
						auth.name,
					)) as Config;
					await writeConfig(updatedConfig, configPath);
				} else {
					const applied = applyAutofixAuthToConfig(
						updatedConfig,
						updatedModel,
						autofixKey,
						auth,
					);
					updatedConfig = applied.config;
					updatedModel = applied.model;
					await writeConfig(updatedConfig, configPath);
				}
			}
			const resolvedModel = resolveAutofixModelFromConfig(
				updatedConfig,
				updatedModel,
				autofixKey,
			);
			setCurrentModel(resolvedModel);
			const result = await readKeyForModelWithDetails(
				resolvedModel,
				updatedConfig,
			);
			if (result.ok) {
				exit();
			} else {
				setAuthError(result.error);
			}
		},
		[autofixKey, configPath, currentModel, exit],
	);

	const modelName = (() => {
		if (autofixKey === "diffApply") return "diff-apply";
		const _: "fixJson" = autofixKey;
		return "fix-json";
	})();

	return (
		<Box flexDirection="column" gap={1}>
			{authError && authError.type === "command_failed" && (
				<AuthCommandErrorPanel authError={authError} isRetrying={isRetrying} />
			)}

			{!authError && (
				<>
					<HeightlessCenteredBox>
						<Box justifyContent="center">
							<Text color="red">
								{`It looks like we need to set up auth for the ${modelName} model`}
							</Text>
						</Box>
					</HeightlessCenteredBox>

					<CustomAuthFlow
						config={config}
						baseUrl={currentModel.baseUrl}
						provider={currentProvider}
						onCancel={cancelAuthSetup}
						onComplete={completeAuthSetup}
					/>
				</>
			)}

			{isRetrying && (
				<HeightlessCenteredBox>
					<Text color="gray">Retrying...</Text>
				</HeightlessCenteredBox>
			)}

			{exitMessage && (
				<HeightlessCenteredBox>
					<Text color="gray">{normalizeRenderedLineBreaks(exitMessage)}</Text>
				</HeightlessCenteredBox>
			)}
		</Box>
	);
}

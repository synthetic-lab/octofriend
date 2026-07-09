import { Box, Static } from "ink";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ExitOnDoubleCtrlC } from "../input/ctrl_c.tsx";
import { useLatestInput } from "../input/latest_input.ts";
import {
	InputPriorityProvider,
	UNCHAINED_PRIORITY,
	usePriorityInput,
} from "../input/priority.tsx";
import type { Metadata } from "../internal/configuration/metadata.ts";
import {
	ConfigContext,
	ConfigPathContext,
	SetConfigContext,
} from "../internal/configuration/react-context.ts";
import type { Config } from "../internal/configuration/schemas.ts";
import type { Transport } from "../internal/transport/common.ts";
import { TerminalSizeTracker } from "../layout/viewport.tsx";
import type { ModelConnectionTester } from "../menu/model_setup/add-model-connection.ts";
import { ModelConnectionTestContext } from "../menu/model_setup/add-model-connection.ts";
import {
	SyntheticQuotaFetchContext,
	type SyntheticQuotaFetcher,
} from "../menu/quota.tsx";
import { MessageDisplay } from "../rendering/messages.tsx";
import {
	appendHistoryStaticItems,
	StaticItemRenderer,
	staticItemKey,
} from "../rendering/static_items.tsx";
import type { StaticItem } from "../rendering/types.ts";
import { TerminalUnchainedContext } from "../theme/branding.tsx";
import { BottomBar } from "./bottom_bar.tsx";
import type { InputHistory } from "./input_history.ts";
import { useAppStore } from "./state/store.ts";
import type { RunArgs, UiState } from "./state/types.ts";
import {
	attachTokenUsageMirror,
	type TokenUsageCounts,
} from "./token_usage.ts";
import { TransportContext } from "./transport_context.tsx";
import { CwdContext } from "./workspace_context.tsx";

export type TerminalAppShellProps = {
	config: Config;
	configPath: string;
	cwd: string;
	metadata: Metadata;
	updates: string | null;
	markUpdatesSeen: () => Promise<void>;
	unchained: boolean;
	transport: Transport;
	inputHistory: InputHistory;
	bootSkills: string[];
	modelConnectionTest: ModelConnectionTester;
	syntheticQuotaFetch: SyntheticQuotaFetcher;
	tokenUsageCounts?: TokenUsageCounts;
} & Pick<
	RunArgs,
	| "trajectoryArcRun"
	| "toolPermission"
	| "skillDiscover"
	| "toolDefinitions"
	| "toolRun"
>;

const UNCHAINED_NOTIF = "Octo runs edits and shell commands automatically";
const CHAINED_NOTIF =
	"Octo asks permission before running edits or shell commands";

export function terminalUnchainedNotification(unchained: boolean): string {
	return unchained ? UNCHAINED_NOTIF : CHAINED_NOTIF;
}

export function selectAppShellState(state: UiState) {
	return {
		history: state.history,
		inflightResponse:
			(state.modeData.mode === "responding" ||
				state.modeData.mode === "compacting") &&
			(state.modeData.inflightResponse.reasoningContent ||
				state.modeData.inflightResponse.content)
				? state.modeData.inflightResponse
				: null,
		isInputInsertMode:
			state.modeData.mode === "input" && state.modeData.vimMode === "INSERT",
		setVimMode: state.setVimMode,
		clearNonce: state.clearNonce,
		cancelNotifyReadyForInput: state.cancelNotifyReadyForInput,
	};
}

type BuildAppStaticItemsInput = {
	metadata: Metadata;
	config: Config;
	bootSkills: readonly string[];
	updates: string | null;
	history: UiState["history"];
};

export function buildAppStaticItems({
	metadata,
	config,
	bootSkills,
	updates,
	history,
}: BuildAppStaticItemsInput): StaticItem[] {
	const items: StaticItem[] = [
		{ type: "header" },
		{ type: "version", metadata, config },
	];
	let writeIndex = items.length;
	if (bootSkills.length > 0) {
		items[writeIndex] = { type: "boot-notification", content: " " };
		writeIndex += 1;
		items[writeIndex] = {
			type: "boot-notification",
			content: "Configured skills:",
		};
		writeIndex += 1;
		let index = 0;
		while (index < bootSkills.length) {
			const skill = bootSkills[index];
			if (skill !== undefined) {
				items[writeIndex] = {
					type: "boot-notification",
					content: `- ${skill}`,
				};
				writeIndex += 1;
			}
			index += 1;
		}
	}
	if (updates) {
		items[writeIndex] = { type: "updates", updates };
		writeIndex += 1;
	}
	items[writeIndex] = { type: "slogan" };
	appendHistoryStaticItems(items, history);
	return items;
}

function UnchainedShiftTabHandler({
	setIsUnchained,
	setTempNotification,
}: {
	setIsUnchained: (fn: (prev: boolean) => boolean) => void;
	setTempNotification: (notif: string | null) => void;
}) {
	usePriorityInput(UNCHAINED_PRIORITY, (_, key) => {
		if (key.shift && key.tab) {
			setIsUnchained((prev) => {
				const unchained = !prev;
				setTempNotification(terminalUnchainedNotification(unchained));
				return unchained;
			});
		}
	});
	return null;
}

export function App({
	config,
	configPath,
	cwd,
	metadata,
	unchained,
	transport,
	updates,
	markUpdatesSeen,
	inputHistory,
	bootSkills,
	modelConnectionTest,
	syntheticQuotaFetch,
	tokenUsageCounts,
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: TerminalAppShellProps) {
	const [currConfig, setCurrConfig] = useState(config);
	const [isUnchained, setIsUnchained] = useState(unchained);
	const [tempNotification, setTempNotification] = useState<string | null>(
		terminalUnchainedNotification(isUnchained),
	);
	const {
		history,
		inflightResponse,
		isInputInsertMode,
		setVimMode,
		clearNonce,
		cancelNotifyReadyForInput,
	} = useAppStore(useShallow(selectAppShellState));

	useLatestInput(cancelNotifyReadyForInput);

	useEffect(() => {
		if (!tokenUsageCounts) return;
		return attachTokenUsageMirror(tokenUsageCounts);
	}, [tokenUsageCounts]);

	useEffect(() => {
		if (updates != null) markUpdatesSeen().then(() => undefined);
		if (currConfig.vimEmulation?.enabled) setVimMode("INSERT");
	}, []);

	const staticItems: StaticItem[] = useMemo(
		() =>
			buildAppStaticItems({
				metadata,
				config: currConfig,
				bootSkills,
				updates,
				history,
			}),
		[history, currConfig, metadata, bootSkills, updates],
	);

	return (
		<ModelConnectionTestContext.Provider value={modelConnectionTest}>
			<SyntheticQuotaFetchContext.Provider value={syntheticQuotaFetch}>
				<InputPriorityProvider>
					<UnchainedShiftTabHandler
						setIsUnchained={setIsUnchained}
						setTempNotification={setTempNotification}
					/>
					<SetConfigContext.Provider value={setCurrConfig}>
						<ConfigPathContext.Provider value={configPath}>
							<ConfigContext.Provider value={currConfig}>
								<TerminalUnchainedContext.Provider value={isUnchained}>
									<TransportContext.Provider value={transport}>
										<CwdContext.Provider value={cwd}>
											<ExitOnDoubleCtrlC
												isInputInsertMode={
													!!currConfig.vimEmulation?.enabled &&
													isInputInsertMode
												}
											>
												<TerminalSizeTracker>
													<Box
														flexDirection="column"
														width="100%"
														height="100%"
													>
														<Static items={staticItems} key={clearNonce}>
															{(item, index) => (
																<StaticItemRenderer
																	item={item}
																	key={staticItemKey(item, index)}
																/>
															)}
														</Static>
														{inflightResponse && (
															<MessageDisplay item={inflightResponse} />
														)}
														<BottomBar
															inputHistory={inputHistory}
															metadata={metadata}
															tempNotification={tempNotification}
															trajectoryArcRun={trajectoryArcRun}
															toolPermission={toolPermission}
															skillDiscover={skillDiscover}
															toolDefinitions={toolDefinitions}
															toolRun={toolRun}
														/>
													</Box>
												</TerminalSizeTracker>
											</ExitOnDoubleCtrlC>
										</CwdContext.Provider>
									</TransportContext.Provider>
								</TerminalUnchainedContext.Provider>
							</ConfigContext.Provider>
						</ConfigPathContext.Provider>
					</SetConfigContext.Provider>
				</InputPriorityProvider>
			</SyntheticQuotaFetchContext.Provider>
		</ModelConnectionTestContext.Provider>
	);
}

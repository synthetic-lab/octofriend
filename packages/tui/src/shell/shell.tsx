import { Box, Static } from "ink";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ExitOnDoubleCtrlC } from "../input/ctrl-c";
import { useLatestInput } from "../input/latest-input";
import {
	InputPriorityProvider,
	UNCHAINED_PRIORITY,
	usePriorityInput,
} from "../input/priority";
import type { Metadata } from "../runtime/config/metadata";
import {
	ConfigContext,
	ConfigPathContext,
	SetConfigContext,
} from "../runtime/config/react-context";
import type { Config } from "../runtime/config/schemas";
import type { Transport } from "../runtime/workspace/common";
import { TerminalSizeTracker } from "../layout/viewport";
import { ModelDiscoveryContext } from "../menu/models/connection";
import type {
	ModelConnectionTester,
	ModelDiscoveryTester,
} from "../menu/models/connection";
import { ModelConnectionTestContext } from "../menu/models/connection";
import {
	SyntheticQuotaFetchContext,
	type SyntheticQuotaFetcher,
} from "../menu/quota";
import { MessageDisplay } from "../render/messages";
import {
	appendHistoryStaticItems,
	StaticItemRenderer,
	staticItemKey,
} from "../render/static-items";
import type { StaticItem } from "../render/types";
import { TerminalUnchainedContext } from "../theme/branding";
import { BottomBar } from "./bottom-bar";
import type { InputHistory } from "./input";
import { useAppStore } from "./state/store";
import type { RunArgs, UiState } from "./state/types";
import { attachTokenUsageMirror, type TokenUsageCounts } from "./token-usage";
import { TransportContext } from "./transport-context";
import { CwdContext } from "./workspace-context";

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
	modelDiscover?: ModelDiscoveryTester;
	syntheticQuotaFetch: SyntheticQuotaFetcher;
	tokenUsageCounts?: TokenUsageCounts;
	initialSessionId: string;
	initialHistory: UiState["history"];
	initialPrompt?: string;
	saveConversationSession: (
		sessionId: string,
		history: UiState["history"],
	) => Promise<void>;
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
		sessionId: state.sessionId,
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
	sessionId: string;
	history: UiState["history"];
};

export function buildAppStaticItems({
	metadata,
	config,
	bootSkills,
	updates,
	sessionId,
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
	items[writeIndex] = {
		type: "boot-notification",
		content: `Session: ${sessionId}`,
	};
	writeIndex += 1;
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
	modelDiscover,
	syntheticQuotaFetch,
	tokenUsageCounts,
	initialSessionId,
	initialHistory,
	initialPrompt,
	saveConversationSession,
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
		sessionId,
		history,
		inflightResponse,
		isInputInsertMode,
		setVimMode,
		clearNonce,
		cancelNotifyReadyForInput,
	} = useAppStore(useShallow(selectAppShellState));
	const hydrateSession = useAppStore((state) => state.hydrateSession);

	useLatestInput(cancelNotifyReadyForInput);

	useEffect(() => {
		hydrateSession(initialSessionId, initialHistory);
		if (initialPrompt !== undefined)
			useAppStore.getState().setQuery(initialPrompt);
		const unsubscribe = useAppStore.subscribe((state, previous) => {
			if (
				state.sessionId === previous.sessionId &&
				state.history === previous.history
			) {
				return;
			}
			saveConversationSession(state.sessionId, state.history).catch(
				(error: unknown) => {
					const detail = error instanceof Error ? error.message : String(error);
					setTempNotification(`Could not save session: ${detail}`);
				},
			);
		});
		return unsubscribe;
	}, []);

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
				sessionId,
				history,
			}),
		[history, sessionId, currConfig, metadata, bootSkills, updates],
	);

	return (
		<ModelDiscoveryContext.Provider
			value={modelDiscover ?? (async () => ({ models: [] }))}
		>
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
		</ModelDiscoveryContext.Provider>
	);
}

import path from "node:path";
import type {
	ConversationSessionHistory,
	SaveConversationSession,
} from "@octofriend/tui";
import type {
	AgentdConversationHistoryEntry,
	AgentdConversationHistoryRecord,
	AgentdConversationSessionLoadResult,
	AgentdRustBridge,
} from "./bridge/agent/agent";
import { CONFIG_DIR } from "./config/paths";

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export type ConversationSessionLaunch = {
	kind: "local" | "docker-connect" | "docker-run" | "ssh";
	config?: string;
	unchained: boolean;
	target?: string;
	args?: string[];
};

export type PreparedConversationSession = {
	sessionId: string;
	history: ConversationSessionHistory;
	launch: ConversationSessionLaunch;
	save: SaveConversationSession;
	flush: () => Promise<void>;
};

type PrepareConversationSessionOptions = {
	resumeId?: string;
	cwd: string;
	launch: ConversationSessionLaunch;
};

export async function prepareConversationSession(
	bridge: AgentdRustBridge,
	options: PrepareConversationSessionOptions,
): Promise<PreparedConversationSession> {
	const initializedSessionIds = new Set<string>();
	let sessionId: string;
	let history: ConversationSessionHistory;
	let launch: ConversationSessionLaunch;
	let revisionId: number | null;

	if (options.resumeId) {
		sessionId = validateSessionId(options.resumeId);
		const loaded = await bridge.conversationSessionLoad({
			databasePath: sessionDatabasePath(sessionId),
		});
		validateLoadedSession(loaded, sessionId, options.cwd);
		history = recordsToHistory(loaded.records);
		launch = parseLaunch(loaded.metadata.launchJson);
		revisionId = loaded.revisionId;
		initializedSessionIds.add(sessionId);
	} else {
		sessionId = crypto.randomUUID();
		history = [];
		launch = options.launch;
		revisionId = null;
		await createSession(bridge, sessionId, options.cwd, launch);
		initializedSessionIds.add(sessionId);
	}

	const revisionIds = new Map<string, number | null>([[sessionId, revisionId]]);
	let saveChain = Promise.resolve();
	const save: SaveConversationSession = (nextSessionId, nextHistory) => {
		saveChain = saveChain.then(async () => {
			const validatedId = validateSessionId(nextSessionId);
			if (!initializedSessionIds.has(validatedId)) {
				await createSession(bridge, validatedId, options.cwd, launch);
				initializedSessionIds.add(validatedId);
			}
			const result = await bridge.conversationSessionReplace({
				databasePath: sessionDatabasePath(validatedId),
				records: historyToEntries(nextHistory),
				parentRevisionId: revisionIds.get(validatedId) ?? null,
				timestamp: Date.now(),
			});
			revisionIds.set(validatedId, result.revisionId);
		});
		return saveChain;
	};
	const flush = () => saveChain;

	return { sessionId, history, launch, save, flush };
}

export async function loadConversationSessionLaunch(
	bridge: AgentdRustBridge,
	sessionId: string,
): Promise<ConversationSessionLaunch> {
	const validatedId = validateSessionId(sessionId);
	const loaded = await bridge.conversationSessionLoad({
		databasePath: sessionDatabasePath(validatedId),
	});
	if (loaded.metadata.sessionId !== validatedId) {
		throw new Error(
			`Session id mismatch: requested ${validatedId}, found ${loaded.metadata.sessionId}`,
		);
	}
	return parseLaunch(loaded.metadata.launchJson);
}

export function sessionDatabasePath(sessionId: string): string {
	return path.join(
		CONFIG_DIR,
		"sessions",
		`${validateSessionId(sessionId)}.sqlite`,
	);
}

function validateSessionId(sessionId: string): string {
	if (!SESSION_ID_PATTERN.test(sessionId)) {
		throw new Error(
			"Invalid session id: use only letters, numbers, underscores, and hyphens",
		);
	}
	return sessionId;
}

async function createSession(
	bridge: AgentdRustBridge,
	sessionId: string,
	cwd: string,
	launch: ConversationSessionLaunch,
): Promise<void> {
	await bridge.conversationSessionCreate({
		databasePath: sessionDatabasePath(sessionId),
		sessionId,
		cwd,
		launchJson: JSON.stringify(launch),
		timestamp: Date.now(),
	});
}

function validateLoadedSession(
	loaded: AgentdConversationSessionLoadResult,
	sessionId: string,
	cwd: string,
): void {
	if (loaded.metadata.sessionId !== sessionId) {
		throw new Error(
			`Session id mismatch: requested ${sessionId}, found ${loaded.metadata.sessionId}`,
		);
	}
	if (path.resolve(loaded.metadata.cwd) !== path.resolve(cwd)) {
		throw new Error(
			`Session ${sessionId} belongs to ${loaded.metadata.cwd}, not ${cwd}`,
		);
	}
}

function parseLaunch(value: string): ConversationSessionLaunch {
	const parsed: unknown = JSON.parse(value);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("kind" in parsed) ||
		typeof parsed.kind !== "string" ||
		!("unchained" in parsed) ||
		typeof parsed.unchained !== "boolean"
	) {
		throw new Error("Session launch metadata is invalid");
	}
	return parsed as ConversationSessionLaunch;
}

function recordsToHistory(
	records: AgentdConversationHistoryRecord[],
): ConversationSessionHistory {
	return records.map((record) => {
		switch (record.kind) {
			case "llm-ir": {
				if (record.payload === null) {
					throw new Error("Stored LLM history item is missing its payload");
				}
				return { type: "llm-ir", ir: JSON.parse(record.payload) };
			}
			case "notification":
				return { type: "notification", content: record.payload ?? "" };
			case "request-failed":
				return { type: "request-failed" };
			case "compaction-failed":
				return { type: "compaction-failed" };
		}
	});
}

function historyToEntries(
	history: ConversationSessionHistory,
): AgentdConversationHistoryEntry[] {
	return history.map((item) => {
		switch (item.type) {
			case "llm-ir":
				return { kind: "llm-ir", payload: JSON.stringify(item.ir) };
			case "notification":
				return { kind: "notification", payload: item.content };
			case "request-failed":
				return { kind: "request-failed" };
			case "compaction-failed":
				return { kind: "compaction-failed" };
		}
	});
}

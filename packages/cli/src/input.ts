import { err, ok, type Result } from "./result";

export const MAX_HISTORY_ITEMS = 100;
export const MAX_HISTORY_TRUNCATION_BATCH = 20;

export type InputHistory = {
	getCurrentHistory(): string[];
	appendToInputHistory(input: string): Promise<void>;
	close(): void;
};

export type InputHistoryLoadParams = {
	databasePath?: string;
	maxHistoryItems?: number;
};

export type InputHistoryAppendParams = InputHistoryLoadParams & {
	input: string;
};

export type InputHistoryResult = {
	history: string[];
};

export type InputHistoryLoader = (
	params: InputHistoryLoadParams,
) => Promise<InputHistoryResult>;

export type InputHistoryAppender = (
	params: InputHistoryAppendParams,
) => Promise<InputHistoryResult>;

export type LoadInputHistoryOptions = InputHistoryLoadParams & {
	load?: InputHistoryLoader;
	append?: InputHistoryAppender;
};

class BridgeInputHistory implements InputHistory {
	private history: string[];
	private readonly append: InputHistoryAppender;
	private readonly databasePath?: string;
	private readonly maxHistoryItems: number;

	constructor({
		history,
		append,
		databasePath,
		maxHistoryItems = MAX_HISTORY_ITEMS,
	}: {
		history: string[];
		append: InputHistoryAppender;
		databasePath?: string;
		maxHistoryItems?: number;
	}) {
		this.history = history;
		this.append = append;
		this.databasePath = databasePath;
		this.maxHistoryItems = maxHistoryItems;
	}

	getCurrentHistory(): string[] {
		return this.history;
	}

	async appendToInputHistory(input: string): Promise<void> {
		if (!input.trim()) return;
		const result = await this.append({
			input,
			...inputHistoryBridgeParams({
				databasePath: this.databasePath,
				maxHistoryItems: this.maxHistoryItems,
			}),
		});
		this.history = result.history;
	}

	close(): void {
		return;
	}
}

export async function loadInputHistory(
	options: LoadInputHistoryOptions = {},
): Promise<Result<InputHistory, string>> {
	if (!(options.load && options.append)) {
		return err("Input history bridge is required");
	}
	const maxHistoryItems = options.maxHistoryItems ?? MAX_HISTORY_ITEMS;
	const bridgeParams = inputHistoryBridgeParams({
		databasePath: options.databasePath,
		maxHistoryItems,
	});
	const result = await options.load(bridgeParams);
	return ok(
		new BridgeInputHistory({
			history: result.history,
			append: options.append,
			databasePath: options.databasePath,
			maxHistoryItems,
		}),
	);
}

function inputHistoryBridgeParams({
	databasePath,
	maxHistoryItems,
}: {
	databasePath?: string;
	maxHistoryItems: number;
}): InputHistoryLoadParams {
	return {
		...(databasePath === undefined ? {} : { databasePath }),
		maxHistoryItems,
	};
}

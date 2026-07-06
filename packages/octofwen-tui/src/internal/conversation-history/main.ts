export type LlmHistoryItem<TIr> = {
	type: "llm-ir";
	ir: TIr;
};

export type RequestFailedHistoryItem = {
	type: "request-failed";
};

export type CompactionFailedHistoryItem = {
	type: "compaction-failed";
};

export type NotificationHistoryItem = {
	type: "notification";
	content: string;
};

export type HistoryItem<TIr> =
	| LlmHistoryItem<TIr>
	| RequestFailedHistoryItem
	| CompactionFailedHistoryItem
	| NotificationHistoryItem;

export function outputToHistory<TIr>(output: TIr[]): HistoryItem<TIr>[] {
	return output.map((ir) => ({
		type: "llm-ir",
		ir,
	}));
}

export function toLlmIR<TIr>(history: HistoryItem<TIr>[]): TIr[] {
	const irs: TIr[] = [];
	for (const item of history) {
		if (item.type === "llm-ir") irs.push(item.ir);
	}
	return irs;
}

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
	const history = new Array<HistoryItem<TIr>>(output.length);
	let index = 0;
	while (index < output.length) {
		history[index] = {
			type: "llm-ir",
			ir: output[index] as TIr,
		};
		index += 1;
	}
	return history;
}

export function toLlmIR<TIr>(history: HistoryItem<TIr>[]): TIr[] {
	const irs = new Array<TIr>(history.length);
	let index = 0;
	let writeIndex = 0;
	while (index < history.length) {
		const item = history[index];
		if (item?.type === "llm-ir") {
			irs[writeIndex] = item.ir;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < irs.length) irs.length = writeIndex;
	return irs;
}

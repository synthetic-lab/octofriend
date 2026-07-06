export type TokenType = "input" | "output";
export type ModelTokenUsage = { input: number; output: number };
export type TokenUsageCounts = Record<string, ModelTokenUsage>;

const totalTokens: TokenUsageCounts = {};
let tokenUsageMirror: TokenUsageCounts | null = null;

export function tokenCounts(): TokenUsageCounts {
	return totalTokens;
}

export function attachTokenUsageMirror(counts: TokenUsageCounts): () => void {
	for (const key of Object.keys(counts)) {
		delete counts[key];
	}
	for (const [model, usage] of Object.entries(totalTokens)) {
		counts[model] = { ...usage };
	}
	tokenUsageMirror = counts;
	return () => {
		if (tokenUsageMirror === counts) tokenUsageMirror = null;
	};
}

export function trackTokens(
	model: string,
	tokenType: TokenType,
	count: number,
): void {
	totalTokens[model] ||= { input: 0, output: 0 };
	totalTokens[model][tokenType] += count;
	if (tokenUsageMirror) {
		tokenUsageMirror[model] = { ...totalTokens[model] };
	}
}

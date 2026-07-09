export type TokenType = "input" | "output";
export type ModelTokenUsage = { input: number; output: number };
export type TokenUsageCounts = Record<string, ModelTokenUsage>;

const totalTokens: TokenUsageCounts = Object.create(null) as TokenUsageCounts;
let tokenUsageMirror: TokenUsageCounts | null = null;

export function tokenCounts(): TokenUsageCounts {
	return totalTokens;
}

export function attachTokenUsageMirror(counts: TokenUsageCounts): () => void {
	for (const key in counts) {
		if (Object.hasOwn(counts, key)) delete counts[key];
	}
	for (const model in totalTokens) {
		if (!Object.hasOwn(totalTokens, model)) continue;
		const usage = totalTokens[model];
		if (usage !== undefined) {
			setTokenUsageBucket(counts, model, {
				input: usage.input,
				output: usage.output,
			});
		}
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
	if (tokenType === "input") trackTokenUsage(model, count, 0);
	else trackTokenUsage(model, 0, count);
}

export function trackTokenUsage(
	model: string,
	input: number,
	output: number,
): void {
	let usage = ownTokenUsage(totalTokens, model);
	if (usage === undefined) {
		usage = { input: 0, output: 0 };
		setTokenUsageBucket(totalTokens, model, usage);
	}
	usage.input += input;
	usage.output += output;
	if (tokenUsageMirror) updateTokenUsageMirror(model, usage);
}

function updateTokenUsageMirror(model: string, usage: ModelTokenUsage): void {
	if (tokenUsageMirror === null) return;
	let mirroredUsage = ownTokenUsage(tokenUsageMirror, model);
	if (mirroredUsage === undefined) {
		mirroredUsage = { input: usage.input, output: usage.output };
		setTokenUsageBucket(tokenUsageMirror, model, mirroredUsage);
	} else {
		mirroredUsage.input = usage.input;
		mirroredUsage.output = usage.output;
	}
}

function ownTokenUsage(
	counts: TokenUsageCounts,
	model: string,
): ModelTokenUsage | undefined {
	return Object.hasOwn(counts, model) ? counts[model] : undefined;
}

function setTokenUsageBucket(
	counts: TokenUsageCounts,
	model: string,
	usage: ModelTokenUsage,
): void {
	if (model === "__proto__") {
		Object.defineProperty(counts, model, {
			value: usage,
			writable: true,
			enumerable: true,
			configurable: true,
		});
		return;
	}
	counts[model] = usage;
}

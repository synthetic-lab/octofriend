let totalTokens: Record<string, { input: number, output: number }> = {};

export function tokenCounts() {
  return totalTokens;
}

export function trackTokens(model: string, tokenType: "input" | "output", count: number) {
  totalTokens[model] ||= { input: 0, output: 0 };
  totalTokens[model][tokenType] += count;
}

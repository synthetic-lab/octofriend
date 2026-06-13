// ~4 characters per token for English text: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type InputHistory = {
	getCurrentHistory(): string[];
	appendToInputHistory(input: string): Promise<void>;
	close(): void;
};

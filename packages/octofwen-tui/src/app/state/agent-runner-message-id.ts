let nextLocalMessageId = 1;

export function createLocalMessageId(prefix: "user" | "assistant"): string {
	const id = `${prefix}-${nextLocalMessageId}`;
	nextLocalMessageId += 1;
	return id;
}

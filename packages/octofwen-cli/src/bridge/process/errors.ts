export type AgentdJsonRpcErrorObject = {
	code: number;
	message: string;
	data?: unknown;
};

export class AgentdJsonRpcError extends Error {
	readonly code: number;
	readonly data: unknown;

	constructor(error: AgentdJsonRpcErrorObject) {
		super(error.message);
		this.name = "AgentdJsonRpcError";
		this.code = error.code;
		this.data = error.data;
	}
}

import type { AgentdJsonRpcErrorObject } from "./errors.ts";

export type AgentdJsonRpcId = number | string | null;

export type AgentdRequest = {
	jsonrpc: "2.0";
	id: AgentdJsonRpcId;
	method: string;
	params?: unknown;
};

export type AgentdSuccessResponse = {
	jsonrpc: "2.0";
	id: AgentdJsonRpcId;
	result: unknown;
};

export type AgentdErrorResponse = {
	jsonrpc: "2.0";
	id: AgentdJsonRpcId;
	error: AgentdJsonRpcErrorObject;
};

export type AgentdResponse = AgentdSuccessResponse | AgentdErrorResponse;

export type AgentdNotification = {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
};

export function createAgentdRequest(
	id: AgentdJsonRpcId,
	method: string,
	params?: unknown,
): AgentdRequest {
	const request: AgentdRequest = {
		jsonrpc: "2.0",
		id,
		method,
	};
	if (params !== undefined) request.params = params;
	return request;
}

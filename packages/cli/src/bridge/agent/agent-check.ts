import { err, ok, type Result } from "../../result.ts";
import type { AgentdRequestOptions } from "../ipc/client.ts";

export function validateAgentdResult<T>(
	result: unknown,
	isExpected: (value: unknown) => value is T,
	invalidResponseError: () => Error,
): Result<T, Error> {
	return isExpected(result) ? ok(result) : err(invalidResponseError());
}

export function unwrapAgentdResult<T>(
	validation: Result<T, Error>,
): T | Promise<never> {
	if (!validation.success) return Promise.reject(validation.error);
	return validation.data;
}

export type AgentdRequestClient = {
	request: (
		method: string,
		params?: unknown,
		options?: AgentdRequestOptions,
	) => Promise<unknown>;
};

export async function requestAgentdResult<T>(
	client: AgentdRequestClient,
	method: string,
	params: unknown,
	isExpected: (value: unknown) => value is T,
	invalidResponseError: () => Error,
	options?: AgentdRequestOptions,
): Promise<T> {
	const result = await client.request(method, params, options);
	return unwrapAgentdResult(
		validateAgentdResult(result, isExpected, invalidResponseError),
	);
}

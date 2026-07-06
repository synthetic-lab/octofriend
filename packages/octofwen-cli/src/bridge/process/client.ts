import { AgentdJsonRpcError } from "./errors.ts";
import {
	type AgentdJsonRpcId,
	type AgentdResponse,
	createAgentdRequest,
} from "./events.ts";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

export type AgentdRequestOptions = {
	abortSignal?: AbortSignal;
	cancelOnAbort?: boolean;
};

export type AgentdProcessLike = {
	stdin: WritableStream<Uint8Array>;
	stdout: ReadableStream<Uint8Array>;
	stderr?: ReadableStream<Uint8Array>;
	kill: () => void;
};

export class AgentdProcessClient {
	readonly #process: AgentdProcessLike;
	readonly #encoder = new TextEncoder();
	readonly #decoder = new TextDecoder();
	readonly #pending = new Map<AgentdJsonRpcId, PendingRequest>();
	readonly #stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
	readonly #stdinWriter: WritableStreamDefaultWriter<Uint8Array>;
	#nextId = 1;
	#buffer = "";
	#closed = false;

	constructor(process: AgentdProcessLike) {
		this.#process = process;
		this.#stdoutReader = process.stdout.getReader();
		this.#stdinWriter = process.stdin.getWriter();
		this.#readStdout().catch((error: unknown) => this.#rejectAll(error));
	}

	async request(
		method: string,
		params?: unknown,
		options: AgentdRequestOptions = {},
	): Promise<unknown> {
		if (this.#closed) throw new Error("agentd client closed");
		if (options.abortSignal?.aborted) {
			if (options.cancelOnAbort) this.close();
			throw new Error("agentd request aborted");
		}
		const id = this.#nextId++;
		const request = createAgentdRequest(id, method, params);
		let abort: (() => void) | undefined;
		const response = new Promise<unknown>((resolve, reject) => {
			abort = () => {
				this.#pending.delete(id);
				reject(new Error("agentd request aborted"));
				if (options.cancelOnAbort) this.close();
			};
			options.abortSignal?.addEventListener("abort", abort, { once: true });
			this.#pending.set(id, { resolve, reject });
		});
		try {
			await this.#stdinWriter.write(
				this.#encoder.encode(`${JSON.stringify(request)}\n`),
			);
		} catch (error) {
			this.#pending.delete(id);
			if (abort) options.abortSignal?.removeEventListener("abort", abort);
			throw error;
		}
		try {
			return await response;
		} finally {
			if (abort) options.abortSignal?.removeEventListener("abort", abort);
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const pending of this.#pending.values()) {
			pending.reject(new Error("agentd client closed"));
		}
		this.#pending.clear();
		try {
			this.#process.kill();
		} catch {
			return;
		}
		this.#stdoutReader.cancel().catch(() => undefined);
		this.#stdinWriter.close().catch(() => undefined);
	}

	async #readStdout(): Promise<void> {
		try {
			while (!this.#closed) {
				const { done, value } = await this.#stdoutReader.read();
				if (done) break;
				this.#buffer += this.#decoder.decode(value, { stream: true });
				this.#drainLines();
			}
		} catch (error) {
			this.#rejectAll(error);
		} finally {
			if (!this.#closed) this.#rejectAll(new Error("agentd stdout closed"));
		}
	}

	#drainLines(): void {
		let newlineIndex = this.#buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.#buffer.slice(0, newlineIndex);
			this.#buffer = this.#buffer.slice(newlineIndex + 1);
			if (line.length > 0) this.#handleLine(line);
			newlineIndex = this.#buffer.indexOf("\n");
		}
	}

	#handleLine(line: string): void {
		let response: AgentdResponse;
		try {
			response = JSON.parse(line) as AgentdResponse;
		} catch (error) {
			this.#rejectAll(error);
			return;
		}

		const pending = this.#pending.get(response.id);
		if (!pending) return;
		this.#pending.delete(response.id);
		if ("error" in response)
			pending.reject(new AgentdJsonRpcError(response.error));
		else pending.resolve(response.result);
	}

	#rejectAll(error: unknown): void {
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}
}

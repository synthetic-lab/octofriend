import {
	agentdTransportRequest,
	type Transport,
	type TransportDirectoryEntry,
} from "./common.ts";

export class LocalTransport implements Transport {
	readonly cwd: string;

	constructor(cwd = process.cwd()) {
		this.cwd = cwd;
	}

	toolRunTransport() {
		return { type: "local" as const };
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	async writeFile(signal: AbortSignal, file: string, contents: string) {
		await this.request(signal, {
			operation: "writeFile",
			path: file,
			contents,
		});
	}

	async readFile(signal: AbortSignal, file: string) {
		const result = await this.request(signal, {
			operation: "readFile",
			path: file,
		});
		return result["contents"] as string;
	}

	async modTime(signal: AbortSignal, file: string) {
		const result = await this.request(signal, {
			operation: "modTime",
			path: file,
		});
		return result["mtime"] as number;
	}

	async resolvePath(signal: AbortSignal, file: string) {
		const result = await this.request(signal, {
			operation: "resolvePath",
			path: file,
		});
		return result["path"] as string;
	}

	async mkdir(signal: AbortSignal, dirpath: string) {
		await this.request(signal, { operation: "mkdir", path: dirpath });
	}

	async readdir(signal: AbortSignal, dirpath: string) {
		const result = await this.request(signal, {
			operation: "readdir",
			path: dirpath,
		});
		return result["entries"] as TransportDirectoryEntry[];
	}

	async pathExists(signal: AbortSignal, file: string) {
		const result = await this.request(signal, {
			operation: "pathExists",
			path: file,
		});
		return result["exists"] as boolean;
	}

	async isDirectory(signal: AbortSignal, file: string) {
		const result = await this.request(signal, {
			operation: "isDirectory",
			path: file,
		});
		return result["isDirectory"] as boolean;
	}

	async shell(
		signal: AbortSignal,
		command: string,
		timeout: number,
	): Promise<string> {
		const result = await this.request(signal, {
			operation: "shell",
			command,
			timeoutMs: timeout,
		});
		return result["output"] as string;
	}

	private request(signal: AbortSignal, params: Record<string, unknown>) {
		return agentdTransportRequest(signal, "octofwen.agentd/transportLocal", {
			cwd: this.cwd,
			...params,
		});
	}
}

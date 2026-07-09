import {
	agentdTransportRequest,
	type Transport,
	type TransportDirectoryEntry,
} from "./common";

const internalSignal = new AbortController().signal;

export class SshTransport implements Transport {
	private readonly target: string;
	cwd: string;

	private constructor(target: string, cwd: string) {
		this.target = target;
		this.cwd = cwd;
	}

	toolRunTransport() {
		return { type: "ssh" as const, target: this.target };
	}

	static async create(target: string): Promise<SshTransport> {
		const result = await agentdTransportRequest(
			internalSignal,
			"octofwen.agentd/transportSsh",
			{ target, operation: "cwd" },
		);
		return new SshTransport(target, (result["cwd"] as string).trim());
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	async writeFile(
		signal: AbortSignal,
		file: string,
		contents: string,
	): Promise<void> {
		await this.request(signal, {
			operation: "writeFile",
			path: file,
			contents,
		});
	}

	async readFile(signal: AbortSignal, file: string): Promise<string> {
		const result = await this.request(signal, {
			operation: "readFile",
			path: file,
		});
		return result["contents"] as string;
	}

	async modTime(signal: AbortSignal, file: string): Promise<number> {
		const result = await this.request(signal, {
			operation: "modTime",
			path: file,
		});
		return result["mtime"] as number;
	}

	async resolvePath(
		signal: AbortSignal,
		pathToResolve: string,
	): Promise<string> {
		const result = await this.request(signal, {
			operation: "resolvePath",
			path: pathToResolve,
		});
		return result["path"] as string;
	}

	async mkdir(signal: AbortSignal, dirpath: string): Promise<void> {
		await this.request(signal, { operation: "mkdir", path: dirpath });
	}

	async readdir(
		signal: AbortSignal,
		dirpath: string,
	): Promise<TransportDirectoryEntry[]> {
		const result = await this.request(signal, {
			operation: "readdir",
			path: dirpath,
		});
		return result["entries"] as TransportDirectoryEntry[];
	}

	async pathExists(signal: AbortSignal, file: string): Promise<boolean> {
		const result = await this.request(signal, {
			operation: "pathExists",
			path: file,
		});
		return result["exists"] as boolean;
	}

	async isDirectory(signal: AbortSignal, file: string): Promise<boolean> {
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
		return agentdTransportRequest(signal, "octofwen.agentd/transportSsh", {
			target: this.target,
			cwd: this.cwd,
			...params,
		});
	}
}

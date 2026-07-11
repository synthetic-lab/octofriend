import {
	agentdTransportRequest,
	type Transport,
	type TransportDirectoryEntry,
} from "./common.ts";

export type ManagedDockerContainer = {
	container: string;
	close: () => Promise<void>;
};

const internalSignal = new AbortController().signal;

export async function manageContainer(
	args: string[],
): Promise<ManagedDockerContainer> {
	console.log("Spawning Docker container...");
	const result = await agentdTransportRequest(
		internalSignal,
		"octofriend.agentd/transportDockerRun",
		{ args },
	);
	const container = result["container"] as string;
	return {
		container,
		close: async () => {
			await agentdTransportRequest(
				internalSignal,
				"octofriend.agentd/transportDockerKill",
				{ container },
			);
		},
	};
}

export type DockerTarget =
	| {
			type: "container";
			container: string;
	  }
	| {
			type: "image";
			image: ManagedDockerContainer;
	  };

export class DockerTransport implements Transport {
	private readonly _container: string;
	private readonly _target: DockerTarget;
	cwd: string;

	private constructor(target: DockerTarget, cwd: string) {
		this._target = target;
		if (this._target.type === "image")
			this._container = this._target.image.container;
		else this._container = this._target.container;
		this.cwd = cwd;
	}

	toolRunTransport() {
		return { type: "docker" as const, container: this._container };
	}

	static async create(target: DockerTarget): Promise<DockerTransport> {
		const container =
			target.type === "image" ? target.image.container : target.container;
		const result = await agentdTransportRequest(
			internalSignal,
			"octofriend.agentd/transportDocker",
			{ container, operation: "cwd" },
		);
		return new DockerTransport(target, (result["cwd"] as string).trim());
	}

	async close() {
		if (this._target.type === "image") await this._target.image.close();
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
		return agentdTransportRequest(signal, "octofriend.agentd/transportDocker", {
			container: this._container,
			cwd: this.cwd,
			...params,
		});
	}
}

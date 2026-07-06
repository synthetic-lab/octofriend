import { afterEach, describe, expect, it } from "bun:test";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	AbortError,
	CommandFailedError,
	findFiles,
	getEnvVar,
	TransportError,
} from "../../../internal/transport/common.ts";
import { LocalTransport } from "../../../internal/transport/local.ts";

const temporaryDirectories: string[] = [];
const isWindows = process.platform === "win32";

function printWorkingDirectoryAndMarkerCommand() {
	return isWindows ? "cd && type marker.txt" : "pwd && cat marker.txt";
}

function failingCommand() {
	return isWindows ? "echo failed && exit /b 7" : "echo failed && exit 7";
}

function sleepCommand() {
	return isWindows ? "ping -n 2 127.0.0.1 >NUL" : "sleep 1";
}

function normalizeShellOutput(output: string) {
	return output.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
}

async function makeTempDirectory() {
	const dir = await mkdtemp(path.join(tmpdir(), "octofwen-transport-"));
	temporaryDirectories.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("LocalTransport", () => {
	it("reads, writes, resolves, lists, and stats local filesystem entries", async () => {
		const root = await makeTempDirectory();
		const signal = new AbortController().signal;
		const transport = new LocalTransport(root);

		await transport.mkdir(signal, path.join(root, "dir"));
		await transport.writeFile(
			signal,
			path.join(root, "dir/file.txt"),
			"contents",
		);
		if (!isWindows) {
			await symlink(path.join(root, "dir"), path.join(root, "link-to-dir"));
		}

		await expect(
			transport.readFile(signal, path.join(root, "dir/file.txt")),
		).resolves.toBe("contents");
		await expect(
			transport.pathExists(signal, path.join(root, "dir/file.txt")),
		).resolves.toBe(true);
		await expect(
			transport.isDirectory(signal, path.join(root, "dir")),
		).resolves.toBe(true);
		await expect(
			transport.resolvePath(signal, path.join(root, "missing.txt")),
		).resolves.toBe(path.join(root, "missing.txt"));
		expect(
			await transport.modTime(signal, path.join(root, "dir/file.txt")),
		).toBeGreaterThan(0);

		const entries = await transport.readdir(signal, root);
		expect(entries).toContainEqual({ entry: "dir", isDirectory: true });
		if (!isWindows) {
			expect(entries).toContainEqual({
				entry: "link-to-dir",
				isDirectory: true,
			});
		}
	});

	it("runs shell commands from the transport cwd and reports command failures", async () => {
		const root = await makeTempDirectory();
		const signal = new AbortController().signal;
		const transport = new LocalTransport(root);

		await writeFile(path.join(root, "marker.txt"), "ok", "utf8");

		const output = await transport.shell(
			signal,
			printWorkingDirectoryAndMarkerCommand(),
			5000,
		);
		const [reportedCwd, marker] = normalizeShellOutput(output).split("\n");
		expect(await realpath(reportedCwd)).toBe(await realpath(root));
		expect(marker).toBe("ok");
		try {
			await transport.shell(signal, failingCommand(), 5000);
			throw new Error("command should fail");
		} catch (error) {
			expect(error).toMatchObject({
				name: "CommandFailedError",
				exitCode: 7,
			});
			expect(normalizeShellOutput((error as Error).message)).toBe(
				"Command exited with code: 7\noutput: failed\n",
			);
		}
	});

	it("maps shell aborts and timeouts to transport errors", async () => {
		const root = await makeTempDirectory();
		const transport = new LocalTransport(root);
		const abortController = new AbortController();
		abortController.abort();

		await expect(
			transport.shell(abortController.signal, sleepCommand(), 5000),
		).rejects.toBeInstanceOf(AbortError);
		await expect(
			transport.shell(new AbortController().signal, sleepCommand(), 10),
		).rejects.toBeInstanceOf(CommandFailedError);
	});

	it("wraps missing file mtime failures in TransportError", async () => {
		const root = await makeTempDirectory();
		const transport = new LocalTransport(root);

		await expect(
			transport.modTime(
				new AbortController().signal,
				path.join(root, "missing.txt"),
			),
		).rejects.toBeInstanceOf(TransportError);
	});
});

describe("findFiles", () => {
	it("finds relative files with pruning, filters, max depth, and result caps", async () => {
		const root = await makeTempDirectory();
		const signal = new AbortController().signal;
		const transport = new LocalTransport(root);

		await mkdir(path.join(root, "src/nested"), { recursive: true });
		await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
		await writeFile(path.join(root, "src/a.ts"), "", "utf8");
		await writeFile(path.join(root, "src/b.test.ts"), "", "utf8");
		await writeFile(path.join(root, "src/nested/c.ts"), "", "utf8");
		await writeFile(path.join(root, "node_modules/pkg/hidden.ts"), "", "utf8");

		await expect(
			findFiles(signal, transport, {
				includeName: "*.ts",
				excludeName: "*.test.ts",
				type: "f",
			}),
		).resolves.toEqual(["src/a.ts", "src/nested/c.ts"]);

		const cappedResults = await findFiles(signal, transport, {
			path: path.join(root, "src"),
			includeName: "*.ts",
			excludeName: "*.test.ts",
			maxDepth: 1,
			maxResults: 1,
		});

		expect(cappedResults).toHaveLength(1);
		expect(cappedResults).toEqual(["a.ts"]);
	});
});

describe("getEnvVar", () => {
	it("reads environment variables through agentd transport", async () => {
		const root = await makeTempDirectory();
		const transport = new LocalTransport(root);

		expect(
			await getEnvVar(
				new AbortController().signal,
				transport,
				"OCTOFWEN_TRANSPORT_TEST_VALUE",
				5000,
			),
		).toBe("");

		process.env["OCTOFWEN_TRANSPORT_TEST_VALUE"] = "abc";
		try {
			expect(
				await getEnvVar(
					new AbortController().signal,
					transport,
					"OCTOFWEN_TRANSPORT_TEST_VALUE",
					5000,
				),
			).toBe("abc");
		} finally {
			delete process.env["OCTOFWEN_TRANSPORT_TEST_VALUE"];
		}
	});
});

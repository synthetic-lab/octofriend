import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function buildReleaseFixture(root: string): Promise<{
	fixture: string;
	name: string;
}> {
	const fixture = join(root, "fixture");
	const stage = join(root, "stage");
	await Promise.all([mkdir(fixture), mkdir(stage)]);
	const os = process.platform === "darwin" ? "macos" : "linux";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const name = `octofriend-1.2.3-${os}-${arch}`;
	const directory = join(stage, name);
	await mkdir(directory);
	for (const executable of [
		"octofriend",
		"octofriend-acp",
		"octofriend-agentd",
	]) {
		const path = join(directory, executable);
		await writeFile(path, `#!/bin/sh\nprintf '%s\\n' ${executable}\n`);
		await chmod(path, 0o755);
	}
	const archive = join(fixture, `${name}.tar.gz`);
	const tar = Bun.spawn(["tar", "-C", stage, "-czf", archive, name], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await tar.exited) !== 0)
		throw new Error("Could not create test archive");
	const digest = new Bun.CryptoHasher("sha256")
		.update(await Bun.file(archive).arrayBuffer())
		.digest("hex");
	await writeFile(join(fixture, "SHA256SUMS"), `${digest}  ${name}.tar.gz\n`);
	return { fixture, name };
}

async function writeFakeDownloaders(
	fakeBin: string,
	name: string,
): Promise<void> {
	await mkdir(fakeBin);
	const script = `#!/bin/sh
url=""
output=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-o|-O) output="$2"; shift 2 ;;
		http*) url="$1"; shift ;;
		*) shift ;;
	esac
done
case "$url" in
	*/SHA256SUMS) cp "$OCTO_TEST_FIXTURE/SHA256SUMS" "$output" ;;
	*/${name}.tar.gz) cp "$OCTO_TEST_FIXTURE/${name}.tar.gz" "$output" ;;
	*) echo "unexpected download: $url" >&2; exit 2 ;;
esac
`;
	for (const command of ["curl", "wget"]) {
		const path = join(fakeBin, command);
		await writeFile(path, script);
		await chmod(path, 0o755);
	}
}

async function expectInstalledExecutables(install: string): Promise<void> {
	for (const executable of [
		"octofriend",
		"octo",
		"octofriend-acp",
		"octofriend-agentd",
	]) {
		const path = join(install, executable);
		if (((await stat(path)).mode & 0o111) === 0) {
			throw new Error(`${path} is not executable`);
		}
		if (!(await readFile(path, "utf8")).includes("#!/bin/sh")) {
			throw new Error(`${path} does not contain the fixture executable`);
		}
	}
}

const supportedPlatform =
	process.platform === "darwin" || process.platform === "linux";

describe.skipIf(!supportedPlatform)("Unix installer", () => {
	for (const downloader of ["curl", "wget"] as const) {
		test(`installs and verifies a release with ${downloader}`, async () => {
			const root = await mkdtemp(join(tmpdir(), "octofriend-installer-"));
			temporaryDirectories.push(root);
			const install = join(root, "install");
			const fakeBin = join(root, "bin");
			const { fixture, name } = await buildReleaseFixture(root);
			await writeFakeDownloaders(fakeBin, name);

			const child = Bun.spawn(
				["/bin/sh", resolve(import.meta.dirname, "../install.sh")],
				{
					env: {
						...process.env,
						OCTO_VERSION: "1.2.3",
						OCTO_INSTALL_DIR: install,
						OCTO_DOWNLOADER: downloader,
						OCTO_TEST_FIXTURE: fixture,
						PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = await new Response(child.stdout).text();
			const error = await new Response(child.stderr).text();
			expect(await child.exited, error).toBe(0);
			expect(output).toContain("Installed octofriend 1.2.3");
			await expectInstalledExecutables(install);
		});
	}
});

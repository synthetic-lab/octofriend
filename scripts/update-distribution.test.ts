import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDistribution } from "./update-distribution.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("distribution metadata generator", () => {
	test("writes valid Homebrew and Scoop metadata from release checksums", async () => {
		const root = await mkdtemp(join(tmpdir(), "octofriend-distribution-"));
		temporaryDirectories.push(root);
		const assets = join(root, "assets");
		const output = join(root, "output");
		await mkdir(assets);
		const targets = [
			"linux-arm64.tar.gz",
			"linux-x64.tar.gz",
			"macos-arm64.tar.gz",
			"macos-x64.tar.gz",
			"windows-arm64.zip",
			"windows-x64.zip",
		];
		const sums = targets
			.map(
				(target, index) =>
					`${String(index + 1)
						.repeat(64)
						.slice(0, 64)}  octofriend-1.2.3-${target}`,
			)
			.join("\n");
		await writeFile(join(assets, "SHA256SUMS"), `${sums}\n`);

		await generateDistribution({ version: "1.2.3", assets, output });

		const formula = await readFile(
			join(output, "Formula/octofriend.rb"),
			"utf8",
		);
		expect(formula).toContain('version "1.2.3"');
		expect(formula).toContain(
			"releases/download/v1.2.3/octofriend-1.2.3-macos-arm64.tar.gz",
		);
		expect(formula).toContain(`sha256 "${"3".repeat(64)}"`);

		const scoop = JSON.parse(
			await readFile(join(output, "bucket/octofriend.json"), "utf8"),
		);
		expect(scoop.version).toBe("1.2.3");
		expect(scoop.architecture["64bit"].hash).toBe("6".repeat(64));
		expect(scoop.architecture.arm64.hash).toBe("5".repeat(64));
		expect(scoop.bin).toContainEqual(["octofriend.exe", "octo"]);

		const ruby = Bun.which("ruby");
		if (ruby) {
			const syntax = Bun.spawn(
				[ruby, "-c", join(output, "Formula/octofriend.rb")],
				{ stdout: "pipe", stderr: "pipe" },
			);
			expect(await syntax.exited).toBe(0);
		}
	});

	test("fails when a required target checksum is absent", async () => {
		const root = await mkdtemp(join(tmpdir(), "octofriend-distribution-"));
		temporaryDirectories.push(root);
		await writeFile(join(root, "SHA256SUMS"), `${"a".repeat(64)}  unrelated\n`);
		await expect(
			generateDistribution({
				version: "1.2.3",
				assets: root,
				output: join(root, "output"),
			}),
		).rejects.toThrow("Missing checksum");
	});
});

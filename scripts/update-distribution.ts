#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Args = { version: string; assets: string; output: string };

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const NEWLINE_PATTERN = /\r?\n/;
const CHECKSUM_LINE_PATTERN = /^([0-9a-f]{64})\s+\*?(.+)$/;

function args(argv: string[]): Args {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const argument = argv[index];
		const key = argument?.startsWith("--") ? argument.slice(2) : undefined;
		const value = argv[index + 1];
		if (!(key && value))
			throw new Error(
				"Usage: update-distribution --version <version> --assets <directory> [--output <directory>]",
			);
		values.set(key, value);
	}
	const version = values.get("version");
	const assets = values.get("assets");
	if (!(version && assets)) throw new Error("Missing distribution argument");
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`Invalid distribution version: ${version}`);
	}
	return { version, assets, output: values.get("output") ?? "." };
}

function checksums(text: string): Map<string, string> {
	const result = new Map<string, string>();
	for (const line of text.split(NEWLINE_PATTERN)) {
		const match = CHECKSUM_LINE_PATTERN.exec(line.trim());
		if (match?.[1] && match[2]) result.set(match[2], match[1]);
	}
	return result;
}

const input = args(process.argv.slice(2));
const assets = resolve(input.assets);
const output = resolve(input.output);
const sums = checksums(await readFile(resolve(assets, "SHA256SUMS"), "utf8"));
const repo = "https://github.com/xsyetopz/octofriend-next";
const asset = (target: string, extension: string) =>
	`octofriend-${input.version}-${target}.${extension}`;
const hash = (name: string) => {
	const value = sums.get(name);
	if (!value) throw new Error(`Missing checksum for ${name}`);
	return value;
};
const url = (name: string) =>
	`${repo}/releases/download/v${input.version}/${name}`;

const targets = {
	macArm: asset("macos-arm64", "tar.gz"),
	macX64: asset("macos-x64", "tar.gz"),
	linuxArm: asset("linux-arm64", "tar.gz"),
	linuxX64: asset("linux-x64", "tar.gz"),
	winArm: asset("windows-arm64", "zip"),
	winX64: asset("windows-x64", "zip"),
};

const formula = `# Managed by scripts/update-distribution.ts.
class Octofriend < Formula
  desc "Fast coding agent with ACP support"
  homepage "${repo}"
  version "${input.version}"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "${url(targets.macArm)}"
      sha256 "${hash(targets.macArm)}"
    else
      url "${url(targets.macX64)}"
      sha256 "${hash(targets.macX64)}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${url(targets.linuxArm)}"
      sha256 "${hash(targets.linuxArm)}"
    else
      url "${url(targets.linuxX64)}"
      sha256 "${hash(targets.linuxX64)}"
    end
  end

  def install
    bin.install "octofriend", "octofriend-acp", "octofriend-agentd"
    bin.install_symlink "octofriend" => "octo"
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/octofriend --help")
    assert_match %q("jsonrpc":"2.0"), pipe_output("#{bin}/octofriend-agentd", %Q({"jsonrpc":"2.0","id":1,"method":"initialize"}\\n))
  end
end
`;

const scoop = {
	version: input.version,
	description: "Fast coding agent with ACP support",
	homepage: repo,
	license: "MIT",
	architecture: {
		"64bit": {
			url: url(targets.winX64),
			hash: hash(targets.winX64),
			extract_dir: `octofriend-${input.version}-windows-x64`,
		},
		arm64: {
			url: url(targets.winArm),
			hash: hash(targets.winArm),
			extract_dir: `octofriend-${input.version}-windows-arm64`,
		},
	},
	bin: [
		"octofriend.exe",
		["octofriend.exe", "octo"],
		"octofriend-acp.exe",
		"octofriend-agentd.exe",
	],
	checkver: { github: repo },
	autoupdate: {
		architecture: {
			"64bit": {
				url: `${repo}/releases/download/v$version/octofriend-$version-windows-x64.zip`,
				extract_dir: "octofriend-$version-windows-x64",
			},
			arm64: {
				url: `${repo}/releases/download/v$version/octofriend-$version-windows-arm64.zip`,
				extract_dir: "octofriend-$version-windows-arm64",
			},
		},
	},
};

await mkdir(resolve(output, "Formula"), { recursive: true });
await mkdir(resolve(output, "bucket"), { recursive: true });
await writeFile(resolve(output, "Formula/octofriend.rb"), formula);
await writeFile(
	resolve(output, "bucket/octofriend.json"),
	`${JSON.stringify(scoop, null, 2)}\n`,
);
console.log(`Updated Homebrew and Scoop metadata for ${input.version}`);

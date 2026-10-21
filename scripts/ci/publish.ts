// eslint-disable-next-line no-restricted-imports -- CI script, not part of the Octo process
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import { TARGETS } from "../../build-targets.ts";

// Publishes the packages staged by package.ts, platform packages first so the
// `octofriend` shim never points at a package that isn't on the registry yet.
//
// Versions npm already has are skipped rather than treated as an error, so
// re-running a failed release from the GitHub UI picks up where it stopped.
//
// CI-only: runs from .github/workflows/release.yml.

const root = path.join(import.meta.dir, "../..");
const outDir = path.join(root, "dist/npm");

type Staged = { dir: string; name: string; version: string };

const order = [...TARGETS.map(t => `octofriend-${t.name}`), packageJson.name];

// Reading every manifest up front fails before publishing anything if staging
// was skipped, rather than after three platforms are already out.
const staged: Staged[] = order.map(dirName => {
  const dir = path.join(outDir, dirName);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  return { dir, name: manifest.name, version: manifest.version };
});

for (const pkg of staged) {
  if (await isPublished(pkg)) {
    console.log(`${pkg.name}@${pkg.version} is already published; skipping`);
    continue;
  }

  console.log(`Publishing ${pkg.name}@${pkg.version}`);
  run("npm", [
    "publish",
    pkg.dir,
    "--access",
    "public",
    "--ignore-scripts",
    // Keep prereleases off `latest` so `npm install -g octofriend` still
    // resolves to the last stable release.
    "--tag",
    pkg.version.includes("-") ? "next" : "latest",
  ]);
}

async function isPublished(pkg: Staged): Promise<boolean> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`;
  const response = await fetch(url);
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Unexpected npm registry response for ${url}: HTTP ${response.status}`);
  }
  return true;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

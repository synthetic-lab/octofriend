// eslint-disable-next-line no-restricted-imports -- CI script, not part of the Octo process
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import packageJson from "../../package.json" with { type: "json" };

// Decides whether a push to main has something to release, by asking whether
// the push changed package.json's version.
//
// Deliberately nothing but git history: a release has to be visible in the PR
// a reviewer approved. Checking the npm registry instead would mean that
// clicking merge could ship a release even though the diff never touched the
// version, because some earlier release failed partway through. Retrying a
// failed release is what re-running the job is for.
//
// CI-only: runs from .github/workflows/release.yml.

const before = process.env["BEFORE"];
const after = process.env["AFTER"];
if (before == null || after == null) {
  throw new Error("usage: BEFORE=<sha> AFTER=<sha> bun scripts/ci/check-release.ts");
}

const release = packageJsonChanged(before, after);

if (release) {
  console.log(`Releasing ${packageJson.name}@${packageJson.version}`);
} else {
  console.log(
    `package.json unchanged; ${packageJson.name}@${packageJson.version} already released`,
  );
}

const outputs: Record<string, string> = {
  release: String(release),
  version: packageJson.version,
};

const outputFile = process.env["GITHUB_OUTPUT"];
if (outputFile == null) {
  for (const [key, value] of Object.entries(outputs)) {
    console.log(`${key}=${value}`);
  }
} else {
  fs.appendFileSync(
    outputFile,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

function packageJsonChanged(before: string, after: string): boolean {
  const result = spawnSync("git", ["diff", "--quiet", before, after, "--", "package.json"], {
    encoding: "utf8",
  });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff ${before} ${after} failed: ${result.stderr}`);
}

import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import { TARGETS, npmPackageName, type Target } from "../../build-targets.ts";

// Assembles the publishable npm packages under dist/npm/, ready for
// `npm publish <dir>`:
//
// - one package per build target, holding just that target's binary
// - the `octofriend` package, a thin shim whose optionalDependencies pull in
//   whichever of the above matches the host
//
// They are split because a compiled binary is ~100MB, and npm rejects
// tarballs above roughly that size; six of them in one package would be ~600MB
// unpacked. Splitting is also what lets a single install skip five of them:
// npm drops optionalDependencies whose os/cpu/libc don't match.
//
// Releases go through .github/workflows/release.yml, which publishes these
// directories. The repo root's own package.json is the build-time manifest
// (`engines.bun` pins the compiler, `files` covers a source checkout) and is
// deliberately not what gets published.

const root = path.join(import.meta.dir, "../..");
const outDir = path.join(root, "dist/npm");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function writeFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writePackageJson(dir: string, contents: Record<string, unknown>): void {
  writeFile(path.join(dir, "package.json"), JSON.stringify(contents, null, 2) + "\n");
}

/** npm records file modes in the tarball, and the binary has to stay executable. */
function copyFile(from: string, to: string, mode: number = 0o644): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fs.chmodSync(to, mode);
}

function stageTargetPackage(t: Target): string {
  const name = npmPackageName(t);
  const dir = path.join(outDir, `octofriend-${t.name}`);
  const built = path.join(root, "dist", t.name);

  // dist/ is gitignored, so a fresh checkout reaching this point means the
  // build step was skipped rather than that something is subtly wrong.
  if (!fs.existsSync(built)) {
    throw new Error(
      `missing ${path.relative(root, built)}; run \`bun run compile:production -- --all\` first`,
    );
  }

  copyFile(path.join(built, "octo"), path.join(dir, "octo"), 0o755);
  // `sourcemap: "linked"` leaves the map beside the binary rather than
  // embedding it, so stack traces only stay readable if it ships too.
  copyFile(path.join(built, "octo.map"), path.join(dir, "octo.map"));

  writeFile(
    path.join(dir, "README.md"),
    [
      `# ${name}`,
      "",
      `The compiled octofriend binary for \`${t.name}\`. Installed automatically as an`,
      "optional dependency of [`octofriend`](https://www.npmjs.com/package/octofriend);",
      "install that instead of this package.",
      "",
      "The octofriend launcher (bin/octo.sh) finds this package by name, so the",
      "package name and the target directory name must stay in sync.",
      "",
    ].join("\n"),
  );

  writePackageJson(dir, {
    name,
    version: packageJson.version,
    description: `The octofriend binary for ${t.name}`,
    license: packageJson.license,
    repository: packageJson.repository,
    os: [t.platform],
    cpu: [t.arch],
    // npm only understands libc on Linux; darwin packages leave it out.
    ...(t.platform === "linux" ? { libc: [t.musl ? "musl" : "glibc"] } : {}),
    publishConfig: { access: "public" },
  });

  return name;
}

function stageMainPackage(optionalDependencies: Record<string, string>): string {
  const dir = path.join(outDir, packageJson.name);
  copyFile(path.join(root, "bin/octo.sh"), path.join(dir, "bin/octo.sh"), 0o755);
  for (const file of ["README.md", "LICENSE", "CHANGELOG.md"]) {
    copyFile(path.join(root, file), path.join(dir, file));
  }

  writePackageJson(dir, {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    license: packageJson.license,
    repository: packageJson.repository,
    bin: packageJson.bin,
    preferGlobal: true,
    // Every target, pinned exactly: npm installs only the ones whose
    // os/cpu/libc match the host, and the launcher expects a binary from the
    // same release as the shim.
    optionalDependencies,
    publishConfig: { access: "public" },
  });

  return packageJson.name;
}

const optionalDependencies: Record<string, string> = {};
for (const t of TARGETS) {
  optionalDependencies[stageTargetPackage(t)] = packageJson.version;
}
const mainPackage = stageMainPackage(optionalDependencies);

console.log(`Staged ${TARGETS.length + 1} packages in ${path.relative(root, outDir)}/:`);
for (const [name, version] of Object.entries(optionalDependencies)) {
  console.log(`  ${name}@${version}`);
}
console.log(`  ${mainPackage}@${packageJson.version}`);

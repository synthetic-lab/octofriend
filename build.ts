import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "@commander-js/extra-typings";
import { writeMigrationsModule } from "./source/db/migrations.codegen.ts";

// Cross-compile standalone binaries with `bun build --compile`.
//
// Everything the binary needs travels inside the bundle so this works on
// stable bun (no 1.4-only `--asset`):
// - drizzle migrations are baked into source/db/migrations.generated.ts
//   (regenerated here on every compile; migrate.test.ts keeps it fresh).
// - the paintcannon native binding is copied to dist/build-assets/
//   paintcannon.node and embedded by bin.ts via a `with { type: "file" }`
//   import, as is paintcannon-react's package.json (its reconciler locates
//   it at startup to report the renderer version).
//
// Host installs skip foreign-platform bindings via os/cpu/libc restrictions,
// so missing ones are installed on demand with explicit --os/--cpu/--libc
// flags (--no-save, no lockfile changes).
//
// `--bytecode` is intentionally absent: bun's bytecode compilation rejects
// top-level await, which this codebase uses.

const root = import.meta.dir;

type Target = {
  /** Output directory: `dist/<name>/` */
  name: string;
  /** Passed as `compile.target` to Bun.build */
  bunTarget: string;
  /**
   * paintcannon Rust napi-rs binding variant this target needs
   * (@syntheticlab/paintcannon-native-<rustNapiBinding>). Baseline builds use
   * the regular x64 bindings: "baseline" constrains the embedded bun runtime's
   * instruction set, not the napi addon's.
   */
  rustNapiBinding: string;
  platform: string;
  arch: string;
  musl: boolean;
  baseline: boolean;
};

function targets(options: {
  rustNapiBinding: string;
  platform: string;
  arch: string;
  musl?: boolean;
}): Target[] {
  const musl = options.musl ?? false;
  // Baseline builds (no AVX2 requirement) only exist for x64.
  const baselines = options.arch === "x64" ? [false, true] : [false];
  return baselines.map(baseline => {
    const name = [
      options.platform,
      options.arch,
      ...(musl ? ["musl"] : []),
      ...(baseline ? ["baseline"] : []),
    ].join("-");
    return {
      name,
      bunTarget: `bun-${name}`,
      rustNapiBinding: options.rustNapiBinding,
      platform: options.platform,
      arch: options.arch,
      musl,
      baseline,
    };
  });
}

// Every `bun build --compile` target except Windows.
const TARGETS: Target[] = [
  ...targets({ platform: "linux", arch: "x64", rustNapiBinding: "linux-x64-gnu" }),
  ...targets({ platform: "linux", arch: "x64", musl: true, rustNapiBinding: "linux-x64-musl" }),
  ...targets({ platform: "linux", arch: "arm64", rustNapiBinding: "linux-arm64-gnu" }),
  ...targets({
    platform: "linux",
    arch: "arm64",
    musl: true,
    rustNapiBinding: "linux-arm64-musl",
  }),
  ...targets({ platform: "darwin", arch: "x64", rustNapiBinding: "darwin-x64" }),
  ...targets({ platform: "darwin", arch: "arm64", rustNapiBinding: "darwin-arm64" }),
];

function isMuslHost(): boolean {
  if (process.platform !== "linux") return false;
  const libArch = process.arch === "arm64" ? "aarch64" : process.arch;
  return fs.existsSync(`/lib/ld-musl-${libArch}.so.1`);
}

function hostTarget(): Target {
  const musl = isMuslHost();
  const found = TARGETS.find(
    t =>
      t.platform === process.platform && t.arch === process.arch && t.musl === musl && !t.baseline,
  );
  if (found == null) {
    throw new Error(`No build target matches host ${process.platform}/${process.arch}`);
  }
  return found;
}

function rustNapiBindingVersion(binding: string): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "node_modules/paintcannon/package.json"), "utf8"),
  );
  const version = pkg["optionalDependencies"]?.[`@syntheticlab/paintcannon-native-${binding}`];
  if (typeof version !== "string") {
    throw new Error(`paintcannon doesn't publish a native binding for ${binding}`);
  }
  return version;
}

async function ensureRustNapiBinding(t: Target): Promise<string> {
  const bindingName = "paintcannon-native-" + t.rustNapiBinding;
  const dir = path.join(root, "node_modules/@syntheticlab", bindingName);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some(file => file.endsWith(".node"))) {
    return dir;
  }
  const pkg = "@syntheticlab/" + bindingName;
  const version = rustNapiBindingVersion(t.rustNapiBinding);
  console.log("Fetching " + pkg + "@" + version + " (foreign platform)...");
  // Install in a scratch dir so compiling never dirties package.json, bun.lock,
  // or the repo's node_modules beyond the binding directory itself.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "octo-binding-"));
  try {
    fs.writeFileSync(
      path.join(scratch, "package.json"),
      JSON.stringify({ name: "octofriend-binding-fetch", version: "0.0.0" }),
    );
    await run(
      [
        "bun",
        "add",
        "--os=" + t.platform,
        "--cpu=" + t.arch,
        ...(t.platform === "linux" ? ["--libc=" + (t.musl ? "musl" : "glibc")] : []),
        pkg + "@" + version,
      ],
      scratch,
    );
    fs.cpSync(path.join(scratch, "node_modules/@syntheticlab", bindingName), dir, {
      recursive: true,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return dir;
}

async function run(args: string[], cwd = root): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(args.join(" ") + " failed with exit code " + code);
  }
}

new Command()
  .name("compile")
  .description("Compile octofriend into standalone binaries")
  .argument(
    "[targets...]",
    "targets to build; defaults to the host platform.\nAvailable: " +
      TARGETS.map(t => t.name).join(", "),
  )
  .option("--all", "build every target")
  .showHelpAfterError()
  .action(async (targetNames, options) => {
    let selected: Target[];
    if (options.all) {
      selected = TARGETS;
    } else if (targetNames.length > 0) {
      selected = targetNames.map(name => {
        const found = TARGETS.find(t => t.name === name);
        if (found == null) {
          throw new Error('Unknown target "' + name + '"');
        }
        return found;
      });
    } else {
      selected = [hostTarget()];
    }

    if (writeMigrationsModule()) {
      console.log("Regenerated source/db/migrations.generated.ts");
    }

    // Start from a clean slate so stale targets never linger in dist/.
    fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });

    // The embedded binding import in bin.ts resolves to this stable path;
    // staged per target since every platform needs its own .node.
    const stagedBinding = path.join(root, "dist/build-assets/paintcannon.node");
    fs.mkdirSync(path.dirname(stagedBinding), { recursive: true });

    const failed: string[] = [];
    for (const t of selected) {
      const bindingDir = await ensureRustNapiBinding(t);
      const bindingFile = fs.readdirSync(bindingDir).find(file => file.endsWith(".node"));
      if (bindingFile == null) {
        throw new Error("No .node binding in " + bindingDir);
      }
      fs.copyFileSync(path.join(bindingDir, bindingFile), stagedBinding);

      const outdir = path.join(root, "dist", t.name);
      fs.mkdirSync(outdir, { recursive: true });
      const outfile = path.join(outdir, "octo");
      console.log("Building " + path.relative(root, outfile) + " (" + t.bunTarget + ")...");
      try {
        // Keep going when one target fails so the rest of the matrix builds.
        const result = await Bun.build({
          entrypoints: ["./source/cli/bin.ts"],
          compile: {
            target: t.bunTarget as Bun.Build.CompileTarget,
            outfile,
          },
          minify: true,
          sourcemap: "linked",
          // Lets bun-env.ts's isStandaloneExecutable() distinguish compiled
          // binaries from dev runs.
          define: {
            OCTO_STANDALONE_EXECUTABLE: JSON.stringify("true"),
          },
          // Embedded file assets get content hashes in their $bunfs names by
          // default; paintcannon-react's startup walk needs an exact filename.
          naming: { asset: "[name].[ext]" },
        });
        if (!result.success) {
          for (const message of result.logs) console.error(message);
          throw new Error("bun build failed for " + t.name);
        }
      } catch (error) {
        console.error("Failed: " + t.name + " (" + (error as Error).message + ")");
        failed.push(t.name);
      }
    }
    // The staging dir only feeds the build inputs; don't ship it in dist/.
    fs.rmSync(path.dirname(stagedBinding), { recursive: true, force: true });
    if (failed.length > 0) {
      console.error("Failed targets: " + failed.join(", "));
      process.exit(1);
    }
  })
  .parseAsync();

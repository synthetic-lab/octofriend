import fs from "node:fs";
import path from "node:path";
import { Command } from "@commander-js/extra-typings";

// Cross-compile standalone binaries with `bun build --compile`.
//
// Each binary embeds the drizzle migrations, paintcannon-react's package.json
// (its reconciler locates it at startup to report the renderer version), and
// the paintcannon native binding for the target platform. Host installs skip
// foreign-platform bindings via npm's os/cpu/libc restrictions, so missing
// ones are force-installed on demand (--no-save, no lockfile changes).
//
// `--bytecode` is intentionally absent: bun's bytecode compilation rejects
// top-level await, which this codebase uses.

const root = import.meta.dir;

type Target = {
  /** Output directory: `dist/<name>/` */
  name: string;
  /** Passed to `bun build --compile --target` */
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

async function ensureRustNapiBinding(binding: string): Promise<string> {
  const dir = path.join(root, "node_modules/@syntheticlab", "paintcannon-native-" + binding);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some(file => file.endsWith(".node"))) {
    return dir;
  }
  const name = "@syntheticlab/paintcannon-native-" + binding;
  console.log(
    "Fetching " +
      name +
      "@" +
      rustNapiBindingVersion(binding) +
      " (npm skips foreign platforms)...",
  );
  await run([
    "npm",
    "install",
    "--no-save",
    "--package-lock=false",
    "--force",
    name + "@" + rustNapiBindingVersion(binding),
  ]);
  return dir;
}

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd: root, stdout: "inherit", stderr: "inherit" });
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

    // Start from a clean slate so stale targets never linger in dist/.
    fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });

    const failed: string[] = [];
    for (const t of selected) {
      const bindingDir = await ensureRustNapiBinding(t.rustNapiBinding);
      const bindingFile = fs.readdirSync(bindingDir).find(file => file.endsWith(".node"));
      if (bindingFile == null) {
        throw new Error("No .node binding in " + bindingDir);
      }
      // --asset embeds by basename: <dir> lands at /$bunfs/root/<basename>.
      const embeddedBinding = "/$bunfs/root/" + path.basename(bindingDir) + "/" + bindingFile;
      const outdir = path.join(root, "dist", t.name);
      fs.mkdirSync(outdir, { recursive: true });
      const outfile = path.join(outdir, "octo");
      console.log("Building " + path.relative(root, outfile) + " (" + t.bunTarget + ")...");
      try {
        // Not all runtime variants are downloadable for canary bun versions
        // (e.g. baseline); keep going so one missing target doesn't block the rest.
        // The cast covers `compile.assets`: a 1.4-only API not yet present in
        // @types/bun 1.3.x types.
        const result = await Bun.build({
          entrypoints: ["./source/cli/bin.ts"],
          compile: {
            target: t.bunTarget,
            outfile,
            assets: [
              "./drizzle",
              "./" + path.relative(root, bindingDir),
              "./node_modules/paintcannon-react/package.json",
            ],
          },
          minify: true,
          sourcemap: "linked",
          define: {
            OCTO_EMBEDDED_PAINTCANNON_BINDING: JSON.stringify(embeddedBinding),
          },
        } as Parameters<typeof Bun.build>[0]);
        if (!result.success) {
          for (const message of result.logs) console.error(message);
          throw new Error("bun build failed for " + t.name);
        }
      } catch (error) {
        console.error("Failed: " + t.name + " (" + (error as Error).message + ")");
        failed.push(t.name);
      }
    }
    if (failed.length > 0) {
      console.error("Failed targets: " + failed.join(", "));
      process.exit(1);
    }
  })
  .parseAsync();

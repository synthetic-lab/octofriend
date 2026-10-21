// The platform matrix for `bun build --compile`, shared by build.ts and the
// release packaging script so the published packages always match what we
// build.
//
// There are deliberately no `-baseline` targets. Bun's x64 runtime targets
// Nehalem (SSE4.2) and dispatches to AVX2/AVX-512 at runtime, so
// `bun-linux-x64-baseline` produces a byte-identical binary to
// `bun-linux-x64`: the suffix is only accepted for backwards compatibility.
// Building them used to double the size of every x64 artifact, and since
// npm rejects tarballs over ~100MB that forced a two-package split.

export type Target = {
  /** Output directory (`dist/<name>/`) and npm package suffix. */
  name: string;
  /** Passed as `compile.target` to Bun.build. */
  bunTarget: string;
  /**
   * paintcannon Rust napi-rs binding variant this target needs
   * (@syntheticlab/paintcannon-native-<rustNapiBinding>).
   */
  rustNapiBinding: string;
  platform: "linux" | "darwin";
  arch: "x64" | "arm64";
  musl: boolean;
};

function target(options: {
  rustNapiBinding: string;
  platform: "linux" | "darwin";
  arch: "x64" | "arm64";
  musl?: boolean;
}): Target {
  const musl = options.musl ?? false;
  const name = [options.platform, options.arch, ...(musl ? ["musl"] : [])].join("-");
  return {
    name,
    bunTarget: `bun-${name}`,
    rustNapiBinding: options.rustNapiBinding,
    platform: options.platform,
    arch: options.arch,
    musl,
  };
}

// Every `bun build --compile` target except Windows.
export const TARGETS: Target[] = [
  target({ platform: "linux", arch: "x64", rustNapiBinding: "linux-x64-gnu" }),
  target({ platform: "linux", arch: "x64", musl: true, rustNapiBinding: "linux-x64-musl" }),
  target({ platform: "linux", arch: "arm64", rustNapiBinding: "linux-arm64-gnu" }),
  target({ platform: "linux", arch: "arm64", musl: true, rustNapiBinding: "linux-arm64-musl" }),
  target({ platform: "darwin", arch: "x64", rustNapiBinding: "darwin-x64" }),
  target({ platform: "darwin", arch: "arm64", rustNapiBinding: "darwin-arm64" }),
];

/**
 * npm package holding one target's binary. bin/octo.sh resolves these by
 * name, so changing the pattern means changing the shell script too.
 */
export function npmPackageName(t: Target): string {
  return `@syntheticlab/octofriend-${t.name}`;
}

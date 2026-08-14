#!/bin/sh
# Dispatch to the compiled octofriend binary for the user's platform.
#
# Written in POSIX shell so the npm package works on systems without bun,
# node, or even bash installed. Binaries live in dist/<target>/octo; the
# target naming matches build.ts's TARGETS.

set -eu

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *)
    echo "octofriend: unsupported operating system: $os (supported: Linux, macOS)" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64 | amd64) cpu="x64" ;;
  arm64 | aarch64) cpu="arm64" ;;
  *)
    echo "octofriend: unsupported CPU architecture: $arch (supported: x64, arm64)" >&2
    exit 1
    ;;
esac

# libc only varies on Linux; musl systems (Alpine, etc.) need musl binaries.
libc=""
if [ "$platform" = "linux" ]; then
  if [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; then
    libc="-musl"
  fi
fi

# x64 ships "baseline" builds without an AVX2 requirement; older x64 CPUs
# (and Rosetta, which reports x86_64) need those. Prefer the modern build
# when AVX2 is present; when in doubt fall back to baseline, which always runs.
baseline=""
if [ "$cpu" = "x64" ]; then
  if [ "$platform" = "linux" ]; then
    grep -qm1 avx2 /proc/cpuinfo 2>/dev/null || baseline="-baseline"
  else
    sysctl -n machdep.cpu.features 2>/dev/null | grep -q AVX2 || baseline="-baseline"
  fi
fi

# Resolve through any symlinks (npm links this via node_modules/.bin).
script="$0"
while [ -L "$script" ]; do
  target="$(readlink "$script")"
  case "$target" in
    /*) script="$target" ;;
    *) script="$(dirname -- "$script")/$target" ;;
  esac
done
root="$(CDPATH= cd -- "$(dirname -- "$script")/.." && pwd)"

target="${platform}-${cpu}${libc}${baseline}"
exe="$root/dist/$target/octo"
if [ ! -x "$exe" ]; then
  echo "octofriend: no compiled binary for your platform ($target) at $exe" >&2
  exit 1
fi

exec "$exe" "$@"

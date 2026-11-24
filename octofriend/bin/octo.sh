#!/bin/sh
# Dispatch to the compiled octofriend binary for the user's platform.
#
# Written in POSIX shell so the npm package works on systems without bun,
# node, or even bash installed. The target naming matches build.ts's TARGETS;
# binaries come from either a repo checkout (`dist/<target>/octo`) or the
# per-platform npm package `@syntheticlab/octofriend-<target>`.

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

target="${platform}-${cpu}${libc}"

# Resolve through any symlinks (npm links this via node_modules/.bin).
script="$0"
while [ -L "$script" ]; do
  link="$(readlink "$script")"
  case "$link" in
    /*) script="$link" ;;
    *) script="$(dirname -- "$script")/$link" ;;
  esac
done
root="$(CDPATH= cd -- "$(dirname -- "$script")/.." && pwd)"

# dist/ covers repo checkouts and local canary builds. The platform package is
# nested under us for global installs, and a sibling of us for local installs,
# where npm hoists it (and where pnpm's virtual store always puts it).
exe=""
for candidate in \
  "$root/dist/$target/octo" \
  "$root/node_modules/@syntheticlab/octofriend-$target/octo" \
  "$root/../@syntheticlab/octofriend-$target/octo"
do
  if [ -x "$candidate" ]; then
    exe="$candidate"
    break
  fi
done

if [ -z "$exe" ]; then
  echo "octofriend: no compiled binary for your platform ($target)" >&2
  echo "octofriend: reinstall with: npm install -g --omit=dev octofriend" >&2
  exit 1
fi

exec "$exe" "$@"

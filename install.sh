#!/bin/sh
set -eu
REPOSITORY="${OCTO_REPOSITORY:-xsyetopz/octofriend-next}"
INSTALL_DIR="${OCTO_INSTALL_DIR:-${HOME}/.local/bin}"
VERSION="${OCTO_VERSION:-}"
TMP_DIR=""

fail() { printf 'octofriend installer: %s\n' "$*" >&2; exit 1; }
cleanup() { [ -z "$TMP_DIR" ] || [ ! -d "$TMP_DIR" ] || rm -rf "$TMP_DIR"; }
trap cleanup EXIT HUP INT TERM

download() {
	case ${OCTO_DOWNLOADER:-auto} in
		curl)
			command -v curl >/dev/null 2>&1 || fail "curl is required"
			curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2"
			;;
		wget)
			command -v wget >/dev/null 2>&1 || fail "wget is required"
			wget -q --https-only "$1" -O "$2"
			;;
		auto)
			if command -v curl >/dev/null 2>&1; then
				curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2"
			elif command -v wget >/dev/null 2>&1; then
				wget -q --https-only "$1" -O "$2"
			else fail "curl or wget is required"; fi
			;;
		*) fail "OCTO_DOWNLOADER must be auto, curl, or wget" ;;
	esac
}

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t octofriend)
if [ -z "$VERSION" ]; then
	download "https://api.github.com/repos/${REPOSITORY}/releases/latest" "$TMP_DIR/release.json"
	VERSION=$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' "$TMP_DIR/release.json" | head -n 1)
	[ -n "$VERSION" ] || fail "could not determine the latest release"
else VERSION=${VERSION#v}; fi

case $(uname -s) in Darwin) OS=macos ;; Linux) OS=linux ;; *) fail "unsupported operating system: $(uname -s)" ;; esac
case $(uname -m) in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) fail "unsupported architecture: $(uname -m)" ;; esac

NAME="octofriend-${VERSION}-${OS}-${ARCH}"
ASSET="${NAME}.tar.gz"
BASE_URL="https://github.com/${REPOSITORY}/releases/download/v${VERSION}"
download "${BASE_URL}/${ASSET}" "$TMP_DIR/$ASSET"
download "${BASE_URL}/SHA256SUMS" "$TMP_DIR/SHA256SUMS"
EXPECTED=$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP_DIR/SHA256SUMS")
[ -n "$EXPECTED" ] || fail "checksum for $ASSET is missing"
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$TMP_DIR/$ASSET" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$TMP_DIR/$ASSET" | awk '{print $1}')
elif command -v openssl >/dev/null 2>&1; then ACTUAL=$(openssl dgst -sha256 "$TMP_DIR/$ASSET" | awk '{print $NF}')
else fail "sha256sum, shasum, or openssl is required"; fi
[ "$EXPECTED" = "$ACTUAL" ] || fail "checksum mismatch for $ASSET"

tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"
mkdir -p "$INSTALL_DIR"
for executable in octofriend octofriend-acp octofriend-agentd; do
	cp "$TMP_DIR/$NAME/$executable" "$INSTALL_DIR/$executable"
	chmod 755 "$INSTALL_DIR/$executable"
done
cp "$INSTALL_DIR/octofriend" "$INSTALL_DIR/octo"
chmod 755 "$INSTALL_DIR/octo"
printf 'Installed octofriend %s to %s\n' "$VERSION" "$INSTALL_DIR"
case ":${PATH:-}:" in *":$INSTALL_DIR:"*) ;; *) printf 'Add %s to PATH.\n' "$INSTALL_DIR" ;; esac

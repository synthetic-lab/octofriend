# To opt into canary builds, source this file in your .zshrc or .bashrc
# Usage: source /path/to/canary.sh
#
# This creates a canary-octofriend function that runs this checkout directly with
# octofriend_CHANNEL=canary, instead of using the published normal channel.
if [ -n "${ZSH_VERSION-}" ]; then
  _octofriend_DIR="${0:A:h}"
elif [ -n "${BASH_VERSION-}" ]; then
  _octofriend_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  echo "Unsupported shell. Please use bash or zsh."
  return 1
fi

function canary-octofriend() {
  (cd "$_octofriend_DIR" && bun run typecheck) || return 1
  octofriend_CHANNEL=canary bun "$_octofriend_DIR/packages/cli/src/bin.ts" "$@"
}

function canary-octo() {
  canary-octofriend "$@"
}

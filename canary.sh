# To opt into canary builds, source this file in your .zshrc or .bashrc
# Usage: source /path/to/canary.sh
#
# This creates a canary-octofwen function that runs this checkout directly with
# OCTOFWEN_CHANNEL=canary, instead of using the published normal channel.
if [ -n "${ZSH_VERSION-}" ]; then
  _OCTOFWEN_DIR="${0:A:h}"
elif [ -n "${BASH_VERSION-}" ]; then
  _OCTOFWEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  echo "Unsupported shell. Please use bash or zsh."
  return 1
fi

function canary-octofwen() {
  (cd "$_OCTOFWEN_DIR" && bun run typecheck) || return 1
  OCTOFWEN_CHANNEL=canary bun "$_OCTOFWEN_DIR/packages/octofwen-cli/src/bin.ts" "$@"
}

function canary-octo() {
  canary-octofwen "$@"
}

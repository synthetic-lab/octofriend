# To opt into canary builds, source this file in your .zshrc or .bashrc
# Usage: source /path/to/canary.sh
#
# This creates a canary-octo function that will build whatever you have in your
# current octofriend checkout and run it, allowing you to use the main branch
# without waiting for new octo releases, or to use an in-development branch
# easily.
if [ -n "$ZSH_VERSION" ]; then
  _OCTOFRIEND_DIR="${0:A:h}"
elif [ -n "$BASH_VERSION" ]; then
  _OCTOFRIEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  echo "Unsupported shell. Please use bash or zsh."
  return 1
fi

function canary-octo() {
  (cd "$_OCTOFRIEND_DIR" && npm run build) || return 1
  node "$_OCTOFRIEND_DIR/dist/source/cli.js" "$@"
}

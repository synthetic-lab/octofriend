# To opt into canary builds, source this file in your config.fish
# Usage: source /path/to/canary.fish
#
# This creates a canary-octo function that will build whatever you have in your
# current octofriend checkout and run it, allowing you to use the main branch
# without waiting for new octo releases, or to use an in-development branch
# easily.

set -g _OCTOFRIEND_DIR (status dirname)

function canary-octo
    set -gx CANARY_OCTO 1
    bun "$_OCTOFRIEND_DIR/source/cli/cli.tsx" $argv
end

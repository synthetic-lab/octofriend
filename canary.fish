# To opt into canary builds, source this file in your config.fish
# Usage: source /path/to/canary.fish
#
# This creates a canary-octo function that will build whatever you have in your
# current octofriend checkout and run it, allowing you to use the main branch
# without waiting for new octo releases, or to use an in-development branch
# easily.

set -g _OCTOFRIEND_DIR (status dirname)

function canary-octo
    set -l old_dir (pwd)
    cd "$_OCTOFRIEND_DIR"
    if not npm run build
        cd "$old_dir"
        return 1
    end
    cd "$old_dir"
    node "$_OCTOFRIEND_DIR/dist/source/cli.js" $argv
end

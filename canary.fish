# To opt into canary builds, source this file in your config.fish
# Usage: source /path/to/canary.fish
#
# This creates a canary-octo function that compiles a fresh binary from
# whatever you have in your current octofriend checkout and runs it, allowing
# you to use the main branch without waiting for new octo releases, or to use
# an in-development branch easily.

set -g _OCTOFRIEND_DIR (status dirname)

function canary-octo
    set -gx CANARY_OCTO 1
    pushd "$_OCTOFRIEND_DIR" >/dev/null; or return 1
    bun run compile
    set -l compile_status $status
    popd >/dev/null
    if test $compile_status -ne 0
        return $compile_status
    end
    "$_OCTOFRIEND_DIR/bin/octo.sh" $argv
end

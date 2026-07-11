# To opt into canary builds, source this file in your config.fish
# Usage: source /path/to/canary.fish
#
# This creates a canary-octofriend function that runs this checkout directly with
# octofriend_CHANNEL=canary, instead of using the published normal channel.

set -g _octofriend_DIR (status dirname)

function canary-octofriend
    set -l old_dir (pwd)
    cd "$_octofriend_DIR"
    set -l cd_status $status
    if test $cd_status -ne 0
        return $cd_status
    end

    bun run typecheck
    set -l typecheck_status $status
    cd "$old_dir"
    if test $typecheck_status -ne 0
        return $typecheck_status
    end

    set -l had_channel 0
    set -l old_channel
    if set -q octofriend_CHANNEL
        set had_channel 1
        set old_channel $octofriend_CHANNEL
    end

    set -gx octofriend_CHANNEL canary
    bun "$_octofriend_DIR/packages/octofriend-cli/src/bin.ts" $argv
    set -l canary_status $status

    if test "$had_channel" = 1
        set -gx octofriend_CHANNEL $old_channel
    else
        set -e octofriend_CHANNEL
    end

    return $canary_status
end

function canary-octo
    canary-octofriend $argv
end

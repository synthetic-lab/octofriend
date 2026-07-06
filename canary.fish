# To opt into canary builds, source this file in your config.fish
# Usage: source /path/to/canary.fish
#
# This creates a canary-octofwen function that runs this checkout directly with
# OCTOFWEN_CHANNEL=canary, instead of using the published normal channel.

set -g _OCTOFWEN_DIR (status dirname)

function canary-octofwen
    set -l old_dir (pwd)
    cd "$_OCTOFWEN_DIR"
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
    if set -q OCTOFWEN_CHANNEL
        set had_channel 1
        set old_channel $OCTOFWEN_CHANNEL
    end

    set -gx OCTOFWEN_CHANNEL canary
    bun "$_OCTOFWEN_DIR/packages/octofwen-cli/src/bin.ts" $argv
    set -l canary_status $status

    if test "$had_channel" = 1
        set -gx OCTOFWEN_CHANNEL $old_channel
    else
        set -e OCTOFWEN_CHANNEL
    end

    return $canary_status
end

function canary-octo
    canary-octofwen $argv
end

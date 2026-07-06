# To opt into canary builds, dot-source this file in your PowerShell profile
# Usage: . /path/to/canary.ps1
#
# This creates Invoke-CanaryOctofwen and a canary-octo alias that run this
# checkout directly with OCTOFWEN_CHANNEL=canary, instead of using the published
# normal channel.

$script:OctofwenCanaryDir = $PSScriptRoot

function Invoke-CanaryOctofwen {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    Push-Location -LiteralPath $script:OctofwenCanaryDir
    try {
        bun run typecheck
        $typecheckExitCode = $LASTEXITCODE
        if ($typecheckExitCode -ne 0) {
            Write-Error "octofwen canary typecheck failed with exit code $typecheckExitCode" -ErrorAction Stop
        }
    }
    finally {
        Pop-Location
    }

    $previousChannel = $env:OCTOFWEN_CHANNEL
    try {
        $env:OCTOFWEN_CHANNEL = "canary"
        bun (Join-Path $script:OctofwenCanaryDir "packages/octofwen-cli/src/bin.ts") @Arguments
        $canaryExitCode = $LASTEXITCODE
        if ($canaryExitCode -ne 0) {
            Write-Error "octofwen canary command failed with exit code $canaryExitCode" -ErrorAction Stop
        }
    }
    finally {
        if ($null -eq $previousChannel) {
            Remove-Item Env:OCTOFWEN_CHANNEL -ErrorAction SilentlyContinue
        }
        else {
            $env:OCTOFWEN_CHANNEL = $previousChannel
        }
    }
}

function Invoke-CanaryOcto {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    Invoke-CanaryOctofwen @Arguments
}

Set-Alias -Name canary-octo -Value Invoke-CanaryOcto

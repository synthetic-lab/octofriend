# To opt into canary builds, dot-source this file in your PowerShell profile
# Usage: . /path/to/canary.ps1
#
# This creates Invoke-Canaryoctofriend and a canary-octo alias that run this
# checkout directly with octofriend_CHANNEL=canary, instead of using the published
# normal channel.

$script:octofriendCanaryDir = $PSScriptRoot

function Invoke-Canaryoctofriend {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    Push-Location -LiteralPath $script:octofriendCanaryDir
    try {
        bun run typecheck
        $typecheckExitCode = $LASTEXITCODE
        if ($typecheckExitCode -ne 0) {
            Write-Error "octofriend canary typecheck failed with exit code $typecheckExitCode" -ErrorAction Stop
        }
    }
    finally {
        Pop-Location
    }

    $previousChannel = $env:octofriend_CHANNEL
    try {
        $env:octofriend_CHANNEL = "canary"
        bun (Join-Path $script:octofriendCanaryDir "packages/cli/src/bin.ts") @Arguments
        $canaryExitCode = $LASTEXITCODE
        if ($canaryExitCode -ne 0) {
            Write-Error "octofriend canary command failed with exit code $canaryExitCode" -ErrorAction Stop
        }
    }
    finally {
        if ($null -eq $previousChannel) {
            Remove-Item Env:octofriend_CHANNEL -ErrorAction SilentlyContinue
        }
        else {
            $env:octofriend_CHANNEL = $previousChannel
        }
    }
}

function Invoke-CanaryOcto {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    Invoke-Canaryoctofriend @Arguments
}

Set-Alias -Name canary-octo -Value Invoke-CanaryOcto

[CmdletBinding()]
param(
    [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("octofriend-install-test-" + [Guid]::NewGuid().ToString("N"))
$fixture = Join-Path $tempRoot "fixture"
$stage = Join-Path $tempRoot "stage"
$install = Join-Path $tempRoot "install"
$name = "octofriend-1.2.3-windows-x64"
$source = Join-Path $stage $name
$oldArchitecture = $env:PROCESSOR_ARCHITECTURE
$oldWowArchitecture = $env:PROCESSOR_ARCHITEW6432
$oldFixture = $env:OCTO_TEST_FIXTURE
$oldUserPath = [Environment]::GetEnvironmentVariable("Path", "User")

try {
    New-Item -ItemType Directory -Force -Path $fixture, $source, $install | Out-Null
    foreach ($executable in @("octofriend.exe", "octofriend-acp.exe", "octofriend-agentd.exe")) {
        Set-Content -Encoding Ascii -Path (Join-Path $source $executable) -Value $executable
    }
    $archive = Join-Path $fixture "$name.zip"
    Compress-Archive -Path $source -DestinationPath $archive
    $hash = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
    Set-Content -Encoding Ascii -Path (Join-Path $fixture "SHA256SUMS") -Value "$hash  $name.zip"

    $env:OCTO_TEST_FIXTURE = $fixture
    $env:PROCESSOR_ARCHITECTURE = "AMD64"
    $env:PROCESSOR_ARCHITEW6432 = ""
    [Environment]::SetEnvironmentVariable("Path", "$install;$oldUserPath", "User")

    function global:Invoke-WebRequest {
        param(
            [switch]$UseBasicParsing,
            [Parameter(Mandatory = $true)][string]$Uri,
            [Parameter(Mandatory = $true)][string]$OutFile
        )
        if ($Uri.EndsWith("/SHA256SUMS")) {
            Copy-Item -Force (Join-Path $env:OCTO_TEST_FIXTURE "SHA256SUMS") $OutFile
            return
        }
        if ($Uri.EndsWith("/octofriend-1.2.3-windows-x64.zip")) {
            Copy-Item -Force (Join-Path $env:OCTO_TEST_FIXTURE "octofriend-1.2.3-windows-x64.zip") $OutFile
            return
        }
        throw "Unexpected download URI: $Uri"
    }

    & (Join-Path $RepositoryRoot "install.ps1") -Version "1.2.3" -InstallDir $install -Repository "fixture/octofriend"

    foreach ($executable in @("octofriend.exe", "octo.exe", "octofriend-acp.exe", "octofriend-agentd.exe")) {
        $path = Join-Path $install $executable
        if (-not (Test-Path $path)) { throw "Installer did not create $path" }
    }
} finally {
    Remove-Item -ErrorAction SilentlyContinue Function:\global:Invoke-WebRequest
    $env:PROCESSOR_ARCHITECTURE = $oldArchitecture
    $env:PROCESSOR_ARCHITEW6432 = $oldWowArchitecture
    $env:OCTO_TEST_FIXTURE = $oldFixture
    [Environment]::SetEnvironmentVariable("Path", $oldUserPath, "User")
    if (Test-Path $tempRoot) { Remove-Item -Recurse -Force $tempRoot }
}

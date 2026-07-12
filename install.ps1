#requires -version 5.1

[CmdletBinding()]
param(
    [string]$Version = $env:OCTO_VERSION,
    [string]$InstallDir = $env:OCTO_INSTALL_DIR,
    [string]$Repository = $(if ($env:OCTO_REPOSITORY) { $env:OCTO_REPOSITORY } else { "xsyetopz/octofriend-next" })
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\octofriend\bin" }
if ([string]::IsNullOrWhiteSpace($Version)) {
    $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repository/releases/latest"
    $Version = [string]$release.tag_name
}
$Version = $Version.TrimStart("v")
if ($Version -notmatch "^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$") { throw "Invalid octofriend version: $Version" }
$architecture = $env:PROCESSOR_ARCHITEW6432
if ([string]::IsNullOrWhiteSpace($architecture)) { $architecture = $env:PROCESSOR_ARCHITECTURE }
switch ($architecture.ToUpperInvariant()) {
    "AMD64" { $arch = "x64" }
    "ARM64" { $arch = "arm64" }
    default { throw "Unsupported Windows architecture: $architecture" }
}
$name = "octofriend-$Version-windows-$arch"
$asset = "$name.zip"
$baseUrl = "https://github.com/$Repository/releases/download/v$Version"
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("octofriend-" + [Guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $archive = Join-Path $tempDir $asset
    $checksums = Join-Path $tempDir "SHA256SUMS"
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$asset" -OutFile $archive
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHA256SUMS" -OutFile $checksums
    $checksumLine = Get-Content $checksums | Where-Object { $_ -match ("^[0-9a-fA-F]{64}\s+\*?" + [Regex]::Escape($asset) + "$") } | Select-Object -First 1
    if (-not $checksumLine) { throw "Checksum for $asset is missing" }
    $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset" }
    Expand-Archive -Path $archive -DestinationPath $tempDir -Force
    $source = Join-Path $tempDir $name
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    foreach ($executable in @("octofriend.exe", "octofriend-acp.exe", "octofriend-agentd.exe")) {
        Copy-Item -Force (Join-Path $source $executable) (Join-Path $InstallDir $executable)
    }
    Copy-Item -Force (Join-Path $InstallDir "octofriend.exe") (Join-Path $InstallDir "octo.exe")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($entries -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable("Path", ((@($entries) + $InstallDir) -join ";"), "User")
    }
    if (($env:Path -split ";") -notcontains $InstallDir) { $env:Path = "$InstallDir;$env:Path" }
    Write-Host "Installed octofriend $Version to $InstallDir"
}
finally {
    if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
}

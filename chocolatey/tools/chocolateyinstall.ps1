#requires -version 5.1

$ErrorActionPreference = "Stop"
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$architecture = $env:PROCESSOR_ARCHITEW6432
if ([string]::IsNullOrWhiteSpace($architecture)) { $architecture = $env:PROCESSOR_ARCHITECTURE }
switch ($architecture.ToUpperInvariant()) {
    "AMD64" { $arch = "x64" }
    "ARM64" { $arch = "arm64" }
    default { throw "Unsupported Windows architecture: $architecture" }
}
$name = "octofriend-$env:ChocolateyPackageVersion-windows-$arch"
$archive = Join-Path $toolsDir "$name.zip"
if (-not (Test-Path $archive)) { throw "Embedded archive is missing: $archive" }
Get-ChocolateyUnzip -FileFullPath $archive -Destination $toolsDir
$binDir = Join-Path $toolsDir $name
Copy-Item -Force (Join-Path $binDir "octofriend.exe") (Join-Path $binDir "octo.exe")

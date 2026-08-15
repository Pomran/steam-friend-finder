# Steam Friend Finder - Install Native Messaging Host
# Usage: right-click -> Run with PowerShell, or run install.bat
$ErrorActionPreference = 'Stop'

$hostName = 'com.steam.friendfinder'
$root = $PSScriptRoot
$hostCs = Join-Path $root 'host.cs'
$hostExe = Join-Path $root 'host.exe'
$genKey = Join-Path $root 'gen-key.js'

Write-Host '==> Compiling Native Messaging Host...' -ForegroundColor Cyan
$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) {
    Write-Host 'csc.exe not found. Please install .NET Framework 4.x Developer Pack.' -ForegroundColor Red
    exit 1
}

& $csc /nologo "/out:$hostExe" $hostCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $hostExe)) {
    Write-Host 'Compile failed.' -ForegroundColor Red
    exit 1
}
Write-Host "    Created $hostExe"

Write-Host '==> Reading extension ID...' -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $root '..\extension\manifest.json'))) {
    Write-Host 'extension\manifest.json not found. Please run from the project native-host folder.' -ForegroundColor Red
    exit 1
}
$extId = (& node $genKey 2>$null | Select-Object -Last 1).Trim()
if (-not $extId -or $extId.Length -ne 32) {
    Write-Host "Extension ID generation failed: '$extId'" -ForegroundColor Red
    exit 1
}
Write-Host "    Extension ID: $extId"

Write-Host '==> Writing Native Host Manifest...' -ForegroundColor Cyan
$manifestPath = Join-Path $root "$hostName.json"
$manifest = @{
    name = $hostName
    description = 'Steam Friend Finder local Steam status host'
    path = $hostExe
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extId/")
} | ConvertTo-Json -Depth 5

[System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "    Wrote $manifestPath"

Write-Host '==> Registering browser Native Messaging...' -ForegroundColor Cyan
$regRoots = @(
    'Software\Google\Chrome\NativeMessagingHosts',
    'Software\Microsoft\Edge\NativeMessagingHosts'
)

foreach ($regRoot in $regRoots) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("$regRoot\$hostName")
    $key.SetValue('', $manifestPath)
    $key.Close()
    Write-Host "    Registered HKCU:\$regRoot\$hostName"
}

Write-Host ''
Write-Host 'Done! Next steps:' -ForegroundColor Green
Write-Host '  1. Open Edge/Chrome extensions page and reload the unpacked extension (extension subfolder).'
Write-Host '  2. Open https://steam.i-test.top/play (local dev: http://127.0.0.1:8787/play).'
Write-Host '  3. The page should show a "Local Steam" status card. If not, refresh or restart the browser.'
Write-Host ''
Write-Host 'Run uninstall.ps1 to remove the host registration.' -ForegroundColor DarkGray

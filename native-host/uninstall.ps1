# Steam Friend Finder - Uninstall Native Messaging Host
$ErrorActionPreference = 'SilentlyContinue'

$hostName = 'com.steam.friendfinder'
$regRoots = @(
    'Software\Google\Chrome\NativeMessagingHosts',
    'Software\Microsoft\Edge\NativeMessagingHosts'
)

foreach ($regRoot in $regRoots) {
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey("$regRoot\$hostName", $false)
    Write-Host "Removed HKCU:\$regRoot\$hostName"
}

Write-Host 'Done. You can manually delete the native-host folder.'

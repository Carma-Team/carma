# Bring up Expo Metro in tunnel mode (for physical devices on any network).
# The app talks to the live cloud backend, so no local server is needed.

$root = $PSScriptRoot | Split-Path -Parent

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\mobile'; npx expo start --tunnel"

Write-Host ""
Write-Host "CARMA Expo (tunnel) started -> scan the QR code with Expo Go"
Write-Host "The app uses the cloud backend (USE_REAL_SERVER = true in mobile/src/constants/serverConfig.ts)"

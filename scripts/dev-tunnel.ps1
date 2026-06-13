# Bring up mock server + Expo Metro in tunnel mode (for physical devices).
# Opens 2 PowerShell windows. Stop by closing each window or Ctrl-C inside it.

$root = $PSScriptRoot | Split-Path -Parent

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\mock-server\local-server'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\mobile'; npx expo start --tunnel"

Write-Host ""
Write-Host "CARMA tunnel stack started:"
Write-Host "  1) Mock server  -> http://localhost:3000"
Write-Host "  2) Expo (tunnel) -> scan the QR code with Expo Go"
Write-Host ""
Write-Host "Make sure USE_REAL_SERVER = false in mobile/src/constants/serverConfig.ts"

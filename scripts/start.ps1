Set-Location (Join-Path $PSScriptRoot "..")

docker compose up -d --build
Write-Host "PM app running at http://localhost:8000"

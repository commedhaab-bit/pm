Set-Location (Join-Path $PSScriptRoot "..")

$envPath = ".env"
$hasSecret = (Test-Path $envPath) -and (Select-String -Path $envPath -Pattern '^SESSION_SECRET=' -Quiet)
if (-not $hasSecret) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    Add-Content -Path $envPath -Value "`nSESSION_SECRET=$secret"
}

docker compose up -d --build
Write-Host "PM app running at http://localhost:8000"

$ErrorActionPreference = 'Stop'

Write-Host "Starting stable Firebase Hosting deploy..." -ForegroundColor Cyan
$env:FIREBASE_HOSTING_UPLOAD_CONCURRENCY = '1'

firebase deploy --only hosting

Write-Host "Hosting deploy command finished." -ForegroundColor Green

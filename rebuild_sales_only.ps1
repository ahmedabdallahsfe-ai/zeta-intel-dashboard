Set-Location "D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard"

Write-Host "`n=== SALES CACHE CLEAN REBUILD ===" -ForegroundColor Cyan

# 1. Kill any lingering Python processes
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# 2. Clear all checkpoints
@(
    "$env:TEMP\zeta_sales_agg_checkpoint.db",
    "$env:TEMP\zeta_sales_agg_checkpoint.db-wal",
    "$env:TEMP\zeta_sales_agg_checkpoint.db-shm",
    "$env:TEMP\zeta_sales_recon_checkpoint.pkl"
) | ForEach-Object { Remove-Item $_ -Force -ErrorAction SilentlyContinue }
Write-Host "Checkpoints cleared." -ForegroundColor Yellow

# 3. Loop refresh_sales.py until "Sales Aggregation Complete"
$pass = 0
$done = $false

while (-not $done) {
    $pass++
    if ($pass -gt 20) {
        Write-Host "[ERROR] Did not complete after 20 passes." -ForegroundColor Red
        exit 1
    }

    Write-Host "`n-- Sales pass $pass ($(Get-Date -Format 'HH:mm:ss')) --" -ForegroundColor Cyan
    $output = python refresh_sales.py 2>&1
    $exit = $LASTEXITCODE
    Write-Host $output

    if ($exit -ne 0) {
        Write-Host "[ERROR] refresh_sales.py exited $exit" -ForegroundColor Red
        exit 1
    }

    if ($output -match "Sales Aggregation Complete") {
        $done = $true
        Write-Host "`nSales cache rebuilt after $pass pass(es)." -ForegroundColor Green
    }
}

# 4. Verify file timestamp
$f = Get-Item "cache\sales.json"
Write-Host "cache\sales.json last modified: $($f.LastWriteTime)  ($([math]::Round($f.Length/1MB,1)) MB)" -ForegroundColor Cyan

# 5. Git push
Write-Host "`nStaging and pushing..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") { Remove-Item ".git\index.lock" -Force }
git add -f cache/sales.json cache/sales.data.js
git add -A
git commit -m "Auto-refresh: sales cache rebuilt $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main

$local  = git rev-parse HEAD
$remote = git rev-parse origin/main
if ($local -eq $remote) {
    Write-Host "`n=== SUCCESSFULLY PUSHED! ===" -ForegroundColor Green
    Write-Host "commit $($local.Substring(0,7))" -ForegroundColor Green
} else {
    Write-Host "[WARNING] Push may have failed. local=$local remote=$remote" -ForegroundColor Yellow
}

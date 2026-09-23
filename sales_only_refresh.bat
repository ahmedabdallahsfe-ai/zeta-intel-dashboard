@echo off
setlocal EnableDelayedExpansion
REM Sales-only refresh (2026-09-23, Claude): same sales steps as refresh.bat
REM (clean checkpoint, repeat refresh_sales.py until complete, then Customer
REM Analytics + build manifest) but NO git add/commit/push.
cd /d "%~dp0"
set "PYTHON_CMD=python"
where python >nul 2>nul || set "PYTHON_CMD=py"
if exist "%TEMP%\zeta_sales_agg_checkpoint.db"     del /f /q "%TEMP%\zeta_sales_agg_checkpoint.db"     >nul 2>nul
if exist "%TEMP%\zeta_sales_agg_checkpoint.db-wal" del /f /q "%TEMP%\zeta_sales_agg_checkpoint.db-wal" >nul 2>nul
if exist "%TEMP%\zeta_sales_agg_checkpoint.db-shm" del /f /q "%TEMP%\zeta_sales_agg_checkpoint.db-shm" >nul 2>nul
if exist "%TEMP%\zeta_sales_recon_checkpoint.pkl"  del /f /q "%TEMP%\zeta_sales_recon_checkpoint.pkl"  >nul 2>nul
set "SALES_PASS=0"
:sales_pass
set /a SALES_PASS+=1
if !SALES_PASS! GTR 20 ( echo [ERROR] Sales did not finish after 20 passes. & echo SALES_ONLY_FAILED> sales_only_refresh.status & exit /b 1 )
echo -- Sales pass !SALES_PASS! --
%PYTHON_CMD% refresh_sales.py > "%TEMP%\zeta_sales_pass_output.txt" 2>&1
set "SALES_EXIT=!ERRORLEVEL!"
type "%TEMP%\zeta_sales_pass_output.txt"
if not "!SALES_EXIT!"=="0" ( echo [ERROR] Sales Refresh FAILED. & echo SALES_ONLY_FAILED> sales_only_refresh.status & exit /b 1 )
findstr /C:"Sales Aggregation Complete" "%TEMP%\zeta_sales_pass_output.txt" >nul
if errorlevel 1 goto sales_pass
echo Sales complete. Building Customer Analytics...
%PYTHON_CMD% etl\build_customer_analytics_cache.py
%PYTHON_CMD% etl\build_manifest.py
echo SALES_ONLY_DONE> sales_only_refresh.status
echo ============================================================
echo   SALES REFRESH DONE (no GitHub push). You can close this window.
echo ============================================================
exit /b 0

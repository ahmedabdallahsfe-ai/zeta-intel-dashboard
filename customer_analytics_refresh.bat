@echo off
REM Customer Analytics only (2026-09-24, Claude): rebuilds cache\customer_analytics.data.js
REM + build manifest. No sales rebuild, NO git push.
cd /d "%~dp0"
set "PYTHON_CMD=python"
where python >nul 2>nul || set "PYTHON_CMD=py"
if exist customer_analytics_refresh.status del /f /q customer_analytics_refresh.status >nul 2>nul
%PYTHON_CMD% etl\build_customer_analytics_cache.py
if errorlevel 1 ( echo CA_FAILED> customer_analytics_refresh.status & echo [ERROR] Customer Analytics failed. & exit /b 1 )
%PYTHON_CMD% etl\build_manifest.py
echo CA_DONE> customer_analytics_refresh.status
echo ============================================================
echo   CUSTOMER ANALYTICS DONE (no GitHub push). You can close this window.
echo ============================================================
exit /b 0

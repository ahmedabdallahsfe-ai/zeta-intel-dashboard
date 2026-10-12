@echo off
setlocal EnableDelayedExpansion
REM ==========================================================================
REM  UPDATE_DASHBOARD_WITH_COVERAGE.bat  (created 2026-10-12)
REM  Same as UPDATE_DASHBOARD.bat, but ALSO forces the Coverage rebuild
REM  (refresh_all.py --steps coverage). NO-PUSH: it builds locally only and
REM  NEVER publishes. When you are ready, run push_now.bat yourself.
REM ==========================================================================
cd /d "%~dp0"
title Zeta Intel Dashboard - UPDATE WITH COVERAGE

set "PYTHON_CMD=python"
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Python was not found on PATH.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=py"
)

%PYTHON_CMD% -c "import pandas, openpyxl, python_calamine" >nul 2>nul
if errorlevel 1 (
    echo Installing missing Python packages...
    %PYTHON_CMD% -m pip install -r requirements.txt --quiet --disable-pip-version-check
)

echo.
echo ============================================================
echo   Rebuilding data locally (Coverage + everything changed) - NOT pushed
echo   This can take 10-20 minutes. Please wait.
echo ============================================================
%PYTHON_CMD% refresh_all.py --steps coverage --no-push
set "RC=!ERRORLEVEL!"

if not "!RC!"=="0" (
    echo.
    echo ============================================================
    if "!RC!"=="3" (
        echo   STOPPED: an Excel file is still open. Close Excel and run again.
    ) else (
        echo   STOPPED with code !RC! - nothing more was done.
        echo   Report: logs\UPDATE_DASHBOARD_LAST_REPORT.html
    )
    echo ============================================================
    pause
    exit /b !RC!
)

echo.
echo ============================================================
echo   DONE - built locally. NOTHING was sent to GitHub.
echo   When you want it live: double-click push_now.bat (it asks Y/N first).
echo ============================================================
pause
exit /b 0

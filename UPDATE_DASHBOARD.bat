@echo off
setlocal EnableDelayedExpansion
REM ==========================================================================
REM  UPDATE_DASHBOARD.bat  --  the ONE refresh point for the Zeta Intel Dashboard
REM  (created 2026-10-02; engine = refresh_all.py, map = config\refresh_map.json)
REM
REM  Your routine: update any Excel file -> save -> close Excel -> double-click
REM  this file. It detects what changed, rebuilds only what is needed plus
REM  everything downstream, validates, updates the version tags, and pushes to
REM  GitHub only if every critical step passed.
REM
REM  Options (type after the file name, or use the shortcut .bat files):
REM     CHECK     show what would happen, change nothing
REM     NOPUSH    build + validate locally, do not push
REM     FULL      rebuild everything (safety run)
REM     FULL NOPUSH
REM
REM  MANUAL ONLY: nothing runs unless you double-click this file. There is no
REM  scheduled task, folder watcher or background job (decision 2026-10-02).
REM  At the end the update report opens in your browser
REM  (logs\UPDATE_DASHBOARD_LAST_REPORT.html).
REM
REM  refresh.bat is untouched and stays the emergency fallback.
REM ==========================================================================
cd /d "%~dp0"
title Zeta Intel Dashboard - UPDATE

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

set "ARGS="
for %%A in (%*) do (
    if /I "%%~A"=="CHECK"     set "ARGS=!ARGS! --parity"
    if /I "%%~A"=="NOPUSH"    set "ARGS=!ARGS! --no-push"
    if /I "%%~A"=="FULL"      set "ARGS=!ARGS! --full"
    if /I "%%~A"=="YES"       set "ARGS=!ARGS! --yes"
)

%PYTHON_CMD% refresh_all.py !ARGS!
set "RC=!ERRORLEVEL!"

echo.
if "!RC!"=="0" (
    echo ============================================================
    echo   UPDATE_DASHBOARD finished. Report: logs\UPDATE_DASHBOARD_LAST_REPORT.html
    echo ============================================================
) else if "!RC!"=="3" (
    echo ============================================================
    echo   STOPPED: a source workbook is still open in Excel. Close it and run again.
    echo ============================================================
) else if "!RC!"=="2" (
    echo ============================================================
    echo   STOPPED: a critical step failed. NOTHING was pushed. See the messages above.
    echo ============================================================
) else (
    echo ============================================================
    echo   Finished with warnings - NOT pushed. Review logs\UPDATE_DASHBOARD_LAST_REPORT.html
    echo ============================================================
)

pause
exit /b !RC!

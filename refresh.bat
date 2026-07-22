@echo off
setlocal enabledelayedexpansion
REM ==========================================================================
REM refresh.bat
REM Double-click entry point for the Coverage Dashboard.
REM   1) Runs refresh.py (reads the Excel workbook, validates, cleans,
REM      aggregates, writes cache\*.json + cache\*.data.js)
REM   2) On success, opens dashboard.html in Google Chrome
REM      (or the default browser if Chrome isn't found)
REM Never edit the dashboard by running dashboard.html directly after
REM changing the workbook -- always refresh via this script first.
REM ==========================================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   Coverage Dashboard - Refresh
echo ============================================================
echo.

REM --- locate a Python interpreter -----------------------------------------
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Python was not found on PATH.
        echo Install Python 3.10+ from https://www.python.org/downloads/
        echo and make sure "Add python.exe to PATH" is checked during setup.
        echo.
        pause
        exit /b 1
    ) else (
        set "PYTHON_CMD=py"
    )
) else (
    set "PYTHON_CMD=python"
)

REM --- ensure dependencies are installed (fast no-op if already present) --
echo Checking dependencies...
%PYTHON_CMD% -c "import pandas, openpyxl, python_calamine" >nul 2>nul
if errorlevel 1 (
    echo Installing required packages from requirements.txt ...
    %PYTHON_CMD% -m pip install -r requirements.txt --quiet --disable-pip-version-check
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies. Check your internet connection
        echo and Python/pip installation, then try again.
        pause
        exit /b 1
    )
)

REM --- run the ETL / aggregation pipeline ----------------------------------
echo Reading workbook and rebuilding cache...
echo.
%PYTHON_CMD% refresh.py
set "REFRESH_EXIT=%ERRORLEVEL%"

echo.
if not "%REFRESH_EXIT%"=="0" (
    echo ============================================================
    echo   Refresh FAILED - see logs\refresh.log for details
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo ============================================================
echo   Refresh complete - opening dashboard...
echo ============================================================
echo.

REM --- open the dashboard in Chrome (fallback: default browser) -----------
set "DASHBOARD_PATH=%~dp0dashboard.html"

start "" chrome "%DASHBOARD_PATH%" 2>nul
if errorlevel 1 (
    start "" "%DASHBOARD_PATH%"
)

exit /b 0

@echo off
setlocal enabledelayedexpansion
REM ==========================================================================
REM refresh_customer_analytics.bat
REM Double-click entry point for the Customer Health / Customer Channel Mix
REM analytics cache (etl/build_customer_analytics_cache.py).
REM
REM WHY THIS IS SEPARATE FROM refresh.bat: this script reads TWO source
REM files -- TOTAL_SALES_2026.xlsx (Jan-May) AND ZETA SALES_2026\june.xlsx
REM (June) -- and combines them IN MEMORY while building the cache. It does
REM NOT need June physically merged into TOTAL_SALES_2026.xlsx, and in fact
REM that CANNOT be done: TOTAL_SALES_2026.xlsx already has 996,720 rows,
REM and adding June's ~194,000 rows on top would push it past Excel's hard
REM 1,048,576-row-per-sheet limit. Keep June in its own separate file --
REM this script (and refresh_sales.py, for the main Sales cache) already
REM read both files independently and merge the data during processing, no
REM manual Excel merge required.
REM
REM This can take a few minutes on a large source file -- that's normal.
REM ==========================================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   Zeta Customer Analytics Refresh (Customer Health cache)
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

REM --- ensure dependencies are installed ------------------------------------
echo Checking dependencies...
%PYTHON_CMD% -c "import python_calamine" >nul 2>nul
if errorlevel 1 (
    echo Installing required packages...
    %PYTHON_CMD% -m pip install python_calamine --quiet --disable-pip-version-check
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies. Check your internet connection.
        pause
        exit /b 1
    )
)

REM --- confirm the June source file is present ------------------------------
if not exist "ZETA SALES_2026\june.xlsx" (
    echo [WARNING] "ZETA SALES_2026\june.xlsx" was not found.
    echo The cache will be rebuilt from TOTAL_SALES_2026.xlsx only
    echo ^(Jan-May^) -- June will still be missing from Customer Health.
    echo.
)

REM --- run the Customer Analytics ETL --------------------------------------
echo Reading Sales workbooks and building the Customer Health cache...
echo ^(this reads a large file and can take a few minutes -- please wait^)
echo.
%PYTHON_CMD% etl\build_customer_analytics_cache.py
set "ETL_EXIT=%ERRORLEVEL%"

if not "%ETL_EXIT%"=="0" (
    echo ============================================================
    echo   [ERROR] Customer Analytics refresh FAILED
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Customer Analytics cache rebuilt successfully.
echo   cache\customer_analytics.json / .data.js are up to date.
echo ============================================================
echo.
echo NOTE: this only rebuilds the local cache files -- it does NOT
echo commit or push to GitHub. Run refresh.bat afterward (or commit
echo the two customer_analytics cache files yourself) to publish
echo this update alongside your other data.
echo.
pause
exit /b 0

@echo off
setlocal enabledelayedexpansion
REM ==========================================================================
REM refresh.bat
REM Unified double-click entry point for the ZETA Commercial Excellence Dashboard.
REM   1) Runs refresh.py (SFE & Coverage aggregation)
REM   2) Runs refresh_iqvia.py (IQVIA Market Share aggregation)
REM   3) Commits and pushes all data caches and code changes to GitHub Pages
REM   4) Opens dashboard.html in Google Chrome
REM ==========================================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   Zeta Commercial Excellence Dashboard - Unified Refresh
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
%PYTHON_CMD% -c "import pandas, openpyxl, python_calamine" >nul 2>nul
if errorlevel 1 (
    echo Installing required packages from requirements.txt ...
    %PYTHON_CMD% -m pip install -r requirements.txt --quiet --disable-pip-version-check
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies. Check your internet connection.
        pause
        exit /b 1
    )
)

REM --- run the SFE / Coverage Aggregation ----------------------------------
echo Reading SFE ^& Coverage workbooks...
echo.
%PYTHON_CMD% refresh.py
set "REFRESH_EXIT=%ERRORLEVEL%"

if not "%REFRESH_EXIT%"=="0" (
    echo ============================================================
    echo   [ERROR] SFE Refresh FAILED - see logs\refresh.log
    echo ============================================================
    echo.
    pause
    exit /b 1
)

REM --- run the Sales Aggregation ------------------------------------------
echo.
echo Reading Sales workbook...
%PYTHON_CMD% refresh_sales.py
set "SALES_EXIT=%ERRORLEVEL%"

if not "%SALES_EXIT%"=="0" (
    echo ============================================================
    echo   [ERROR] Sales Refresh FAILED
    echo ============================================================
    echo.
    pause
    exit /b 1
)

REM --- run the IQVIA Market Share Aggregation ------------------------------
REM Added 2026-07-28: this step was documented in the header comment above
REM but was never actually wired in -- IQVIA refreshes had to be run and
REM pushed by hand every time. Reads iqvia_source\IQVIA_SOURCE.xlsx (copy it
REM in from wherever IQVIA exports the latest workbook before running this).
echo.
echo Reading IQVIA workbook...
%PYTHON_CMD% refresh_iqvia.py
set "IQVIA_EXIT=%ERRORLEVEL%"

if not "%IQVIA_EXIT%"=="0" (
    echo ============================================================
    echo   [ERROR] IQVIA Refresh FAILED
    echo ============================================================
    echo.
    pause
    exit /b 1
)

REM --- run the Customer Analytics Aggregation ------------------------------
REM Added 2026-08-03: this script's output (cache/customer_analytics.json /
REM .data.js) was already being staged and committed below, but the script
REM that GENERATES those files was never actually called here -- every
REM refresh.bat run since 2026-07-28 silently kept committing a stale
REM Customer Health cache. This is why Line-scoping (Position/SKU columns
REM in the Retail/Chain Pharmacy Customer Health drill) doesn't show up yet
REM even after other refreshes: the cache simply never got rebuilt. Reads
REM TOTAL_SALES_2026.xlsx directly (same source as refresh_sales.py) --
REM see etl\build_customer_analytics_cache.py's own header for why it's a
REM separate script instead of folded into refresh_sales.py.
echo.
echo Reading Customer Analytics workbook...
%PYTHON_CMD% etl\build_customer_analytics_cache.py
set "CUSTANALYTICS_EXIT=%ERRORLEVEL%"

if not "%CUSTANALYTICS_EXIT%"=="0" (
    echo ============================================================
    echo   [ERROR] Customer Analytics Refresh FAILED
    echo ============================================================
    echo.
    pause
    exit /b 1
)

REM --- run the To-Market vs In-Market (TMS/IMS) Aggregation ----------------
REM Revised 2026-07-31: this workspace is embedded as-is via iframe (see
REM js/app.js's renderTomarketTab()) rather than rebuilt into this app's
REM own cache format, so refresh here just calls the original dashboard's
REM own refresh script -- "TO MARKET_IN MARKET\refresh_dashboard.py" --
REM which reads "TMS VS IMS.xlsx" and rewrites that folder's index.html
REM in place. Runs WITHOUT --push (that flag pushes to two separate,
REM unrelated GitHub repos this platform's refresh has nothing to do
REM with -- see that script's own header comment); the regenerated
REM index.html is committed by THIS repo's own push step below instead.
if exist "TO MARKET_IN MARKET\TMS VS IMS.xlsx" (
    echo.
    echo Reading To-Market vs In-Market workbook...
    %PYTHON_CMD% "TO MARKET_IN MARKET\refresh_dashboard.py"
    REM BUG FIX (2026-08-03, found via Ahmed's screenshot: script printed
    REM "Done!" -- fully succeeded -- yet refresh.bat still reported
    REM "[ERROR] ... FAILED" and stopped BEFORE ever reaching the git
    REM commit/push section below. Root cause: this whole block is one
    REM parenthesized `if exist (...)` unit, so %TMSIMS_EXIT% here was
    REM being expanded at PARSE time (before the `set` on the line above
    REM ever ran), not at execution time -- it read as empty, and
    REM `if not ""=="0"` is always true. So this step failed on EVERY
    REM run, silently blocking every push refresh.bat ever attempted,
    REM regardless of whether the Python script itself succeeded. Fixed
    REM by using delayed expansion (!TMSIMS_EXIT!) instead of %...% --
    REM setlocal enabledelayedexpansion is already active at the top of
    REM this file, this block just wasn't using it.
    set "TMSIMS_EXIT=%ERRORLEVEL%"
    if not "!TMSIMS_EXIT!"=="0" (
        echo ============================================================
        echo   [ERROR] To-Market vs In-Market Refresh FAILED
        echo ============================================================
        echo.
        pause
        exit /b 1
    )
) else (
    echo.
    echo [SKIP] "TO MARKET_IN MARKET\TMS VS IMS.xlsx" not found -- skipping To-Market vs In-Market refresh.
)

echo.
echo ============================================================
echo   Refresh complete - pushing to GitHub...
echo ============================================================
echo.

set "GIT_CMD=git"
where git >nul 2>nul
if errorlevel 1 (
    if exist "C:\\Program Files\\Git\\cmd\\git.exe" (
        set "GIT_CMD=C:\\Program Files\\Git\\cmd\\git.exe"
    ) else if exist "C:\\Program Files (x86)\\Git\\cmd\\git.exe" (
        set "GIT_CMD=C:\\Program Files (x86)\\Git\\cmd\\git.exe"
    ) else (
        set "GIT_CMD="
    )
)

if "%GIT_CMD%"=="" (
    echo [WARNING] Git is not installed or not on PATH.
    echo Skipping automatic GitHub push. You can commit and push the 
    echo files in cache/ using GitHub Desktop or manually.
) else (
    echo Staging and committing updated data files...
    "%GIT_CMD%" add -f cache/metadata.data.js
    "%GIT_CMD%" add -f cache/dashboard.data.js
    "%GIT_CMD%" add -f cache/teamkpis.data.js
    "%GIT_CMD%" add -f cache/records.data.js
    "%GIT_CMD%" add -f cache/organogram.data.js
    "%GIT_CMD%" add -f cache/sales.json
    "%GIT_CMD%" add -f cache/sales.data.js
    "%GIT_CMD%" add -f cache/iqvia.json
    "%GIT_CMD%" add -f cache/iqvia.data.js
    REM customer_analytics.json is 140MB+ (exceeds GitHub 100MB limit)
    REM -- only the compressed .data.js version is pushed
    "%GIT_CMD%" add -f cache/customer_analytics.data.js
    "%GIT_CMD%" add "TO MARKET_IN MARKET/index.html"
    "%GIT_CMD%" add assets/*.js
    "%GIT_CMD%" add js/*.js
    "%GIT_CMD%" add css/*.css
    "%GIT_CMD%" add dashboard.html
    REM Added 2026-08-03 ("1 refresh bat to push everything"): the explicit
    REM adds above only ever covered specific cache/js/css/html files -- any
    REM change to refresh.py, refresh_sales.py, refresh_iqvia.py, this batch
    REM file itself, or the etl/ scripts silently never reached GitHub even
    REM though this step ran git commit + push regardless. `git add -A`
    REM picks up everything else (respecting .gitignore, so cache/*.json,
    REM logs/, *.xlsx, and the credential files added to .gitignore this
    REM same day -- .github_token, test_credentials.json, Sync_Report.txt --
    REM all stay excluded exactly as before).
    "%GIT_CMD%" add -A
    "%GIT_CMD%" commit -m "Auto-refresh dashboard data"
    echo Pushing to GitHub repository...
    "%GIT_CMD%" push origin main
    if errorlevel 1 (
        echo [WARNING] Git push failed. Verify your network or credentials.
    ) else (
        echo.
        echo ============================================================
        echo   SUCCESSFULLY PUSHED TO GITHUB PAGES!
        echo   View your online dashboard at:
        echo   https://ahmedabdallahsfe-ai.github.io/zeta-intel-dashboard/dashboard.html
        echo ============================================================
        echo.
    )
)

REM --- open the dashboard in Chrome (fallback: default browser) -----------
set "DASHBOARD_PATH=%~dp0dashboard.html"

start "" chrome "%DASHBOARD_PATH%" 2>nul
if errorlevel 1 (
    start "" "%DASHBOARD_PATH%"
)

exit /b 0

@echo off
setlocal enabledelayedexpansion
REM ==========================================================================
REM push_now.bat
REM
REM Clears stale git lock files, then stages, commits and pushes.
REM
REM WHY THIS EXISTS
REM   Git writes .git\index.lock while it works and deletes it when it is
REM   done. If a git command is interrupted -- Ctrl+C, a crash, a closed
REM   window, or a tool reading the repo over a mounted/networked path that
REM   refuses the delete -- the lock is left behind. Every later `git add`
REM   then fails with:
REM
REM       fatal: Unable to create '...\.git\index.lock': File exists.
REM
REM   refresh.bat only checks the exit code of `git push`, so a failed `add`
REM   and `commit` scroll past silently and the run LOOKS successful: caches
REM   rebuild, Chrome opens, nothing reaches GitHub. That happened on
REM   2026-08-06 and cost a full refresh cycle to diagnose.
REM
REM   Deleting the lock is safe WHEN NO GIT PROCESS IS RUNNING. This script
REM   checks for one first rather than deleting blindly -- removing a live
REM   lock is how an index actually gets corrupted.
REM
REM   Use this when you only changed code (js/css/html) and do not need the
REM   several minutes refresh.bat spends re-reading the workbooks.
REM ==========================================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   Zeta Dashboard - Commit and Push
echo ============================================================
echo.

REM --- locate git -----------------------------------------------------------
set "GIT_CMD=git"
where git >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\Git\cmd\git.exe" (
        set "GIT_CMD=C:\Program Files\Git\cmd\git.exe"
    ) else if exist "C:\Program Files (x86)\Git\cmd\git.exe" (
        set "GIT_CMD=C:\Program Files (x86)\Git\cmd\git.exe"
    ) else (
        echo [ERROR] Git was not found on PATH.
        echo.
        pause
        exit /b 1
    )
)

REM --- clear stale locks ----------------------------------------------------
REM Only safe if nothing is holding them. A running git process means the
REM lock is real and deleting it risks a corrupt index.
tasklist /FI "IMAGENAME eq git.exe" 2>nul | find /I "git.exe" >nul
if not errorlevel 1 (
    echo [ERROR] A git process is currently running.
    echo Close it, wait for it to finish, then run this again.
    echo Do NOT delete the lock while git is working.
    echo.
    pause
    exit /b 1
)

if exist ".git\index.lock" (
    echo Found a stale .git\index.lock - removing it.
    del /f /q ".git\index.lock"
    if exist ".git\index.lock" (
        echo [ERROR] Could not delete .git\index.lock.
        echo Something still has the file open. Close any editor, git GUI,
        echo or antivirus scan touching this folder and try again.
        echo.
        pause
        exit /b 1
    )
    echo Removed.
    echo.
)

REM HEAD.lock blocks commits the same way index.lock blocks staging.
if exist ".git\HEAD.lock" (
    echo Found a stale .git\HEAD.lock - removing it.
    del /f /q ".git\HEAD.lock"
    echo.
)

REM --- show what is about to go ---------------------------------------------
echo Changes to be committed:
echo ------------------------------------------------------------
"%GIT_CMD%" status --short
echo ------------------------------------------------------------
echo.

REM --- stage ----------------------------------------------------------------
REM The cache files need -f because .gitignore line 2 is `cache/` -- git add
REM does not override an ignore rule for files it does not already track.
echo Staging...
"%GIT_CMD%" add -f cache/metadata.data.js       2>nul
"%GIT_CMD%" add -f cache/dashboard.data.js      2>nul
"%GIT_CMD%" add -f cache/teamkpis.data.js       2>nul
"%GIT_CMD%" add -f cache/records.data.js        2>nul
"%GIT_CMD%" add -f cache/organogram.data.js     2>nul
"%GIT_CMD%" add -f cache/sales.json             2>nul
"%GIT_CMD%" add -f cache/sales.data.js          2>nul
"%GIT_CMD%" add -f cache/iqvia.json             2>nul
"%GIT_CMD%" add -f cache/iqvia.data.js          2>nul
"%GIT_CMD%" add -f cache/customer_analytics.data.js 2>nul
"%GIT_CMD%" add -f cache/market_intel.data.js   2>nul
"%GIT_CMD%" add -f cache/tms_ims.data.js        2>nul
"%GIT_CMD%" add -A

if errorlevel 1 (
    echo.
    echo [ERROR] Staging failed. Read the message above - if it mentions
    echo index.lock, a git process is still running.
    echo.
    pause
    exit /b 1
)

REM --- commit ---------------------------------------------------------------
REM An empty commit is not an error worth stopping for: it just means
REM everything was already pushed.
"%GIT_CMD%" diff --cached --quiet
if not errorlevel 1 (
    echo Nothing new to commit - everything is already committed.
    echo Checking whether the branch still needs pushing...
    echo.
    goto :dopush
)

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Dashboard update"

echo Committing: %MSG%
"%GIT_CMD%" commit -m "%MSG%"
if errorlevel 1 (
    echo.
    echo [ERROR] Commit failed - see the message above.
    echo.
    pause
    exit /b 1
)
echo.

:dopush
echo Pushing to GitHub...
"%GIT_CMD%" push origin main
if errorlevel 1 (
    echo.
    echo [ERROR] Push failed. Check your network or credentials.
    echo.
    pause
    exit /b 1
)

REM --- confirm it actually landed -------------------------------------------
REM Comparing local HEAD against the remote is the only real proof. A push
REM that prints nothing and a push that succeeded look identical otherwise.
echo.
for /f %%i in ('"%GIT_CMD%" rev-parse HEAD') do set "LOCAL=%%i"
for /f %%i in ('"%GIT_CMD%" rev-parse origin/main') do set "REMOTE=%%i"

if "!LOCAL!"=="!REMOTE!" (
    echo ============================================================
    echo   PUSHED SUCCESSFULLY
    echo   commit !LOCAL:~0,7!
    echo.
    echo   https://ahmedabdallahsfe-ai.github.io/zeta-intel-dashboard/dashboard.html
    echo.
    echo   GitHub Pages takes 1-2 minutes to rebuild.
    echo   Then hard-refresh the page with Ctrl+Shift+R.
    echo ============================================================
) else (
    echo ============================================================
    echo   [WARNING] Local and remote still differ.
    echo   local  !LOCAL!
    echo   remote !REMOTE!
    echo   The push did not fully land - run this again.
    echo ============================================================
)
echo.
pause
exit /b 0

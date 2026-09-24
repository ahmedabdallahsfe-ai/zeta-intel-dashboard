@echo off
setlocal enabledelayedexpansion
REM ==========================================================================
REM checkpoint_growth_rule.bat  (2026-09-24)
REM One-off checkpoint: commits + pushes the validated working version via the
REM existing push_now.bat (reused, not duplicated), then creates an annotated
REM tag and pushes it. Full output -> checkpoint_growth_rule.log
REM ==========================================================================
cd /d "%~dp0"
set "TAG=mat-aug2026-growth-rule-v1"
set "LOG=Claude outputs\checkpoint_growth_rule.log"
if exist "Claude outputs\checkpoint_growth_rule.status" del /f /q "Claude outputs\checkpoint_growth_rule.status"
echo [%date% %time%] checkpoint start > "%LOG%"
call push_now.bat "Checkpoint: validated MAT Aug-2026 growth rule (unified Fastest/Decliner eligibility, 0.5 pct filtered-market share, prior>0, selected metric; OPELLA like-for-like restatement; IQVIA UI + fixes 2026-09-24)" < nul >> "%LOG%" 2>&1
set "GIT_CMD=git"
where git >nul 2>nul || set "GIT_CMD=C:\Program Files\Git\cmd\git.exe"
echo. >> "%LOG%"
echo === TAG === >> "%LOG%"
"%GIT_CMD%" tag -a %TAG% -m "Validated MAT Aug-2026 Growth Rule version (2026-09-24): unified growth eligibility + OPELLA like-for-like restatement. Validated LCV+SU, raw IQVIA untouched." >> "%LOG%" 2>&1
"%GIT_CMD%" push origin %TAG% >> "%LOG%" 2>&1
echo === VERIFY === >> "%LOG%"
for /f %%i in ('"%GIT_CMD%" rev-parse HEAD') do set "LOCAL=%%i"
for /f %%i in ('"%GIT_CMD%" rev-parse origin/main') do set "REMOTE=%%i"
echo local_head=!LOCAL! >> "%LOG%"
echo origin_main=!REMOTE! >> "%LOG%"
"%GIT_CMD%" rev-parse %TAG%~0 >> "%LOG%" 2>&1
"%GIT_CMD%" ls-remote --tags origin %TAG% >> "%LOG%" 2>&1
"%GIT_CMD%" status --short >> "%LOG%" 2>&1
echo [%date% %time%] checkpoint end >> "%LOG%"
echo DONE > "Claude outputs\checkpoint_growth_rule.status"
echo Checkpoint finished - see Claude outputs\checkpoint_growth_rule.log

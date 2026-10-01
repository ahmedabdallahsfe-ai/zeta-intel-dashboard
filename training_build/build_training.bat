@echo off
setlocal
REM ======================================================================
REM  build_training.bat  -- rebuild the TRAINING dashboard (fake data)
REM  Reads the production caches READ-ONLY and writes ONLY into training\
REM  Run it after refresh.bat whenever you want the training copy to follow
REM  the latest dashboard code/data. It never pushes to GitHub.
REM ======================================================================
cd /d "%~dp0\.."
set "PYTHON_CMD=python"
where python >nul 2>nul || set "PYTHON_CMD=py"
set "NAMES=%TEMP%\zeta_training_names.json"
echo [1/3] Collecting names to replace...
%PYTHON_CMD% training_build\collect_names.py "%NAMES%" dashboard teamkpis organogram working_days coaching list_intel sales customer_analytics || goto fail
echo [2/3] Building fake data caches...
%PYTHON_CMD% training_build\build_training_data.py "%NAMES%" metadata teamkpis organogram working_days coaching auth dashboard list_intel tms_ims market_intel iqvia ims_rx records sales customer_analytics sprint business_review expense_budget regulatory_pipeline egypt_registration news_latest news_archive build_manifest || goto fail
echo [3/3] Copying dashboard code into training\ ...
%PYTHON_CMD% training_build\setup_training_site.py || goto fail
del /f /q "%NAMES%" >nul 2>nul
echo TRAINING_BUILD_DONE> training_build\build_training.status
echo ============================================================
echo   TRAINING DASHBOARD REBUILT (nothing pushed). Close this window.
echo ============================================================
exit /b 0
:fail
del /f /q "%NAMES%" >nul 2>nul
echo TRAINING_BUILD_FAILED> training_build\build_training.status
echo [ERROR] Training build failed -- the production dashboard was not touched.
exit /b 1

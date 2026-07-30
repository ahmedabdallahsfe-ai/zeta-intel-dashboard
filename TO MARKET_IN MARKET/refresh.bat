@echo off
title TMS vs IMS Dashboard Refresh
echo ============================================
echo   TMS vs IMS Dashboard - Data Refresh
echo ============================================
echo.

cd /d "%~dp0"

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Install Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Check if openpyxl is installed
python -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
    echo Installing openpyxl...
    pip install openpyxl
    echo.
)

:: Check if Excel file exists
if not exist "TMS VS IMS.xlsx" (
    echo ERROR: "TMS VS IMS.xlsx" not found in %cd%
    pause
    exit /b 1
)

:: Check if index.html exists
if not exist "index.html" (
    echo ERROR: "index.html" not found in %cd%
    pause
    exit /b 1
)

echo Choose an option:
echo   1. Refresh data only (local)
echo   2. Refresh data + push to GitHub
echo.
set /p choice="Enter 1 or 2: "

if "%choice%"=="2" (
    echo.
    echo Refreshing data and pushing to GitHub...
    python refresh_dashboard.py --push
) else (
    echo.
    echo Refreshing data locally...
    python refresh_dashboard.py
)

echo.
echo ============================================
echo   Refresh complete!
echo ============================================
pause

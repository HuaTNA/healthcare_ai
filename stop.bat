@echo off
title Clinical Tutor - Stopping...
echo ============================================
echo   Clinical Tutor - Stopping Services
echo ============================================
echo.

:: Kill backend (python on port 8000)
echo [1/2] Stopping backend...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      Backend stopped.

:: Kill frontend (node on port 3000)
echo [2/2] Stopping frontend...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
:: Also kill port 3001 in case it fell back
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo      Frontend stopped.

:: Clean up stale lock
if exist "%~dp0frontend\.next\dev\lock" del "%~dp0frontend\.next\dev\lock"

echo.
echo ============================================
echo   All services stopped.
echo ============================================
pause

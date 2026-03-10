@echo off
title Clinical Tutor - Starting...
echo ============================================
echo   Clinical Tutor - AI Teaching Assistant
echo ============================================
echo.

:: Start backend
echo [1/2] Starting FastAPI backend (port 8000)...
start "Clinical Tutor Backend" cmd /k "cd /d %~dp0 && set PYTHONIOENCODING=utf-8 && python api.py"

:: Wait for backend to fully load (data loading takes ~45s)
echo      Waiting for backend to load data (this takes ~45 seconds)...
:wait_backend
timeout /t 5 /nobreak >nul
curl -s http://localhost:8000/api/cases?page=1 >nul 2>&1
if errorlevel 1 (
    echo      Still loading...
    goto wait_backend
)
echo      Backend ready!

:: Start frontend
echo [2/2] Starting Next.js frontend (port 3000)...
start "Clinical Tutor Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

:: Wait for frontend
timeout /t 8 /nobreak >nul

echo.
echo ============================================
echo   Both servers running!
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo ============================================
echo.
echo Opening browser...
start http://localhost:3000

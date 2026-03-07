@echo off
title Clinical Tutor - Starting...
echo ============================================
echo   Clinical Tutor - AI Teaching Assistant
echo ============================================
echo.

:: Start backend
echo [1/2] Starting FastAPI backend (port 8000)...
start "Clinical Tutor Backend" cmd /k "cd /d %~dp0 && set PYTHONIOENCODING=utf-8 && python api.py"

:: Wait for backend to initialize
echo      Waiting for backend to load data...
timeout /t 5 /nobreak >nul

:: Start frontend
echo [2/2] Starting Next.js frontend (port 3000)...
start "Clinical Tutor Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ============================================
echo   Both servers starting!
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000
echo ============================================
echo.
echo Opening browser in 10 seconds...
timeout /t 10 /nobreak >nul
start http://localhost:3000

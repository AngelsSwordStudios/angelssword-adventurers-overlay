@echo off
echo.
echo  ============================================
echo   AS Adventurer — EXE Builder
echo  ============================================
echo.
cd /d "%~dp0"
node build-exe.js
pause

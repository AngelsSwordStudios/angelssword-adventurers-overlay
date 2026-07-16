@echo off
echo.
echo  ============================================
echo   AS Adventurer — Public Release Builder
echo  ============================================
echo.
cd /d "%~dp0"
node build-release.js
pause

@echo off
setlocal

set "NODE_DIR=%~dp0runtime"

:: Use bundled Node.js if available, otherwise try system Node
if exist "%NODE_DIR%\node.exe" (
    set "NODE=%NODE_DIR%\node.exe"
    set "PATH=%NODE_DIR%;%PATH%"
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo.
        echo  Node.js not found! Run setup.bat first.
        echo.
        pause
        exit /b 1
    )
    set "NODE=node"
)

:: Install deps if missing
if not exist "node_modules" (
    echo  Installing dependencies...
    if exist "%NODE_DIR%\npm.cmd" (
        call "%NODE_DIR%\npm.cmd" install --production
    ) else (
        npm install --production
    )
    echo.
)

:: Generate placeholders if no assets
set "HAS_ASSETS=0"
for %%f in (public\assets\neutral_idle.*) do set "HAS_ASSETS=1"
if "%HAS_ASSETS%"=="0" (
    echo  Generating placeholder assets...
    "%NODE%" generate-placeholders.js
    echo.
)

echo.
echo  ============================================
echo   AS Adventurer - Starting...
echo  ============================================
echo.

cd /d "%~dp0"
"%NODE%" server.js
pause

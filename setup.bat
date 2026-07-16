@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   AS Adventurer - First Time Setup
echo  ============================================
echo.
echo  This will download a portable Node.js runtime
echo  and install dependencies. No system install needed.
echo.

set "NODE_VERSION=20.18.0"
set "NODE_DIR=%~dp0runtime"
set "NODE_ZIP=%~dp0runtime\node.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
set "NODE_EXTRACTED=node-v%NODE_VERSION%-win-x64"

:: Check if already set up
if exist "%NODE_DIR%\node.exe" (
    echo  [OK] Node.js runtime already installed.
    echo.
    goto :install_deps
)

:: Create runtime directory
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"

echo  [1/3] Downloading Node.js v%NODE_VERSION% portable...
echo        URL: %NODE_URL%
echo.

:: Try PowerShell download
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -UseBasicParsing }" 2>nul

if not exist "%NODE_ZIP%" (
    echo  [ERROR] Download failed. Please check your internet connection.
    echo.
    pause
    exit /b 1
)

echo  [2/3] Extracting Node.js runtime...

:: Extract using PowerShell
powershell -Command "& { Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%NODE_DIR%' -Force }" 2>nul

:: Move files from nested folder to runtime root
if exist "%NODE_DIR%\%NODE_EXTRACTED%" (
    xcopy /E /Y /Q "%NODE_DIR%\%NODE_EXTRACTED%\*" "%NODE_DIR%\" >nul 2>nul
    rmdir /S /Q "%NODE_DIR%\%NODE_EXTRACTED%" >nul 2>nul
)

:: Clean up zip
del /Q "%NODE_ZIP%" >nul 2>nul

:: Verify
if not exist "%NODE_DIR%\node.exe" (
    echo  [ERROR] Extraction failed. Please try again.
    pause
    exit /b 1
)

echo  [OK] Node.js v%NODE_VERSION% installed to runtime\

:install_deps
echo.
echo  [3/3] Installing dependencies...

:: Use our bundled Node/npm
set "PATH=%NODE_DIR%;%NODE_DIR%\node_modules\npm\bin;%PATH%"
cd /d "%~dp0"
"%NODE_DIR%\npm.cmd" install --production 2>nul
if !errorlevel! neq 0 (
    "%NODE_DIR%\node.exe" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" install --production
)

:: Generate placeholder assets if needed
set "HAS_ASSETS=0"
for %%f in (public\assets\neutral_idle.*) do set "HAS_ASSETS=1"
if "!HAS_ASSETS!"=="0" (
    echo.
    echo  [SETUP] Generating placeholder assets...
    "%NODE_DIR%\node.exe" generate-placeholders.js
)

echo.
echo  ============================================
echo   Setup Complete!
echo  ============================================
echo.
echo   Double-click  start.bat  to run.
echo.
echo   Place your GIF/WEBM assets in:
echo     public\assets\
echo.
pause

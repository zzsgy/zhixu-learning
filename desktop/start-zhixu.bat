@echo off
setlocal
chcp 65001 >nul

REM Always run from the folder that contains this launcher.
cd /d "%~dp0"

REM Keep this window open when Node.js is missing.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required.
  echo Please install Node.js and run this launcher again.
  pause
  exit /b 1
)

REM Keep this window open when dependencies have not been installed.
if not exist "node_modules" (
  echo Installing local document parsers...
  call npm install --cache ".npm-cache"
  if errorlevel 1 (
    echo Installation failed. Check the network and try again.
    pause
    exit /b 1
  )
)

REM Reuse the running service or start a new one.
node --disable-warning=ExperimentalWarning launcher.mjs

REM Show the real error instead of closing the window immediately.
if errorlevel 1 (
  echo.
  echo Zhixu failed to start. Keep this window open and send its error text.
  pause
)
endlocal

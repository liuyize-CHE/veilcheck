@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo VeilCheck could not find Node.js.
  echo Install Node.js 20 or newer from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\tesseract.js\dist\tesseract.min.js" (
  echo.
  echo VeilCheck dependencies are not installed yet.
  echo Open a terminal in this folder and run: pnpm install
  echo.
  pause
  exit /b 1
)

start "VeilCheck Server" /min node server.mjs
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"
endlocal

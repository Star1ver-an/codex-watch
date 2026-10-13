@echo off
:loop
cd /d "%~dp0"
set "NODE=node"
if exist "%LOCALAPPDATA%\hermes\node\node.exe" set "NODE=%LOCALAPPDATA%\hermes\node\node.exe"
"%NODE%" --experimental-sqlite --no-warnings dist\index.js %*
echo bridge exited, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop

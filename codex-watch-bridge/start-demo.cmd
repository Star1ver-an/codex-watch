@echo off
cd /d "%~dp0"
node --experimental-sqlite --no-warnings dist\index.js --demo %*

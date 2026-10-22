@echo off
rem BMM release tool. Interactive menu without arguments; see tools\release\README.md.
rem   tools\release\release.bat --all --version 1.0.4 --yes
setlocal
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required ^(https://nodejs.org^).
  exit /b 2
)
node "%~dp0release.mjs" %*
set CODE=%ERRORLEVEL%
endlocal & exit /b %CODE%

@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\a2578\AppData\Local\Programs\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
rem Double-click entry: stop ONLY the auto Chinese-translation worker.
rem A request in flight finishes first. Collection workers, web, API and the
rem database are never touched. Equivalent to: stop-radar.cmd translate.
rem (Keep this wrapper ASCII-only: Chinese comments here break cmd.exe parsing
rem  at multi-byte buffer boundaries. Chinese guidance lives in the tool output
rem  and in docs/radar/本地运行说明.md -- do not move it back into this file.)
echo.
echo  LightChoice Radar - stop translate
echo  ---------------------------------------------
"%NODE_EXE%" --env-file-if-exists=.env scripts\radar-local.ts stop translate
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (echo  Done. Collection services were not touched.) else echo  Stop incomplete - see the messages above.
echo  Status: status-radar.cmd
echo.
pause
exit /b %CODE%

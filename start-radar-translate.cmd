@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\a2578\AppData\Local\Programs\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
rem Double-click entry: start the managed auto Chinese-translation worker.
rem Equivalent to: start-radar.cmd translate. Same managed safety gates apply:
rem five official/regulatory sources, stored baseline, DB-persisted budget caps.
rem With the budget used up it still starts (checks only) but sends no new paid request.
rem (Keep this wrapper ASCII-only: Chinese comments here break cmd.exe parsing
rem  at multi-byte buffer boundaries. Chinese guidance lives in the tool output
rem  and in docs/radar/本地运行说明.md -- do not move it back into this file.)
echo.
echo  LightChoice Radar - start translate
echo  ---------------------------------------------
"%NODE_EXE%" --env-file-if-exists=.env scripts\radar-local.ts start translate
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo  Start failed - see the messages above.
echo  Status: status-radar.cmd    Stop translate: stop-radar-translate.cmd
echo.
pause
exit /b %CODE%

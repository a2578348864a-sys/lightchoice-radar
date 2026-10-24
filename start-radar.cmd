@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\a2578\AppData\Local\Programs\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
rem 不带参数：只补起数据库 / API / 网页 / 两个采集 Worker，不调用任何付费翻译。
rem 带 translate：额外启动受控的自动中文翻译 Worker（需要用户已单独授权持续付费）。
echo.
echo  LightChoice Radar - start
echo  ---------------------------------------------
"%NODE_EXE%" --env-file-if-exists=.env scripts\radar-local.ts start %*
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo  Some services did not start. See the messages above.
echo  Status: status-radar.cmd    Stop: stop-radar.cmd    Translate: start-radar-translate.cmd
echo.
pause
exit /b %CODE%

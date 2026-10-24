@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\a2578\AppData\Local\Programs\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
rem 不带参数：先停自动翻译，再停两个采集 Worker、网页、API，数据库保留运行。
rem translate：只停自动翻译，采集全部不受影响。
rem all：连数据库一起停。
"%NODE_EXE%" --env-file-if-exists=.env scripts\radar-local.ts stop %*
echo.
pause

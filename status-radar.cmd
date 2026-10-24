@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "NODE_EXE=C:\Users\a2578\AppData\Local\Programs\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
rem 只读查看：数据库 / API / 网页 / 两个采集 Worker / 自动中文翻译（状态、预算、最后成功、最近失败）。
"%NODE_EXE%" --env-file-if-exists=.env scripts\radar-local.ts status
echo.
pause

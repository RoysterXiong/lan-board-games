@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 连珠 · 局域网棋桌

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未检测到 Node.js。
  echo 请先安装 Node.js 18 或更高版本： https://nodejs.org/
  echo.
  pause
  exit /b 1
)

set "AUTO_OPEN=1"
node server.js

if errorlevel 1 (
  echo.
  echo 服务器已退出，请检查上面的错误信息。
  pause
)

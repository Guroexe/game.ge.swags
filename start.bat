@echo off
rem ===== GEN.SWAGS — запуск игры + MP-сервера одним кликом =====
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
) else (
  set "NODE=C:\Users\Guro\AppData\Local\Programs\kimi-desktop\resources\resources\runtime\node.exe"
)

if not exist "%NODE%" if not "%NODE%"=="node" (
  echo [ОШИБКА] Node.js не найден ни в PATH, ни по пути %NODE%
  echo Установите Node.js с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

echo Запуск GEN.SWAGS (HTTP :8080 + HTTPS :8343 + WS :7777)...
"%NODE%" server\start.js
pause

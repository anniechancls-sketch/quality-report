@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动质量数据分析与报告生成工具...
echo.
node src\app\server.js --host 0.0.0.0 --port 8787
pause

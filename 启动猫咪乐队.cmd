@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
 echo 未找到本地分析环境，请按 README.md 安装依赖。
 pause
 exit /b 1
)
".venv\Scripts\python.exe" launch.py
if errorlevel 1 pause

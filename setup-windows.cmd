@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
 echo 未找到 Python Launcher。请安装 Python 3.13，并勾选 Python Launcher 与 Add Python to PATH。
 pause
 exit /b 1
)
py -3.13 --version >nul 2>nul
if errorlevel 1 (
 echo 需要 Python 3.13。请先从 python.org 安装 Python 3.13 后重试。
 pause
 exit /b 1
)
if not exist ".venv\Scripts\python.exe" py -3.13 -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.9.1 torchaudio==2.9.1
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r requirements-local.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install --no-deps basic-pitch==0.4.0
if errorlevel 1 goto failed
echo.
echo 依赖安装完成。现在双击“启动猫咪乐队.cmd”。
pause
exit /b 0
:failed
echo.
echo 安装失败。检查网络连接后重新运行本脚本；也可查看屏幕上的错误信息。
pause
exit /b 1
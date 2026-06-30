@echo off
echo Starting Video Engine Worker...
echo.

REM Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found.
    echo Run: python -m venv venv
    echo Then: venv\Scripts\pip install -r requirements.txt --prefer-binary
    pause
    exit /b 1
)

REM Check if .env exists
if not exist ".env" (
    echo ERROR: .env file not found. Copy .env.template to .env and fill in values.
    pause
    exit /b 1
)

REM Check ffmpeg
where ffmpeg >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo WARNING: ffmpeg not found in PATH. Worker will fail at startup.
    echo Install ffmpeg and add it to PATH.
    pause
    exit /b 1
)

echo ffmpeg found. Starting worker on port 8001...
echo Press Ctrl+C to stop.
echo.
venv\Scripts\python.exe main.py
pause

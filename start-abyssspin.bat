@echo off
cd /d "%~dp0"
start "" http://localhost:8765/
python server.py --host 0.0.0.0
if errorlevel 1 pause

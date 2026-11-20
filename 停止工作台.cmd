@echo off
setlocal
cd /d "%~dp0"
rem Probe standard CPython 3.13 x64; fall back when py is unavailable.
py -3.13 -c "import sys,struct,sysconfig; sys.exit(not (sys.version_info[:2]==(3,13) and struct.calcsize('P')==8 and not sysconfig.get_config_var('Py_GIL_DISABLED')))" >nul 2>nul
if not errorlevel 1 (
  py -3.13 runtime.py stop
) else (
  python runtime.py stop
)
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo Operation failed. Read the error above and the Readme.
if not defined WORKBENCH_NO_PAUSE pause
exit /b %RC%

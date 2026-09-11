@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "VENV=%BACKEND%\.venv"

rem The whole project lives on D: now, but pip/npm still default to the C:
rem user-profile temp dir regardless of project location -- C: has been
rem observed to run out of space, so route temp extraction to D: as a
rem precaution.
set "TMP=D:\tmp"
set "TEMP=D:\tmp"
if not exist "%TMP%" mkdir "%TMP%" >nul 2>&1

echo === HKH Glacier Watch ===
echo.

rem --- Create the backend Python venv if it doesn't exist yet ---
if not exist "%VENV%\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv "%VENV%"
    echo Installing backend dependencies...
    "%VENV%\Scripts\python.exe" -m pip install -q -r "%BACKEND%\requirements.txt"
)

echo Using Python venv: %VENV%

rem --- Install frontend dependencies if missing ---
if not exist "%FRONTEND%\node_modules" (
    echo Installing frontend dependencies...
    pushd "%FRONTEND%"
    call npm install
    popd
)

rem --- Build the frontend (the backend serves this production build) ---
echo Building frontend...
pushd "%FRONTEND%"
call npm run build
popd

rem --- Start the backend server (serves API + built frontend on one port) ---
echo Starting server on http://127.0.0.1:8000 ...
pushd "%BACKEND%"
start "HKH Glacier Watch - server" "%VENV%\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000
popd

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"

echo.
echo Server is running in its own window titled "HKH Glacier Watch - server".
echo Close that window (or Ctrl+C in it) to stop the server.
endlocal

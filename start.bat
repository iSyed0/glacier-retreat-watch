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

rem --- Start LM Studio's API server for the portal assistant (localhost only) ---
rem The assistant's model (google/gemma-4-e2b) runs in LM Studio on this PC.
rem Bound to 127.0.0.1 on purpose: other PCs reach the assistant through the
rem portal backend below, never LM Studio directly. LM Studio itself must be
rem installed and the model downloaded; the backend loads it on first use.
set "LMS=%USERPROFILE%\.lmstudio\bin\lms.exe"
if not exist "%LMS%" (
    echo LM Studio CLI not found -- the portal assistant will be unavailable.
    goto :lmstudio_done
)
echo Starting LM Studio server for the assistant...
"%LMS%" server start --bind 127.0.0.1 --port 1234 >nul 2>&1
if not errorlevel 1 goto :lmstudio_done

rem lms can't always wake LM Studio on its own -- open the app (install path
rem from its uninstall registry entry), give it time to start, then retry.
set "LMSTUDIO_EXE="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$k = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -like 'LM Studio*' | Select-Object -First 1; if ($k) { ($k.DisplayIcon -split ',')[0] }"`) do set "LMSTUDIO_EXE=%%i"
if not defined LMSTUDIO_EXE goto :lmstudio_failed
echo Opening LM Studio...
start "" "%LMSTUDIO_EXE%"
timeout /t 20 /nobreak >nul
"%LMS%" server start --bind 127.0.0.1 --port 1234 >nul 2>&1
if not errorlevel 1 goto :lmstudio_done

:lmstudio_failed
echo WARNING: couldn't start LM Studio's server -- the portal works, but the
echo assistant won't until you open LM Studio and start its server
echo (Developer tab, or: lms server start).
:lmstudio_done

rem --- Free port 8000 ---
rem A portal server left running from an earlier start (possibly bound to
rem localhost only) would make the new one fail to bind -- stop it. Anything
rem else on the port is left alone and reported.
set "PORT_OWNER="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_.OwningProcess); if ($p.CommandLine -like '*uvicorn*app:app*') { Stop-Process -Id $p.ProcessId -Force } else { $p.Name } } | Select-Object -First 1"`) do set "PORT_OWNER=%%i"
if defined PORT_OWNER (
    echo ERROR: port 8000 is in use by %PORT_OWNER% -- close it and run start.bat again.
    pause
    exit /b 1
)

rem --- Firewall: let other PCs on the network reach port 8000 ---
rem scripts\allow_network.ps1 checks for (and fixes) the two things that
rem block them: a missing inbound rule for TCP 8000, and a Windows BLOCK
rem rule for this PC's Python (block rules beat allow rules). Admin rights are
rem only requested -- one UAC prompt -- when something actually needs fixing.
set "NETFIX=%ROOT%scripts\allow_network.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%NETFIX%" -Check
if errorlevel 1 (
    echo Fixing Windows Firewall so other PCs can reach port 8000 -- approve the admin prompt...
    powershell -NoProfile -Command "try { Start-Process powershell -Verb RunAs -Wait -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File ' + [char]34 + $env:NETFIX + [char]34) } catch { exit 1 }"
    powershell -NoProfile -ExecutionPolicy Bypass -File "%NETFIX%" -Check
    if errorlevel 1 (
        echo.
        echo WARNING: Windows Firewall still blocks port 8000 -- the portal will only
        echo open on this PC. Ask an administrator to run, in an admin PowerShell:
        echo   powershell -ExecutionPolicy Bypass -File "%NETFIX%"
        echo.
    ) else (
        echo Firewall fixed.
    )
)

rem --- Start the server: API + built frontend, one process, one port ---
rem Bound to 0.0.0.0 so other PCs on the network can open the portal (and its
rem assistant) at http://<this-pc>:8000.
echo Starting server on port 8000 ...
pushd "%BACKEND%"
start "HKH Glacier Watch - server" "%VENV%\Scripts\python.exe" -m uvicorn app:app --host 0.0.0.0 --port 8000
popd

rem Wait (up to ~30s) until it's actually listening on all interfaces.
powershell -NoProfile -Command "for ($i = 0; $i -lt 30; $i++) { if (Get-NetTCPConnection -LocalPort 8000 -LocalAddress 0.0.0.0 -State Listen -ErrorAction SilentlyContinue) { exit 0 }; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 (
    echo ERROR: the server didn't start -- check the "HKH Glacier Watch - server" window.
    pause
    exit /b 1
)

rem This PC's LAN address (interface with a default gateway), for the
rem "open from another PC" hint below.
set "LAN_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress"`) do set "LAN_IP=%%i"

start "" "http://127.0.0.1:8000"

echo.
echo Server is running in its own window titled "HKH Glacier Watch - server",
echo serving the portal and its API on port 8000:
echo   This PC:      http://127.0.0.1:8000
if defined LAN_IP echo   Other PCs:    http://%LAN_IP%:8000
echo Close that window (or Ctrl+C in it) to stop the server.
endlocal

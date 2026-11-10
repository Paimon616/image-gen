@echo off
chcp 65001 >nul
rem Removes the firewall rule and the logon autostart. Delete this folder afterwards to remove everything.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker.ps1" stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker.ps1" autostart-off
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0firewall.ps1\" -Remove'"
echo 방화벽 규칙을 지웠습니다. 이 폴더를 통째로 삭제하면 끝입니다.
pause

@echo off
"%~dp0bin\node.exe" "%~dp0scripts\updater.cjs"
if errorlevel 1 goto :fail
if exist "%~dp0.update-tmp" (
if exist "%~dp0.update-tmp\new-bin\" (
xcopy /E /I /Y "%~dp0.update-tmp\new-bin\*" "%~dp0bin\"
if errorlevel 1 goto :fail
) else (
if not exist "%~dp0.update-tmp\skip-bin-update" goto :fail
)
if not exist "%~dp0.update-tmp\latest-version" goto :fail
copy /Y "%~dp0.update-tmp\latest-version" "%~dp0.installed-version" >nul
if errorlevel 1 goto :fail
rmdir /s /q "%~dp0.update-tmp" 2>nul
)
echo Update complete.
pause
exit /b 0

:fail
echo Update failed. Restoring the previous installation...
"%~dp0bin\node.exe" "%~dp0scripts\updater.cjs" --rollback
if errorlevel 1 goto :rollback_fail
echo Existing installation is ready. Close every RisuBard console and try again.
pause
exit /b 1

:rollback_fail
echo Automatic rollback failed. Do not delete .update-tmp; it contains the previous installation backup.
pause
exit /b 1

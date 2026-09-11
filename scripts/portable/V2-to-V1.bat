@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title RisuBard V2 to V1 Converter

echo ============================================================
echo RisuBard V2 to V1 Save Converter
echo ============================================================
echo Drag a V2 save folder onto this BAT file,
echo or enter its absolute path below.
echo.

if not "%~1"=="" set "SOURCE=%~1"
if defined SOURCE goto :source_ready

:ask_source
set /p "SOURCE=V2 save folder path: "
set "SOURCE=%SOURCE:"=%"
if not defined SOURCE goto :cancel

:source_ready
if not exist "%SOURCE%\" goto :not_found
echo.
echo Source: "%SOURCE%"
echo Output: "%SOURCE%-v1"
echo The source folder will not be modified.
echo Do not close this window until conversion finishes.
echo.

"%~dp0bin\node.exe" "%~dp0scripts\convert-v2-to-v0925.cjs" "%SOURCE%"
if errorlevel 2 goto :missing
if errorlevel 1 goto :fail
goto :success

:missing
echo.
echo One or more required files are missing.
echo Strict conversion stopped to prevent silent data loss.
echo Recovery mode can skip missing chats, descriptions, and assets.
echo Core layout or index files can never be skipped.
echo.
choice /C YN /N /M "Run recovery mode? [Y/N]: "
if errorlevel 2 goto :fail
echo.
echo Starting recovery mode. Review every WARNING shown below.
echo.
"%~dp0bin\node.exe" "%~dp0scripts\convert-v2-to-v0925.cjs" --skip-missing "%SOURCE%"
if errorlevel 1 goto :fail

:success
echo.
echo Conversion completed successfully.
echo Use the new sibling folder ending in -v1.
pause
exit /b 0

:not_found
echo.
echo ERROR: The V2 save folder does not exist:
echo "%SOURCE%"
goto :fail_pause

:cancel
echo.
echo Conversion cancelled.
pause
exit /b 1

:fail
echo.
echo ERROR: Conversion failed. Review the messages above.

:fail_pause
echo The source folder was not modified.
pause
exit /b 1

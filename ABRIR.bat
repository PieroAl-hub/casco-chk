@echo off
title Detector de Casco - Servidor local
echo.
echo   ===================================
echo      DETECTOR DE CASCO - INICIANDO
echo   ===================================
echo.
echo   Espera 2 segundos y se abrira solo...
echo   Para CERRAR, cierra esta ventana negra.
echo.

start "" http://localhost:8090

"C:\xampp\php\php.exe" -S localhost:8090 -t "%~dp0"

pause

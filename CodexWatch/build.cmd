@echo off
set "JAVA_HOME=C:\Android\jdk-17.0.20.1+1"
set "ANDROID_HOME=C:\Android\Sdk"
cd /d "%~dp0"
call gradlew.bat assembleDebug %*

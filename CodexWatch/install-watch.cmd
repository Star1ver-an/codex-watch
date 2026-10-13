@echo off
set "JAVA_HOME=C:\Android\jdk-17.0.20.1+1"
set "ANDROID_HOME=C:\Android\Sdk"
set "PATH=C:\Android\Sdk\platform-tools;%PATH%"
cd /d "%~dp0"
call gradlew.bat assembleDebug || exit /b 1
adb devices
adb install -r app\build\outputs\apk\debug\app-debug.apk

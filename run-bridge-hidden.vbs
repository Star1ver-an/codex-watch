Option Explicit
Dim shell, fso, bridgeDir, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
bridgeDir = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "codex-watch-bridge")
shell.CurrentDirectory = bridgeDir
command = "cmd.exe /c """ & fso.BuildPath(bridgeDir, "start-bridge.cmd") & """"
shell.Run command, 0, False

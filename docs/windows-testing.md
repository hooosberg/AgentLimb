# Windows 0.2.1 Single-Package Test Checklist

Use a normal, non-administrator Windows account with Chrome and Node.js 18 or later. This procedure validates the intended product flow: one Chrome package, then a compatible local AI terminal bootstraps the Windows runtime after obtaining user approval.

## First install through the onboarding prompt

1. Extract `agentlimb-chrome-v0.2.1.zip`.
2. In `chrome://extensions`, enable Developer mode and load the extracted directory.
3. Open a Codex, Claude Code, WorkBuddy, or equivalent terminal agent with the extracted AgentLimb directory as its working directory.
4. Open AgentLimb's side panel and copy the onboarding prompt into that agent.
5. When it asks for approval to install the local runtime, approve the request.

Expected: the agent detects Windows, finds `scripts\install.ps1` in its current AgentLimb directory, passes the unpacked extension ID to the installer, and does not ask you to download a separate Windows Runtime package.

## Runtime verification

Run these PowerShell commands after the agent reports success:

```powershell
agentlimb status
Invoke-WebRequest "http://127.0.0.1:7791/api/mvp/status" -UseBasicParsing
Get-ScheduledTask -TaskName "AgentLimb Bridge"
Test-Path "$env:LOCALAPPDATA\AgentLimb\native-host\agentlimb-native-host.exe"
```

Expected: the CLI and HTTP checks succeed, the scheduled task is `Ready` or `Running`, and the Native Messaging executable exists.

## Chrome connection

1. Reload the unpacked extension, then reopen its side panel.
2. Copy the onboarding prompt again.
3. Confirm that it reports Windows, uses `%LOCALAPPDATA%\AgentLimb\bin\agentlimb.cmd`, and does not reference `agentlimb-windows-v0.2.1.zip`.
4. Start the agent session and confirm the extension can communicate through the local Bridge.

## Download fallback

Repeat the first-install flow with the terminal agent opened outside the extracted AgentLimb directory. After approval, it should download only the fixed public source tag `v0.2.1`, verify that source's `package.json` version, and run the same installer. It must not download a Windows Runtime zip or accept a URL supplied by a webpage or task.

## Upgrade and restart

Run the same onboarding prompt again, approve installation, then verify:

```powershell
Stop-ScheduledTask -TaskName "AgentLimb Bridge"
Start-ScheduledTask -TaskName "AgentLimb Bridge"
Start-Sleep 2
agentlimb status
```

Expected: reinstall is idempotent, there is no nested `kernel\kernel` directory, and the CLI reconnects after restart.

## Uninstall preview

```powershell
& "$env:LOCALAPPDATA\AgentLimb\scripts\windows\uninstall.ps1" -WhatIf
```

Expected: `-WhatIf` reports the operation without removing files or the scheduled task. Muscle files on the Desktop are always preserved.

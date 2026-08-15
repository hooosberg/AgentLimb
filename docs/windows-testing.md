# Windows 0.2.1-b2 GitHub Runtime Checklist

Use a normal, non-administrator Windows account with Node.js 18 or later and Edge, Chrome, Brave, Vivaldi, Chromium, or another Chromium browser. This validates the same first-run path for Chrome Web Store and offline extension installs: the extension supplies its ID, and an approved terminal agent downloads the matching AgentLimb source archive from the official GitHub version tag.

## First install through the onboarding prompt

1. Install AgentLimb from the Chrome Web Store, or load the released `agentlimb-chrome-v0.2.1-b2.zip` as an unpacked extension.
2. Open the AgentLimb side panel and copy the onboarding prompt into Codex, Claude Code, WorkBuddy, or another terminal-capable agent.
3. Confirm the agent performs only the loopback health check before approval.
4. Approve the requested local Runtime setup.
5. Confirm the agent downloads only the exact `v0.2.1` GitHub source archive URL included in the prompt, extracts it into a temporary directory, and runs `scripts\install.ps1 -ExtensionId <current ID>` from the known repository root.

Expected: the agent does not scan Desktop, Downloads, browser Profiles, extension directories, source repositories, or network shares. It does not use npm, download a separate Runtime zip, or substitute another download URL.

## Runtime verification

Run these PowerShell commands after the agent reports success:

```powershell
agentlimb status
Invoke-WebRequest "http://127.0.0.1:7791/api/mvp/status" -UseBasicParsing
Get-ScheduledTask -TaskName "AgentLimb Bridge"
Test-Path "$env:LOCALAPPDATA\AgentLimb\native-host\agentlimb-native-host.exe"
```

Expected: the CLI and HTTP checks succeed, the scheduled task is `Ready` or `Running`, and the Native Messaging executable exists.

## Browser connection

1. Reload the extension in the browser used for installation, then reopen its side panel.
2. Copy the onboarding prompt again.
3. Confirm it reports an online Bridge and the current extension ID, without mentioning npm, extension package paths, browser Profiles, or source discovery.
4. Start a non-sensitive browser task and confirm the agent can operate the page through the local Bridge.

## Upgrade and restart

Repeat the approved onboarding setup with the same extension version, then verify:

```powershell
Stop-ScheduledTask -TaskName "AgentLimb Bridge"
Start-ScheduledTask -TaskName "AgentLimb Bridge"
Start-Sleep 2
agentlimb status
```

Expected: setup is idempotent, there is no nested `kernel\kernel` directory, and the CLI reconnects after restart.

## Uninstall preview

```powershell
& "$env:LOCALAPPDATA\AgentLimb\scripts\windows\uninstall.ps1" -WhatIf
```

Expected: `-WhatIf` reports the operation without removing files or the scheduled task. Muscle files on the Desktop are always preserved.

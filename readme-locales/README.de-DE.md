<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Hör auf zuzusehen, wie deine KI dieselbe Aufgabe neu lernt.</strong><br>
  Die Open-Source-Alternative zu CoWork — 90% weniger Tokens bei wiederholten Browser-Aufgaben.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Kostenlos_installieren-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Im Chrome Web Store installieren">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>Wenn AgentLimb für dich nützlich ist, bitte ⭐ dieses Repo mit einem Stern versehen — das hilft anderen, das Projekt zu entdecken!</em>
</p>

<p align="center">
  <strong>
    <a href="../README.md">English</a> &nbsp;|&nbsp;
    <a href="./README.zh-CN.md">中文</a> &nbsp;|&nbsp;
    <a href="./README.ja-JP.md">日本語</a> &nbsp;|&nbsp;
    <a href="./README.ko-KR.md">한국어</a> &nbsp;|&nbsp;
    <a href="./README.es-ES.md">Español</a> &nbsp;|&nbsp;
    <a href="./README.fr-FR.md">Français</a> &nbsp;|&nbsp;
    <a href="./README.de-DE.md">Deutsch</a> &nbsp;|&nbsp;
    <a href="./README.pt-BR.md">Português</a> &nbsp;|&nbsp;
    <a href="./README.ru-RU.md">Русский</a> &nbsp;|&nbsp;
    <a href="./README.ar-SA.md">العربية</a> &nbsp;|&nbsp;
    <a href="./README.it-IT.md">Italiano</a> &nbsp;|&nbsp;
    <a href="./README.hi-IN.md">हिन्दी</a>
  </strong>
</p>

<p align="center">
  <img src="../assets/demo.gif" alt="AgentLimb Demo — AI agent controlling the browser" width="720">
</p>

---

## Über

**AgentLimb** ist eine Chrome-Extension — [jetzt im Chrome Web Store verfügbar](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — die jedem KI-Terminal — Claude Code, Cursor, Codex, Trae, Windsurf oder jedem lokalen Modell — ermöglicht, deinen Browser präzise zu steuern. Extension installieren, einen Prompt kopieren, in deine KI einfügen — 10 Sekunden bis zur automatischen Konfiguration.

Kein Headless-Browser. Keine erneute Anmeldung. Keine invasiven Agents. Dein echtes Chrome, deine echten Cookies, deine echten Sitzungen — plus Muskelgedächtnis, das Wiederholungsaufgaben mit jeder Ausführung deutlich günstiger macht.

## Highlights

### 1. Ein-Prompt-Setup

Einen Prompt kopieren, in beliebiges KI-Tool einfügen. Keine Config-Dateien, keine Terminal-Befehle, keine API-Keys. Wenn deine KI Befehle ausführen kann, kann sie AgentLimb nutzen.

### 2. Muskelgedächtnis — 85% weniger Tokens, 80–95% weniger Wartezeit

Beim ersten Besuch einer Seite erkundet die KI das DOM und lernt Selektoren und Workflows. AgentLimb schreibt dieses Wissen nach `~/Desktop/AgentLimb-muscle/<domain>.json`. Jede spätere Ausführung auf derselben Seite überspringt die Erkundung.

Echte Regressionsdaten einer Reddit-Post-Aufgabe (geringer Parameter Codex, 2026-04-18):

| | Kaltstart (erste Erkundung) | Warmstart (Muskel-Abruf) | Einsparung |
|---|---|---|---|
| `page_snapshot`-Aufrufe | 3 | **0** | 100% |
| Werkzeugaufrufe gesamt | 23 | 10 | 56,5% |
| Geschätzte Tokens | ~12.250 | **~1.750** | **↓ 85,7%** |
| Wanduhrzeit | 8–20 Min. | 30 s–2 Min. | **↓ ~80–95%** |

Je öfter eine Seite genutzt wird, desto günstiger wird sie.

### 3. CDP-nativ, kein Screenshot-Raten

AgentLimb steuert den Browser über Chrome Debugger Protocol. Die KI erhält eine strukturierte semantische Liste interaktiver Elemente — keine Screenshots. Klicks treffen den richtigen Knoten, Formulare nutzen native APIs, Navigationen geben sofort die neue URL zurück.

### 4. Expliziter Task-Lebenszyklus

Stille bedeutet nicht länger Erfolg. Die KI deklariert explizit `task_plan` → `task_step_done` → `task_complete` / `task_fail`. Timeouts und Bridge-Abbrüche werden als echte Fehler erfasst. Das Seitenpanel zeigt die Live-Schritt-Liste in Echtzeit.

### 5. 100% Lokal & Privat

Bridge läuft auf `127.0.0.1:7791`. Keine Analytik, kein Tracking, keine Cloud. Muskelwissen liegt als einfaches JSON auf deinem Desktop — du kannst es jederzeit lesen, vergleichen, teilen oder löschen.

## Funktionsweise

```
Dein KI-Terminal  (Claude Code / Cursor / Codex / Trae / Windsurf / lokales Modell)
    ↕  HTTP + SSE  (16 standardisierte Werkzeuge, auto-auffindbar via /docs-Endpunkte)
AgentLimb Bridge  (lokales Node.js · 127.0.0.1:7791)
    ↕  chrome.runtime-Nachrichtenübermittlung
AgentLimb Extension  (Chrome MV3 · Seitenpanel-UI · Task/Muskel/Log-Tabs)
    ↕  Chrome Debugger Protocol
Dein Browser  (eingeloggt, mit Cookies, deine echten Sitzungen)
    ↓  Wissen wird gespeichert
~/Desktop/AgentLimb-muscle/<domain>.json  (dauerhaft, menschenlesbar)
```

## Schnellstart

1. **Installieren** — Zwei Optionen:
   - **Chrome Web Store** (empfohlen): [AgentLimb installieren](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — ein Klick, automatische Updates
   - **Manuell (aktueller Build)**: [Neuestes zip herunterladen](https://github.com/hooosberg/AgentLimb/releases/latest), entpacken, `chrome://extensions` öffnen, **Entwicklermodus** aktivieren, **Entpackte Extension laden** klicken
2. **Kopieren** — Seitenpanel öffnen, „Onboarding-Prompt kopieren" klicken
3. **Einfügen** — In beliebiges KI-Terminal einfügen. Es verbindet sich automatisch, ruft das Tool-Schema ab und beginnt zu arbeiten

## Werkzeugset — 16 Werkzeuge

16 standardisierte Werkzeuge in fünf Kategorien: Browser-Zustand beobachten, auf Seitenelemente navigieren und interagieren, Muskelgedächtnis lesen und schreiben, Task-Lebenszyklus deklarieren und Bridge-Konnektivität aufrechterhalten. Die vollständige Dokumentation wird on demand vom Bridge bereitgestellt — die KI ruft Schemata nur bei Bedarf ab.

## Warum nicht einfach X nutzen?

Jeder bestehende Ansatz zur Browser-Automatisierung hat reale Kosten. Hier der ehrliche Vergleich:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **Einrichtung** | Skripte schreiben, Abhängigkeiten verwalten, Headless-Modus handhaben | SaaS-Konfiguration, pro Workflow einzeln | Nur Mac (braucht Desktop-Umgebung), Sandbox erforderlich | Einen Prompt kopieren. Fertig |
| **Element-Erkennung** | CSS/XPath — du schreibst und pflegst sie | Visuelle KI-Erkennung — instabil bei Updates | Screenshot-Koordinaten — ±1px kann das Ziel verfehlen | CDP liest das Live-DOM — semantisch, präzise |
| **Token-Kosten pro Aktion** | Keine (reines Skript) | Cloud-Gebühren + KI-Tokens | 1.000–3.000 Tokens/Screenshot × jeder Schritt | ~300 Tokens/Schritt, Warmstart: **85,7 % weniger** |
| **Kosten für wiederholte Aufgaben** | Konstant (Skript läuft erneut) | Linear — pro Ausführung abgerechnet | Linear — erkundet jedes Mal neu, kein Gedächtnis | **Sinkend** — Muskelgedächtnis summiert sich |
| **Login-Sitzungen** | Zusätzliches Cookie-/Sitzungs-Setup | Cloud — kann deine lokalen Sitzungen nicht nutzen | OS-Ebene, kennt den Browser-Status nicht | Dein echtes Chrome — schon eingeloggt |
| **Wenn die Seite sich ändert** | Selektoren brechen — Skripte neu schreiben | Das visuelle Modell kann sich unbemerkt verschlechtern | Screenshot-Inferenz passt sich an, aber teuer | KI erkennt die Abweichung, findet einen neuen Selektor, heilt den Muskel selbst |
| **Datenschutz** | Lokal ✅ | Über Drittanbieter-Server ❌ | Lokal ✅ | 100% lokal — nur 127.0.0.1 ✅ |
| **KI-Terminal-Auswahl** | Beliebig (reines Skript) | Je nach Plattform | Gebündelt mit Codex / Claude | Jede KI, die HTTP spricht |
| **Gemeinsames Wissen** | Skript = an eine KI gebunden | Workflow = an Plattform gebunden | Kein dauerhaftes Gedächtnis | Muskeldateien = KI-übergreifend, übertragbar, dauerhaft |

**Das Alleinstellungsmerkmal**: AgentLimbs Muskeldateien liegen als reines JSON in `~/Desktop/AgentLimb-muscle/`. Wissen, das Claude Code heute erkundet, steht Codex morgen zur Verfügung — gleiche Dateien, null Neu-Erkundung. Wechsle KI-Tools, ohne einen einzigen gelernten Workflow zu verlieren.

## Anwendungsfälle

- **Marketing** — Beiträge in sozialen Medien veröffentlichen, Kampagnen plattformübergreifend verwalten
- **Recherche** — Daten scrapen, Produkte vergleichen, Wettbewerbsinformationen sammeln
- **Automatisierung** — Formulare ausfüllen, Bewerbungen einreichen, Profile aktualisieren
- **Tests** — Web-App in echtem Browser mit echten Sitzungen QA-testen

## Designphilosophie

- **Minimale Oberfläche** — 16 Werkzeuge, jedes tut eine Sache gut, kombinierbar über jeden Workflow
- **Nicht-invasiv** — arbeitet in deinem echten Browser, nicht in einer Sandbox
- **Local-first** — Privatsphäre durch Architektur, nicht durch Versprechen
- **KI-agnostisch** — jedes Tool, das HTTP senden kann, kann verbinden; kein Vendor-Lock-in

## Ressourcen

- **Website**: [agentlimb.com](https://agentlimb.com)
- **Tutorials**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **KI-Tools-Verzeichnis**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **News**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Datenschutzrichtlinie**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Nutzungsbedingungen**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **Lizenz**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Kontakt

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **E-Mail**: [zikedece@proton.me](mailto:zikedece@proton.me)

## Weitere Projekte

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>KI-Schreibbegleiter</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>Visueller KI-Prompt-Generator</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>App-Store-Screenshots</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>3D-Trail-Geschichten</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>Design-Protokollschicht</sub>
      </a>
    </td>
  </tr>
</table>

## Lizenz

[Business Source License 1.1](../LICENSE) — Kostenlos für Privatnutzung. Kommerzielle Nutzung erfordert eine Lizenz. Wird am 2030-04-12 zu Apache 2.0.

Copyright © 2025 hooosberg. Alle Rechte vorbehalten.

---
title: "Beliebiges KI-Tool verbinden"
date: "2026-04-18"
tag: "Erste Schritte"
icon: "🔌"
description: "Claude Code, Codex, Cursor, lokale Modelle – ein Prompt verbindet sie alle. Keine spezielle Einrichtung erforderlich."
readTime: "3 Min."
difficulty: "Einsteiger"
---

## Ein Prompt, jede KI

AgentLimb muss nicht in deinem KI-Tool installiert werden. Es erfordert keine Konfiguration in Claude Code, Cursor oder Codex. Die Verbindung wird vollständig über den Prompt hergestellt, den du einfügst.

Kopiere den Prompt aus dem AgentLimb-Seitenpanel. Füge ihn in dein KI-Tool ein. Deine KI liest ihn, verbindet sich mit der Bridge auf deinem Computer und ist sofort bereit, den Browser zu steuern.

---

## Unterstützte KI-Tools

**Claude Code** — Füge den Prompt zu Beginn einer Session ein. Claude liest die Umgebungsdetails und verbindet sich automatisch.

**Codex** — Füge den Prompt ein. Codex verbindet sich und beginnt zu arbeiten.

**Cursor** — Füge ihn im Chat-Fenster ein. Funktioniert im Agent-Modus ohne zusätzliche Konfiguration.

**Windsurf, Trae** — Wie Cursor. Einfügen und loslegen.

**Lokale KI-Modelle (Ollama, LM Studio, etc.)** — Funktioniert mit jedem Modell, das Tool-Nutzung unterstützt. Kleinere Modelle eignen sich gut für einfachere Aufgaben.

**Jedes andere KI-Tool** — Wenn deine KI Anweisungen folgen und externe Tools nutzen kann, funktioniert sie mit AgentLimb. Die Verbindung ist standard HTTP, das universellste Format.

---

## Zwischen KI-Tools wechseln

Du kannst verschiedene KI-Tools für verschiedene Aufgaben verwenden oder mitten im Projekt wechseln. Das Wissen, das deine KI angesammelt hat, gehört keinem bestimmten Tool – es lebt in den Gedächtnisdateien auf deinem Desktop.

Wenn Claude Code gestern Reddit erkundet hat, kann Codex dieses Wissen heute nutzen. Wechsle KI-Tools wann immer du möchtest, ohne erlernte Workflows zu verlieren.

---

## Der Prompt aktualisiert sich automatisch

Jedes Mal, wenn du im Seitenpanel auf „Prompt kopieren" klickst, spiegelt der Prompt den aktuellen Zustand wider: welche Websites deine KI gelernt hat, ob die Bridge verbunden ist und die vollständige Liste verfügbarer Tools. Kopiere ihn bei jeder neuen Session frisch für die genauesten Informationen.

---

## Was deine KI tun kann

Einmal verbunden, hat deine KI Zugriff auf 16 Tools zur Browser-Steuerung:

- **Lesen** — Sehen, was auf der aktuellen Seite ist, welche Tabs offen sind, die aktuelle URL
- **Navigieren** — Zu jeder URL gehen, zurückgehen, vorwärts gehen
- **Klicken und tippen** — Buttons klicken, Formulare ausfüllen, scrollen, Screenshots machen
- **Warten** — Warten, bis eine Seite lädt, warten, bis ein Element erscheint
- **Gedächtnis** — Gespeichertes Wissen über jede Website lesen und aktualisieren

Deine KI kombiniert diese Tools, um jede Aufgabe zu erledigen, in welcher Reihenfolge auch immer es sinnvoll ist.

---

## Fehlerbehebung

**KI sagt, sie kann keine Verbindung herstellen:** Stelle sicher, dass die Bridge läuft. Öffne das AgentLimb-Seitenpanel – wenn du ein grünes „Verbunden"-Badge siehst, ist die Bridge aktiv. Falls nicht, starte sie aus dem Extension-Ordner.

**KI scheint verwirrt über verfügbare Tools:** Kopiere einen frischen Prompt aus dem Seitenpanel und füge ihn erneut ein. Der neue Prompt enthält die aktuellste Tool-Liste und Verbindungsdetails.

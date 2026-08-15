---
title: "Multi-Account-Parallelsteuerung: Ein Befehl, alle Profile gleichzeitig"
date: "2026-04-20"
tag: "Neu in v0.1.3"
icon: "👥"
description: "Führe eine KI-Aufgabe gleichzeitig auf mehreren Chrome-Profilen aus. Verschiedene Konten, derselbe Befehl — jedes Profil hat seine eigene Identität, Fenster-Lock und kann unabhängig pausiert werden."
readTime: "8 Min"
difficulty: "Fortgeschritten"
---

## Was Diese Funktion Tut

AgentLimb v0.1.3 ermöglicht es deiner KI, mehrere Chrome-Profile gleichzeitig zu steuern — parallel, mit einem einzigen Befehl.

Wenn du drei Twitter-Konten, zwei Unternehmens-Google-Workspace-Logins oder ein Dutzend Testprofile hast, musst du dieselbe Aufgabe nicht mehr dreimal ausführen. Eine Anweisung erreicht gleichzeitig alle geöffneten Seitenpanels.

Jedes Profil:
- Zeigt eine **explizite Identität** im Seitenpanel-Header (z. B. `Profile-a3f2`)
- Sperrt KI-Aktionen automatisch auf das **richtige Chrome-Fenster**
- Kann **unabhängig pausiert** werden, ohne andere zu stoppen
- Empfängt den **vollständigen Aufgaben-Lebenszyklus** — Plan, Schrittaktualisierungen und das endgültige Ergebnis

---

## Einrichtung

Du musst nichts Neues konfigurieren. Das Multi-Profil-Verhalten ist automatisch, solange du mehr als ein Seitenpanel geöffnet hast.

**Schritt 1 — Erstelle mehrere Chrome-Profile**

Chrome öffnen → Profilavatar klicken → **Hinzufügen** → so viele Profile erstellen wie nötig. Jedes Profil hat eigene Cookies, Sitzungen und Login-Status.

**Schritt 2 — Seitenpanel in jedem Profil öffnen**

Klicke in jedem Chrome-Profilfenster auf das AgentLimb-Symbol oder öffne das Seitenpanel über das Erweiterungsmenü. Im Header jedes Panels sollte das Identitätslabel des Profils erscheinen.

**Schritt 3 — KI verbinden**

Kopiere den Onboard-Prompt aus einem beliebigen Seitenpanel und füge ihn in dein KI-Terminal ein. Der Bridge erkennt automatisch alle verbundenen Profile.

Das war's. Deine KI ist jetzt mit allen geöffneten Profilen verbunden.

---

## Eine Aufgabe auf Allen Profilen Ausführen

Gib deiner KI wie gewohnt eine einzelne Anweisung. Zum Beispiel:

> Veröffentliche "Unser neues Feature ist live — schau es dir auf agentlimb.com an" auf Twitter.

Die KI wird:
1. Einen `task_plan` deklarieren — alle Seitenpanels zeigen gleichzeitig dieselbe Schrittliste
2. Die Aufgabe auf jedem aktiven Profil parallel ausführen
3. `task_complete` melden, wenn alle aktiven Profile fertig sind, und pausierte Profile nennen, falls vorhanden

Du beobachtest den Fortschritt in jedem Seitenpanel unabhängig. Eines kann vor dem anderen fertig sein — sie warten nicht aufeinander.

---

## Fenster-Lock: Navigation Geht an die Richtige Stelle

Jedes Chrome-Profil kann mehrere Fenster geöffnet haben. Ohne Fenster-Lock könnte der `navigate`-Befehl der KI im falschen Fenster landen.

AgentLimb löst das automatisch. Wenn du ein Seitenpanel öffnest, registriert es das Chrome-Fenster, in dem es sich befindet. Jeder `navigate`-Aufruf für dieses Profil zielt auf dieses spezifische Fenster — nicht auf das, das Chrome in diesem Moment als "aktiv" betrachtet.

Wenn du das Fenster schließt und das Seitenpanel in einem anderen öffnest, aktualisiert sich der Lock automatisch. Die KI folgt deinem Fokus.

---

## Ein Profil Pausieren (Ausschließen)

Manchmal möchtest du eine Aufgabe auf zwei von drei Profilen ausführen, nicht auf allen.

**Methode 1 — Seitenpanel schließen.** Ein geschlossenes Panel bedeutet "dieses Profil nimmt nicht teil". Die KI überspringt es still und meldet es in der finalen Zusammenfassung.

**Methode 2 — Pausieren klicken.** Die Pausieren-Schaltfläche im Panel schließt das Profil aus, ohne das Panel zu schließen. Nützlich, wenn du das Panel sichtbar halten, aber vorübergehend ausschließen möchtest.

In beiden Fällen erklärt die KI die Gesamtaufgabe nicht wegen eines pausierten Profils für fehlgeschlagen. Sie fährt mit den verbleibenden aktiven Profilen fort. Nur wenn *alle* Profile pausiert sind, erklärt die KI `task_fail(no_active_profile)`.

**Fortsetzen:** Öffne einfach das Panel wieder oder klicke auf Fortsetzen. Der Bridge erkennt die Änderung innerhalb von 300ms und schließt das Profil automatisch in die nächste Aufgabe ein.

---

## Ein Bestimmtes Profil Anvisieren

Für einige Aufgaben möchtest du ein Profil präzise steuern, anstatt an alle zu senden.

Verwende den `target`-Parameter in deiner Anweisung:

> Nur Profile-a3f2 verwenden: LinkedIn-Bio aktualisieren.

Die KI übergibt dieses Label an den Bridge, der den Tool-Aufruf ausschließlich an dieses Profil weiterleitet. Andere Profile sind nicht betroffen.

Das Label jedes Profils findest du im Header seines Seitenpanels.

---

## Ein Praktisches Beispiel

Du betreibst ein Produkt mit Konten auf X, Weibo und Threads über drei Chrome-Profile.

**Alter Workflow:** Posting-Aufgabe dreimal ausführen, dabei manuell Profile wechseln.

**Mit Multi-Profil-Parallelsteuerung:**

1. Alle drei Profile öffnen, in jedem ein Seitenpanel öffnen
2. Der KI eine Anweisung geben: "Heutiges Build-Update auf allen Konten veröffentlichen"
3. Alle drei Seitenpanels zeigen den Plan; alle drei führen parallel aus
4. Fertig in etwa der Zeit, die eine einzelne Ausführung braucht

Wenn ein Konto ratenlimitiert oder gesperrt ist, wird dieses Profil übersprungen. Die anderen zwei schließen normal ab. Die finale Zusammenfassung sagt dir genau, was bei jedem passiert ist.

---

## Zusammenfassung

| | Vor v0.1.3 | v0.1.3 |
|---|---|---|
| Auf 3 Profilen ausführen | 3 separate Aufgaben | 1 Befehl |
| Profilidentität | Keine — KI rät | Explizites Label im Panel angezeigt |
| Fensterziel | Unzuverlässig zwischen Fenstern | Automatisch auf richtiges Fenster gesperrt |
| Profil ausschließen | Kein Mechanismus | Panel schließen oder Pausieren klicken |
| Aufgabenergebnis | Ein Ergebnis pro Ausführung | Pro-Profil-Status in einer Zusammenfassung |

Multi-Profil-Parallelsteuerung ist am mächtigsten in Kombination mit Muskelgedächtnis — die KI kennt bereits die Selektoren für jede Website, sodass die Aufgabe jedes Profils mit voller Warmstart-Geschwindigkeit läuft.

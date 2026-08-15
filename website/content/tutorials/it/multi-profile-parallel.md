---
title: "Controllo Multi-Account Parallelo: Un Comando, Tutti i Profili Contemporaneamente"
date: "2026-04-20"
tag: "Nuovo in v0.1.3"
icon: "👥"
description: "Esegui un'attività IA su più profili Chrome contemporaneamente. Account diversi, lo stesso comando — ogni profilo ha la propria identità, blocco finestra e può essere sospeso indipendentemente."
readTime: "8 min"
difficulty: "Intermedio"
---

## Cosa Fa Questa Funzionalità

AgentLimb v0.1.3 permette alla tua IA di controllare più profili Chrome contemporaneamente — in parallelo, con un solo comando.

Se hai tre account Twitter, due login Google Workspace aziendali o una dozzina di profili di test, non devi più eseguire la stessa attività tre volte. Un'istruzione raggiunge tutti i pannelli laterali aperti simultaneamente.

Ogni profilo:
- Mostra un'**identità esplicita** nell'intestazione del pannello laterale (es. `Profile-a3f2`)
- Blocca le azioni dell'IA sulla **finestra Chrome corretta** automaticamente
- Può essere **sospeso** indipendentemente senza fermare gli altri
- Riceve il **ciclo di vita completo dell'attività** — piano, aggiornamenti dei passi e risultato finale

---

## Configurazione

Non devi configurare nulla di nuovo. Il comportamento multi-profilo è automatico finché hai più di un pannello laterale aperto.

**Passo 1 — Crea più profili Chrome**

Apri Chrome → clicca sull'avatar del profilo → **Aggiungi** → crea tutti i profili che ti servono. Ogni profilo ha i propri cookie, sessioni e stato di accesso.

**Passo 2 — Apri il pannello laterale in ogni profilo**

In ogni finestra del profilo Chrome, clicca sull'icona AgentLimb o apri il pannello laterale dal menu Estensioni. Dovresti vedere l'etichetta dell'identità del profilo nell'intestazione di ogni pannello.

**Passo 3 — Connetti la tua IA**

Copia il prompt di integrazione da qualsiasi pannello laterale e incollalo nel tuo terminale IA. Il Bridge scopre automaticamente tutti i profili connessi.

Ecco fatto. La tua IA è ora connessa a tutti i profili aperti.

---

## Eseguire un'Attività su Tutti i Profili

Dai alla tua IA un'unica istruzione come al solito. Per esempio:

> Pubblica "La nostra nuova funzionalità è attiva — scoprila su agentlimb.com" su Twitter.

L'IA:
1. Dichiarerà un `task_plan` — tutti i pannelli laterali mostrano la stessa lista di passi simultaneamente
2. Eseguirà l'attività su ogni profilo attivo in parallelo
3. Riporterà `task_complete` quando tutti i profili attivi finiscono, indicando i profili ignorati se alcuni erano sospesi

Osservi i progressi in ogni pannello laterale in modo indipendente. Uno potrebbe finire prima dell'altro — non si aspettano a vicenda.

---

## Blocco Finestra: La Navigazione Va nel Posto Giusto

Ogni profilo Chrome può avere più finestre aperte. Senza blocco finestra, il comando `navigate` dell'IA potrebbe atterrare nella finestra sbagliata.

AgentLimb risolve questo automaticamente. Quando apri un pannello laterale, registra la finestra Chrome in cui si trova. Ogni chiamata `navigate` per quel profilo punta a quella finestra specifica — non a quella che Chrome considera "attiva" in quel momento.

Se chiudi la finestra e riapri il pannello laterale in un'altra, il blocco si aggiorna automaticamente. L'IA segue la tua attenzione.

---

## Sospendere un Profilo (Esclusione)

A volte vuoi eseguire un'attività su due dei tuoi tre profili, non su tutti.

**Metodo 1 — Chiudi il pannello laterale.** Un pannello chiuso significa "questo profilo non partecipa". L'IA lo salta silenziosamente e lo riporta nel riepilogo finale.

**Metodo 2 — Clicca su Sospendi.** Il pulsante Sospendi nel pannello esclude quel profilo senza chiudere il pannello. Utile se vuoi mantenere il pannello visibile ma escluderlo temporaneamente.

In entrambi i casi, l'IA non dichiara il fallimento dell'attività generale per un profilo sospeso. Continua con i profili attivi rimanenti. Solo se *tutti* i profili sono sospesi, l'IA dichiarerà `task_fail(no_active_profile)`.

**Per riprendere:** riapri semplicemente il pannello o clicca su Riprendi. Il Bridge rileva la modifica entro 300ms e include automaticamente il profilo nell'attività successiva.

---

## Puntare a un Profilo Specifico

Per alcune attività vuoi controllare un profilo con precisione invece di trasmettere a tutti.

Usa il parametro `target` nella tua istruzione:

> Usando solo Profile-a3f2: aggiorna la bio su LinkedIn.

L'IA passa questa etichetta al Bridge, che instrada la chiamata dello strumento esclusivamente a quel profilo. Gli altri profili non sono interessati.

Puoi trovare l'etichetta di ogni profilo nell'intestazione del suo pannello laterale.

---

## Un Esempio Pratico

Hai account su X, Weibo e Threads su tre profili Chrome.

**Flusso di lavoro precedente:** eseguire l'attività di pubblicazione tre volte, cambiando profilo manualmente ogni volta.

**Con il controllo multi-profilo parallelo:**

1. Apri tutti e tre i profili, apri un pannello laterale in ciascuno
2. Dai alla tua IA un'unica istruzione: "Pubblica l'aggiornamento build di oggi su tutti gli account"
3. Tutti e tre i pannelli laterali mostrano il piano; tutti e tre eseguono in parallelo
4. Completa in circa lo stesso tempo di un'unica esecuzione

Se un account è limitato per frequenza o sospeso, quel profilo viene saltato. Gli altri due completano normalmente. Il riepilogo finale ti dice esattamente cosa è successo in ciascuno.

---

## Riepilogo

| | Prima di v0.1.3 | v0.1.3 |
|---|---|---|
| Esecuzione su 3 profili | 3 attività separate | 1 comando |
| Identità del profilo | Nessuna — l'IA indovina | Etichetta esplicita nel pannello |
| Finestra di destinazione | Non affidabile tra finestre | Bloccato automaticamente sulla finestra corretta |
| Escludere un profilo | Nessun meccanismo | Chiudere il pannello o cliccare Sospendi |
| Risultato dell'attività | Un risultato per esecuzione | Stato per profilo in un unico riepilogo |

Il controllo multi-profilo parallelo è più potente combinato con la memoria muscolare — l'IA conosce già i selettori per ogni sito, quindi l'attività di ogni profilo viene eseguita a piena velocità di avvio a caldo.

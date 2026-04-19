<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Smetti di guardare la tua IA reimparare la stessa attività.</strong><br>
  L'alternativa open-source a CoWork — 90% meno token su attività ripetute nel browser.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Installa_gratis-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Installa dal Chrome Web Store">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>Se AgentLimb ti è utile, metti una ⭐ a questo repo — aiuta altri a scoprire il progetto!</em>
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

## Informazioni

**AgentLimb** è un'estensione Chrome — [disponibile sul Chrome Web Store](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — che permette a qualsiasi terminale IA — Claude Code, Cursor, Codex, Trae, Windsurf o qualsiasi modello locale — di guidare il browser con precisione. Installa l'estensione, copia un prompt, incollalo nella tua IA — configurazione automatica in 10 secondi.

Nessun browser headless. Nessun re-login. Nessun agente invasivo. Il tuo vero Chrome, i tuoi veri cookie, le tue vere sessioni — più una memoria muscolare che rende le attività ripetute sempre più economiche.

## Punti salienti

### 1. Configurazione con un solo prompt

Copia un prompt, incollalo in qualsiasi strumento IA. Nessun file di configurazione, nessun comando da terminale, nessuna chiave API. Se la tua IA può eseguire comandi, può usare AgentLimb.

### 2. Memoria muscolare — 85% meno token, 80–95% meno attesa

La prima volta che la tua IA visita un sito, esplora il DOM e apprende selettori e workflow. AgentLimb salva queste conoscenze in `~/Desktop/AgentLimb-muscle/<domain>.json`. Ogni esecuzione successiva sullo stesso sito salta l'esplorazione e riutilizza quanto appreso.

Dati reali di regressione da un'attività di pubblicazione su Reddit (Codex a bassi parametri, 2026-04-18):

| | Avvio a freddo (prima esplorazione) | Avvio a caldo (richiamo muscolare) | Risparmio |
|---|---|---|---|
| Chiamate a `page_snapshot` | 3 | **0** | 100% |
| Totale chiamate agli strumenti | 23 | 10 | 56,5% |
| Token stimati | ~12.250 | **~1.750** | **↓ 85,7%** |
| Tempo reale | 8–20 min | 30 s–2 min | **↓ ~80–95%** |

Più si riutilizza un sito, più diventa economico e veloce.

### 3. CDP nativo, nessuna stima tramite screenshot

AgentLimb controlla il browser tramite Chrome Debugger Protocol. L'IA riceve un elenco semantico strutturato di elementi interattivi — non screenshot. I click colpiscono il nodo giusto, i form usano API native, le navigazioni restituiscono immediatamente il nuovo URL.

### 4. Ciclo di vita del task esplicito

Il silenzio non significa più successo. L'IA dichiara esplicitamente `task_plan` → `task_step_done` → `task_complete` / `task_fail`. I timeout e le disconnessioni del bridge vengono catturati come veri fallimenti. Il pannello laterale mostra la lista dei passi in tempo reale.

### 5. 100% locale e privato

Il bridge gira su `127.0.0.1:7791`. Nessuna analitica, nessun tracciamento, nessun cloud. Le conoscenze muscolari sono JSON semplice sul desktop — puoi leggerlo, confrontarlo, condividerlo o eliminarlo in qualsiasi momento.

### 6. Controllo Parallelo Multi-Account — Opera su Più Profili Chrome Contemporaneamente

Un comando IA, ogni profilo Chrome lo esegue simultaneamente. Due account Twitter, tre account Google aziendali o una dozzina di profili di test——AgentLimb li controlla tutti in un'unica attività.

- **Identità esplicita** — ogni pannello laterale mostra "Questo pannello: Profile-xxxxxx"; Bridge sa quale profilo ha restituito quale risultato
- **Sospendi / auto-sospendi** — chiudi il pannello (o clicca su Sospendi) per escludere quel profilo dall'attività; gli altri continuano senza interruzioni
- **Broadcast task\_\*** — `task_plan`, `task_step_done`, `task_complete`, `task_fail` vengono trasmessi a ogni profilo attivo; tutti i pannelli laterali rimangono sincronizzati
- **Blocco finestra** — `navigate` punta automaticamente alla finestra Chrome corretta, anche se lo stesso profilo ha più finestre aperte
- **Routing per target** — specifica il profilo per etichetta nella chiamata allo strumento per precisione millimetrica

## Come funziona

```
Il tuo terminale IA  (Claude Code / Cursor / Codex / Trae / Windsurf / modello locale)
    ↕  HTTP + SSE  (16 strumenti standardizzati, scopribili via endpoint /docs)
AgentLimb Bridge  (Node.js locale · 127.0.0.1:7791)
    ↕  messaggistica chrome.runtime
AgentLimb Extension  (Chrome MV3 · pannello laterale · tab task/muscolo/log)
    ↕  Chrome Debugger Protocol
Il tuo browser  (connesso, con cookie, le tue sessioni reali)
    ↓  conoscenze persistite
~/Desktop/AgentLimb-muscle/<domain>.json  (durevole, leggibile dall'uomo)
```

## Avvio Rapido

1. **Installa** — Due opzioni:
   - **Chrome Web Store** (consigliato): [Installa AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — un clic, aggiornamenti automatici
   - **Manuale (ultima build)**: [Scarica lo zip](https://github.com/hooosberg/AgentLimb/releases/latest), decomprimi, apri `chrome://extensions`, abilita la **Modalità sviluppatore**, clicca **Carica estensione non pacchettizzata**
2. **Copia** — Apri il pannello laterale, clicca "Copia prompt di onboarding"
3. **Incolla** — Incolla in qualsiasi terminale IA. Si connette automaticamente, recupera lo schema degli strumenti su richiesta e inizia a lavorare

## Set di strumenti — 16 strumenti

16 strumenti standardizzati in cinque categorie: osservare lo stato del browser, navigare e interagire con gli elementi della pagina, leggere e scrivere la memoria muscolare, dichiarare gli eventi del ciclo di vita del task e mantenere la connettività del bridge. La documentazione completa è fornita su richiesta — l'IA recupera gli schemi solo quando ne ha bisogno.

## Perché non usare direttamente X?

Ogni approccio esistente all'automazione del browser ha un costo reale. Ecco il confronto onesto:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **Configurazione** | Scrivere script, gestire dipendenze, gestire modalità headless | Config SaaS, setup per singolo workflow | Solo Mac (serve ambiente desktop), sandbox richiesta | Copia un prompt. Fatto |
| **Targeting elementi** | CSS/XPath — li scrivi e mantieni tu | Rilevamento visivo IA — instabile negli aggiornamenti | Coordinate screenshot — ±1px può mancare il bersaglio | CDP legge il DOM live — semantico, preciso |
| **Costo token per azione** | Zero (script puro) | Costi cloud + token IA | 1.000–3.000 token/screenshot × ogni passaggio | ~300 token/passo, avvio a caldo: **-85,7%** |
| **Costo task ripetuti** | Fisso (lo script viene rieseguito) | Lineare — addebito per esecuzione | Lineare — ri-esplora ogni volta, nessuna memoria | **Decrescente** — la muscle memory si accumula |
| **Sessioni di login** | Setup extra di cookie/sessioni | Cloud — non può usare le tue sessioni locali | A livello OS, non conosce lo stato del browser | Il tuo vero Chrome — già loggato |
| **Quando il sito cambia** | I selettori si rompono — riscrivi gli script | Il modello visivo può degradare silenziosamente | L'inferenza da screenshot si adatta, ma è costosa | L'IA rileva la discrepanza, trova un nuovo selettore e auto-ripara il muscolo |
| **Privacy dei dati** | Locale ✅ | Tramite server di terze parti ❌ | Locale ✅ | 100% locale — solo 127.0.0.1 ✅ |
| **Scelta del terminale IA** | Qualsiasi (script puro) | Varia in base alla piattaforma | In bundle con Codex / Claude | Qualsiasi IA che parli HTTP |
| **Conoscenza condivisa** | Script = legato a una sola IA | Workflow = legato alla piattaforma | Nessuna memoria persistente | File muscoli = cross-IA, trasferibili, permanenti |
| **Multi-account parallelo** | Orchestrazione manuale | Dipende dalla piattaforma | No | ✅ Più profili Chrome, un solo comando |

**Il fattore distintivo**: i file muscoli di AgentLimb vivono in `~/Desktop/AgentLimb-muscle/` come semplice JSON. La conoscenza esplorata oggi da Claude Code è disponibile domani a Codex — stessi file, zero ri-esplorazione. Cambia strumento IA senza perdere un singolo workflow appreso.

## Casi d'uso

- **Marketing** — Pubblicare sui social media, gestire campagne su più piattaforme
- **Ricerca** — Estrarre dati, confrontare prodotti, raccogliere intelligence competitiva
- **Automazione** — Compilare moduli, inviare candidature, aggiornare profili
- **Testing** — QA della tua app web su un browser reale con sessioni reali

## Filosofia di design

- **Superficie minima** — 16 strumenti, ognuno fa una cosa bene, componibili in qualsiasi workflow
- **Non invasivo** — lavora nel tuo browser reale, non in una sandbox
- **Local-first** — privacy per architettura, non per promessa
- **Agnostico all'IA** — qualsiasi strumento in grado di inviare HTTP può connettersi; nessun lock-in del fornitore

## Risorse

- **Sito web**: [agentlimb.com](https://agentlimb.com)
- **Tutorial**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **Directory strumenti IA**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **Notizie**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Informativa sulla privacy**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Termini di servizio**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **Licenza**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Contatti

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **Email**: [zikedece@proton.me](mailto:zikedece@proton.me)

## Altri progetti

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>Assistente di scrittura IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>Generatore visivo di prompt IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>Screenshot per App Store</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>Storie di sentieri 3D</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>Strato di protocollo design</sub>
      </a>
    </td>
  </tr>
</table>

## Licenza

[Business Source License 1.1](../LICENSE) — Gratuito per uso personale. L'uso commerciale richiede una licenza. Diventa Apache 2.0 il 2030-04-12.

Copyright © 2025 hooosberg. Tutti i diritti riservati.

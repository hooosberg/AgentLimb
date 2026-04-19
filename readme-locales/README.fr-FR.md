<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>Arrêtez de regarder votre IA réapprendre la même tâche.</strong><br>
  L'alternative open-source à CoWork — 90% moins de tokens sur les tâches répétitives du navigateur.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-Installer_gratuitement-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Installer depuis le Chrome Web Store">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>Si AgentLimb vous est utile, merci de ⭐ mettre ce dépôt en favori — cela aide d'autres à découvrir le projet !</em>
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

## À propos

**AgentLimb** est une extension Chrome — [disponible sur le Chrome Web Store](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — qui permet à n'importe quel terminal IA — Claude Code, Cursor, Codex, Trae, Windsurf ou tout modèle local — de piloter votre navigateur avec précision. Installez l'extension, copiez un prompt, collez-le dans votre IA — configuration automatique en 10 secondes.

Sans navigateurs headless. Sans reconnexion. Sans agents invasifs. Votre vrai Chrome, vos vrais cookies, vos vraies sessions — plus une mémoire musculaire qui rend les tâches répétées de moins en moins coûteuses.

## Points forts

### 1. Configuration en un seul prompt

Copiez un prompt, collez-le dans n'importe quel outil IA. Pas de fichiers de configuration, pas de commandes terminal, pas de clés API. Si votre IA peut exécuter des commandes, elle peut utiliser AgentLimb.

### 2. Mémoire musculaire — 85% moins de tokens, 80–95% moins d'attente

La première fois que votre IA visite un site, elle explore le DOM et apprend les sélecteurs et workflows. AgentLimb enregistre ce savoir dans `~/Desktop/AgentLimb-muscle/<domain>.json`. Chaque exécution ultérieure sur le même site saute l'exploration et réutilise ce qui a été appris.

Données réelles de régression pour une tâche de publication Reddit (Codex faible paramètre, 2026-04-18) :

| | Démarrage à froid (première exploration) | Démarrage à chaud (rappel musculaire) | Économie |
|---|---|---|---|
| Appels à `page_snapshot` | 3 | **0** | 100% |
| Total d'appels d'outils | 23 | 10 | 56,5% |
| Tokens estimés | ~12 250 | **~1 750** | **↓ 85,7%** |
| Temps réel | 8–20 min | 30 s–2 min | **↓ ~80–95%** |

Plus vous réutilisez un site, plus c'est rapide et économique.

### 3. CDP natif, pas de devinette par capture d'écran

AgentLimb pilote le navigateur via Chrome Debugger Protocol. L'IA reçoit une liste sémantique structurée d'éléments interactifs — pas des captures d'écran. Les clics touchent le bon nœud, les formulaires utilisent les API natives, les navigations retournent immédiatement la nouvelle URL.

### 4. Cycle de vie de tâche explicite

Le silence ne signifie plus le succès. L'IA déclare explicitement `task_plan` → `task_step_done` → `task_complete` / `task_fail`. Les timeouts et les coupures du bridge sont capturés comme de vrais échecs. Le panneau latéral affiche la liste des étapes en temps réel.

### 5. 100% local et privé

Le bridge tourne sur `127.0.0.1:7791`. Pas d'analytique, pas de tracking, pas de cloud. Le savoir musculaire est un JSON brut sur votre bureau — vous pouvez le lire, le comparer, le partager ou le supprimer à tout moment.

### 6. Contrôle Parallèle Multi-Comptes — Opérez Plusieurs Profils Chrome Simultanément

Une commande IA, chaque profil Chrome l'exécute simultanément. Deux comptes Twitter, trois comptes Google d'entreprise ou une dizaine de profils de test——AgentLimb les contrôle tous en une seule tâche.

- **Identité explicite** — chaque panneau latéral affiche "Ce panneau : Profile-xxxxxx" ; Bridge sait quel profil a renvoyé quel résultat
- **Suspendre / suspension automatique** — fermer le panneau (ou cliquer sur Suspendre) retire ce profil de la tâche ; les autres continuent sans interruption
- **Diffusion task\_\*** — `task_plan`, `task_step_done`, `task_complete`, `task_fail` sont diffusés à chaque profil actif ; tous les panneaux latéraux restent synchronisés
- **Verrouillage de fenêtre** — `navigate` cible automatiquement la bonne fenêtre Chrome, même si le même profil a plusieurs fenêtres ouvertes
- **Routage par cible** — spécifiez le profil par étiquette dans l'appel d'outil pour une précision chirurgicale

## Fonctionnement

```
Votre terminal IA  (Claude Code / Cursor / Codex / Trae / Windsurf / modèle local)
    ↕  HTTP + SSE  (16 outils standardisés, découvrables via les endpoints /docs)
AgentLimb Bridge  (Node.js local · 127.0.0.1:7791)
    ↕  messagerie chrome.runtime
AgentLimb Extension  (Chrome MV3 · panneau latéral · onglets tâche/muscle/log)
    ↕  Chrome Debugger Protocol
Votre navigateur  (connecté, avec cookies, vos vraies sessions)
    ↓  savoir persisté
~/Desktop/AgentLimb-muscle/<domain>.json  (durable, lisible par l'humain)
```

## Démarrage Rapide

1. **Installer** — Deux options :
   - **Chrome Web Store** (recommandé) : [Installer AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — un clic, mises à jour automatiques
   - **Manuel (dernière build)** : [Télécharger le zip](https://github.com/hooosberg/AgentLimb/releases/latest), décompresser, ouvrir `chrome://extensions`, activer le **Mode développeur**, cliquer sur **Charger l'extension non empaquetée**
2. **Copier** — Ouvrir le panneau latéral, cliquer sur « Copier le prompt d'intégration »
3. **Coller** — Coller dans n'importe quel terminal IA. Il se connecte automatiquement, récupère le schéma d'outils à la demande et commence à travailler

## Ensemble d'outils — 16 outils

16 outils standardisés répartis en cinq catégories : observer l'état du navigateur, naviguer et interagir avec les éléments de la page, lire et écrire la mémoire musculaire, déclarer les événements du cycle de vie des tâches et maintenir la connectivité du bridge. La documentation complète est fournie à la demande — l'IA ne récupère les schémas que lorsqu'elle en a besoin.

## Pourquoi ne pas juste utiliser X ?

Chaque approche existante d'automatisation du navigateur a un coût réel. Voici la comparaison honnête :

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **Configuration** | Écrire des scripts, gérer les dépendances, configurer le mode headless | Config SaaS, configuration par workflow | Mac uniquement (besoin d'un environnement desktop), sandbox requis | Copiez un prompt. Fini |
| **Ciblage d'éléments** | CSS/XPath — vous les écrivez et maintenez | Détection IA visuelle — instable face aux mises à jour | Coordonnées de capture — ±1px peut rater la cible | CDP lit le DOM en direct — sémantique, précis |
| **Coût par action en tokens** | Aucun (script pur) | Frais cloud + tokens IA | 1 000–3 000 tokens/capture × chaque étape | ~300 tokens/étape, démarrage à chaud : **85,7 % de moins** |
| **Coût des tâches répétées** | Fixe (le script se relance) | Linéaire — facturé par exécution | Linéaire — re-explore à chaque fois, sans mémoire | **Décroissant** — la mémoire musculaire s'accumule |
| **Sessions de connexion** | Configuration cookies/sessions en plus | Cloud — impossible d'utiliser vos sessions locales | Au niveau OS, ignore l'état du navigateur | Votre vrai Chrome — déjà connecté |
| **Quand le site change** | Sélecteurs cassés — réécrire les scripts | Le modèle visuel peut se dégrader silencieusement | L'inférence par capture s'adapte, mais coûte cher | L'IA détecte l'écart, trouve un nouveau sélecteur, auto-répare le muscle |
| **Confidentialité des données** | Local ✅ | Via des serveurs tiers ❌ | Local ✅ | 100% local — 127.0.0.1 uniquement ✅ |
| **Choix de terminal IA** | N'importe quoi (script pur) | Varie selon la plateforme | Inclus avec Codex / Claude | N'importe quelle IA qui parle HTTP |
| **Connaissance partagée** | Script = verrouillé à une seule IA | Workflow = verrouillé à la plateforme | Pas de mémoire persistante | Fichiers muscles = multi-IA, transférables, permanents |
| **Multi-comptes parallèle** | Orchestration manuelle | Selon la plateforme | Non | ✅ Plusieurs profils Chrome, une commande |

**Le différenciateur** : les fichiers muscles d'AgentLimb vivent dans `~/Desktop/AgentLimb-muscle/` en JSON pur. Le savoir exploré aujourd'hui par Claude Code est disponible demain pour Codex — mêmes fichiers, zéro ré-exploration. Changez d'outil IA sans perdre un seul workflow appris.

## Cas d'usage

- **Marketing** — Publier sur les réseaux sociaux, gérer des campagnes sur plusieurs plateformes
- **Recherche** — Scraper des données, comparer des produits, recueillir de l'intelligence concurrentielle
- **Automatisation** — Remplir des formulaires, soumettre des candidatures, mettre à jour des profils
- **Tests** — QA de votre application web sur un vrai navigateur avec de vraies sessions

## Philosophie de conception

- **Surface minimale** — 16 outils, chacun fait une chose bien, composables sur n'importe quel workflow
- **Non-invasif** — fonctionne dans votre vrai navigateur, pas dans une sandbox
- **Local-first** — confidentialité par architecture, pas par promesse
- **Agnostique IA** — tout outil pouvant envoyer du HTTP peut se connecter ; pas de lock-in fournisseur

## Ressources

- **Site web** : [agentlimb.com](https://agentlimb.com)
- **Tutoriels** : [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **Répertoire d'outils IA** : [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **Actualités** : [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **Politique de confidentialité** : [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **Conditions d'utilisation** : [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **Licence** : [agentlimb.com/license.html](https://agentlimb.com/license.html)

## Contact

- **GitHub** : [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **E-mail** : [zikedece@proton.me](mailto:zikedece@proton.me)

## Autres projets

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>Compagnon d'écriture IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>Générateur visuel de prompts IA</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>Captures pour App Store</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>Histoires de sentiers 3D</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>Couche de protocole design</sub>
      </a>
    </td>
  </tr>
</table>

## Licence

[Business Source License 1.1](../LICENSE) — Gratuit pour usage personnel. L'usage commercial nécessite une licence. Devient Apache 2.0 le 2030-04-12.

Copyright © 2025 hooosberg. Tous droits réservés.

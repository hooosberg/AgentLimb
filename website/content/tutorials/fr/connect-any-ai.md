---
title: "Connectez n'importe quel outil IA"
date: "2026-04-18"
tag: "Premiers pas"
icon: "🔌"
description: "Claude Code, Codex, Cursor, modèles locaux — une seule invite les connecte tous. Pas de configuration spéciale requise."
readTime: "3 min"
difficulty: "Débutant"
---

## Une invite, n'importe quelle IA

AgentLimb n'a pas besoin d'être installé dans votre outil IA. Il ne nécessite aucune configuration dans Claude Code, Cursor ou Codex. La connexion est établie entièrement via l'invite que vous collez.

Copiez l'invite depuis le panneau latéral d'AgentLimb. Collez-la dans votre outil IA. Votre IA la lit, se connecte au pont qui s'exécute sur votre ordinateur et est immédiatement prête à contrôler le navigateur.

---

## Outils IA compatibles

**Claude Code** — Collez l'invite au début d'une session. Claude lit les détails de l'environnement et se connecte automatiquement.

**Codex** — Collez l'invite. Codex se connecte et commence à travailler.

**Cursor** — Collez dans la fenêtre de chat. Fonctionne en mode Agent sans configuration supplémentaire.

**Windsurf, Trae** — Identique à Cursor. Collez et c'est parti.

**Modèles IA locaux (Ollama, LM Studio, etc.)** — Fonctionne avec n'importe quel modèle qui prend en charge l'utilisation d'outils. Les modèles plus petits fonctionnent bien pour les tâches simples.

**N'importe quel autre outil IA** — Si votre IA peut suivre des instructions et utiliser des outils externes, elle fonctionne avec AgentLimb. La connexion est en HTTP standard, le format le plus universel possible.

---

## Passer d'un outil IA à l'autre

Vous pouvez utiliser différents outils IA pour différentes tâches, ou passer de l'un à l'autre en cours de projet. La connaissance accumulée par votre IA n'appartient à aucun outil spécifique — elle vit dans les fichiers de mémoire de votre bureau.

Si Claude Code a exploré Reddit hier, Codex peut utiliser cette connaissance aujourd'hui. Changez d'outil IA quand vous le souhaitez sans perdre aucun des flux de travail appris.

---

## L'invite se met à jour automatiquement

Chaque fois que vous cliquez sur « Copier l'invite » dans le panneau latéral, l'invite reflète l'état actuel : quels sites votre IA a appris, si le pont est connecté et la liste complète des outils disponibles. Copiez-la à nouveau chaque fois que vous démarrez une nouvelle session pour obtenir les informations les plus précises.

---

## Ce que votre IA peut faire

Une fois connectée, votre IA a accès à 16 outils pour contrôler le navigateur :

- **Lire** — Voir ce qui est sur la page actuelle, quels onglets sont ouverts, l'URL actuelle
- **Naviguer** — Aller à n'importe quelle URL, reculer, avancer
- **Cliquer et taper** — Cliquer sur des boutons, remplir des formulaires, défiler, prendre des captures d'écran
- **Attendre** — Attendre qu'une page se charge, attendre qu'un élément apparaisse
- **Mémoire** — Lire et mettre à jour la connaissance enregistrée sur n'importe quel site web

Votre IA combine ces outils pour accomplir la tâche que vous lui donnez, dans l'ordre qui a du sens.

---

## Dépannage

**L'IA dit qu'elle ne peut pas se connecter :** Assurez-vous que le pont est en cours d'exécution. Ouvrez le panneau latéral AgentLimb — si vous voyez un badge vert « Connecté », le pont est actif. Sinon, démarrez-le depuis le dossier de l'extension.

**L'IA semble confuse sur les outils disponibles :** Copiez une nouvelle invite depuis le panneau latéral et collez-la à nouveau. La nouvelle invite inclut la liste d'outils la plus récente et les détails de connexion.

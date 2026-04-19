---
title: "Contrôle Multi-Compte Parallèle : Une Commande, Tous les Profils en même temps"
date: "2026-04-20"
tag: "Nouveau dans v0.1.3"
icon: "👥"
description: "Exécutez une tâche IA sur plusieurs profils Chrome simultanément. Comptes différents, même commande — chaque profil a sa propre identité, verrouillage de fenêtre et peut être suspendu indépendamment."
readTime: "8 min"
difficulty: "Intermédiaire"
---

## Ce que Fait Cette Fonctionnalité

AgentLimb v0.1.3 permet à votre IA de piloter plusieurs profils Chrome en même temps — en parallèle, avec une seule commande.

Si vous avez trois comptes Twitter, deux connexions Google Workspace d'entreprise ou une douzaine de profils de test, vous n'avez plus besoin d'exécuter la même tâche trois fois. Une instruction atteint simultanément tous les panneaux latéraux ouverts.

Chaque profil :
- Affiche une **identité explicite** dans l'en-tête du panneau latéral (ex. `Profile-a3f2`)
- Verrouille les actions de l'IA sur la **bonne fenêtre Chrome** automatiquement
- Peut être **suspendu** indépendamment sans arrêter les autres
- Reçoit le **cycle de vie complet de la tâche** — plan, mises à jour des étapes et résultat final

---

## Configuration

Aucune nouvelle configuration n'est nécessaire. Le comportement multi-profil est automatique dès que vous avez plus d'un panneau latéral ouvert.

**Étape 1 — Créez plusieurs profils Chrome**

Ouvrez Chrome → cliquez sur l'avatar de votre profil → **Ajouter** → créez autant de profils que nécessaire. Chaque profil a ses propres cookies, sessions et état de connexion.

**Étape 2 — Ouvrez le panneau latéral dans chaque profil**

Dans chaque fenêtre de profil Chrome, cliquez sur l'icône AgentLimb ou ouvrez le panneau latéral depuis le menu Extensions. Vous devriez voir l'étiquette d'identité du profil dans l'en-tête de chaque panneau.

**Étape 3 — Connectez votre IA**

Copiez le prompt d'intégration depuis n'importe quel panneau latéral et collez-le dans votre terminal IA. Le Bridge découvre automatiquement tous les profils connectés.

C'est tout. Votre IA est maintenant connectée à tous les profils ouverts.

---

## Exécuter une Tâche sur Tous les Profils

Donnez à votre IA une seule instruction comme d'habitude. Par exemple :

> Publie "Notre nouvelle fonctionnalité est en ligne — découvrez-la sur agentlimb.com" sur Twitter.

L'IA va :
1. Déclarer un `task_plan` — tous les panneaux latéraux affichent la même liste d'étapes simultanément
2. Exécuter la tâche sur chaque profil actif en parallèle
3. Rapporter `task_complete` quand tous les profils actifs terminent, en précisant les profils ignorés si certains étaient suspendus

Vous observez la progression dans chaque panneau latéral indépendamment. L'un peut finir avant l'autre — ils ne s'attendent pas mutuellement.

---

## Verrouillage de Fenêtre : La Navigation Va au Bon Endroit

Chaque profil Chrome peut avoir plusieurs fenêtres ouvertes. Sans verrouillage de fenêtre, la commande `navigate` de l'IA pourrait atterrir dans la mauvaise fenêtre.

AgentLimb résout cela automatiquement. Quand vous ouvrez un panneau latéral, il enregistre la fenêtre Chrome dans laquelle il se trouve. Chaque appel `navigate` pour ce profil cible cette fenêtre spécifique — pas celle que Chrome considère "active" à ce moment-là.

Si vous fermez la fenêtre et rouvrez le panneau latéral dans une autre, le verrouillage se met à jour automatiquement. L'IA suit votre attention.

---

## Suspendre un Profil (Exclusion)

Parfois vous voulez exécuter une tâche sur deux de vos trois profils, pas tous.

**Méthode 1 — Fermez le panneau latéral.** Un panneau fermé signifie "ce profil ne participe pas". L'IA l'ignore silencieusement et le signale dans le résumé final.

**Méthode 2 — Cliquez sur Suspendre.** Le bouton Suspendre dans le panneau exclut ce profil sans fermer le panneau. Utile si vous voulez garder le panneau visible mais l'exclure temporairement.

Dans les deux cas, l'IA ne déclare pas l'échec de la tâche globale à cause d'un profil suspendu. Elle continue avec les profils actifs restants. Seulement si *tous* les profils sont suspendus, l'IA déclarera `task_fail(no_active_profile)`.

**Pour reprendre :** rouvrez simplement le panneau ou cliquez sur Reprendre. Le Bridge détecte le changement en 300ms et inclut automatiquement le profil dans la prochaine tâche.

---

## Cibler un Profil Spécifique

Pour certaines tâches, vous voulez contrôler un profil précisément plutôt que de diffuser à tous.

Utilisez le paramètre `target` dans votre instruction :

> En utilisant uniquement Profile-a3f2 : mets à jour la bio sur LinkedIn.

L'IA transmet cette étiquette au Bridge, qui route l'appel d'outil exclusivement vers ce profil. Les autres profils ne sont pas affectés.

Vous pouvez trouver l'étiquette de chaque profil dans l'en-tête de son panneau latéral.

---

## Un Exemple Pratique

Vous gérez des comptes sur X, Weibo et Threads avec trois profils Chrome.

**Ancien flux de travail :** exécuter la tâche de publication trois fois en changeant de profil manuellement.

**Avec le contrôle multi-profil parallèle :**

1. Ouvrez les trois profils, ouvrez un panneau latéral dans chacun
2. Donnez à votre IA une seule instruction : "Publie la mise à jour du build d'aujourd'hui sur tous les comptes"
3. Les trois panneaux latéraux affichent le plan ; les trois s'exécutent en parallèle
4. Se termine en à peu près le même temps qu'une seule exécution

Si un compte est limité en débit ou suspendu, ce profil est ignoré. Les deux autres se terminent normalement. Le résumé final vous dit exactement ce qui s'est passé sur chacun.

---

## Résumé

| | Avant v0.1.3 | v0.1.3 |
|---|---|---|
| Exécuter sur 3 profils | 3 tâches séparées | 1 commande |
| Identité du profil | Aucune — l'IA devine | Étiquette explicite dans le panneau |
| Cible de fenêtre | Non fiable entre fenêtres | Verrouillé automatiquement sur la bonne fenêtre |
| Exclure un profil | Aucun mécanisme | Fermer le panneau ou cliquer Suspendre |
| Résultat de la tâche | Un résultat par exécution | Statut par profil dans un résumé unique |

Le contrôle multi-profil parallèle est plus puissant combiné avec la mémoire musculaire — l'IA connaît déjà les sélecteurs pour chaque site, donc la tâche de chaque profil s'exécute à pleine vitesse de démarrage à chaud.

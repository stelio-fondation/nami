# Nami — fork « onglets multi-workspace »

Ce dépôt est un fork de [mrdainami/nami](https://github.com/mrdainami/nami).
Il ajoute à Nami **plusieurs espaces de travail dans une seule fenêtre** : une
barre d'onglets en haut, un onglet = un dossier, et chaque onglet garde ses
sessions d'agents vivantes quand on passe à un autre.

**[↓ Télécharger l'installeur Windows du fork (dernière version de `master`)](https://github.com/stelio-fondation/nami/releases/download/latest/Nami-Setup-x64.exe)**
· [version portable](https://github.com/stelio-fondation/nami/releases/download/latest/Nami-Portable-x64.exe)
· [toutes les versions](https://github.com/stelio-fondation/nami/releases)

---

## Ce que le fork ajoute

### Des onglets, un par dossier

- Une barre d'onglets en haut de la fenêtre. Chaque onglet est un Nami complet
  sur son propre dossier : bureau, sessions, arborescence, bibliothèque.
- **Les sessions continuent de tourner** dans les onglets qui ne sont pas
  affichés, et leur sortie s'y accumule.
- Un point vert sur l'onglet indique qu'il a des sessions en cours.
- **Un dossier n'est jamais ouvert deux fois dans la même fenêtre** : demander
  un dossier déjà ouvert (Ouvrir, Récents, glisser-déposer…) bascule sur son
  onglet.
- Les onglets se réordonnent par glisser-déposer, se ferment avec × ou un clic
  molette.
- Fermer un onglet qui a des sessions en cours demande confirmation. Fermer le
  dernier onglet ferme la fenêtre.
- Le navigateur intégré reste dans son onglet : il est placé dans les
  coordonnées de l'onglet et disparaît avec lui.
- Un changement de thème s'applique à la barre d'onglets et à tous les onglets
  de la fenêtre.
- Quand un bureau a des sessions en cours et qu'on ouvre un autre dossier, Nami
  propose désormais **« Ouvrir dans un nouvel onglet »** (choix par défaut), en
  plus de « nouvelle fenêtre ».
- Plusieurs fenêtres restent possibles (⇧⌘N / Ctrl+Shift+N), chacune avec ses
  onglets.

### Raccourcis

| Action | macOS | Windows / Linux |
|---|---|---|
| Nouvel onglet | ⌘T | Ctrl+T |
| Onglet suivant / précédent | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Aller à l'onglet 1…8, dernier onglet | ⌘1…⌘8, ⌘9 | Ctrl+1…Ctrl+8, Ctrl+9 |
| Fermer le panneau, puis l'onglet quand le bureau est vide | ⌘W | Ctrl+W, Ctrl+Shift+W |
| Fermer l'onglet directement | ⇧⌘W | Ctrl+F4 |
| Panneau latéral Sessions / Workspace / Library | ⌥⌘1 / 2 / 3 | Ctrl+Alt+1 / 2 / 3 |

Avec les onglets, ⌘1…⌘3 servent à changer d'onglet : le panneau latéral est
passé sur ⌥⌘1…3. Ces raccourcis fonctionnent aussi quand un terminal a le
focus. Sous Windows, Ctrl+T ouvre donc un onglet même depuis un terminal (le
shell ne reçoit plus ce raccourci).

Le menu **Window** liste les onglets de la fenêtre active.

### Mémorisation

À la fermeture, Nami retient chaque fenêtre avec **ses onglets, leur ordre et
l'onglet actif**, et les rouvre au lancement suivant. Le bureau de chaque
dossier est restauré comme avant. Les fichiers `state.json` d'avant les onglets
sont relus sans perte : chaque ancienne fenêtre devient une fenêtre à un onglet.

### Réglages

| Réglage | Effet |
|---|---|
| `NAMI_TABS=0` (variable d'environnement) | Revient exactement au Nami d'origine : une fenêtre = un dossier. `NAMI_TABS=1` force les onglets. |
| `"workspaceTabs": false` dans `settings.json` | Même chose, de façon permanente. La variable d'environnement l'emporte. |
| `NAMI_TABS_DEBUG=1` | Écrit dans le terminal la géométrie de la fenêtre et de chaque onglet, pour diagnostiquer un problème d'affichage. |

Les modes `--screenshot` et `--demo` utilisent toujours le Nami d'origine.

---

## Installer

1. Télécharger [`Nami-Setup-x64.exe`](https://github.com/stelio-fondation/nami/releases/download/latest/Nami-Setup-x64.exe).
2. Le lancer. L'installeur n'est pas signé : Windows SmartScreen affiche
   « Windows a protégé votre ordinateur » → **Informations complémentaires** →
   **Exécuter quand même**.

À savoir :

- **Il remplace le Nami officiel** s'il est installé (même identifiant
  d'application). Réglages, récents et bureaux sont conservés.
- **N'acceptez pas les mises à jour proposées dans l'application.** Elles
  viennent du dépôt officiel et réinstalleraient Nami sans les onglets. Pour
  mettre le fork à jour, téléchargez à nouveau l'installeur ci-dessus.
- Pour essayer sans rien installer : la [version portable](https://github.com/stelio-fondation/nami/releases/download/latest/Nami-Portable-x64.exe).

### Construire soi-même

```powershell
git clone https://github.com/stelio-fondation/nami.git
cd nami
npm install
npm start              # lancer depuis les sources
npm run dist:win       # installeur dans release\ (Windows)
```

Sous PowerShell, pour passer une option à electron-builder, mettez le `--`
entre guillemets : `npm run dist:win "--" --x64`.

---

## Publication automatique

Le workflow [`.github/workflows/fork-release.yml`](.github/workflows/fork-release.yml)
construit l'installeur Windows x64 (installeur + portable) sur un runner
Windows, après `npm ci` et `npm test` :

- **chaque push sur `master`** remplace la pré-release
  [`latest`](https://github.com/stelio-fondation/nami/releases/tag/latest) ;
- **un tag `tabs-v…`** (par exemple `tabs-v0.6.1-1`) crée une release
  versionnée et durable.

`npm run check:security` est exécuté à titre informatif et ne bloque pas la
publication : il échoue aujourd'hui à cause de vulnérabilités dans les
dépendances de l'upstream 0.6.1.

Les workflows de l'upstream (`windows.yml`, `release.yml`) sont conservés tels
quels pour ne pas créer de conflits. `windows.yml` se déclenche aussi sur
`master` et échoue pour la même raison de sécurité : on peut le désactiver dans
l'onglet **Actions** du dépôt (workflow « windows » → **Disable workflow**),
sans toucher au code.

---

## Suivre l'upstream

```powershell
git remote add upstream https://github.com/mrdainami/nami.git   # une seule fois
git fetch upstream
git switch master
git merge upstream/master
git push
```

Le fork a été écrit pour limiter les conflits : la logique nouvelle vit dans
ses propres fichiers, et les fichiers de l'upstream ne sont touchés qu'à
quelques endroits.

| Fichier | Rôle |
|---|---|
| `src/main/workspace-tabs.js` | Modèle des onglets (pur, testé) : ajout, dédoublonnage, fermeture, ordre, sérialisation, flag |
| `src/main/workspace-shell.js` | La fenêtre à onglets : barre, vues des onglets, disposition, fermeture, raccourcis |
| `src/main/tab-keys.js` | Lecture des raccourcis d'onglets avant la page (et avant xterm) |
| `src/main/window-host.js` | Retrouve l'onglet qui envoie un message IPC, et sa fenêtre |
| `src/main/tabbar-preload.js`, `src/renderer/tabbar.*` | La barre d'onglets |
| `src/main/main.js` | Branchement : rendu partagé entre fenêtre et onglet, routage vers l'onglet actif, mémorisation |
| `src/main/app-menu.js` | Entrées de menu des onglets, seulement quand ils sont actifs |
| `src/main/browser-views.js`, `browser-overlays.js` | Le navigateur intégré accepte un onglet comme « fenêtre » |
| `src/main/preload.js`, `src/renderer/app.js` | Le bouton « Ouvrir dans un nouvel onglet » (7 lignes dans `app.js`) |

Tests : `tests/workspace-tabs.test.mjs` (dans `npm test`) et
`tests/workspace-tabs-runtime.cjs`, qui pilote un vrai Electron (trois onglets,
une session dans chacun, changement d'onglet, navigateur, thème, fermeture,
mémorisation) :

```powershell
npx electron tests/workspace-tabs-runtime.cjs
```

Les autres tests Electron de l'upstream (`tests/*.cjs`) supposent une fenêtre
par dossier : lancez-les avec `NAMI_TABS=0`.

---

## Limites connues

- Fermer une **fenêtre** ne demande pas de confirmation, même avec des sessions
  en cours (comportement d'origine). Seule la fermeture d'un **onglet** le fait.
- Chaque onglet est un rendu complet : la mémoire augmente avec le nombre
  d'onglets. Le chargement différé n'est pas encore fait.
- Le thème est commun aux onglets d'une même fenêtre, pas entre fenêtres.
- Pas de menu contextuel sur les onglets.
- macOS n'a pas encore été testé à la main.
- Installeurs non signés (avertissement SmartScreen).

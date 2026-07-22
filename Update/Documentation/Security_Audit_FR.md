# Better Mod Manager (BMM) — Audit de sécurité

**Date :** 2026-07-03 · **Périmètre :** l'app desktop Tauri BMM — le backend Rust
(`src-tauri/src`) et ses frontières de confiance : extraction d'archives (zip-slip /
CWE-22), spawn de processus enfants (CWE-78), les deux écouteurs réseau (API plugin
locale + l'hôte de repo « mode serveur » LAN), l'auto-updater, et la surface des pages
personnalisées en sandbox (`bmmpage://`). Revue de code source, pas un pentest de
binaire publié. Compagnon des docs `Technical_Analysis` / `App_Features` de BMM.

**En résumé : aucun problème de sévérité élevée.** Les surfaces porteuses sont défendues
avec les bons patterns et portent des commentaires explicatifs. Quelques notes
faibles/informatives ci-dessous — principalement les défauts du serveur de repo exposé
au LAN et la dépendance à des crates tierces pour la sûreté de l'extraction 7z/rar.

---

## Examiné et jugé SÛR

### Extraction d'archives — zip-slip / CWE-22 (`archive.rs`)
Les mods peuvent être stockés en `.zip/.tar/.tar.gz/.7z/.rar` et sont extraits vers un
cache à la demande. L'extraction **zip** (cas courant, chemins série + parallèle) résout
chaque entrée via `enclosed_name()` de la crate zip — la bonne défense zip-slip — et
**ignore** toute entrée qui s'échapperait de la destination. **Tar/tar.gz** passent par
`unpack` de la crate `tar`, qui rejette par défaut les membres `..`/absolus.

### Injection de commande — CWE-78 (`commands/proc.rs`)
Chaque processus enfant est lancé via `hidden_command` / `hidden_tokio_command`, qui
enveloppent `std::process::Command::new(program)` avec des arguments passés en **tableau**
(aucune interpolation shell) et posent `CREATE_NO_WINDOW` sous Windows. Aucune surface
d'injection de métacaractères ; le flag de fenêtre cachée retire aussi le canal auxiliaire
du flash de console.

### API plugin locale — auth & isolation (`api/mod.rs`)
L'API REST plugin écoute sur **`127.0.0.1` uniquement** (pas toutes les interfaces).
Auth :
- Token admin comparé en **temps constant** (`ct_eq`, CWE-208).
- Les tokens par-plugin sont acceptés, et — crucial — l'identité et les permissions de
  l'appelant sont résolues **depuis le bearer token**, jamais depuis l'en-tête spoofable
  `X-BMM-Plugin-Id` (`require_permission`, CWE-862/863). Un plugin limité ne peut pas
  s'élever en omettant/forgeant un en-tête.
- Le CORS est restreint à une liste blanche d'origines `tauri.localhost`.

### « Mode serveur » repo LAN — traversée & contrôle d'accès (`commands/repo_server.rs`)
Cet hôte est volontairement exposé au LAN (écoute `0.0.0.0`) pour partager un repo
généré. La traversée est correctement bloquée : il **rejette tout segment `..`/`...`**
en amont (avant la vérif `full_path.starts_with(serve_dir)`, insuffisante seule car
`Path::starts_with` est un match de préfixe de composants). L'accès est gardé par un
**Creator ID** obligatoire pour les téléchargements `/mods/`, une vérif de **ban**, et
une **whitelist** optionnelle.

### Auto-update (`commands/autoupdate.rs`)
Les métadonnées de mise à jour viennent des releases GitHub en HTTPS ; chaque
`download_url` par-fichier est **obligatoirement HTTPS** (les bascules en HTTP clair sont
refusées) et chaque fichier téléchargé est **vérifié en SHA-256** contre le manifeste
avant application.

### Pages personnalisées en sandbox — `bmmpage://` (`commands/custom_pages.rs`)
Le contenu « Page » tiers est servi sous un schéma `bmmpage://` avec une CSP stricte et
rendu dans une **iframe `sandbox` SANS `allow-same-origin`** (origine opaque `null`). Par
construction, il ne peut atteindre ni `window.parent`, ni le DOM de BMM, ni
`__TAURI__`/`invoke`, ni cookies/localStorage, ni le réseau, ni les sous-frames. Des
capacités déclarées existent dans le manifeste mais **aucune n'est accordée
automatiquement** — modèle de permissions deny-by-default et rétro-compatible. Les ids de
page passent une liste blanche `sanitize_id()`. Isolation excellente.

---

## Notes de faible sévérité / défense en profondeur

1. **Le « mode serveur » repo est exposé au LAN avec des défauts permissifs** — *Faible.*
   Il écoute `0.0.0.0`, la **whitelist est opt-in (désactivée par défaut)**, et seuls les
   fichiers `/mods/` exigent un Creator ID — donc les métadonnées du repo / fichiers
   non-mod sont lisibles par quiconque sur le réseau local tant que le serveur tourne.
   C'est le modèle de partage voulu et la traversée est défendue, mais à surfacer dans
   l'UI/docs : **activer la whitelist pour un partage privé**, et privilégier des réseaux
   de confiance. Envisager un bind `127.0.0.1`-seul pour les tests solo/locaux.

2. **L'extraction 7z / rar dépend de crates tierces pour la sûreté zip-slip** — *Faible.*
   Contrairement à zip (`enclosed_name`) et tar (garde de la crate), l'extraction `.7z`
   (`sevenz_rust`) et `.rar` (`unrar`) fait confiance à la crate pour empêcher la
   traversée. Une archive `.7z`/`.rar` de mod hostile (les mods peuvent venir de repos
   communautaires) pourrait traverser si la crate est vulnérable. **Recommandation :**
   valider le chemin relatif de chaque entrée (rejeter `..` / absolu / à préfixe de
   lecteur) après listing et avant/juste après extraction, en miroir de la garde zip — un
   garde-fou peu coûteux et indépendant de la crate.

3. **L'authenticité de l'auto-update repose sur HTTPS + SHA-256-du-manifeste, pas sur une
   signature indépendante** — *Info.* L'intégrité ne vaut que le canal de release :
   quiconque peut publier une release GitHub (ou une compromission du canal) peut livrer
   une mise à jour dont le SHA-256 correspond à son propre manifeste. Envisager de
   **signer les artefacts de mise à jour** (ex. minisign/Ed25519) et de vérifier la
   signature côté client. (Le projet frère BetterInstaller implémente déjà exactement ce
   modèle Ed25519 ; la signature Authenticode du MSI Windows, si utilisée, mitige
   partiellement.)

4. **Docstring périmée** — *Info.* Le commentaire au-dessus de `PermissionDenied` dans
   `api/mod.rs` décrit encore le comportement déprécié « pas d'en-tête ⇒ admin » ; le
   `require_permission` actif résout l'identité depuis le token. Mettre à jour le
   commentaire pour éviter toute confusion future.

5. **Échappement VBS/PowerShell des launch-packs** — *Info (reporté).* Le constructeur de
   launch-pack écrit les chemins d'exe choisis par l'utilisateur dans un `.vbs` (`"`→`""`)
   et un script PowerShell `.lnk` (`'`→`''`) — les bons échappements pour chaque contexte,
   et l'entrée provient des **propres** fichiers de l'utilisateur local (pas une surface
   distante/d'autrui). Correct en l'état ; à revoir seulement si les définitions de
   launch-pack deviennent partageables/importables depuis des sources non fiables.

---

## Remédiation (appliquée le 2026-07-03)

- **Garde zip-slip 7z/rar — CORRIGÉ.** `archive.rs` a désormais un `is_unsafe_rel_path()`
  indépendant (rejette `..`, POSIX-absolu, Windows drive-absolu et UNC) appliqué avant
  d'extraire les `.7z` (valide tout l'index en amont) et les `.rar` (valide chaque entrée
  avant `extract_with_base`). Cela ne repose plus uniquement sur la crate tierce pour la
  sûreté des chemins — cela reflète la garantie `enclosed_name()` utilisée pour zip.
  `cargo check` au vert.
- **Docstring de permission périmée — CORRIGÉ.** Le commentaire au-dessus de
  `PermissionDenied` dans `api/mod.rs` indique maintenant correctement que
  l'identité/permissions sont résolues depuis le bearer token (pas l'en-tête spoofable).
- **Défauts LAN du serveur repo — accepté (documenté).** Le bind `0.0.0.0` est la
  fonctionnalité de partage « mode serveur » voulue ; la whitelist garde déjà tous les
  chemins quand activée et la traversée est défendue. Laissé comme choix documenté de
  l'utilisateur (activer la whitelist / réseaux de confiance) plutôt que d'amputer la
  fonctionnalité.
- **Signature indépendante des mises à jour — reporté (Info).** Ajouter une signature
  minisign/Ed25519 des artefacts est un changement de taille d'une fonctionnalité, pas un
  correctif ; l'intégrité actuelle est HTTPS + SHA-256-du-manifeste. Suivi pour une future
  release. (BetterInstaller livre déjà le modèle Ed25519 comme référence.)

## Résumé des recommandations

| Élément | Sévérité | Statut / Action |
|---|---|---|
| Zip-slip (zip/tar), injection de commande, auth API plugin, traversée repo, update HTTPS+SHA-256, sandbox `bmmpage://` | — | **Sûr — à conserver** |
| Zip-slip 7z/rar via crate tierce | Faible | **Corrigé** — validation indépendante des chemins |
| Docstring de permission périmée | Info | **Corrigé** — commentaire corrigé |
| Défauts LAN du serveur repo (whitelist off, métadonnées publiques) | Faible | Accepté — choix documenté de l'utilisateur |
| Pas de signature indépendante des mises à jour | Info | Reporté — envisager minisign/Ed25519 plus tard |
| Échappement VBS/PS des launch-packs | Info | Correct (entrée locale uniquement) |

Aucun bloquant.

## Remédiation (appliquée le 2026-07-22)

| Élément | Sévérité | Action |
|---|---|---|
| **rmcp RUSTSEC-2026-0189** (DNS rebinding du transport Streamable HTTP, CVSS 8.8) | Haute (inatteignable) | **Corrigé** — rmcp 0.16 → **1.8**. Le serveur MCP de BMM est stdio-only, le transport vulnérable n'était donc jamais atteignable ; le bump efface l'advisory quand même. `cargo audit` rapporte désormais **0 vulnérabilité**. Seule casse : `ServerInfo`/`Implementation` devenus `#[non_exhaustive]` → construits par mutation depuis `Default`. |
| **Comparaisons de mots de passe non constantes** dans les templates mini-serveur & hub-server générés (CWE-208) | Faible | **Corrigé** — la nouvelle porte **mot de passe de téléchargement** côté abonnés ET la porte admin `Authorization` utilisent désormais `crypto.timingSafeEqual` dans `server.express.js.template` et `hub-server.js.template`. |
| Advisory **dompurify** de faible sévérité (GHSA-c2j3-45gr-mqc4) dans l'outillage npm racine | Faible | **Corrigé** — `npm audit fix` → 0 vulnérabilité. |
| Nouvelle fonctionnalité passée en revue : **mot de passe de téléchargement des dépôts** | — | Basé sur header (`X-Repo-Password`), construction `HeaderValue` gardée côté client Rust, 401 remonté en erreur typée, chemins exemptés limités à dashboard/monitoring/admin/local. Aucun secret journalisé (l'historique n'enregistre que « mot de passe absent ou faux »). |

# CI/CD et scans de sécurité

Chaque workflow GitHub Actions du dépôt BMM : ce qui le déclenche, ce qu'il vérifie, ce qui le fait
échouer, ce qu'il laisse derrière lui, et comment lancer la même chose sur ta machine. La dernière
partie détaille les scans de sécurité : les lancer à la main, changer les seuils, exclure un chemin,
écarter un faux positif.

Cette page s'adresse aux contributeurs et aux mainteneurs. Rien ici ne tourne dans l'app.

---

## Les quatre workflows

| Workflow | Fichier | Se lance sur | Bloque sur |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | push sur `main` / `Tdev`, chaque pull request, à la main | un gate de `npm run ci`, un `cargo test` en échec, une alerte npm ou cargo non expliquée |
| Release | `.github/workflows/release.yml` | un tag `v*`, ou à la main avec une version | une étape de build, de signature ou d'envoi |
| Re-sign update manifests | `.github/workflows/resign-manifests.yml` | lundi et jeudi 04:17 UTC, ou à la main | un manifeste qui ne se vérifie pas avec la clé publique épinglée |
| Security | `.github/workflows/security.yml` | push sur `main` / `master` / `Tdev`, chaque pull request, lundi 04:23 UTC, à la main | un secret dans l'historique, ou un résultat Semgrep / Trivy au seuil ou au-dessus |

Chaque action est épinglée par SHA de commit complet, avec son tag en commentaire. Chaque image
Docker des scans de sécurité est épinglée par digest. Un tag peut être déplacé par qui le contrôle,
pas un SHA. Chaque workflow part de `permissions: {}` ou de `contents: read`. Un job n'obtient
davantage que s'il écrit quelque chose.

### CI (`ci.yml`)

| Job | Ce qu'il vérifie |
|---|---|
| Frontend | `npm ci`, puis `npm run ci` : la même chaîne de gates qu'en local (traductions, docs, TypeScript, fraîcheur du JS compilé, docs de l'API, deep links, `security-guard`, `check-api-secrets`…). Le dépôt BMM Docs est cloné au commit que cet arbre épingle, parce que plusieurs gates le lisent. |
| Rust | `cargo test` dans `src-tauri`, sous Windows (la cible de BMM). |
| npm audit | `node .github/scripts/dep-audit.mjs npm .` : les alertes high et critical des dépendances npm livrées (hors dev) font échouer. |
| cargo audit | `node .github/scripts/dep-audit.mjs cargo src-tauri` : toute vulnérabilité RustSec fait échouer. |

La seule façon de passer une alerte signalée est une entrée dans `.github/audit-ignore.json`, qui
nomme l'alerte, le dossier et une raison. Les avertissements (non maintenu, yanked) sont affichés et
ne font pas échouer.

- **Secrets / variables :** aucun.
- **Artefacts :** aucun.
- **En local :** `npm run ci`, `cd src-tauri && cargo test`, et les deux lignes `dep-audit.mjs`
  ci-dessus.

### Release (`release.yml`)

Construit BMM et le sidecar MCP, empaquette et signe l'installeur avec BetterInstaller, signe les
manifestes de mise à jour, puis publie la release GitHub. Son unique job a `contents: write`.

- **Secrets :** `BMM_PRIVATE_KEY` (obligatoire, la clé Ed25519 de l'éditeur) ; `BETAHUB_CONFIG`
  (optionnel, le contenu complet de `betahub-config.local.ts` ; sans lui, l'exemple commité sert).
- **Artefacts :** la release elle-même : installeur, delta, `update.json`, `update-manifest.json`.
- **En local :** `examples/bmm/release.ps1` dans BetterInstaller fait les mêmes étapes. Ne le lance
  jamais avec `-Publish` pour un test.

### Re-sign update manifests (`resign-manifests.yml`)

Les deux manifestes signés expirent au bout de 7 jours. Ce job les télécharge depuis la dernière
release (ou le tag donné à la main), renouvelle la signature, la vérifie avec la clé publique
qu'épinglent les copies installées, puis les renvoie. Il tourne deux fois par semaine : un passage
planifié sauté ne provoque donc pas de panne.

- **Secrets :** `BMM_PRIVATE_KEY` (obligatoire) ; `BCWEB_ASSETS_TOKEN` (optionnel : pousse aussi les
  fichiers vers le miroir BCWEB ; ignoré s'il est absent).
- **Artefacts :** aucun ; il remplace les deux assets de la release.

### Security (`security.yml`)

| Job | Outil | Ce qu'il lit | Échoue quand |
|---|---|---|---|
| Gate self-test | `node --test` | `.github/scripts/security-gate.test.mjs` | le gate lui-même est faux ; chaque scan l'attend |
| Secrets | Gitleaks 8.30.1 | tout l'historique git, toutes les branches | un résultat non revu dans `.gitleaks.toml` / `.gitleaksignore`, ou zéro commit lu |
| SAST | Semgrep 1.178.0 | `src-tauri/src`, `frontend/src`, `.github/workflows` et les templates du mini-serveur | un résultat au seuil Semgrep ou au-dessus |
| Dépendances + config conteneur | Trivy 0.74.0 | `benchmarks/rust/Cargo.lock` et les templates Dockerfile de `src-tauri/src/templates/docker` | un résultat au seuil Trivy ou au-dessus |
| Envoi SARIF vers code scanning | `codeql-action/upload-sarif` | les trois fichiers SARIF | un envoi qui échoue sur un dépôt qui accepte le code scanning |
| Commentaire de PR | `gh api` | les trois verdicts | n'échoue jamais une pull request à lui seul |

Chaque scanner écrit son propre rapport et sort en 0. **Un seul script décide :**
`.github/scripts/security-gate.mjs`, le même fichier dans BMM, BetterInstaller, BMM Docs et BCW. Il
place chaque résultat sur une seule échelle (`critical > high > medium > low > info`), affiche un
tableau et ne fait échouer le job qu'au seuil ou au-dessus.

- **Secrets :** aucun à créer. Les jobs d'envoi et de commentaire utilisent le `GITHUB_TOKEN`
  automatique.
- **Variables :** voir [Seuils](#seuils).
- **Artefacts** (gardés 30 jours) : `security-gitleaks`, `security-semgrep` et `security-trivy`.
  Chacun contient le rapport JSON natif, le SARIF, un tableau `*-summary.md` et un verdict
  `*.result.json`.

**Pourquoi certains scans ne sont pas là :**

- **Pas de DAST (OWASP ZAP, Nuclei).** BMM est une app de bureau. Il n'y a pas d'app web de staging
  à viser : l'API locale écoute sur `127.0.0.1` dans l'app en cours d'exécution, et les serveurs de
  dépôt tournent sur les machines des utilisateurs. Aucun job de ce dépôt ne vise un hôte du réseau,
  encore moins un hôte de production.
- **Pas de scan Trivy de `package-lock.json` ni de `src-tauri/Cargo.lock`.** Les audits npm et cargo
  de `ci.yml` les contrôlent déjà, en bloquant, avec les raisons dans `.github/audit-ignore.json`. Un
  second scanner obligerait à écrire chaque alerte acceptée dans deux fichiers d'exclusion qui
  finiraient par diverger. Chaque lockfile a donc une seule autorité. Trivy couvre ce que rien d'autre
  ne couvrait : le lockfile de la crate de benchmarks et les Dockerfiles que BMM génère pour les
  utilisateurs.
- **Pas de scan d'image.** Ce dépôt ne construit ni ne publie aucune image.
- **Semgrep complète les gates de `npm run ci`, il ne les répète pas.** `security-guard` interdit
  `eval` et les handlers inline, et `check-api-secrets` vérifie la doc de l'API. Semgrep apporte des
  règles de type taint (path traversal, ReDoS, open redirect, spawn dangereux, injection de script
  dans Actions, actions non épinglées). Il couvre aussi le mini-serveur Express, que ces gates ne
  lisent pas.

---

## Lire les résultats

### Le log et le résumé du job

Le gate affiche un tableau par outil : sévérité, `BLOCK` ou `pass`, id de règle et emplacement. Il
écrit aussi ce tableau dans le résumé du job. Un résultat bloquant est aussi une annotation
`::error` sur la page du run. Gitleaks n'affiche jamais un secret : il tourne avec `--redact`, donc
le log montre la règle, le fichier, la ligne, le commit et l'empreinte.

### Le commentaire de pull request

Sur une pull request, le job `PR comment` poste **un** commentaire, puis modifie ce même
commentaire à chaque run suivant. Il le retrouve grâce à une première ligne cachée,
`<!-- bmm-security-gate -->`. Le commentaire montre :

- une ligne par outil : seuil, nombre par sévérité, nombre bloquant, `pass` ou **FAIL** ;
- un verdict global `PASSED`, `FAILED` ou `INCOMPLETE` (`INCOMPLETE` veut dire qu'un scan n'a pas
  produit de verdict parce qu'il n'a pas tourné ; ce n'est jamais présenté comme un succès) ;
- un lien vers le run et ses artefacts.

Une pull request venant d'un fork, ou de Dependabot, reçoit un token en lecture seule : le job
affiche une notice et ne poste rien. Le même tableau reste dans le résumé de chaque job de scan.

### Code scanning (l'onglet Security)

Le job `code-scanning` envoie les SARIF de Gitleaks, Semgrep et Trivy, avec une catégorie par outil
(`gitleaks`, `semgrep`, `trivy`). GitHub alors :

- suit chaque alerte dans le temps (ouverte, corrigée, écartée) ;
- annote les lignes modifiées d'une pull request.

L'envoi a lieu même quand un gate a échoué, parce que ce sont justement les alertes qui comptent. Le
job demande d'abord à l'API si le code scanning est disponible. BMM est public, donc il l'est. Sur un
dépôt privé sans GitHub Advanced Security, le job le dit dans une notice et n'envoie rien ; le SARIF
reste dans les artefacts. Le SARIF des templates n'est pas envoyé, parce que ses chemins désignent
les copies renommées en `*.js`. Ces résultats sont dans l'artefact `security-semgrep` et dans le
gate.

Le code scanning est une vue. **C'est le gate qui fait échouer le build.** Un résultat écarté dans
l'onglet Security fait encore échouer le job au run suivant, tant que l'outil le signale.

---

## Seuils

Le seuil est la **plus basse sévérité qui fait échouer**. Définis-le comme variable de dépôt dans
**Settings > Secrets and variables > Actions > Variables** :

| Variable | Valeurs | Défaut |
|---|---|---|
| `SECURITY_GATE_SEVERITY` | `critical`, `high`, `medium`, `low` | `high` |
| `SECURITY_GATE_SEVERITY_SEMGREP` | les mêmes | la valeur globale |
| `SECURITY_GATE_SEVERITY_TRIVY` | les mêmes | la valeur globale |

- `critical` et `high` bloquent par défaut. `medium` ne bloque que si tu choisis `medium` ou `low`.
  `low` ne bloque qu'à `low`. `info` ne bloque jamais.
- Gitleaks n'a pas de seuil : tout secret qui n'est pas une exclusion revue fait échouer.
- Une valeur que le gate ne connaît pas, une faute de frappe par exemple, **fait échouer le run**
  avec le code de sortie 2. Elle ne retombe pas sur un défaut, parce qu'une faute de frappe ne doit
  jamais vouloir dire que rien ne bloque.
- Le `UNKNOWN` de Trivy (une alerte pas encore notée) compte comme `high`.
- Chez Semgrep, `ERROR` compte comme `high`, `WARNING` comme `medium` et `INFO` comme `low`.

Pour essayer un seuil sans toucher à la variable, lance le gate en local sur l'artefact
téléchargé :

```bash
SECURITY_GATE_SEVERITY=medium node .github/scripts/security-gate.mjs --tool trivy --report trivy.json
```

---

## Lancer chaque scan à la main

Tout se lance depuis la racine du dépôt avec Docker, avec les mêmes images épinglées que la CI.
Sous Windows, utilise Git Bash avec `export MSYS_NO_PATHCONV=1`, ou un clone dans WSL. Les montages
d'un disque Windows sont lents, et Trivy peut y atteindre son délai de 5 minutes.

```bash
GITLEAKS=zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
SEMGREP=semgrep/semgrep:1.178.0@sha256:32e459968daabe7ab86968184a29109b9564aa00392401156f9788452b42786b
TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
mkdir -p reports
```

**Secrets (Gitleaks, tout l'historique) :**

```bash
docker run --rm -v "$PWD:/repo" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$GITLEAKS" git /repo --config /repo/.gitleaks.toml --gitleaks-ignore-path /repo/.gitleaksignore \
  --redact --verbose --report-format json --report-path /repo/reports/gitleaks.json --exit-code 0
node .github/scripts/security-gate.mjs --tool gitleaks --report reports/gitleaks.json
```

Le log doit dire `N commits scanned` avec N supérieur à 0. `0 commits scanned` veut dire que git a
refusé le dossier (il manque les variables `safe.directory`), pas que l'historique est propre.

**SAST (Semgrep, règles épinglées) :**

```bash
REF=$(grep -oE 'SEMGREP_RULES_REF: [0-9a-f]{40}' .github/workflows/security.yml | cut -d' ' -f2)
git init -q ../semgrep-rules && git -C ../semgrep-rules fetch -q --depth 1 https://github.com/semgrep/semgrep-rules "$REF" \
  && git -C ../semgrep-rules checkout -q FETCH_HEAD
CFG=$(grep -v '^#' .github/security/semgrep-rules.txt | grep . | sed 's#^#--config=/rules/#')
docker run --rm -v "$PWD:/src" -v "$PWD/../semgrep-rules:/rules:ro" -w /src \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$SEMGREP" semgrep scan --metrics=off $CFG --json-output=reports/semgrep.json \
  src-tauri/src frontend/src .github/workflows
node .github/scripts/security-gate.mjs --tool semgrep --report reports/semgrep.json
```

**Dépendances et Dockerfiles (Trivy) :**

```bash
docker run --rm -v "$PWD:/src" -w /src "$TRIVY" fs --scanners vuln,misconfig --show-suppressed \
  --skip-files package-lock.json --skip-files src-tauri/Cargo.lock \
  --file-patterns 'dockerfile:Dockerfile\..*\.template$' \
  --format json --output reports/trivy.json --exit-code 0 .
node .github/scripts/security-gate.mjs --tool trivy --report reports/trivy.json
```

**Le gate lui-même :** `node --test .github/scripts/security-gate.test.mjs`.

**Le commentaire de PR, rendu en local :** ajoute `--json reports/<outil>.result.json` à chaque ligne
de gate ci-dessus, puis :

```bash
node .github/scripts/security-gate.mjs --markdown --results reports/gitleaks.result.json \
  --results reports/semgrep.result.json --results reports/trivy.result.json --marker bmm-security-gate
```

---

## Ajouter ou exclure une cible

| Pour… | Modifier |
|---|---|
| Faire scanner un autre dossier par Semgrep | la liste de chemins à la fin de l'étape `semgrep (application code)` de `security.yml` |
| Ajouter une règle Semgrep | une ligne dans `.github/security/semgrep-rules.txt` : le chemin d'un fichier de règle de `semgrep/semgrep-rules` au commit épinglé |
| Exclure des chemins de Semgrep | un `.semgrepignore` à la racine, un motif par ligne, avec un commentaire qui dit pourquoi |
| Confier un lockfile à Trivy | rien : `trivy fs` trouve tous les lockfiles, sauf les deux de `--skip-files` |
| Exclure un dossier de Trivy | `--skip-dirs <dossier>` dans l'étape `trivy fs`, avec un commentaire qui dit pourquoi |
| Mettre à jour les règles Semgrep | changer `SEMGREP_RULES_REF`, régénérer les listes (voir plus bas) et lire le diff |

Les listes ne gardent que les fichiers de règles dont les règles ne sont pas marquées
`subcategory: audit`. Une règle d'audit signale chaque usage d'un sink, chaque `innerHTML` ou chaque
`temp_dir` par exemple, pour qu'un humain le relise. Sur ce code, elles donnaient environ 3 700
résultats, dont 1 480 en `ERROR`, sans moyen de distinguer un vrai problème du reste. Pour régénérer
la liste après avoir changé la ref, garde les mêmes dossiers que l'en-tête de la liste, garde chaque
fichier de règle dont les règles ne sont pas toutes `audit`, et relis le diff comme du code.

Une règle Semgrep prise à un commit épinglé donne le même résultat l'an prochain, alors qu'un
ruleset du registre (`p/…`) change sous tes pieds. La contrepartie : les nouvelles règles n'arrivent
que quand quelqu'un met la ref à jour.

---

## Écarter un faux positif proprement

Il y a deux endroits pour faire taire un résultat. **Préfère la config de l'outil.** Elle est
versionnée, relue dans une pull request, porte sa raison à côté d'elle, et vaut à la fois pour le
gate, les artefacts et l'onglet Security. Un rejet dans l'onglet Security ne fait que cacher l'alerte
dans cette vue : le gate échoue encore au run suivant.

| Outil | Où | Format |
|---|---|---|
| Gitleaks, un résultat | `.gitleaksignore` | l'empreinte affichée dans le log (`commit:fichier:règle:ligne`), sous un commentaire qui dit pourquoi |
| Gitleaks, une classe de faux positifs | `.gitleaks.toml` `[[allowlists]]` | `targetRules` + une `regexes` étroite, avec un commentaire qui prouve qu'elle ne peut pas toucher un vrai secret |
| Semgrep | la ligne de source | `// nosemgrep: <id-de-règle>` (ou `#` en Python), avec la raison sur la ligne au-dessus |
| Trivy | `.trivyignore` | `CVE-XXXX-YYYY exp:2026-12-31` sous un commentaire avec la raison ; l'expiration refait passer l'exclusion en revue |
| Audit des dépendances (`ci.yml`) | `.github/audit-ignore.json` | id, outil, dossier, raison, date |

Règles communes :

- **Un vrai secret n'est jamais exclu.** Fais-le d'abord tourner (rotation). Seulement ensuite, s'il
  doit rester dans l'historique, ajoute son empreinte avec la date de rotation.
- Une exclusion nomme un résultat, ou une classe prouvée inoffensive. Jamais une règle entière ou un
  dossier entier « pour que la CI passe ».
- Une modification de l'un de ces fichiers est une modification de sécurité : relis-la comme telle.

Un rejet dans l'onglet Security (`False positive` / `Won't fix`, avec un commentaire) reste utile pour
consigner une décision sur une alerte que la config de l'outil ne sait pas exprimer. Écris la
justification dans le champ de commentaire, pas seulement le motif.

---

## Tester sans rien toucher en production

- Chaque scan ne lit que le checkout. Aucun job n'ouvre de connexion vers un serveur BMM, un
  serveur de dépôt d'utilisateur ou un hôte de production. Le seul trafic réseau récupère les images
  épinglées, la base d'alertes de Trivy et les règles Semgrep épinglées.
- Lance les workflows sur une branche ou une pull request. `workflow_dispatch` les lance à la
  demande, sans commit.
- Lance chaque commande ci-dessus en local ; les rapports arrivent dans `reports/`. Ne commite pas
  ce dossier.
- Pour voir le gate échouer exprès, baisse le seuil le temps d'un run avec
  `SECURITY_GATE_SEVERITY=low` en local, ou définis la variable de dépôt pour un run de test sur une
  branche.
- `node --test .github/scripts/security-gate.test.mjs` prouve que le gate distingue toujours `high`
  de `low`, et qu'un rapport manquant ou un scan de rien est un échec, pas un succès.

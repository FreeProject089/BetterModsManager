# Étendre BMM

Tout ce que l'interface sait faire, elle le fait en demandant au cœur via un unique canal. Ce même
canal est ouvert aux **plugins, scripts et clients IA** — donc tout ce que BMM fait, vous pouvez
l'automatiser.

## Trois portes d'entrée

```mermaid
flowchart TD
    subgraph CLIENTS["Clients"]
        PLUG["Plugins"]
        SCRIPT["Scripts"]
        AI["Client IA"]
        PAGE["Pages personnalisées<br/>bmmpage://"]
    end
    MCP[["Serveur MCP + CLI<br/>(sidecar)"]]
    subgraph APP["App BMM"]
        API[["API HTTP locale"]]
        BROKER["Courtier de permissions"]
        CORE[["Commandes du cœur"]]
    end
    DATA[("data.json")]
    PLUG -- "token de plugin" --> API
    SCRIPT -- "token d'API" --> API
    AI -- "stdio" --> MCP
    MCP -- "actions en direct" --> API
    MCP -- "modifs hors ligne" --> DATA
    PAGE -- "postMessage" --> BROKER
    API --> CORE
    BROKER -- "accordé seulement" --> CORE
```

- **API locale** — un petit serveur HTTP sur votre machine. Plugins et scripts l'appellent pour
  scanner, activer, construire des packs, lire l'état, etc.
- **Serveur MCP** — les mêmes capacités exposées comme outils Model Context Protocol, pour qu'un
  assistant IA pilote BMM en conversation. Il fonctionne via stdio, pas un port public, dans un
  processus à part : les actions en direct passent par l'API locale, les commandes hors ligne
  modifient `data.json` directement.
- **Pages personnalisées** — des mini-apps `bmmpage://` en sandbox que vous épinglez à la barre de
  navigation. Elles ne parlent à BMM qu'à travers un **courtier de permissions**, donc une page
  obtient exactement l'accès que vous accordez, et rien de plus.

## Deeplinks

Les boutons sur le web (« Installer ce mod dans BMM ») fonctionnent via des **deeplinks** — un schéma
d'URL que BMM enregistre auprès de l'OS. Cliquer sur l'un transmet la requête à BMM (l'app en cours, ou
une nouvelle si aucune n'est ouverte). Un lien hors des limites strictes est refusé d'office ; tout
ce qui modifie, télécharge ou lance quelque chose vous demande d'abord.

```mermaid
flowchart TD
    WEB(["Bouton web"]) --> LINK["lien bmm://"]
    LINK --> APP["BMM en cours,<br/>ou démarrage"]
    APP --> LIMITS{"Dans les<br/>limites strictes ?"}
    LIMITS -- "non" --> REFUSE(["Refusé"])
    LIMITS -- "oui" --> WRITES{"Modifie, télécharge<br/>ou lance quelque chose ?"}
    WRITES -- "non" --> ACT(["L'action s'exécute"])
    WRITES -- "oui" --> CONFIRM{"Vous confirmez ?"}
    CONFIRM -- "oui" --> ACT
    CONFIRM -- "non" --> CANCEL(["Rien n'est fait"])
```

!!! info "À voir dans l'app"
    Aide &amp; autre → Développeur → **Serveur MCP et API locale**, **Pages personnalisées**,
    **Installation en un clic**. Référence : [API](doc-page:reference/api).

## Traductions (i18n)

Chaque texte de l'UI se résout via `t(clé)` contre des fichiers JSON par langue dans `Lang/` —
de simples maps clé→texte chargées du disque au démarrage. Ordre de résolution : la langue
active → le dictionnaire **français** (le FR est la langue de base) → la clé brute elle-même,
pour qu'une traduction manquante soit visible plutôt que silencieuse.

- **Bascule en direct** — changer de langue ré-applique immédiatement chaque attribut
  `data-i18n` et émet un événement `langChanged` pour les modules dynamiques. Sans redémarrage.
- **Ajouter une langue** = déposer un nouveau JSON dans `Lang/` : elle apparaît dans le
  sélecteur (avec le nom/drapeau de son `_info`) sans recompilation.
- Chaque fichier peut fournir des groupes `_synonyms` — fusionnés entre langues pour alimenter
  la **recherche sémantique** de la palette de commandes et des docs.

```mermaid
flowchart TD
    LANGFILES[("Lang/*.json")] --> DICTS["Dictionnaires<br/>en mémoire"]
    SWITCH["setLang()"] --> DICTS
    DICTS --> T["t(clé)"]
    T --> CUR{"Dans la langue<br/>active ?"}
    CUR -- "oui" --> OUT(["Texte traduit"])
    CUR -- "non" --> FR{"En français ?"}
    FR -- "oui" --> OUT
    FR -- "non" --> RAW(["Clé brute affichée"])
    LANGFILES -- "_synonyms" --> SEARCH["Recherche sémantique"]
```

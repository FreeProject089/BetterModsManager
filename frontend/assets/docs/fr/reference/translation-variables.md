# Variables des traductions

Certains textes de BMM contiennent un mot entre accolades, comme `{n}` ou `{name}`. BMM le remplace par une
valeur au moment d’afficher le texte : `"{n} nouveaux mods ajoutés"` devient « 3 nouveaux mods ajoutés ». Cette
page liste chaque clé qui en utilise, avec les noms employés, pour que la traduction les garde.

Elle est générée à partir de l’audit de l’application (`scripts/check-i18n-vars.mjs`), celui qui fait échouer
la compilation quand une traduction et le code ne sont pas d’accord. Elle ne peut pas être périmée.

## Règles pour les traducteurs

- **Recopiez chaque variable à l’identique.** `{n}` reste `{n}` : ni `{nombre}`, ni `{N}`, ni `(n)`. Une variable renommée s’affiche avec ses accolades.
- **Gardez-les toutes.** Chaque variable du texte anglais doit apparaître dans le vôtre. Vous pouvez les déplacer, l’ordre peut changer.
- **N’en ajoutez jamais.** Une variable que l’application ne remplit pas s’affiche telle quelle.
- **Les pluriels vont par paire.** Une clé en `.one` sert pour un seul élément et ne contient pas de nombre ; sa jumelle `.many` porte `{n}`. Écrivez chacune comme une vraie phrase : pas de `(s)` ni de `(x)`.
- **Certaines accolades sont du texte.** Les clés de la section [Accolades qui sont du texte](#accolades-qui-sont-du-texte) montrent la syntaxe du planificateur (`{variables}`, `{name}`). Rien n’y est remplacé : traduisez-les comme n’importe quel mot.

## Noms courants

| Variable | En général |
|---|---|
| `{n}` | un nombre (un total, un rang, une position) |
| `{name}` | un nom (mod, profil, tâche, fichier…) |
| `{m}` | un second nombre, ou un nom, à côté de {n} |
| `{v}` | une version ou une valeur |
| `{total}` | le total sur lequel porte le compte |
| `{count}` | un nombre d’éléments |
| `{s}` | des secondes, ou un mot court choisi par le code |
| `{err}` | un message d’erreur |
| `{id}` | un identifiant |
| `{e}` | un message d’erreur |
| `{size}` | une taille déjà formatée (Ko, Mo…) |
| `{label}` | un titre court |
| `{path}` | un chemin de fichier ou de dossier |
| `{profile}` | un nom de profil |
| `{version}` | un numéro de version |
| `{mod}` | un nom de mod |
| `{error}` | un message d’erreur |
| `{host}` | un nom de serveur |
| `{url}` | une adresse web |
| `{file}` | un nom de fichier |
| `{x}` | une liste ou un détail inséré par le code |
| `{date}` | une date |
| `{time}` | une heure |
| `{type}` | un genre (un importateur, un format…) |

## Accolades qui sont du texte

Ces clés contiennent des accolades montrées telles quelles au lecteur. Rien n’y est remplacé.

| Clé | Pourquoi |
|---|---|
| `docs.diagram.i18n-system.n.T.desc` | describes {placeholders} in prose |
| `plugins.dl.data_export_auto.p.name` | documents the {date}/{time}/{datetime} file-name tokens |
| `repo.manifestLayoutHint` | shows the mods/{id}/{path} layout template |
| `sched.ai.classifyHint` | lists scheduler variables the classify block sets |
| `sched.ai.textPh` | shows the scheduler {variable} syntax |
| `sched.ai.triageTextPh` | shows the scheduler {variable} syntax |
| `sched.bk.nameHint` | documents the {date}/{time}/{datetime} file-name tokens |
| `sched.fw.textPh` | tells the reader {variables} are substituted |
| `sched.http.headersPh` | shows a {token} variable in an example header |
| `sched.http.subst` | tells the reader {variables} are substituted |
| `sched.idof.idPh` | tells the reader {variables} are substituted |
| `sched.idof.intoPh` | shows the scheduler {name} syntax |
| `sched.list.itemPh` | tells the reader {variables} are substituted |
| `sched.list.valuePh` | tells the reader {variables} are substituted |
| `sched.map.intoPh` | shows the scheduler {name} syntax |
| `sched.map.keyPh` | tells the reader {variables} are substituted |
| `sched.map.valuePh` | tells the reader {variables} are substituted |
| `sched.var.namePh` | shows the scheduler {variable} syntax as an example |
| `sched.var.valuePh` | shows the scheduler {variable} syntax as an example |
| `sched.wh.bodyHint` | tells the reader {variables} are substituted |

## Toutes les clés avec variables

1050 clés, regroupées par leur premier segment. Le texte est le texte français, raccourci.

### activity

| Clé | Variables | Texte |
|---|---|---|
| `activity.btnRunning` | `{n}` | Activité : {n} en cours |
| `activity.cancelOne` | `{title}` | Annuler {title} |
| `activity.doneCount` | `{m}` `{n}` | {n} sur {m} faits |
| `activity.failedCount` | `{m}` `{n}` | {n} sur {m} en échec. |
| `activity.hourMin` | `{h}` `{m}` | {h} h {m} min |
| `activity.minSec` | `{m}` `{s}` | {m} min {s} s |
| `activity.sec` | `{s}` | {s} s |

### actjob

| Clé | Variables | Texte |
|---|---|---|
| `actjob.count` | `{m}` `{n}` | {n}/{m} |
| `actjob.queued` | `{n}` | +{n} en attente |
| `actjob.stateCopying` | `{pct}` | Copie {pct} % |
| `actjob.stateRemoving` | `{pct}` | Retrait {pct} % |
| `actjob.summaryCancelled` | `{label}` `{m}` `{n}` | {label} : arrêté après {n} sur {m}. Le mod en cours a été défait. |
| `actjob.summaryDisabled` | `{label}` `{m}` `{n}` | {label} : {n} sur {m} désactivé(s). |
| `actjob.summaryEnabled` | `{label}` `{m}` `{n}` | {label} : {n} sur {m} activé(s). |
| `actjob.summaryFailed` | `{f}` `{label}` `{m}` `{n}` | {label} : {n} sur {m} faits, {f} en échec : |

### ai

| Clé | Variables | Texte |
|---|---|---|
| `ai.api.bindFailed` | `{why}` | Impossible d’ouvrir le port ({why}). Un autre programme l’utilise-t-il ? |
| `ai.api.stats` | `{refused}` `{served}` | Répondues : {served} · refusées : {refused} |
| `ai.ask.more` | `{n}` | +{n} autres |
| `ai.ask.nFiles` | `{n}` | {n} fichiers |
| `ai.ask2.byLocal` | `{model}` | par {model}, sur ce PC |
| `ai.ask2.byRemote` | `{model}` | par {model} (API distante) |
| `ai.ask2.checked` | `{p}` | vérifiée par Laya {p} % |
| `ai.emb.disk` | `{free}` `{need}` | Nécessite {need} d'espace disque ; {free} libres. |
| `ai.emb.diskNeed` | `{need}` | Nécessite {need} d'espace disque. |
| `ai.emb.eta` | `{eta}` | {eta} restantes |
| `ai.emb.install` | `{size}` | Installer le modèle ({size}) |
| `ai.emb.installHint` | `{host}` | Un seul téléchargement depuis {host}, vérifié contre son SHA-256 épinglé, repris s’il est interrompu. Ensuite… |
| `ai.emb.mirror` | `{host}` | miroir {host} |
| `ai.emb.noSpace` | `{free}` `{need}` | Pas assez d'espace disque : l'installation nécessite {need}, le disque a {free} libres. Libérez de l'espace p… |
| `ai.emb.outdatedHint` | `{size}` | Un ancien paquet du modèle est installé. La mise à jour est un téléchargement de {size}, vérifié par son SHA-… |
| `ai.emb.progress` | `{got}` `{total}` | Téléchargement… {got} / {total} |
| `ai.emb.resume` | `{got}` | {got} déjà téléchargés : le téléchargement reprend à partir de là. |
| `ai.emb.testOdd` | `{lang}` `{ms}` `{tag}` `{tagP}` | Laya a répondu, mais pas comme prévu : « {tag} » ({tagP} %), langue {lang}, en {ms} ms. Supprimez et réinstal… |
| `ai.emb.testOk` | `{lang}` `{load}` `{ms}` `{tag}` `{tagP}` | Laya fonctionne : exemple classé « {tag} » ({tagP} %), langue {lang}, en {ms} ms (chargement : {load} ms). |
| `ai.emb.update` | `{size}` | Mettre à jour le modèle ({size}) |
| `ai.emb.where` | `{dir}` `{size}` | {size} dans {dir} |
| `ai.first.install` | `{size}` | Installer Laya ({size}) |
| `ai.hub2.model` | `{state}` | Modèle : {state} |
| `ai.hub2.nOwn` | `{n}` | {n} avec leurs propres réglages |
| `ai.hub2.tasksPill` | `{n}` `{on}` | {n} tâche(s), {on} active(s) |
| `ai.lib.appliedMany` | `{n}` | Appliqué à {n} mods. |
| `ai.lib.appliedOne` | `{n}` `{name}` | Appliqué à {name} ({n} mods). |
| `ai.lib.apply` | `{n}` | Appliquer ({n}) |
| `ai.lib.applyAll` | `{n}` | Tout appliquer ({n}) |
| `ai.lib.applyGroup` | `{n}` | Appliquer ce profil ({n}) |
| `ai.lib.applying` | `{done}` `{total}` | Application : {done} / {total} mods |
| `ai.lib.confirmCopies` | `{n}` | Inclut {n} copies des mêmes mods dans d'autres profils. |
| `ai.lib.confirmGo` | `{m}` `{n}` | Appliquer {n} modifications à {m} mods |
| `ai.lib.confirmLead` | `{what}` | Appliquer les suggestions à {what}. Les lignes que tu as cochées restent telles quelles ; pour les autres, la… |
| `ai.lib.copies` | `{n}` | {n} copies |
| `ai.lib.dedupe` | `{c}` `{n}` | {n} mods sont installés dans plusieurs profils ({c} copies en plus) : les analyser une fois et appliquer à ch… |
| `ai.lib.failedN` | `{n}` | {n} en échec. |
| `ai.lib.includeGuesses` | `{n}` | Inclure les hypothèses peu sûres de Laya ({n}) |
| `ai.lib.nMods` | `{n}` | {n} mods |
| `ai.lib.nSugg` | `{n}` | {n} suggestion(s) |
| `ai.lib.progress` | `{done}` `{total}` | {done} / {total} mods |
| `ai.lib.scopeAll` | `{n}` | Tous les mods ({n}) |
| `ai.lib.scopeIncomplete` | `{n}` | Mods sans description ou sans tags ({n}) |
| `ai.lib.summary` | `{n}` `{s}` `{total}` | {n} mods sur {total} ont des suggestions ({s} s). |
| `ai.lib.summaryStopped` | `{ms}` `{n}` | Arrêté. {n} mods avec des suggestions jusqu'ici ({ms} s). |
| `ai.lib.undone` | `{n}` | Annulé : {n} mods sont revenus à leur état précédent. |
| `ai.lib.whereEvery` | `{n}` `{p}` | Les {p} profils ({n} mods) |
| `ai.lib.whereHere` | `{n}` | Ce profil ({n} mods) |
| `ai.lt.deleteConfirm` | `{name}` | Supprimer la tâche « {name} » ? |
| `ai.lt.nTasks` | `{n}` | {n} tâches |
| `ai.lt.out.answer` | `{label}` | Réponse : {label} |
| `ai.lt.out.guess` | `{label}` | Hypothèse : {label} |
| `ai.lt.out.unknown` | `{why}` | Je ne sais pas ({why}) |
| `ai.lt.ranLine` | `{n}` `{total}` | {n} mods sur {total} ont une réponse. |
| `ai.lt.running` | `{name}` | « {name} » en cours... |
| `ai.lt.t.idLine` | `{id}` | Dans un script : ai.classify avec task {id} |
| `ai.lt.taskLine` | `{id}` `{n}` `{src}` | {n} étiquettes · {src} · id {id} |
| `ai.reason.embFailed` | `{why}` | Le modèle intégré a échoué ({why}). |
| `ai.reason.http` | `{code}` | Le serveur a répondu HTTP {code}. |
| `ai.report.fEmail` | `{n}` | {n} adresse(s) e-mail |
| `ai.report.fIp` | `{n}` | {n} adresse(s) IP |
| `ai.report.fMachine` | `{n}` | {n} mention(s) du nom de ce PC |
| `ai.report.fToken` | `{n}` | {n} secret(s) ou jeton(s) |
| `ai.report.fUsername` | `{n}` | {n} mention(s) du nom de votre compte Windows |
| `ai.report.fUserPath` | `{n}` | {n} chemin(s) de dossier avec votre nom d’utilisateur |
| `ai.report.hintCategory` | `{p}` `{v}` | Catégorie : {v} ({p}) |
| `ai.report.hintDuplicate` | `{v}` | Ressemble à : « {v} » |
| `ai.report.hintSeverity` | `{p}` `{v}` | Gravité : {v} ({p}) |
| `ai.set2.modelsFound` | `{n}` | {n} modèle(s) trouvé(s). |
| `ai.set2.stCls` | `{v}` | Classement : {v} |
| `ai.set2.stGen` | `{v}` | Rédaction : {v} |
| `ai.settings.testOk` | `{ms}` `{target}` | {target} : OK ({ms} ms) |
| `ai.sug3.rowsTitle` | `{n}` | Suggestions ({n}) |
| `ai.suggest.selected` | `{n}` | {n} sélectionné(s) |
| `ai.suggest.title` | `{name}` | Suggestions pour {name} |
| `ai.suggest.withProvider` | `{provider}` | Fichiers + {provider} |
| `ai.task.blocked` | `{why}` | Laya n’est pas disponible : {why} |

### analytics

| Clé | Variables | Texte |
|---|---|---|
| `analytics.deletedAll` | `{n}` | Données locales effacées · {n} suppression(s) de paquet demandée(s) |
| `analytics.liveStatus` | `{pending}` `{sent}` | {sent} envoyée(s), {pending} en attente |

### apps

| Clé | Variables | Texte |
|---|---|---|
| `apps.card.from` | `{source}` | de {source} |
| `apps.card.openAria` | `{name}` | Détails de {name} |
| `apps.create.bundled` | `{f}` `{n}` | Publié : {n} application(s) empaquetée(s), {f} |
| `apps.create.clearBody` | `{n}` | Ceci jette le brouillon ({n} entrée(s)). Exportez-le d'abord pour le garder. |
| `apps.create.opened` | `{n}` | Ouvert : {n} application(s) |
| `apps.create.packMissing` | `{n}` | {n} entrée(s) nomment un fichier absent du dossier |
| `apps.create.pbDupe` | `{id}` `{n}` | {id} apparaît {n} fois. Les id doivent être uniques. |
| `apps.create.pbFileOnly` | `{id}` | {id} : un fichier, pas d’adresse. Seule la publication en un fichier le porte. |
| `apps.create.pbNoTitle` | `{id}` | {id} : pas de titre. |
| `apps.create.pbNoUrl` | `{id}` | {id} : pas d'URL de téléchargement. Les lecteurs ignoreront cette entrée. |
| `apps.create.problems` | `{n}` | {n} chose(s) à regarder |
| `apps.create.stillNeeded` | `{x}` | Il manque encore : {x} |
| `apps.detail.versionPair` | `{installed}` `{latest}` | v{installed} installée, v{latest} dans le catalogue |
| `apps.shownOf` | `{n}` `{total}` | {n} sur {total} |
| `apps.someSourcesFailed` | `{n}` | {n} source(s) n'ont pas répondu. Leurs apps manquent ci-dessous. |
| `apps.sourceDisabled` | `{name}` | {name} est désactivée. Elle reste dans Sources. |
| `apps.sourceFailedOne` | `{n}` | {n} source n'a pas répondu. Ses applications manquent ci-dessous. |
| `apps.sources.bundleAdded` | `{n}` | Suivi : {n} application(s) |
| `apps.sources.fromIndex` | `{n}` | {n} catalogue(s) d’apps ajouté(s) depuis cet index. |
| `apps.sources.indexAll` | `{n}` | Cet index liste {n} catalogue(s) d’apps et vous les suivez déjà tous. |
| `apps.sources.indexNone` | `{n}` | Cet index ne liste aucun catalogue d’apps, seulement {n} entrée(s) d’autres types. |
| `apps.sources.indexNone2` | `{what}` | Aucun catalogue d’apps dans cet index, seulement {what}. Ajoute-les depuis leurs écrans. |
| `apps.sourcesFailedMany` | `{n}` | {n} sources n'ont pas répondu. Leurs applications manquent ci-dessous. |
| `apps.state.updatedToast` | `{name}` | {name} : mise à jour terminée |
| `apps.updatesMany` | `{n}` | {n} mises à jour |

### bcv2

| Clé | Variables | Texte |
|---|---|---|
| `bcv2.account.signedInAs` | `{name}` | Connecté en tant que {name} |
| `bcv2.legal.revision` | `{r}` | révision {r} |
| `bcv2.legal.shipped` | `{v}` | vous avez accepté la version {v} |
| `bcv2.legal.version` | `{v}` | Version {v} |

### bench

| Clé | Variables | Texte |
|---|---|---|
| `bench.pointTime` | `{time}` | Heure : {time} |
| `bench.ui.avg` | `{v}` | moy. {v} |
| `bench.ui.elapsed` | `{t}` | {t} écoulées |
| `bench.ui.peak` | `{v}` | pic {v} |
| `bench.ui.samples` | `{n}` | {n} échantillons |
| `bench.ui.stepOf` | `{n}` `{total}` | Étape {n} sur {total} |

### benchmark

| Clé | Variables | Texte |
|---|---|---|
| `benchmark.importFailed` | `{error}` | Échec de l'importation : {error} |
| `benchmark.importSuccess` | `{count}` | {count} points de données importés |

### cat

| Clé | Variables | Texte |
|---|---|---|
| `cat.badType` | `{t}` | Aucun type de catalogue nommé « {t} ». |
| `cat.deleteAsk` | `{k}` | Supprimer le catalogue {k} que cette machine écrit ? |
| `cat.deleted` | `{k}` | Catalogue {k} supprimé |
| `cat.entryOk` | `{id}` `{mode}` `{n}` | {mode} : {id} ({n} entrée(s)) |
| `cat.importedN` | `{n}` | {n} catalogue(s) suivi(s) |
| `cat.pubBadKind` | `{k}` `{list}` | « {k} » n’est pas quelque chose que BMM sait publier. Il connaît : {list} |
| `cat.pubDone` | `{k}` `{n}` | {n} entrée(s) {k} publiée(s). |
| `cat.pubEmpty` | `{k}` | Rien à publier : aucune entrée {k}. Le dossier n’a pas été touché. |

### catpub

| Clé | Variables | Texte |
|---|---|---|
| `catpub.dropped` | `{n}` | {n} entrée(s) laissée(s) de côté |
| `catpub.plusLinked` | `{l}` | plus {l} liée(s) |
| `catpub.split` | `{f}` `{l}` | {f} emballé(s), {l} lié(s) |

### catsrc

| Clé | Variables | Texte |
|---|---|---|
| `catsrc.age.d` | `{n}` | il y a {n} j |
| `catsrc.age.h` | `{n}` | il y a {n} h |
| `catsrc.age.m` | `{n}` | il y a {n} min |
| `catsrc.editor.addIndex` | `{n}` | Ajouter les {n} catalogues |
| `catsrc.export.done` | `{n}` | {n} source(s) exportée(s). |
| `catsrc.health.okN` | `{n}` | OK · {n} éléments |
| `catsrc.import.done` | `{n}` `{s}` | {n} source(s) ajoutée(s), {s} ignorée(s). |
| `catsrc.import.msg` | `{n}` | {n} source(s) seront suivies. Celles que vous suivez déjà sont ignorées. |
| `catsrc.indexAdded` | `{n}` | {n} catalogue(s) ajouté(s) depuis cet index. |
| `catsrc.lastOk` | `{a}` | Actualisée {a} |
| `catsrc.remove.msg` | `{name}` `{url}` | {name} ({url}) ne sera plus lue. Une ligne reste dans l'historique pour la remettre. |
| `catsrc.retryFail` | `{e}` | Toujours pas de réponse : {e} |
| `catsrc.summary` | `{f}` `{n}` `{off}` `{y}` | {n} sources, dont {y} à vous ({off} désactivées). {f} n'ont pas répondu. |
| `catsrc.test.index` | `{n}` | C'est un index : il liste {n} catalogues. |
| `catsrc.test.indexImport` | `{n}` | {n} d'entre eux vont dans cette liste et peuvent être ajoutés d'un coup. |
| `catsrc.test.items` | `{n}` | {n} éléments |
| `catsrc.test.okNamed` | `{name}` | Elle répond : {name} |
| `catsrc.test.warnings` | `{n}` | {n} avertissements |
| `catsrc.via` | `{i}` | via {i} |

### cm

| Clé | Variables | Texte |
|---|---|---|
| `cm.doneBundle` | `{f}` `{n}` | {n} emballé(s) dans {f} : un seul fichier, rien à héberger. |
| `cm.doneJson` | `{f}` `{n}` | {n} entrée(s) écrite(s) dans {f}. |
| `cm.dropped` | `{n}` | {n} entrées inutilisables |
| `cm.fromIndex` | `{n}` | {n} catalogue(s) ajouté(s) depuis cet index. |
| `cm.indexAll` | `{n}` | Cet index liste {n} catalogue(s) de ce type et tu les suis déjà tous. |
| `cm.indexNone` | `{what}` | Aucun catalogue de ce type dans cet index. Il contient {what} ; ajoute-les depuis leurs propres écrans. |
| `cm.searchNone` | `{q}` | Rien ici ne correspond à « {q} ». |
| `cm.someFailed` | `{list}` | Ceux-ci n'ont pas pu être écrits : {list} |

### common

| Clé | Variables | Texte |
|---|---|---|
| `common.contentIdCopied` | `{id}` | Content ID copié : {id}… |
| `common.idCopied` | `{name}` | ID copié : {name} |
| `common.version` | `{version}` | V{version} |

### community

| Clé | Variables | Texte |
|---|---|---|
| `community.filter.count` | `{n}` | {n} articles |

### conflict

| Clé | Variables | Texte |
|---|---|---|
| `conflict.allFiltered` | `{n}` | Rien ne correspond à ces filtres ({n} mod(s) ont des conflits). |
| `conflict.currentlyWins` | `{m}` | {m} est actif : c'est sa version de ces fichiers qui est sur le disque. |
| `conflict.filesCount` | `{count}` | {count} fichier(s) |
| `conflict.flipped` | `{n}` | Fait : {n} fichier(s) ont changé de main. |
| `conflict.groupSource` | `{mod}` `{profile}` | Source : {mod} ({profile}) |
| `conflict.hiddenNote` | `{n}` | {n} autre(s) mod(s) ont des conflits, masqués par les filtres ci-dessus. |
| `conflict.makeWin` | `{m}` | Faire gagner {m} sur ces fichiers |
| `conflict.treeTruncated` | `{n}` `{total}` | Affichage des {n} premiers fichiers partagés sur {total}. |

### consent

| Clé | Variables | Texte |
|---|---|---|
| `consent.sent` | `{n}` | Preuves envoyées : {n} |

### crashmgr

| Clé | Variables | Texte |
|---|---|---|
| `crashmgr.laya.explainNote` | `{model}` | Écrit par {model} à partir du journal masqué. Peut se tromper. |
| `crashmgr.laya.groupN` | `{n}` | Groupe {n} |
| `crashmgr.laya.groups` | `{g}` `{n}` | {n} rapports de crash en {g} groupes de crashs similaires. |
| `crashmgr.laya.similar` | `{g}` `{n}` | Groupe {g} : {n} similaires |
| `crashmgr.laya.stepLine` | `{step}` | À faire : {step} |

### credits

| Clé | Variables | Texte |
|---|---|---|
| `credits.codeCommits` | `{n}` | {n} commits |
| `credits.codeOpenRepo` | `{repo}` | Ouvrir le dépôt {repo} |
| `credits.codeRepoCommits` | `{n}` `{repo}` | {n} commits dans {repo} |
| `credits.codeRepos` | `{n}` | Commits dans {n} dépôts |
| `credits.codeSince` | `{year}` | depuis {year} |
| `credits.stackGroupsN` | `{n}` | {n} groupes |
| `credits.stackShown` | `{n}` `{total}` | {n} sur {total} |
| `credits.stackTotal` | `{n}` | {n} composants open source |

### csp

| Clé | Variables | Texte |
|---|---|---|
| `csp.conns` | `{n}` | Ce que BMM contacte : {n} hôtes |
| `csp.errNotDirective` | `{name}` | « {name} » n'est pas un nom de directive. |
| `csp.executeWarning` | `{n}` | {n} qui autorisent l'exécution de code |
| `csp.shippedPolicy` | `{n}` | Politique livrée : {n} directives |

### cv

| Clé | Variables | Texte |
|---|---|---|
| `cv.allWin` | `{m}` | {m} gagne tous les fichiers |
| `cv.applied` | `{d}` `{n}` | Terminé : {n} fichier(s) recopié(s), {d} mod(s) désactivé(s). |
| `cv.disableM` | `{m}` | Désactiver {m} |
| `cv.files` | `{n}` | {n} fichiers partagés |
| `cv.keepCopy` | `{m}` | Garder la copie de {m} |
| `cv.listCut` | `{n}` `{total}` | Affichage de {n} sur {total}. |
| `cv.makeWin` | `{m}` | Faire gagner {m} |
| `cv.moveDown` | `{m}` | Descendre {m} |
| `cv.moveUp` | `{m}` | Monter {m} |
| `cv.onlyMod` | `{m}` | Seulement {m} |
| `cv.pairsTitle` | `{n}` | Conflits par paire ({n}) |
| `cv.selectAll` | `{n}` | Les {n} fichiers |
| `cv.selected` | `{n}` | {n} sélectionné(s) |
| `cv.selectFile` | `{f}` | Sélectionner {f} |
| `cv.showMore` | `{n}` | Afficher {n} de plus |
| `cv.split` | `{a}` `{b}` `{na}` `{nb}` | {a} : {na}, {b} : {nb} |
| `cv.statusClean` | `{n}` `{p}` | {n} fichiers partagés entre {p} paires de mods. |
| `cv.statusDirty` | `{n}` | Appliquer change {n} fichier(s) sur le disque. |
| `cv.statusDisable` | `{n}` | {n} mod(s) seront désactivés. |
| `cv.winnerFor` | `{f}` | Quelle copie de {f} garder |

### debug

| Clé | Variables | Texte |
|---|---|---|
| `debug.reportGenerated` | `{path}` | Rapport généré : {path} |

### deeplink

| Clé | Variables | Texte |
|---|---|---|
| `deeplink.keyLocked` | `{k}` | La clé {k} est verrouillée, et la phrase de passe fournie ne l’ouvre pas. |
| `deeplink.keyUnknown` | `{k}` | Aucune clé d’identité nommée « {k} » : la requête part non signée. Vérifie l’id dans Réglages → Identité &amp; AP… |
| `deeplink.opened` | `{action}` | Lien profond : {action} |

### detail

| Clé | Variables | Texte |
|---|---|---|
| `detail.originLink` | `{h}` | Un lien · {h} |
| `detail.originRepo` | `{h}` | Dépôt serveur · {h} |
| `detail.originRepoUnverified` | `{h}` | Dépôt serveur · {h} (sans sommes de contrôle) |
| `detail.originSources` | `{n}` | {n} source(s) de mise à jour |
| `detail.originUpdate` | `{h}` | Son propre lien de mise à jour · {h} |

### dev

| Clé | Variables | Texte |
|---|---|---|
| `dev.label.rules` | `{n}` | {n} règles |
| `dev.label.shownOf` | `{n}` `{shown}` | {shown} sur {n} |
| `dev.msg.rustFailed` | `{why}` | Impossible de lire les journaux Rust : {why} |
| `dev.msg.sheetFailed` | `{why}` | Impossible de lire cette feuille : {why} |

### dlg

| Clé | Variables | Texte |
|---|---|---|
| `dlg.refused` | `{action}` `{why}` | Lien refusé ({action}) : {why} |

### docs

| Clé | Variables | Texte |
|---|---|---|
| `docs.diagram.backup-system.n.BUNDLE.desc` | `{date}` `{time}` | Construit un zip avec un manifeste de son contenu, scellé par la phrase secrète si elle est fournie. Une sauv… |
| `docs.diagram.hosting-flow.n.MANIFEST.desc` | `{id}` `{path}` | Écrit uniquement repo.json pour des dossiers de mods déjà sur cette machine (dossiers, profils ou les deux),… |
| `docs.diagram.ui.matches` | `{n}` | {n} trouvé(s) |
| `docs.diagram.ui.nodes` | `{n}` | {n} étapes |
| `docs.diagram.ui.openDiagram` | `{title}` | Ouvrir : {title} |
| `docs.diagram.ui.refs` | `{n}` | {n} références au code |

### fbc

| Clé | Variables | Texte |
|---|---|---|
| `fbc.testFail` | `{url}` `{why}` | Pas de réponse de {url} : {why} |
| `fbc.testOk` | `{kb}` `{kinds}` `{mb}` `{n}` | Joignable · retours actifs · {kinds} · corps {kb} Ko · {n} fichier(s), {mb} Mo max |

### fbm

| Clé | Variables | Texte |
|---|---|---|
| `fbm.anonWhy` | `{n}` | Le rapport part quand même, mais personne ne peut répondre dans BMM et les installations non liées sont limit… |
| `fbm.attachCap` | `{mb}` `{n}` | jusqu’à {n} fichiers, {mb} Mo au total |
| `fbm.budget` | `{max}` `{maxn}` `{n}` `{used}` | {used} sur {max} utilisés · {n} fichier(s) sur {maxn} |
| `fbm.contactLinkedAs` | `{name}` | Envoyé en tant que {name}. Les réponses arrivent dans Messages &amp; signalements et les notifications de BMM. |
| `fbm.skippedBig` | `{f}` | {f} a été laissé de côté : le total dépasserait la limite de taille. |
| `fbm.sumFiles` | `{n}` | {n} fichier(s) |
| `fbm.sumSteps` | `{n}` | {n} indiquée(s) |

### feedback

| Clé | Variables | Texte |
|---|---|---|
| `feedback.filesTooBig` | `{n}` | Les pièces jointes dépassent {n} Mo au total. Enlève la plus grosse et renvoie. |
| `feedback.queueFlushed` | `{n}` | {n} rapport(s) enregistré(s) envoyé(s) à BetterCommunity. |
| `feedback.rateLimited` | `{s}` | Trop de rapports. Réessaie dans {s} s. |
| `feedback.tooLongBody` | `{n}` | Ta description dépasse les {n} Ko acceptés par ce projet. Raccourcis-la, ou mets le détail dans un fichier .t… |
| `feedback.tooManyFiles` | `{n}` | {n} pièces jointes au maximum. Enlèves-en et renvoie. |
| `feedback.versionRefused` | `{v}` | Cette version de BMM est trop ancienne pour envoyer des rapports. Mets à jour vers {v} ou plus récent. |

### flappy

| Clé | Variables | Texte |
|---|---|---|
| `flappy.dead` | `{best}` | Tombé. Cliquez pour recommencer. Record : {best} |
| `flappy.rpcDead` | `{best}` `{n}` | Score de {n} (record {best}) |
| `flappy.rpcPlaying` | `{n}` | En vol : {n} points |

### history

| Clé | Variables | Texte |
|---|---|---|
| `history.revertError` | `{error}` | Erreur lors de l'annulation : {error} |

### hub

| Clé | Variables | Texte |
|---|---|---|
| `hub.assets.promptDesc` | `{n}` | Ce tutoriel inclut {n} assets : des mini-jeux et un pack de mods pour t'entraîner. |
| `hub.deleteAsk` | `{name}` | Supprimer « {name} » ? Le fichier et ta progression sont effacés. |
| `hub.progressOf` | `{done}` `{total}` | {done} étapes faites sur {total} |
| `hub.step` | `{current}` `{total}` | Étape {current}/{total} |

### i18n

| Clé | Variables | Texte |
|---|---|---|
| `i18n.chars` | `{n}` `{src}` | {n} caractères (source : {src}) |
| `i18n.hcFiles` | `{n}` | {n} fichiers |
| `i18n.listCapped` | `{n}` | {n} de plus : affine la recherche pour les voir |
| `i18n.phExtra` | `{name}` | {name} absent de la source |
| `i18n.phMissing` | `{name}` | {name} manquant |
| `i18n.progress` | `{done}` `{lang}` `{pct}` `{total}` | {lang} · {done}/{total} traduites ({pct} %) |

### kofi

| Clé | Variables | Texte |
|---|---|---|
| `kofi.tierAria` | `{n}` | Donner {n} sur Ko-fi |

### launch

| Clé | Variables | Texte |
|---|---|---|
| `launch.ann.opensIn` | `{host}` | Ouvre {host} dans votre navigateur |
| `launch.dotLabel` | `{n}` `{title}` `{total}` | Étape {n} sur {total} : {title} |

### laya

| Clé | Variables | Texte |
|---|---|---|
| `laya.dbg.benchDone` | `{ms}` `{n}` | {n} passages en {ms} ms. |
| `laya.dbg.benchProgress` | `{i}` `{n}` | Passage {i} sur {n} |
| `laya.dbg.decAccept` | `{label}` | Accepterait « {label} » |
| `laya.dbg.decAmbiguous` | `{m}` `{need}` | Trop serré : {m} % d’avance pour {need} % requis |
| `laya.dbg.decBelow` | `{p}` `{t}` | Sous le seuil : {p} % pour {t} % requis |
| `laya.dbg.decRaw` | `{label}` | Score le plus haut : « {label} » |
| `laya.dbg.exported` | `{n}` | {n} appels exportés, sans aucun texte. |
| `laya.dbg.loadMs` | `{ms}` | chargé en {ms} ms |
| `laya.dbg.thresholdMark` | `{t}` | Seuil {t} % |
| `laya.dbg.verifyBad` | `{n}` | {n} fichier(s) ne correspondent pas. Réinstallez le modèle depuis les Paramètres. |
| `laya.dbg.verifyOk` | `{ms}` `{n}` | Les {n} fichiers correspondent à leur empreinte ({ms} ms). |

### legacy

| Clé | Variables | Texte |
|---|---|---|
| `legacy.andMore` | `{n}` `{names}` | {names} et {n} de plus |
| `legacy.failed` | `{error}` | L'import a échoué : {error} |
| `legacy.imported` | `{n}` | {n} profil(s) importé(s) |

### lib

| Clé | Variables | Texte |
|---|---|---|
| `lib.results` | `{m}` `{n}` | {n} sur {m} |
| `lib.sel.count` | `{n}` | {n} sélectionné(s) |
| `lib.sel.disableTip` | `{n}` | Désactiver les {n} mod(s) sélectionné(s) actif(s) |
| `lib.sel.enableTip` | `{n}` | Activer les {n} mod(s) sélectionné(s) inactif(s) |
| `lib.sel.jobDisable` | `{n}` | Désactiver {n} mod(s) sélectionné(s) |
| `lib.sel.jobEnable` | `{n}` | Activer {n} mod(s) sélectionné(s) |
| `lib.subtitle` | `{enabled}` `{s2}` `{total}` | {enabled} actif(s) sur {total} mod{s2} |

### mapper

| Clé | Variables | Texte |
|---|---|---|
| `mapper.actionCancelled` | `{count}` | {count} action(s) annulée(s) |
| `mapper.archiveRezipFailed` | `{err}` | Vos modifications sont enregistrées, mais la recompression a échoué : {err}. Le mod est resté un dossier. |
| `mapper.confirmApply` | `{count}` | Voulez-vous vraiment appliquer ces {count} changements de structure ? |
| `mapper.confirmStagedDelete` | `{count}` | Voulez-vous marquer {count} élément(s) pour suppression définitive ? (Sera appliqué lors du clic sur 'Appliqu… |
| `mapper.itemsMarkedForDelete` | `{count}` | {count} élément(s) marqué(s) pour suppression |
| `mapper.itemsMoved` | `{count}` `{target}` | {count} élément(s) en attente vers « {target} » |
| `mapper.mappingCancelled` | `{count}` | {count} mappages annulés |
| `mapper.modRootMapped` | `{count}` `{target}` | Mod entier ({count} éléments) mappé vers "{target}" |
| `mapper.modRootSelected` | `{count}` | Racine du mod sélectionnée ({count} éléments). Double-cliquez un dossier de destination pour la mapper |
| `mapper.newModsDetected.many` | `{n}` | {n} nouveaux mods détectés et ajoutés automatiquement |
| `mapper.pathCopiedCount` | `{count}` | {count} chemin(s) copié(s) ! |
| `mapper.pv.nFiles` | `{n}` | {n} fichiers |
| `mapper.pv.nOver` | `{n}` | {n} écrasés |
| `mapper.pv.pending` | `{n}` | Modifications à appliquer : {n} |
| `mapper.pv.warnConflicts` | `{names}` | D'autres mods écrivent les mêmes fichiers : {names} |
| `mapper.pv.warnOverwrite` | `{n}` | {n} fichiers remplaceront des fichiers du jeu (sauvegardés avant). |
| `mapper.pv.warnRoot` | `{n}` | {n} fichiers arrivent à la racine du jeu. |

### md

| Clé | Variables | Texte |
|---|---|---|
| `md.sched.ahead` | `{here}` `{span}` `{tz}` | {here} est en avance de {span} sur {tz} en ce moment |
| `md.sched.behind` | `{here}` `{span}` `{tz}` | {here} est en retard de {span} sur {tz} en ce moment |
| `md.sched.same` | `{here}` `{tz}` | {here} est à la même heure que {tz} en ce moment |

### mg

| Clé | Variables | Texte |
|---|---|---|
| `mg.conflicts` | `{n}` | {n} conflit(s) |
| `mg.missingSummary` | `{n}` | {n} dépendance(s) nommée(s) par un mod et fournie(s) par rien : |
| `mg.summary` | `{c}` `{m}` `{r}` | {m} mods · {r} à la racine · {c} paire(s) en conflit |

### mm

| Clé | Variables | Texte |
|---|---|---|
| `mm.cancelError` | `{err}` | Erreur lors de l'annulation : {err} |
| `mm.cat.addLinkName` | `{g}` | Un nom pour lui. Vide pour utiliser « {g} ». |
| `mm.cat.countAll` | `{n}` | {n} liste(s), toutes emballées |
| `mm.cat.doneBundle` | `{f}` `{n}` | {n} liste(s) emballée(s) dans {f}. Un seul fichier, rien à héberger. |
| `mm.cat.doneFolder` | `{l}` `{n}` | Écrit : {n} liste(s) emballée(s), {l} liée(s), plus catalog.json |
| `mm.cat.dropped` | `{n}` | {n} entrée(s) inutilisable(s) |
| `mm.cat.notLists` | `{list}` | Pas des listes de mods, donc écarté(s) : {list} |
| `mm.creds.hosts` | `{list}` | Concerne : {list} |
| `mm.creds.inKeys` | `{list}` `{n}` | {n} clé(s) d’identité privée(s) : {list} |
| `mm.creds.inKeysDone` | `{list}` | Ajoutées à ton trousseau : {list} |
| `mm.creds.inPw` | `{list}` `{n}` | {n} mot(s) de passe de téléchargement, pour : {list} |
| `mm.creds.inPwDone` | `{n}` | {n} mot(s) de passe retenu(s) pour cette session |
| `mm.exportError` | `{err}` | Erreur lors de l'exportation : {err} |
| `mm.fileTree` | `{count}` | Arborescence ({count} fichiers) |
| `mm.importError` | `{err}` | Erreur lors de l'importation : {err} |
| `mm.installError` | `{err}` | Erreur d'installation : {err} |
| `mm.installSuccess` | `{success}` `{total}` | {success}/{total} mod(s) installé(s). |

### mod

| Clé | Variables | Texte |
|---|---|---|
| `mod.activated` | `{name}` | "{name}" activé. |
| `mod.add.conflictFiles` | `{n}` | {n} fichier(s) |
| `mod.add.conflictMore` | `{n}` | et {n} autre(s) |
| `mod.add.conflicts` | `{n}` | Partage des fichiers avec {n} mod(s) actif(s) : le dernier activé l'emporte. |
| `mod.add.copyingSize` | `{size}` | Copie de {size} dans le dossier des mods… |
| `mod.add.failed` | `{e}` | Non ajouté : {e} |
| `mod.add.files` | `{n}` | {n} fichiers |
| `mod.add.kindArchive` | `{type}` | Archive {type} |
| `mod.add.readFailed` | `{e}` | Lecture impossible : {e} |
| `mod.add.sizeArchive` | `{full}` `{packed}` | {packed} compressé, {full} décompressé |
| `mod.added` | `{name}` | "{name}" importé et ajouté à la bibliothèque. |
| `mod.archiveMoreFiles` | `{count}` | + {count} autres fichiers non-affichés pour les performances (cliquez sur Explorer l'archive en haut). |
| `mod.conflictsDesc` | `{mods}` | Ce mod partage des fichiers avec : {mods}. |
| `mod.conflictsFound` | `{n}` | {n} conflit(s) détecté(s) |
| `mod.deactivated` | `{name}` | "{name}" désactivé. |
| `mod.deleteWarning` | `{name}` | Voulez-vous supprimer {name} ? |
| `mod.disabledCount` | `{count}` | {count} mod(s) désactivé(s). |
| `mod.disableDependentsDesc` | `{names}` | Les mods suivants sont liés à celui-ci et pourraient être désactivés : {names}. Voulez-vous les désactiver au… |
| `mod.downloading` | `{name}` | "{name}" en cours de téléchargement... |
| `mod.enabledCount` | `{count}` | {count} mod(s) activé(s). |
| `mod.filesCount` | `{count}` | {count} fichiers installés |
| `mod.idCopied` | `{id}` | ID copié : {id} |
| `mod.importConfirmDesc` | `{name}` | Voulez-vous télécharger et installer &lt;strong&gt;{name}&lt;/strong&gt; ? |
| `mod.installed` | `{name}` | "{name}" a été installé avec succès ! |
| `mod.removed` | `{name}` | "{name}" supprimé définitivement. |
| `mod.removedOnly` | `{name}` | "{name}" retiré de la liste. |
| `mod.removeTagConfirm` | `{name}` | Voulez-vous vraiment retirer le tag {name} de ce mod ? |
| `mod.scanAdded.many` | `{n}` | {n} nouveaux mods ajoutés |
| `mod.scanFound` | `{count}` | {count} mod(s) découvert(s) ! |
| `mod.scanRemoved.many` | `{n}` | {n} mods retirés |

### modpack

| Clé | Variables | Texte |
|---|---|---|
| `modpack.act.bypass` | `{n}` | Activer quand même les {n} mod(s) sans empreintes |
| `modpack.act.conflictInPack` | `{n}` | {n} fichier(s), tous deux dans le pack |
| `modpack.act.conflictOutside` | `{n}` | {n} fichier(s), reste actif |
| `modpack.act.doneFailed` | `{n}` | {n} en échec |
| `modpack.act.doneLine` | `{off}` `{on}` | {on} activé(s), {off} désactivé(s) |
| `modpack.act.doneMissing` | `{n}` | {n} manquant(s) |
| `modpack.act.doneSha` | `{n}` | {n} sans empreintes |
| `modpack.act.exclusiveHint` | `{n}` | Désactive les {n} autre(s) mod(s) actuellement actif(s). |
| `modpack.act.failed` | `{e}` | Le modpack n'a pas pu être activé : {e} |
| `modpack.act.go` | `{n}` | Activer ({n}) |
| `modpack.act.goExclusive` | `{n}` | Désactiver {n} autre(s) mod(s) |
| `modpack.act.integrityWarn` | `{n}` | {n} alerte(s) d'intégrité |
| `modpack.act.jobLabel` | `{name}` | Modpack « {name} » |
| `modpack.act.offLabel` | `{name}` | Désactiver « {name} » |
| `modpack.act.pickSub` | `{n}` | {n} pack(s). Choisissez-en un pour voir ce qu'il change avant que rien ne bouge. |
| `modpack.act.queued` | `{name}` | « {name} » est en cours d'activation en arrière-plan. |
| `modpack.act.title` | `{name}` | Activer « {name} » |
| `modpack.addModErrors` | `{count}` | {count} mod(s) ont échoué. |
| `modpack.applyPartial` | `{applied}` `{missing}` | {applied} mods activés, {missing} manquants. |
| `modpack.cat.build.done` | `{n}` | Catalogue écrit avec {n} pack(s). |
| `modpack.cat.build.doneSome` | `{m}` `{n}` | Catalogue écrit avec {n} pack(s). {m} ignoré(s), sans adresse. |
| `modpack.cat.build.notPack` | `{f}` | {f} n’est pas un modpack, ignoré |
| `modpack.cat.installed` | `{name}` | « {name} » installé. |
| `modpack.cat.someFailed` | `{n}` | {n} catalogue(s) n'ont pas répondu. |
| `modpack.countAll` | `{n}` | {n} packs |
| `modpack.countOf` | `{n}` `{total}` | {n} sur {total} |
| `modpack.createdAt` | `{date}` | Créé le {date} |
| `modpack.modsCount` | `{count}` | {count} mods |
| `modpack.noMatch` | `{q}` | Aucun modpack ne correspond à « {q} ». |
| `modpack.repair.denied` | `{name}` | {name} : accès refusé par le serveur |
| `modpack.repair.incomplete` | `{errors}` | Réparation incomplète : • {errors} |
| `modpack.repair.noLink` | `{name}` | {name} : aucun lien de téléchargement fourni |
| `modpack.repair.noLinkSkipped` | `{name}` | {name} : aucun lien fourni, ignoré. |
| `modpack.repair.notFound` | `{name}` | {name} : fichier introuvable sur le serveur |
| `modpack.repair.partial` | `{errors}` | Réparé, mais certains mods ont été ignorés : • {errors} |
| `modpack.repair.repairing` | `{name}` | Réparation de {name}… |
| `modpack.updatedAt` | `{date}` | Mis à jour le {date} |

### mods

| Clé | Variables | Texte |
|---|---|---|
| `mods.sha.missingDesc` | `{name}` | Le mod "{name}" n'a pas de hachage SHA valide. Pour des raisons de sécurité, il est recommandé de calculer le… |

### notif

| Clé | Variables | Texte |
|---|---|---|
| `notif.dndQuietHours` | `{to}` | Heures calmes jusqu'à {to}. Modifiables dans les paramètres. |
| `notif.jobDone` | `{job}` | Terminé : {job} |
| `notif.jobFailed` | `{err}` `{job}` | Échec : {job}. {err} |
| `notif.repeated` | `{n}` | Reçu {n} fois |
| `notif.snoozedUntil` | `{when}` | retour {when} |
| `notif.unreadN` | `{n}` | {n} non lue(s) |

### nudge

| Clé | Variables | Texte |
|---|---|---|
| `nudge.waiting.many` | `{n}` | {n} autres messages en attente |

### oldInstalls

| Clé | Variables | Texte |
|---|---|---|
| `oldInstalls.backingUp` | `{name}` | Sauvegarde de {name}… |
| `oldInstalls.backupLede` | `{size}` | Ce dossier contient les données de l’ancienne version ({size}). Cette version a déjà sa propre copie. |
| `oldInstalls.backupSaved` | `{path}` | Ta sauvegarde : {path} |
| `oldInstalls.confirmData` | `{size}` | Le dossier ci-dessous ({size}) sera supprimé définitivement. Il ne passe pas par la Corbeille. |
| `oldInstalls.confirmQuickTitle` | `{n}` | Supprimer {n} élément(s) ? |
| `oldInstalls.found` | `{n}` `{size}` | {n} élément(s) trouvé(s), {size} au total |
| `oldInstalls.lineBackup` | `{path}` | Sauvegarde enregistrée : {path} |
| `oldInstalls.lineCancelled` | `{name}` | {name} : désinstallation annulée. |
| `oldInstalls.lineDeleted` | `{name}` | Supprimé : {name} |
| `oldInstalls.lineKept` | `{name}` | Gardé : {name} |
| `oldInstalls.lineStillThere` | `{name}` | {name} est toujours installé. Si son désinstalleur est encore ouvert, termine-le puis relance l’analyse. |
| `oldInstalls.lineUninstalled` | `{name}` | {name} désinstallé. |
| `oldInstalls.pointsTo` | `{path}` | Ouvre {path} |
| `oldInstalls.removeN` | `{n}` | Retirer {n} élément(s)… |
| `oldInstalls.summary` | `{done}` `{failed}` `{skipped}` | {done} retiré(s), {failed} en échec, {skipped} gardé(s). |
| `oldInstalls.uninstalling` | `{name}` | Désinstallation de {name}… Réponds au désinstalleur s’il pose une question. |

### onboarding

| Clé | Variables | Texte |
|---|---|---|
| `onboarding.stepCounter` | `{current}` `{total}` | ÉTAPE {current} / {total} |

### order

| Clé | Variables | Texte |
|---|---|---|
| `order.applied` | `{n}` | Ordre appliqué : {n} fichier(s) redéployé(s) |
| `order.applyFailed` | `{e}` | L'ordre est enregistré, mais le dossier du jeu n'a pas pu être entièrement mis à jour : {e}. Réappliquer term… |
| `order.contested` | `{n}` | {n} fichier(s) partagé(s) |
| `order.import.files` | `{n}` | {n} fichier(s) changent de gagnant |
| `order.import.fromTo` | `{m}` `{n}` | De la position {n} à {m} |
| `order.import.inactive` | `{n}` | {n} inactif(s) |
| `order.import.inactiveList` | `{n}` | Installés, inactifs ({n}) |
| `order.import.missing` | `{n}` | {n} non installé(s) |
| `order.import.missingList` | `{n}` | Non installés ({n}) |
| `order.import.moved` | `{n}` | {n} déplacé(s) |
| `order.import.placed` | `{m}` `{n}` | {n} sur {m} placés |
| `order.lib.moved` | `{f}` `{m}` `{n}` | {m} : position {n}, {f} fichier(s) redéployé(s) |
| `order.lib.position` | `{n}` `{t}` | Position {n} sur {t} |
| `order.loadFailed` | `{e}` | Impossible de lire l'ordre d'activation : {e} |
| `order.more` | `{n}` | +{n} autre(s) |
| `order.moved` | `{m}` `{n}` | {m} déplacé en position {n} |
| `order.overriddenBy` | `{m}` `{n}` | {n} fichier(s) écrasé(s) par {m} |
| `order.overrides` | `{m}` `{n}` | Écrase {n} fichier(s) de {m} |
| `order.pending` | `{n}` | {n} fichier(s) vont changer de main |
| `order.position` | `{n}` | Position {n} |
| `order.reapplied` | `{n}` | Réappliqué : {n} fichier(s) copié(s) |
| `order.share.failed` | `{e}` | Impossible de partager l'ordre : {e} |
| `order.share.lede` | `{n}` | {n} mod(s) actif(s), désignés par ce qu'un autre PC reconnaît, jamais par des chemins locaux. |
| `order.titleFor` | `{p}` | Ordre d'activation : {p} |
| `order.tools.listsCount` | `{n}` | {n} enregistrées |

### orderList

| Clé | Variables | Texte |
|---|---|---|
| `orderList.act.already` | `{n}` | {n} déjà actif(s) |
| `orderList.act.disable` | `{n}` | {n} à désactiver |
| `orderList.act.disableList` | `{n}` | Désactivés ({n}) |
| `orderList.act.enable` | `{n}` | {n} à activer |
| `orderList.act.enableList` | `{n}` | Activés, dans cet ordre ({n}) |
| `orderList.act.missing` | `{n}` | {n} introuvable(s), ignoré(s) |
| `orderList.act.missingList` | `{n}` | Introuvables ({n}) |
| `orderList.activated` | `{d}` `{f}` `{m}` `{n}` | {n} mod(s) activé(s), {d} désactivé(s), {f} fichier(s) redéployé(s), {m} introuvable(s). |
| `orderList.activatedCancelled` | `{d}` `{f}` `{n}` | Arrêté : {n} mod(s) activé(s), {d} désactivé(s), {f} fichier(s) redéployé(s). |
| `orderList.activateFailed` | `{e}` | Échec de l’activation : {e} |
| `orderList.activateTitle` | `{m}` `{p}` | Activer {m} sur {p} |
| `orderList.addedN` | `{n}` | {n} mod(s) ajouté(s). |
| `orderList.addFromProfile` | `{p}` | Ajouter l’ordre de {p} |
| `orderList.addFromProfileTip` | `{p}` | Ajoute les mods actifs de {p}, dans leur ordre actuel, sauf ceux déjà dans la liste |
| `orderList.addSelected` | `{n}` | Ajouter la sélection ({n}) |
| `orderList.applied` | `{n}` | Ordre appliqué à {n} profil(s). |
| `orderList.applyOne` | `{f}` `{n}` | {n} mod(s) placé(s), {f} fichier(s) redéployé(s) |
| `orderList.applyOneFailed` | `{e}` | échec : {e} |
| `orderList.applyPartial` | `{m}` `{n}` | Ordre appliqué à {n} profil(s) sur {m}. Voir ci-dessous. |
| `orderList.applyTitle` | `{m}` | Appliquer l’ordre de {m} |
| `orderList.count` | `{n}` | {n} mod(s) |
| `orderList.deleteConfirm` | `{m}` | Cliquez encore sur Supprimer pour supprimer {m}. |
| `orderList.failed` | `{n}` | Activation impossible ({n}) |
| `orderList.fromProfileName` | `{p}` | Ordre de {p} |
| `orderList.importNotes` | `{n}` | Notes : {n} caractères |
| `orderList.jobLabel` | `{m}` | Liste « {m} » |
| `orderList.loadFailed` | `{e}` | Impossible de lire les listes d’ordre : {e} |
| `orderList.notesChars` | `{n}` | {n} caractères |
| `orderList.notesCount` | `{m}` `{n}` | {n} / {m} caractères |
| `orderList.notesEditorTitle` | `{m}` | Notes : {m} |
| `orderList.nowCalled` | `{m}` | S’appelle maintenant {m} |
| `orderList.pick.results` | `{n}` | {n} résultat(s) |
| `orderList.scopeSome` | `{n}` | Pour {n} profil(s) |
| `orderList.shareFileLedeNotes` | `{n}` | Toute la liste dans un fichier, avec ses {n} caractères de notes. |
| `orderList.shareLen` | `{m}` `{n}` | {n} / {m} caractères |
| `orderList.shareTitle` | `{m}` | Partager « {m} » |
| `orderList.st.active` | `{n}` | Actif, n°{n} |
| `orderList.st.activeTip` | `{n}` `{p}` | Activé dans {p}, en position {n} de son ordre |
| `orderList.st.inactiveTip` | `{p}` | Installé dans {p} mais désactivé : Activer l’allume |
| `orderList.st.outsideTip` | `{p}` | Installé sur ce PC, mais pas dans {p} |
| `orderList.sum.active` | `{n}` | {n} actif(s) |
| `orderList.sum.byName` | `{n}` | {n} reconnu(s) par le nom |
| `orderList.sum.inactive` | `{n}` | {n} installé(s), désactivé(s) |
| `orderList.sum.missing` | `{n}` | {n} introuvable(s) |
| `orderList.viewingFor` | `{p}` | État dans {p} |
| `orderList.viewState` | `{p}` | Afficher l’état des mods dans {p} |

### paths

| Clé | Variables | Texte |
|---|---|---|
| `paths.errFailed` | `{s}` | Impossible de savoir où se trouve « {s} » |

### plugins

| Clé | Variables | Texte |
|---|---|---|
| `plugins.apiChipOn` | `{port}` | API locale · port {port} |
| `plugins.applySuccess` | `{enabled}` | {enabled} mod(s) activé(s) |
| `plugins.assets.added` | `{f}` | {f} ajouté. |
| `plugins.assets.errExists` | `{f}` | Le plugin livre déjà un fichier nommé {f}. Renomme le tien, ou retire celui-là d'abord. |
| `plugins.assets.errTooBig` | `{0}` | Trop gros pour être affiché ({0} Ko). |
| `plugins.assets.removed` | `{f}` | {f} retiré. |
| `plugins.assets.saved` | `{f}` | Enregistré sous {f}. |
| `plugins.assets.title` | `{p}` | Fichiers livrés avec {p} |
| `plugins.auto.imported` | `{n}` | {n} automatisation(s) ajoutée(s), désactivée(s). À relire dans le Planificateur : |
| `plugins.auto.importedOnly` | `{n}` | {n} automatisation(s) ajoutée(s) et laissée(s) éteinte(s). |
| `plugins.autoUpdated` | `{name}` `{v}` | Plugin « {name} » mis à jour en v{v} |
| `plugins.bundle.followed` | `{n}` | {n} catalogue(s) suivi(s) |
| `plugins.bundleBadFile` | `{0}` | Ce n’est pas un bundle de catalogue : {0} |
| `plugins.canJoin` | `{n}` | PEUT REJOINDRE : {n} mod(s) prêt(s) |
| `plugins.cannotJoin` | `{n}` | NE PEUT PAS REJOINDRE : {n} problème(s) |
| `plugins.catNoSource` | `{id}` | « {id} » n'a pas d'adresse et n'est pas installé. Personne ne pourra l'obtenir |
| `plugins.catPacked` | `{f}` | emballé dans {f} |
| `plugins.catPackMissing` | `{list}` `{n}` | Le catalogue nomme {n} fichier(s) absent(s) du dossier : {list} |
| `plugins.catPublished` | `{k}` `{n}` | Écrit : {n} plugin(s) emballé(s), {k} laissé(s) sur leur adresse |
| `plugins.check.missingAsset` | `{f}` | Le manifeste liste le fichier {f}, et il n'est pas là. Cette liste est écrite depuis le disque à l'empaquetag… |
| `plugins.check.missingScript` | `{f}` | Le manifeste déclare le script {f}, et il n'est pas dans le dossier. Le plugin s'installe, l'appliquer n'exéc… |
| `plugins.check.undeclaredAsset` | `{f}` | {f} est dans le dossier mais pas dans le manifeste. Il fonctionne, mais la modération ne voit que le manifest… |
| `plugins.chooseScriptDesc` | `{name}` | « {name} » : choisis un script. Il exécute un vrai programme sur ton PC. |
| `plugins.compareIssues` | `{n}` | {n} problème(s) détecté(s) |
| `plugins.contents.autoAsks` | `{p}` | Écrite pour utiliser : {p} |
| `plugins.contents.autoSteps` | `{n}` | {n} étape(s) |
| `plugins.contents.count` | `{n}` | {n} élément(s) |
| `plugins.contents.folderWhat` | `{n}` `{s}` | {n} fichier(s), {s}. |
| `plugins.contents.missingWhy` | `{f}` | Le manifeste liste « {f} » mais il n'est pas dans le dossier du plugin. Cette partie ne fera rien. |
| `plugins.contents.nFiles` | `{n}` | {n} fichier(s) |
| `plugins.createPermsN` | `{all}` `{n}` | {n} sur {all} demandées |
| `plugins.createSaved` | `{name}` | Plugin '{name}' sauvegardé localement |
| `plugins.deepLinkActivateDesc` | `{name}` | Activer la liste de mods pour '{name}' ? |
| `plugins.deepLinkModDisabled` | `{id}` | Mod '{id}' désactivé |
| `plugins.deepLinkModEnabled` | `{id}` | Mod '{id}' activé |
| `plugins.deepLinkNotFound` | `{id}` | Plugin '{id}' non installé |
| `plugins.deepLinkProfileActivated` | `{id}` | Profil '{id}' activé |
| `plugins.errChecksumMismatch` | `{actual}` `{expected}` | le fichier téléchargé ne correspond pas à la somme de contrôle du catalogue (attendu {expected}, obtenu {actu… |
| `plugins.exportSuccess` | `{name}` | Plugin '{name}' exporté |
| `plugins.fromIndex` | `{n}` | {n} catalogue(s) de plugins ajouté(s) depuis cet index. |
| `plugins.indexAll` | `{n}` | Cet index liste {n} catalogue(s) de plugins et vous les suivez déjà tous. |
| `plugins.indexNone` | `{n}` | Cet index ne liste aucun catalogue de plugins, seulement {n} entrée(s) d’autres types. |
| `plugins.indexNone2` | `{what}` | Aucun catalogue de plugins dans cet index, seulement {what}. Ajoute-les depuis leurs écrans. |
| `plugins.installSuccess` | `{name}` | Plugin '{name}' installé ! |
| `plugins.modsNotFound` | `{mods}` | Mods introuvables : {mods} |
| `plugins.noChecksumBody` | `{name}` | L'entrée du catalogue pour « {name} » n'a pas de SHA-256 : BMM ne peut pas vérifier que le fichier téléchargé… |
| `plugins.pcbAlready` | `{id}` | {id} est déjà dans ce catalogue |
| `plugins.pcbFromFile` | `{f}` | depuis {f} |
| `plugins.pcbNotPlugin` | `{f}` | {f} n’est pas un plugin, laissé de côté |
| `plugins.perm.asksN` | `{all}` `{n}` | En demande {n} sur {all} |
| `plugins.perm.extra` | `{x}` | Accordées sans être demandées : {x} |
| `plugins.permsGranted` | `{n}` `{total}` | {n} / {total} accordées |
| `plugins.ptEmptyResponse` | `{s}` | (réponse vide : {s}) |
| `plugins.ptNetworkError` | `{e}` | Erreur réseau : {e} Vérifiez que BMM est démarré et que l'API tourne sur le port 51274. |
| `plugins.ptTruncated` | `{n}` | [tronqué : {n} caractères] |
| `plugins.qtFieldsRequired` | `{fields}` | {fields} sont obligatoires |
| `plugins.qtPathParam` | `{n}` | Remplace :{n} dans l'adresse. |
| `plugins.runScriptsDesc` | `{n}` `{name}` | « {name} » veut exécuter {n} script(s) externe(s) sur ton ordinateur. Ne continue que si tu fais confiance à… |
| `plugins.scriptsRan` | `{n}` | {n} script(s) lancé(s). |
| `plugins.shipCount` | `{n}` | {n} livré(s) |
| `plugins.shownOf` | `{n}` `{total}` | {n} sur {total} |
| `plugins.tree.archive` | `{n}` | Une archive contenant {n} fichier(s) |
| `plugins.tree.chip` | `{b}` `{f}` | {f} fichier(s) · {b} |
| `plugins.tree.holds` | `{b}` `{n}` | {n} fichiers · {b} |
| `plugins.tree.sum` | `{b}` `{d}` `{f}` | {f} fichier(s) dans {d} dossier(s) · {b} |
| `plugins.uninstallDesc` | `{name}` | Supprimer '{name}' et tous ses fichiers ? |
| `plugins.uninstallSuccess` | `{name}` | Plugin '{name}' supprimé |
| `plugins.updateNeedsChecksum` | `{name}` | {name} : une mise à jour est disponible, mais son entrée de catalogue n'a pas de somme de contrôle. Installez… |

### prof

| Clé | Variables | Texte |
|---|---|---|
| `prof.bgCropError` | `{err}` | Erreur recadrage: {err} |
| `prof.chk.free` | `{drive}` `{free}` | {free} libres sur {drive} |
| `prof.chk.sharedBackup` | `{profiles}` | Déjà le dossier de sauvegarde de : {profiles}. Chaque profil a besoin du sien, sinon désactiver un mod pourra… |
| `prof.chk.sharedGame` | `{profiles}` | C'est aussi le dossier de jeu de : {profiles}. Cela fonctionne : les fichiers qu'un mod dépose dans le jeu ap… |
| `prof.chk.sharedMods` | `{profiles}` | Déjà le dossier des mods de : {profiles}. Les deux profils afficheront les mêmes mods. |
| `prof.confirmDisableSelected` | `{count}` | Voulez-vous désactiver tous les mods des {count} profils sélectionnés ? |
| `prof.created` | `{name}` | Profil "{name}" créé avec succès. |
| `prof.createError` | `{err}` | Impossible de créer le profil : {err} |
| `prof.deleteConfirmLabel` | `{name}` | Voulez-vous vraiment supprimer le profil "{name}" ? Cette action est irréversible. |
| `prof.deleteError` | `{err}` | Erreur lors de la suppression du profil : {err} |
| `prof.duplicateFolderMsg` | `{profile}` | Avertissement : Ce dossier de mods est déjà utilisé par le profil : {profile} |
| `prof.hasActiveMods` | `{count}` | {count} mod(s) sont encore actifs dans ce profil. Voulez-vous les désactiver avant de supprimer ? |
| `prof.importError` | `{err}` `{type}` | Échec de l'import {type} : {err} |
| `prof.importSuccess` | `{count}` `{type}` | {count} profil(s) {type} importé(s) avec succès. |
| `prof.modsActive` | `{count}` | {count} mod(s) actif(s) |
| `prof.modsDisabled` | `{count}` | {count} mod(s) désactivé(s) |
| `prof.need.lead` | `{what}` | Il manque : {what} |
| `prof.ovgmeImported` | `{count}` | {count} profil(s) OvGME importé(s) avec succès. |
| `prof.updated` | `{name}` | Profil "{name}" mis à jour. |

### repo

| Clé | Variables | Texte |
|---|---|---|
| `repo.adv.count` | `{n}` | Outils : {n} |
| `repo.browse.downdetail` | `{s}` | BetterCommunity a répondu HTTP {s}. Problème serveur, pas votre connexion. Réessayez sous peu. |
| `repo.cat.b.count` | `{m}` `{n}` | {n} sur {m} sélectionné(s) |
| `repo.cat.b.pulled` | `{m}` `{n}` | {n} ajouté(s) sur {m}. Les autres étaient déjà là. |
| `repo.cat.followedN` | `{n}` | {n} catalogue(s) suivi(s) |
| `repo.cat.pick.export` | `{n}` | Exporter {n} |
| `repo.cat.saved` | `{n}` | {n} dépôts enregistrés. |
| `repo.checkingMod` | `{name}` | Vérification des mises à jour de « {name} »… |
| `repo.claims` | `{c}` | se dit « {c} » |
| `repo.convert.doneSigned` | `{backup}` `{v}` | Converti au format {v} et signé. Ancien manifeste gardé sous {backup}. |
| `repo.convert.doneUnsigned` | `{backup}` `{v}` | Converti au format {v}, non signé. Ancien manifeste gardé sous {backup}. |
| `repo.convert.go` | `{v}` | Convertir en {v} |
| `repo.convert.lead` | `{from}` `{to}` | Actuellement {from}. Ensuite : format {to}. Rien n'est écrit avant votre confirmation. |
| `repo.convert.more` | `{n}` | Et {n} de plus. |
| `repo.convert.upToDate` | `{v}` | Déjà au format {v}. Rien à changer. |
| `repo.errPortInUse` | `{port}` | Le port {port} est déjà utilisé par une autre application. |
| `repo.extras.applied` | `{n}` | {n} élément(s) ajouté(s) au dépôt. |
| `repo.extras.bundleOf` | `{t}` | Un catalogue de {t}, emporté dans le repo. Aucun autre hébergeur requis. |
| `repo.extras.catalogOf` | `{t}` | Un catalogue {t} que tu suis. |
| `repo.extras.followed` | `{n}` | {n} catalogue(s) suivi(s). |
| `repo.extras.installed` | `{n}` | {n} élément(s) récupéré(s) depuis ce dépôt. |
| `repo.extras.lpDesc` | `{n}` | {n} programme(s) |
| `repo.extras.pending` | `{n}` | Gardé : {n} élément(s) y entreront quand un dépôt sera fait |
| `repo.extras.pendingTag` | `{n}` | {n} en attente |
| `repo.extras.taskAdded` | `{n}` | {n} automatisation(s) ajoutée(s), désactivée(s). |
| `repo.follow.added` | `{name}` | {name} est maintenant suivi. |
| `repo.follow.applied` | `{n}` `{name}` | {name} : {n} mod(s) mis à jour et appliqué(s). |
| `repo.follow.checkFailed` | `{err}` `{name}` | Impossible de vérifier {name} : {err} |
| `repo.follow.downloaded` | `{n}` `{name}` | {name} : {n} mod(s) téléchargé(s). |
| `repo.follow.everyMin` | `{n}` | toutes les {n} minutes |
| `repo.follow.found` | `{n}` `{name}` | {name} : {n} de vos mods ont une mise à jour. |
| `repo.follow.foundManual` | `{n}` `{name}` | {name} : {n} mise(s) à jour trouvée(s), mais BMM ne sait pas à quel profil elles appartiennent. Mettez-les à… |
| `repo.follow.heldGame` | `{n}` `{name}` | {name} : {n} mise(s) à jour trouvée(s). Un jeu est lancé, donc rien n'a été installé ; BMM réessaiera à la pr… |
| `repo.follow.installFailed` | `{err}` `{name}` | {name} : la mise à jour a échoué : {err} |
| `repo.follow.jobOff` | `{name}` | Mise à jour depuis {name} : désactivation des mods |
| `repo.follow.jobOn` | `{name}` | Mise à jour depuis {name} : réactivation des mods |
| `repo.follow.lastCheck` | `{when}` | vérifié le {when} |
| `repo.follow.lastError` | `{err}` | La dernière vérification a échoué : {err} |
| `repo.follow.updates` | `{n}` | {n} mise(s) à jour |
| `repo.follow.upToDate` | `{name}` | {name} : vos mods sont à jour. |
| `repo.followDlg.content` | `{mods}` `{profiles}` | {mods} mod(s) dans {profiles} profil(s) |
| `repo.followDlg.errHttp` | `{code}` | Le serveur a répondu HTTP {code} : il n'y a pas de dépôt à cette adresse, ou il refuse BMM. |
| `repo.followDlg.fmtVersion` | `{v}` | format repo.json {v} |
| `repo.followDlg.testing` | `{url}` | Lecture de {url}… |
| `repo.format.label` | `{v}` | format {v} |
| `repo.format.legacy` | `{v}` | ancien {v} |
| `repo.format.legacyHint` | `{cur}` | Écrit par un ancien BMM. Il fonctionne toujours ; le convertir le passe au format {cur}. |
| `repo.format.needsHint` | `{cur}` | Le BMM actuel ne le lit qu'au prix d'une réparation. Convertissez-le au format {cur}. |
| `repo.format.tooNew` | `{v}` | format {v} (plus récent que ce BMM) |
| `repo.head.historyCount` | `{n}` | {n} dépôts dans votre historique |
| `repo.head.joined` | `{name}` | Rejoint : {name} |
| `repo.hiddenN` | `{n}` | {n} masqué(s) par toi |
| `repo.hostMetaMods` | `{n}` | {n} mod(s) |
| `repo.modBaselined` | `{name}` | Suivi de « {name} » activé. Revérifiez plus tard pour détecter une nouvelle version. |
| `repo.modNoSource` | `{name}` | « {name} » n'a aucune source de mise à jour. Utilisez « Configurer les mises à jour » pour en lier une. |
| `repo.modSourceUnreachable` | `{name}` | Impossible de joindre la source de mise à jour de « {name} » |
| `repo.modUpToDate` | `{name}` | « {name} » est à jour |
| `repo.notifClientConnectedDetail` | `{creator_id}` `{protocol}` | {protocol} · ID : {creator\_id} |
| `repo.notifDownloadFinishedDetail` | `{creator_id}` `{file}` | {creator\_id} a fini de télécharger {file} |
| `repo.notifDownloadStartedDetail` | `{creator_id}` `{file}` | {creator\_id} télécharge {file} |
| `repo.preview.extras` | `{n}` | Extras (plugins, thèmes, listes…) : {n} |
| `repo.preview.modpacks` | `{n}` | Modpacks partagés : {n} |
| `repo.preview.total` | `{files}` `{size}` | {files} fichiers, {size} au total |
| `repo.profilesCount` | `{count}` | Profils ({count}) : |
| `repo.quick.doneFolder` | `{dir}` `{n}` | repo.json écrit dans {dir}. Mods décrits : {n}. |
| `repo.quick.doneModpack` | `{dir}` `{n}` | Dépôt créé dans {dir}. Mods ajoutés : {n}. |
| `repo.quick.doneProfile` | `{dir}` | Dépôt créé dans {dir}. |
| `repo.quick.modsN` | `{n}` | {n} mods |
| `repo.quick.overwrite` | `{dir}` | {dir} contient déjà un dépôt. Le reconstruire depuis ce profil ? |
| `repo.remote.errEmptyDir` | `{0}` | Rien trouvé sous {0}. Est-ce bien le dossier des mods ? |
| `repo.serverOnline` | `{port}` | Serveur en ligne : port {port} |
| `repo.share.message` | `{link}` `{name}` `{url}` | Rejoins mon dépôt BMM « {name} » : {link} Ou dans BMM : Server Repo, onglet Synchroniser, colle {url} puis Ré… |
| `repo.ssh.browserPicked` | `{dir}` | Dossier distant : {dir} |
| `repo.ssh.downloading` | `{done}` `{file}` `{total}` | Réception {done}/{total} : {file} |
| `repo.ssh.errAuth` | `{detail}` | Échec de l’authentification : {detail} |
| `repo.ssh.errBadManifest` | `{detail}` | Le repo.json du serveur est illisible : {detail} |
| `repo.ssh.errConnect` | `{detail}` `{host}` | Impossible de joindre {host} : {detail} |
| `repo.ssh.errGeneric` | `{detail}` | Échec de l'opération SSH : {detail} |
| `repo.ssh.errHostKeyChanged` | `{fp}` | L’empreinte de ce serveur a changé ({fp}). Refusé. Si vous avez reconstruit la machine, utilisez « Oublier l’… |
| `repo.ssh.errKeyDecode` | `{detail}` | Ce fichier n’est pas une clé privée lisible par BMM : {detail} |
| `repo.ssh.errKeyRead` | `{detail}` | Impossible de lire le fichier de clé : {detail} |
| `repo.ssh.errListDir` | `{detail}` `{dir}` | Lecture impossible du dossier distant {dir} : {detail} |
| `repo.ssh.errLocalDir` | `{dir}` | {dir} n’est pas un dossier. |
| `repo.ssh.errLocalWrite` | `{detail}` `{path}` | Écriture impossible dans {path} : {detail} |
| `repo.ssh.errNoManifest` | `{dir}` | Aucun repo.json dans {dir} sur le serveur. Le dossier distant pointe probablement un niveau trop haut, ou sur… |
| `repo.ssh.errNoSuchTarget` | `{name}` | Aucune cible SSH enregistrée sous le nom « {name} ». Vérifiez le nom dans « Publier par SSH ». |
| `repo.ssh.errOpenRemote` | `{detail}` `{path}` | Ouverture impossible de {path} : {detail} |
| `repo.ssh.errReadRemote` | `{detail}` `{path}` | Lecture impossible de {path} : {detail} |
| `repo.ssh.errRemoteMissing` | `{dir}` | Le dossier distant {dir} n’existe pas. |
| `repo.ssh.errSftp` | `{detail}` | SFTP n’a pas pu démarrer sur le serveur : {detail} |
| `repo.ssh.errUnsafePath` | `{path}` | Le serveur a renvoyé un chemin qui sortirait du dossier de destination ({path}). Transfert interrompu. |
| `repo.ssh.pullConfirm` | `{dir}` | Récupérer le dépôt distant dans {dir} ? Les fichiers de même nom seront écrasés par la version du serveur. Le… |
| `repo.ssh.pulled` | `{n}` `{size}` | {n} fichier(s) récupérés ({size}). |
| `repo.ssh.testNoDir` | `{dir}` | Connecté, mais {dir} n’existe pas encore. Il sera créé au premier envoi. |
| `repo.ssh.testNotWritable` | `{dir}` | Connecté, mais {dir} n’est pas accessible en écriture. L’envoi échouerait après avoir tout transféré : corrig… |
| `repo.ssh.testOk` | `{fp}` | Connecté. Empreinte {fp}. |
| `repo.ssh.testOkButNot` | `{fp}` | Connecté (empreinte {fp}), mais la publication échouerait. Voir ci-dessous. |
| `repo.ssh.testWhyFix` | `{dir}` `{user}` | Sur le serveur : sudo chown {user} {dir}, ou publiez dans un sous-dossier à vous, par ex. {dir}/bmm. |
| `repo.ssh.testWhyOwner` | `{dir}` `{mode}` `{owner}` `{user}` | {dir} appartient à l'uid {owner} (mode {mode}) et BMM s'est connecté en tant que « {user} », qui ne peut pas… |
| `repo.ssh.uploaded` | `{n}` `{size}` | Publié : {n} fichiers, {size}. |
| `repo.ssh.uploading` | `{done}` `{file}` `{total}` | Envoi {done}/{total} : {file} |
| `repo.static.done` | `{n}` | Fichiers écrits dans le dossier du dépôt : {n} |
| `repo.static.md.share` | `{url}` | Dans BMM : Server Repo, onglet Synchroniser, collez {url} puis Récupérer. L'outil Lien de partage fait aussi… |
| `repo.stepChecking` | `{current}` `{mod}` `{profile}` `{total}` | Vérification : {profile} - {mod} ({current}/{total}) |
| `repo.stepDownloading` | `{current}` `{mod}` `{profile}` `{total}` | Téléchargement : {profile} - {mod} ({current}/{total}) |
| `repo.stepExporting` | `{current}` `{mod}` `{profile}` `{total}` | Export : {profile} - {mod} ({current}/{total}) |
| `repo.stepFetchingPart` | `{current}` `{mod}` `{profile}` `{total}` | Récupération part : {profile} - {mod} (Bloc {current}/{total}) |
| `repo.stepPreparing` | `{current}` `{mod}` `{profile}` `{total}` | Préparation : {profile} - {mod} ({current}/{total}) |
| `repo.update.matchN` | `{m}` `{n}` | {n} sur {m} |
| `repo.update.modN` | `{n}` | {n} mods |
| `repo.update.published` | `{n}` | {n} fichier(s) publié(s). |
| `repo.update.publishMsg` | `{name}` | Le dossier ci-dessus remplace ce que « {name} » sert en ce moment. Toute personne qui synchronise recevra la… |
| `repo.update.pulled` | `{n}` | {n} fichier(s) récupéré(s). Modifiez ci-dessous, puis republiez. |
| `repo.update.showMore` | `{n}` | Afficher {n} de plus |
| `repo.update.urlNoTarget` | `{name}` | Aucune cible SSH nommée « {name} ». Ajoutez-la dans Publier par SSH. |
| `repo.updateApply` | `{count}` | Mettre à jour {count} mod(s) |
| `repo.updatesBaselined` | `{count}` | Suivi de {count} téléchargement(s) direct(s) activé. Revérifiez plus tard pour détecter les changements. |
| `repo.updatesFound` | `{count}` | {count} mise(s) à jour disponible(s) |
| `repo.updatesRepoErrors` | `{count}` | {count} repo(s) injoignable(s) |
| `repo.validate.cacheHits` | `{n}` | {n} fichiers inchangés n'ont pas été relus (cochez « Relire chaque fichier » pour forcer). |
| `repo.validate.changed` | `{n}` | Fichiers différents du repo.json : {n}. |
| `repo.validate.duplicateIds` | `{n}` | Mods présents deux fois dans un profil : {n}. |
| `repo.validate.emptyProfiles` | `{n}` | Profils sans aucun mod : {n}. |
| `repo.validate.filled` | `{n}` | Fichiers sans empreinte : {n}. |
| `repo.validate.formatNewer` | `{v}` | Format {v} : plus récent que ce BMM. Lisible, certains champs peuvent être ignorés. |
| `repo.validate.formatOk` | `{v}` | Format {v} : à jour. |
| `repo.validate.formatOld` | `{cur}` `{v}` | Format {v} : plus ancien que {cur}. |
| `repo.validate.formatTooNew` | `{v}` | Format {v} : trop récent pour ce BMM. Mettez BMM à jour pour le vérifier. |
| `repo.validate.missing` | `{n}` | Fichiers listés absents : {n}. |
| `repo.validate.progress` | `{done}` `{of}` `{size}` `{total}` | {done} / {total} fichiers · {size} sur {of} |
| `repo.validate.summary` | `{files}` `{mods}` `{profiles}` `{size}` | {profiles} profils, {mods} mods, {files} fichiers, {size}. |
| `repo.validate.took` | `{s}` | Vérifié en {s} s. |
| `repo.validate.verdictBad` | `{n}` | Problèmes à corriger avant de partager : {n}. |
| `repo.validate.verdictWarn` | `{n}` | Utilisable. Points à regarder : {n}. |
| `repo.validate.which` | `{n}` | Voir lesquels ({n}) |
| `repo.version.alsoConverts` | `{v}` | Le manifeste est converti au format {v} en même temps. |
| `repo.version.confirm` | `{from}` `{to}` | Passer la version de {from} à {to} et re-signer le repo.json ? |
| `repo.version.done` | `{backup}` `{v}` | Version {v} appliquée et signée. Ancien manifeste gardé sous {backup}. |
| `repo.version.same` | `{v}` | Le dépôt est déjà en {v}. |

### res

| Clé | Variables | Texte |
|---|---|---|
| `res.byTask` | `{m}` | choisi par une tâche, encore {m} min |
| `res.inForce` | `{p}` | En vigueur : {p} |
| `res.pausedBy.plugin` | `{n}` | Suspendu par le plugin {n}. |
| `res.pausedBy.task` | `{n}` | Suspendu par la tâche « {n} ». |
| `res.pausedLeft` | `{m}` | Reprise automatique dans {m} min. |

### resources

| Clé | Variables | Texte |
|---|---|---|
| `resources.link.presetSet` | `{name}` | Préréglage de ressources : {name} |

### restore

| Clé | Variables | Texte |
|---|---|---|
| `restore.confirmBody` | `{n}` | {n} section(s) vont écraser ce qui est là actuellement. |
| `restore.count` | `{n}` `{size}` | {n} fichier(s) · {size} |
| `restore.done` | `{n}` | {n} fichier(s) restauré(s). Rechargement… |
| `restore.failed` | `{error}` | La restauration a échoué : {error} |
| `restore.notif` | `{n}` `{sections}` | {n} fichier(s) restauré(s) depuis un .DATABMM : {sections}. |
| `restore.previousAt` | `{path}` | Tes données précédentes sont dans {path} |
| `restore.unreadable` | `{error}` | Ce fichier n'a pas pu être lu comme un .DATABMM : {error} |
| `restore.written` | `{version}` `{when}` | Écrit le {when} par BMM {version} |

### rstudio

| Clé | Variables | Texte |
|---|---|---|
| `rstudio.cutsnapped` | `{s}` | La coupe se termine à {s}s, au prochain point de reprise. |

### sched

| Clé | Variables | Texte |
|---|---|---|
| `sched.ai.tainted` | `{f}` | La réponse de Laya ne peut pas servir dans « {f} » de cette étape. Utilisez plutôt une étiquette pour choisir… |
| `sched.arm.done` | `{n}` `{s}` | « {n} » mise sur {s} |
| `sched.arm.gone` | `{n}` | aucune tâche avec l’id {n}, rien n’a changé |
| `sched.bk.done` | `{f}` `{mb}` `{n}` | {f} écrit ({mb} Mo, {n} section(s)) |
| `sched.bl.overwriteTitle` | `{n}` | Remplacer le bloc « {n} » ? |
| `sched.bl.overwriteUsed` | `{n}` | Les blocs sont partagés par toutes les tâches : ça remplace donc ce qu'exécutent {n} appelant(s) : |
| `sched.bl.saved` | `{n}` | « {n} » enregistré. |
| `sched.bmms.ok` | `{n}` | {n} étape(s) |
| `sched.call.missing` | `{n}` | Aucun bloc nommé « {n} ». |
| `sched.catBundled` | `{f}` | Empaqueté dans {f}. |
| `sched.catDone` | `{n}` | {n} entrée(s) publiée(s). |
| `sched.catEmpty` | `{k}` | rien à publier pour « {k} », aucun catalogue écrit |
| `sched.chainLoop` | `{n}` `{name}` | Chaîne arrêtée après {n} tâches : « {name} » s’attend elle-même en boucle. |
| `sched.cond.gonePlugin` | `{n}` | {n} (pas installé ici) |
| `sched.creds.keyActive` | `{k}` | La clé active ({k}) |
| `sched.creds.keyMissing` | `{k}` | {k} (n'est plus sur le trousseau) |
| `sched.dbg.finishedLine` | `{n}` `{s}` `{w}` | {w} : {n} étape(s), {s} s |
| `sched.dbg.modeUntil` | `{n}` | jusqu'à « {n} » |
| `sched.dbg.trailN` | `{n}` | {n} valeur(s) |
| `sched.dcsHookOff` | `{n}` | Surveillance DCS retirée de {n} dossier(s). |
| `sched.dcsHookOk` | `{n}` | Surveillance DCS installée dans {n} dossier(s). |
| `sched.dl.steps` | `{n}` | {n} étape(s) |
| `sched.exp.missing` | `{n}` | {n} tâche(s) référencée(s) n’existent plus et ne peuvent pas être incluses. |
| `sched.exp.withSubs` | `{n}` | Inclut {n} tâche(s) appelée(s) par celle-ci. |
| `sched.exportedN` | `{n}` | {n} automatisation(s) exportée(s) |
| `sched.filter.n` | `{n}` `{total}` | {n} sur {total} |
| `sched.filter.total` | `{total}` | {total} tâches |
| `sched.flag.denied` | `{k}` `{list}` | « {k} » n’est pas un réglage de stockage qu’une tâche peut changer. Autorisés : {list}. |
| `sched.flow.delMany` | `{n}` | Supprimer ces {n} étapes, et tout ce qu’elles contiennent ? |
| `sched.flow.folded` | `{n}` | {n} à l’intérieur, replié |
| `sched.flow.lastRun` | `{when}` | Dernière exécution {when} |
| `sched.flow.nBranches` | `{n}` | {n} branche(s) |
| `sched.flow.nCases` | `{n}` | {n} cas |
| `sched.flow.needs` | `{what}` | demande « {what} » |
| `sched.gen.done` | `{n}` | Dépôt écrit dans {n} |
| `sched.gen.errGone` | `{n}` | Profil(s) absent(s) de cette machine : {n} |
| `sched.gw.found` | `{f}` `{n}` | {n} trouvé(s), {f} retenu |
| `sched.gw.ready` | `{f}` | surveille {f} |
| `sched.http.badUrl` | `{u}` | Ce n’est pas une adresse http(s) : {u} |
| `sched.http.status` | `{s}` `{u}` | HTTP {s} depuis {u} |
| `sched.imp.checked` | `{n}` | la sauvegarde s'ouvre ({n} section(s)) |
| `sched.imp.plugin` | `{p}` | plugin « {p} » installé |
| `sched.imp.read` | `{n}` | liste de {n} mod(s) lue |
| `sched.imp.restored` | `{n}` | {n} section(s) RESTAURÉE(S) par-dessus les données actuelles |
| `sched.imp.tasks` | `{n}` | {n} automatisation(s) ajoutée(s), désactivée(s) |
| `sched.imp.unknownKind` | `{k}` | rien ici ne sait lire un « {k} » |
| `sched.importedIncl` | `{n}` | {n} élément(s) nécessaire(s) également restauré(s) |
| `sched.importStripped` | `{p}` | Importé désactivé. Il demandait : {p}. Accordez ce que vous voulez dans ses permissions. |
| `sched.insp.unresolved` | `{n}` | Désigne {n} élément(s) qu’il n’inclut pas (ils échoueront sur une autre machine) : |
| `sched.key.exists` | `{k}` | « {k} » est déjà sur le trousseau, laissée telle quelle |
| `sched.key.made` | `{k}` | clé d'identité « {k} » créée |
| `sched.listApply.done` | `{new}` `{on}` | {on} mod(s) activé(s), {new} installé(s). |
| `sched.listApply.missing` | `{n}` | {n} mod(s) introuvable(s) |
| `sched.net.badHeader` | `{s}` | L’en-tête « {s} » a un nom ou une valeur inutilisable. |
| `sched.net.error` | `{s}` | Erreur réseau : {s} |
| `sched.net.refused` | `{why}` | Refusé avant l’envoi : {why}. |
| `sched.net.status` | `{s}` | Le serveur a répondu HTTP {s}. |
| `sched.order.notActive` | `{m}` | « {m} » n'est pas actif : il n'a pas de place dans l'ordre de déploiement. |
| `sched.pa.copied` | `{f}` | {f} copié |
| `sched.pa.missing` | `{p}` | {p} (plus installé) |
| `sched.pa.ran` | `{f}` | {f} exécuté |
| `sched.par.branch` | `{n}` | BRANCHE {n} |
| `sched.par.some` | `{m}` `{n}` | {n} branche(s) parallèle(s) sur {m} ont échoué |
| `sched.pc.doneToast` | `{n}` | {n} automatisation(s) trouvée(s) dans les catalogues |
| `sched.pc.e403` | `{c}` | Ce catalogue est privé ({c}). |
| `sched.pc.e5xx` | `{c}` | Erreur serveur ({c}). Votre adresse est correcte. |
| `sched.pc.followed` | `{n}` | Suivi : {n} automatisation(s). |
| `sched.pc.followedBundle` | `{n}` | Bundle suivi : {n} automatisation(s), aucun hébergeur nécessaire. |
| `sched.pc.fromIndex` | `{n}` | {n} catalogue(s) d’automatisations ajouté(s) depuis cet index. |
| `sched.pc.indexAll` | `{n}` | Cet index liste {n} catalogue(s) d’automatisations et vous les suivez déjà tous. |
| `sched.pc.indexNone` | `{n}` | Cet index ne liste aucun catalogue d’automatisations ({n} entrée(s) d’autres types). |
| `sched.pc.skipped` | `{n}` | {n} ignoré(s) |
| `sched.permDenied` | `{what}` | Cette tâche n’a pas le droit de {what}. Accordez-le dans ses permissions. |
| `sched.permsN` | `{n}` `{total}` | {n} sur {total} accordées |
| `sched.pg.applied` | `{t}` | Parti de « {t} ». Modifiez ce que vous voulez. |
| `sched.pg.inner` | `{n}` | +{n} à l’intérieur |
| `sched.pg.permsNeed` | `{p}` | Nécessite {p}. Laissée décochée : accordez-la après avoir lu les étapes. |
| `sched.pg.steps` | `{n}` | {n} étape(s) |
| `sched.pg.sub` | `{n}` | {n} tâches prêtes à l’emploi. Chacune est complète et fait quelque chose d’utile telle quelle ; choisissez-en… |
| `sched.presetd.sharedvar` | `{sharedNote}` | Écrit une variable partagée que toutes les autres tâches peuvent lire par {sharedNote}. Une brique de constru… |
| `sched.presetReplaceBody` | `{n}` | Un préréglage remplace cette tâche : {n} étape(s), son nom, son déclencheur et ses permissions. L'annulation… |
| `sched.prev.lede` | `{c}` `{n}` | {c} étape(s) sur {n} changeraient réellement quelque chose. |
| `sched.prev.noteMaybe` | `{m}` | Lu depuis les étapes. Rien n'a été exécuté. {m} d'entre elles dépendent d'une condition de branche ou de bouc… |
| `sched.prof.errGone` | `{n}` | Aucun profil avec l’id {n} |
| `sched.prof.made` | `{n}` | « {n} » créé |
| `sched.prof.reused` | `{n}` | Le profil « {n} » existe déjà : réutilisé |
| `sched.ref.more` | `{n}` | {n} de plus. Affine la recherche pour les voir. |
| `sched.retry.again` | `{n}` `{t}` | échec, tentative {n} sur {t}… |
| `sched.retry.againIn` | `{s}` | en échec, nouvel essai dans {s} s |
| `sched.rm.done` | `{a}` `{c}` `{n}` `{r}` | {n} mod(s) indexé(s) : {a} ajouté(s), {c} modifié(s), {r} RETIRÉ(S) |
| `sched.scrEngOk` | `{program}` `{version}` | S’exécutera avec {program} ({version}) sur cet ordinateur. |
| `sched.sparkFails` | `{m}` `{n}` | {n} des {m} dernières exécutions ont échoué |
| `sched.sparkOk` | `{m}` | les {m} dernières exécutions se sont bien passées |
| `sched.ssh.targetDefault` | `{n}` | Celui par défaut ({n}) |
| `sched.ssh.targetMissing` | `{n}` | {n} (n'est plus enregistré) |
| `sched.switchGap` | `{m}` | Non traités : {m} (DEFAULT les absorbe). |
| `sched.syncMadeProfile` | `{n}` | Profil « {n} » créé |
| `sched.syncNoManifest` | `{e}` | Impossible de lire ce dépôt (pas de repo.json, ou injoignable) : {e} |
| `sched.syncPickProfile` | `{list}` | Indiquez quel profil du dépôt synchroniser. Disponibles : {list} |
| `sched.tcb.count` | `{n}` | {n} sélectionnée(s) |
| `sched.tcb.countMix` | `{e}` `{l}` `{n}` | {n} sélectionnée(s) ({e} emballée(s), {l} liée(s)) |
| `sched.tcb.done` | `{n}` | Catalogue écrit : {n} automatisation(s) plus catalog.json |
| `sched.tcb.doneMix` | `{e}` `{l}` | Catalogue écrit : {e} automatisation(s) emballée(s), {l} liée(s), plus catalog.json |
| `sched.tcb.dropped` | `{n}` | {n} entrée(s) laissée(s) de côté |
| `sched.tcb.notTask` | `{f}` | {f} n’est pas une automatisation, ignoré |
| `sched.tcb.packed` | `{f}` | enregistré sous {f} |
| `sched.tcb.packMissing` | `{list}` `{n}` | Le catalogue nomme {n} fichier(s) absent(s) du dossier : {list} |
| `sched.test.confirm` | `{s}` | Tester « {s} » l’exécute pour de vrai : ce qu’elle modifie sera modifié. Continuer ? |
| `sched.trRssFound` | `{n}` `{t}` | {n} élément(s), le plus récent : {t} |
| `sched.trScr.loaded` | `{f}` | {f} chargé |
| `sched.v.json` | `{variable}` | JSON invalide (en remplaçant chaque {variable} par du texte). |
| `sched.valid.wrongFormat` | `{got}` `{want}` | Attendu {want}, reçu {got}. |
| `sched.var.badName` | `{n}` | Nom de variable inutilisable : {n} |
| `sched.view.badWindow` | `{n}` | Ce n’est pas une fenêtre que cette étape peut ouvrir : {n} |
| `sched.view.gone` | `{n}` | {n} (n’est plus un écran) |
| `sched.wait.gaveUp` | `{n}` `{s}` | abandon après {n} tentatives (dernière réponse {s}) |
| `sched.wait.noSignal` | `{h}` | aucun signal sur « {h} » avant l'expiration |
| `sched.wh.badHeader` | `{h}` | Ce n’est pas une ligne d’en-tête : {h} |
| `sched.wh.badJson` | `{e}` | Le corps n’est pas du JSON valide : {e} |
| `sched.why.afterArming` | `{v}` | Surveille la fin de « {v} » |
| `sched.why.afterIdle` | `{v}` | En attente de la fin de « {v} » |
| `sched.why.dueAt` | `{v}` | prévue {v} |
| `sched.why.eventArming` | `{v}` | à l'écoute de {v} |
| `sched.why.eventIdle` | `{v}` | attend {v} |
| `sched.why.probeIdle` | `{v}` | Le script n’a pas dit oui (vérifié toutes les {v} min) |
| `sched.why.rssArming` | `{v}` | Surveille {v} : la première vérification apprendra ce qui s’y trouve. |
| `sched.why.rssIdle` | `{v}` | Surveille {v} : aucun nouvel élément depuis la dernière vérification. |
| `sched.why.watchArming` | `{v}` | apprend {v} |
| `sched.why.watchIdle` | `{v}` | attend que {v} change |

### settings

| Clé | Variables | Texte |
|---|---|---|
| `settings.appPicker.error` | `{err}` | Erreur : {err} |
| `settings.appPicker.selected` | `{n}` | {n} sélectionné(s) |
| `settings.bcKey.okN` | `{n}` | {n} notification(s) récupérée(s). |
| `settings.bundleEmpty` | `{x}` | Rien à prendre pour : {x}. |
| `settings.bundleExported` | `{mb}` `{n}` | {mb} Mo écrits ({n} section(s)). |
| `settings.catIndex.added` | `{n}` | {n} source(s) de catalogue ajoutée(s). |
| `settings.catIndex.already` | `{n}` | {n} déjà présent(s). |
| `settings.catIndex.holds` | `{n}` | Cet index liste {n} catalogue(s). |
| `settings.catIndex.makeDone` | `{n}` | Index écrit avec {n} catalogue(s). |
| `settings.catIndex.skipped` | `{n}` | {n} ignoré(s). |
| `settings.catIndex.state.ok` | `{n}` | OK · {n} éléments |
| `settings.catIndex.willAdd` | `{what}` | Sera ajouté : {what}. |
| `settings.creatorKey.protection` | `{what}` | Protection de la clé créateur : {what} |
| `settings.creatorKey.refused` | `{why}` | Le magasin de la clé créateur a été refusé : {why} |
| `settings.creatorKey.resetDone` | `{cid}` | Identité créateur réinitialisée. Creator ID : {cid} |
| `settings.creatorKey.resetFailed` | `{why}` | Échec de la réinitialisation : {why} |
| `settings.creatorKey.state` | `{seq}` | Creator ID épinglé à cette installation. Rotations de clé : {seq} |
| `settings.dataExportError` | `{err}` | Erreur export : {err} |
| `settings.dataImportError` | `{err}` | Erreur import : {err} |
| `settings.discordRpcDetails` | `{name}` | Profil : {name} |
| `settings.discordRpcStatus` | `{count}` | {count} mods activés |
| `settings.identity.authKeyAuto` | `{name}` | Par défaut ({name}) |
| `settings.langDownloadError` | `{err}` | Erreur download : {err} |
| `settings.langImportError` | `{err}` | Échec de l'importation : {err} |
| `settings.langRemoveConfirm` | `{code}` `{name}` | Supprimer la langue « {name} » ({code}) ? Cela supprime son fichier .json. |
| `settings.langRemoved` | `{name}` | {name} supprimée |
| `settings.launchPackDeleteConfirmText` | `{name}` | Êtes-vous certain de vouloir supprimer le pack {name} ? |
| `settings.launchPackError` | `{err}` | Erreur : {err} |
| `settings.link.done` | `{name}` | Lié en tant que {name}. |
| `settings.lpImported` | `{n}` | « {n} » importé |
| `settings.lpImportedMissing` | `{c}` `{n}` | « {n} » importé : {c} programme(s) introuvable(s) sur ce PC |
| `settings.searchCount` | `{n}` | Sections trouvées : {n} |
| `settings.searchEmpty` | `{q}` | Aucun réglage ne correspond à « {q} ». |
| `settings.shortcutError` | `{err}` | Erreur sauvegarde raccourci : {err} |
| `settings.shortcutUpdated` | `{key}` | Raccourci mis à jour ({key}) |
| `settings.tagCreateError` | `{err}` | Erreur création tag : {err} |
| `settings.tagDeleteError` | `{err}` | Erreur suppression tag : {err} |
| `settings.tipsRestored` | `{n}` | {n} astuce(s) réaffichée(s). |

### sha

| Clé | Variables | Texte |
|---|---|---|
| `sha.act.bgNow` | `{name}` | Hachage de {name} |
| `sha.act.idle` | `{h}` `{n}` | Rien en cours. {h} mods sur {n} ont une référence. |
| `sha.act.queue` | `{n}` | {n} en attente |
| `sha.act.run` | `{i}` `{n}` `{name}` | Vérification {i} sur {n} : {name} |
| `sha.andMore` | `{n}` | et {n} de plus |
| `sha.cap` | `{a}` `{b}` | {a} affichés sur {b}. Cherchez pour réduire la liste. |
| `sha.cidTip` | `{id}` | Content id : l'empreinte du mod entier. {id} |
| `sha.copyHash` | `{f}` | Copier le hash de {f} |
| `sha.done.bad` | `{n}` | {n} avec des différences |
| `sha.done.failed` | `{n}` | {n} illisible(s) |
| `sha.done.ok` | `{n}` | {n} conforme(s) |
| `sha.done.skipped` | `{n}` | {n} sans hash ignoré(s) |
| `sha.exported` | `{n}` | Rapport enregistré : {n} mods. |
| `sha.filesN` | `{n}` | {n} fichiers |
| `sha.hashedOn` | `{d}` | haché le {d} |
| `sha.hashMissingN` | `{n}` | Hacher {n} manquant(s) |
| `sha.queuedN` | `{n}` | {n} mis en file de hachage. |
| `sha.rep.added` | `{n}` | {n} ajouté(s) |
| `sha.rep.missing` | `{n}` | {n} manquant(s) |
| `sha.rep.modified` | `{n}` | {n} modifié(s) |
| `sha.rep.ok` | `{n}` | Les {n} fichiers correspondent. |
| `sha.selected` | `{n}` | {n} sélectionné(s) |
| `sha.selectOne` | `{name}` | Sélectionner {name} |
| `sha.verifyAllN` | `{n}` | Vérifier les {n} affichés |

### sshact

| Clé | Variables | Texte |
|---|---|---|
| `sshact.destFileHint` | `{name}` | Le fichier atterrit ici sous le nom {name}. Le changer ici ne vaut que pour ce transfert. |
| `sshact.fetched` | `{n}` | Récupéré : {n} octets. |
| `sshact.published` | `{n}` | Publié : {n} octets. |

### sshbr

| Clé | Variables | Texte |
|---|---|---|
| `sshbr.count` | `{d}` `{f}` | {d} dossier(s), {f} fichier(s) |

### sshsrv

| Clé | Variables | Texte |
|---|---|---|
| `sshsrv.confirmDelete` | `{name}` | Supprimer le serveur « {name} » ? |
| `sshsrv.forgetConfirm` | `{host}` | Oublier la clé approuvée de {host} ? La prochaine connexion affichera la clé du serveur et redemandera. |
| `sshsrv.stepLoggedIn` | `{user}` | Connecté en tant que {user}. |
| `sshsrv.stepLogin` | `{user}` | Connexion en tant que {user}… |
| `sshsrv.stepReach` | `{where}` | Connexion à {where}… |
| `sshsrv.stepReached` | `{where}` | {where} a répondu. |
| `sshsrv.stepWritable` | `{dir}` `{n}` | {dir} existe et est inscriptible ({n} élément(s) dedans). |

### stm

| Clé | Variables | Texte |
|---|---|---|
| `stm.dur.h` | `{h}` `{m}` | {h} h {m} min |
| `stm.dur.min` | `{n}` | {n} min |
| `stm.dur.s` | `{n}` | {n} s |
| `stm.game.effectOn` | `{k}` | En ce moment : BMM travaille comme en Silencieux. Retenu jusqu’à ce que tu fermes l’application : {k}. |
| `stm.game.fromProfile` | `{p}` | Trouvé dans le dossier de l’application de ton profil « {p} ». |
| `stm.game.hGame` | `{g}` | Une application tourne : {g} |
| `stm.game.leaving` | `{d}` | L’application est fermée : retour à la normale dans {d}. |
| `stm.game.notAGame` | `{x}` | {x} est un navigateur ou une appli courante : tant qu'il tourne, le mode application reste actif. |
| `stm.game.since` | `{d}` | Actif depuis {d}. |
| `stm.gfx.pending` | `{a}` `{b}` | BMM a démarré avec « {a} ». « {b} » s’applique après un redémarrage. |
| `stm.presets.appliedToast` | `{p}` | {p} appliqué. L'annulation est au-dessus des préréglages. |
| `stm.presets.applyP` | `{p}` | Appliquer {p} |
| `stm.presets.c.add` | `{r}` `{w}` | {w} : {r} |
| `stm.presets.c.alertOn` | `{c}` `{w}` | activées, avertissement à {w} % libres, critique à {c} % |
| `stm.presets.c.alerts` | `{a}` `{b}` | Alertes d'espace : {a} → {b} |
| `stm.presets.c.change` | `{a}` `{b}` `{w}` | {w} : {a} → {b} |
| `stm.presets.c.intensity` | `{a}` `{b}` | Intensité de travail : {a} → {b} |
| `stm.presets.c.remove` | `{r}` `{w}` | {w} : règle retirée ({r}) |
| `stm.presets.capsKept` | `{d}` | Plafonds de vitesse gardés tels quels : {d}. |
| `stm.presets.changesN` | `{n}` | {n} changements |
| `stm.presets.free` | `{f}` `{t}` | {f} libres sur {t} |
| `stm.presets.nAdded` | `{n}` | {n} ajout(s) |
| `stm.presets.nChanged` | `{n}` | {n} modification(s) |
| `stm.presets.nRemoved` | `{n}` | {n} retrait(s) |
| `stm.presets.pcLine` | `{c}` `{d}` | {d} disques · {c} threads |
| `stm.presets.pcSummary` | `{c}` `{d}` | Ce PC : {d} disques, {c} threads |
| `stm.presets.previewTitle` | `{p}` | Ce que {p} change |
| `stm.presets.r.buffer` | `{n}` | pas de {n} Kio |
| `stm.presets.r.cap` | `{n}` | plafond {n} Mo/s |
| `stm.presets.r.parallel` | `{n}` | {n} à la fois |
| `stm.presets.recTitle` | `{p}` | Recommandé pour ce PC : {p} |
| `stm.presets.undo` | `{p}` | Annuler {p} |
| `stm.presets.whyTitle` | `{p}` | Pourquoi {p} : |
| `stm.space.profilesNeed` | `{a}` `{p}` | Profils : {p} pour {a} libres |
| `stm.space.usedByN` | `{n}` | Utilisé par {n} dossiers de profils |
| `stm.space.usedOf` | `{t}` `{u}` | {u} sur {t} |
| `stm.subj.join` | `{s}` `{v}` | {v} : {s} |

### storage

| Clé | Variables | Texte |
|---|---|---|
| `storage.alertCriticalMod` | `{free}` `{label}` `{limit}` | Action bloquée : espace critique sur le disque {label} ({free}% libres, limite à {limit}%). |
| `storage.alertWarningMod` | `{free}` `{label}` `{limit}` | Attention : l'espace sur le disque {label} est faible ({free}% libres, limite à {limit}%). |
| `storage.error` | `{err}` | Erreur : {err} |
| `storage.hwCpu` | `{n}` | {n} cœurs logiques |
| `storage.optimized` | `{limit}` `{name}` | Optimisation réussie pour {name} : {limit} MB/s |

### task

| Clé | Variables | Texte |
|---|---|---|
| `task.feed.badPath` | `{s}` | Impossible d’écrire un fichier de flux à cet endroit ({s}). |

### themes

| Clé | Variables | Texte |
|---|---|---|
| `themes.catalogExportedBundle` | `{f}` `{n}` | {n} thème(s) emballé(s) dans {f}. Un seul fichier, rien à héberger. |
| `themes.catalogExportedFolder` | `{n}` | catalog.json écrit avec {n} fichier(s) de thème. Téléverse le dossier tel quel. |
| `themes.dropinFound` | `{n}` | {n} preset(s) found |
| `themes.fromIndex` | `{n}` | {n} catalogue(s) de thèmes ajouté(s) depuis cet index. |
| `themes.importFailed` | `{list}` | Import impossible : {list} |
| `themes.indexAll` | `{n}` | Cet index liste {n} catalogue(s) de thèmes et vous les suivez déjà tous. |
| `themes.indexNone` | `{n}` | Cet index ne liste aucun catalogue de thèmes, seulement {n} entrée(s) d’autres types. |
| `themes.indexNone2` | `{what}` | Aucun catalogue de thèmes dans cet index, seulement {what}. Ajoute-les depuis leurs écrans. |

### toast

| Clé | Variables | Texte |
|---|---|---|
| `toast.hashFailed` | `{id}` | Échec du hash du mod {id} |
| `toast.openError` | `{err}` `{id}` | Erreur ouverture {id} : {err} |
| `toast.updatePartial` | `{applied}` `{errors}` | Mise à jour partielle : {applied} appliqués, {errors} erreurs |

### tools

| Clé | Variables | Texte |
|---|---|---|
| `tools.cache.clean` | `{b}` | Vider la sélection ({b}) |
| `tools.cache.cleaned` | `{b}` | {b} libérés. |
| `tools.cache.confirmMsg` | `{b}` `{names}` | {names} : {b} seront supprimés. BMM les reconstruit quand il en a besoin. |
| `tools.cache.summary` | `{t}` | {t} dans les caches et restes. |
| `tools.conflicts.files` | `{n}` | {n} fichier(s) |
| `tools.conflicts.summary` | `{a}` `{n}` | {n} paire(s) en conflit, dont {a} active(s). |
| `tools.deployed.summary` | `{f}` `{m}` `{n}` `{p}` | {n} constat(s) dans {p} profil(s) : {m} mod(s) actif(s), {f} fichier(s) vérifié(s). |
| `tools.diff.onlyA` | `{a}` | Seulement dans {a} |
| `tools.diff.onlyB` | `{b}` | Seulement dans {b} |
| `tools.diff.summary` | `{a}` `{b}` `{n}` `{s}` | {a} et {b} : {n} différence(s), {s} mod(s) identique(s). |
| `tools.disk.perMod` | `{n}` | Par mod ({n}) |
| `tools.disk.summary` | `{p}` `{t}` | {t} au total pour {p} profil(s) et les données de BMM. |
| `tools.duplicates.copies` | `{n}` | {n} copies |
| `tools.duplicates.summary` | `{f}` `{h}` `{m}` `{s}` `{w}` | {m} mod(s) en double, {f} groupe(s) de fichiers identiques, {w} récupérables. {s} fichiers listés, {h} hachés. |
| `tools.duplicates.wasted` | `{w}` | {w} en double |
| `tools.dupprofiles.counts` | `{a}` `{b}` `{s}` | {s} en commun, {a} seulement dans le premier, {b} seulement dans le second |
| `tools.dupprofiles.similar` | `{p}` | {p} semblables |
| `tools.dupprofiles.summary` | `{n}` `{p}` | {n} paire(s) parmi {p} profil(s). |
| `tools.jsondiff.meta` | `{f}` | Modifié aussi hors des entrées : {f} |
| `tools.jsondiff.summary` | `{a}` `{b}` `{c}` `{m}` `{p}` `{s}` | {a} entrées, puis {b} : {p} ajoutées, {m} retirées, {c} modifiées, {s} identiques. |
| `tools.largefiles.summary` | `{m}` `{n}` `{s}` `{t}` | {n} fichier(s) de {m} ou plus, sur {s} fichier(s) ({t}) parcourus. |
| `tools.logs.clipped` | `{n}` | Seules les {n} dernières lignes correspondantes sont affichées. L’export les contient aussi. |
| `tools.logs.summary` | `{e}` `{n}` `{t}` `{w}` | {n} ligne(s) affichée(s) sur {t} : {e} erreur(s), {w} avertissement(s). |
| `tools.moreInExport` | `{n}` | {n} de plus dans l’export. |
| `tools.names.summary` | `{m}` `{n}` | {n} mod(s) sur {m} pourraient être rangés. |
| `tools.orphans.summary` | `{m}` `{n}` `{p}` | {n} résultat(s) dans {p} profil(s) et {m} mod(s). |
| `tools.ranAt` | `{time}` | Résultat de {time} |
| `tools.validate.bad` | `{f}` `{n}` | Format {f} : {n} problème(s). |
| `tools.validate.ok` | `{f}` `{n}` | Format {f} : aucun problème trouvé ({n} entrées). |

### tut

| Clé | Variables | Texte |
|---|---|---|
| `tut.fieldHiddenIn` | `{where}` | Ce champ se trouve dans « {where} ». Ouvre-la d’abord. |
| `tut.where.coveredBy` | `{title}` | La fenêtre « {title} » est par-dessus. |
| `tut.where.inDialog` | `{title}` | C’est dans « {title} », qui n’est pas encore ouvert. |
| `tut.where.missingOn` | `{page}` | Ce n’est pas encore à l’écran. C’est sur la page {page} et ça peut apparaître après l’étape précédente. |
| `tut.where.onTab` | `{tab}` | C’est dans l’onglet « {tab} ». |

### tutc

| Clé | Variables | Texte |
|---|---|---|
| `tutc.issues` | `{n}` | {n} point(s) à vérifier |
| `tutc.movedTo` | `{n}` | Déplacée en position {n} |
| `tutc.removePartAsk` | `{name}` | Supprimer « {name} » et toutes ses étapes ? |
| `tutc.stepN` | `{n}` `{total}` | Étape {n} sur {total} |
| `tutc.target.found` | `{n}` | Trouvé sur cet écran ({n}). |

### tutcat

| Clé | Variables | Texte |
|---|---|---|
| `tutcat.b.saved` | `{n}` | catalog.json et {n} fichier(s) de tutoriel écrits. Déposez le dossier tel quel. |
| `tutcat.b.savedPartial` | `{names}` | Catalogue écrit, mais ceux-ci n’ont pas pu être exportés : {names} |
| `tutcat.b.write` | `{n}` | Exporter le catalogue ({n}) |

### update

| Clé | Variables | Texte |
|---|---|---|
| `update.availableToast` | `{version}` | BMM v{version} est disponible. Cliquez ici pour voir les nouveautés. |
| `update.daysAgo` | `{n}` | il y a {n} jours |
| `update.dlProgress` | `{done}` `{total}` | Téléchargement {done} / {total} Mo |
| `update.etaMin` | `{n}` | environ {n} min restantes |
| `update.etaSec` | `{n}` | environ {n} s restantes |
| `update.hoursAgo` | `{n}` | il y a {n} h |
| `update.lastCheck` | `{when}` | Dernière vérification : {when} |
| `update.lastCheckFailed` | `{when}` | Échec de la dernière vérification : {when} |
| `update.minutesAgo` | `{n}` | il y a {n} min |
| `update.pageNotFound` | `{name}` | Page non trouvée : {name} |
| `update.sizeMb` | `{size}` | {size} Mo |
| `update.speed` | `{speed}` | {speed} Mo/s |
| `update.stagedBody` | `{n}` `{version}` | La v{version} a été téléchargée et vérifiée la dernière fois. Installation dans {n} s. |
| `update.stagedReady` | `{version}` | La v{version} a été téléchargée et vérifiée la dernière fois. |
| `update.stagedToast` | `{version}` | La v{version} est téléchargée et vérifiée. Elle s'installera au prochain démarrage de BMM. |

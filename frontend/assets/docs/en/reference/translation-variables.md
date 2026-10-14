# Translation variables

Some texts in BMM contain a word between braces, such as `{n}` or `{name}`. BMM replaces it with a value
when it shows the text: `"{n} new mods added"` becomes « 3 new mods added ». This page lists every key that
takes one, with the names it uses, so a translation can keep them.

It is generated from the app’s own audit (`scripts/check-i18n-vars.mjs`), the same one that fails the build
when a translation and the code disagree. It cannot go out of date.

## Rules for translators

- **Copy every variable exactly.** `{n}` stays `{n}`: not `{nombre}`, not `{N}`, not `(n)`. A renamed variable is shown to the user with its braces.
- **Keep all of them.** Each variable of the English text must appear in yours. You may move them, and the order may change.
- **Never add one.** A variable the app does not fill is shown as-is.
- **Plurals come in pairs.** A key ending in `.one` is used for exactly one item and has no number in it; its `.many` twin carries `{n}`. Write each as a full sentence: no `(s)` or `(x)`.
- **Some braces are text.** The keys listed under [Braces that are text](#braces-that-are-text) show BMM’s scheduler syntax (`{variables}`, `{name}`) to the reader. Those are not filled in: translate them like any other word.

## Common names

| Variable | Usually |
|---|---|
| `{n}` | a number (a count, an index, a position) |
| `{name}` | a name (mod, profile, task, file…) |
| `{m}` | a second number, or a name, next to {n} |
| `{v}` | a version or a value |
| `{total}` | the total the count is out of |
| `{count}` | a number of items |
| `{s}` | seconds, or a short word the code picks |
| `{err}` | an error message |
| `{id}` | an identifier |
| `{e}` | an error message |
| `{size}` | a size, already formatted (KB, MB…) |
| `{label}` | a short title |
| `{path}` | a file or folder path |
| `{profile}` | a profile name |
| `{version}` | a version number |
| `{mod}` | a mod name |
| `{error}` | an error message |
| `{host}` | a server name |
| `{url}` | a web address |
| `{file}` | a file name |
| `{x}` | a list or a detail the code inserts |
| `{date}` | a date |
| `{time}` | a time |
| `{type}` | a kind of thing (an importer, a format…) |

## Braces that are text

These keys contain braces that are shown to the reader as they are. Nothing is filled in.

| Key | Why |
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

## Every key with variables

1050 keys, grouped by their first segment. The text is the English one, shortened.

### activity

| Key | Variables | Text |
|---|---|---|
| `activity.btnRunning` | `{n}` | Activity: {n} running |
| `activity.cancelOne` | `{title}` | Cancel {title} |
| `activity.doneCount` | `{m}` `{n}` | {n} of {m} done |
| `activity.failedCount` | `{m}` `{n}` | {n} of {m} failed. |
| `activity.hourMin` | `{h}` `{m}` | {h} h {m} min |
| `activity.minSec` | `{m}` `{s}` | {m} min {s} s |
| `activity.sec` | `{s}` | {s} s |

### actjob

| Key | Variables | Text |
|---|---|---|
| `actjob.count` | `{m}` `{n}` | {n}/{m} |
| `actjob.queued` | `{n}` | +{n} waiting |
| `actjob.stateCopying` | `{pct}` | Copying {pct}% |
| `actjob.stateRemoving` | `{pct}` | Removing {pct}% |
| `actjob.summaryCancelled` | `{label}` `{m}` `{n}` | {label}: stopped after {n} of {m}. The mod in progress was undone. |
| `actjob.summaryDisabled` | `{label}` `{m}` `{n}` | {label}: {n} of {m} disabled. |
| `actjob.summaryEnabled` | `{label}` `{m}` `{n}` | {label}: {n} of {m} enabled. |
| `actjob.summaryFailed` | `{f}` `{label}` `{m}` `{n}` | {label}: {n} of {m} done, {f} failed: |

### ai

| Key | Variables | Text |
|---|---|---|
| `ai.api.bindFailed` | `{why}` | Could not open the port ({why}). Is it used by another program? |
| `ai.api.stats` | `{refused}` `{served}` | Answered: {served} · refused: {refused} |
| `ai.ask.more` | `{n}` | +{n} more |
| `ai.ask.nFiles` | `{n}` | {n} files |
| `ai.ask2.byLocal` | `{model}` | by {model}, on this PC |
| `ai.ask2.byRemote` | `{model}` | by {model} (remote API) |
| `ai.ask2.checked` | `{p}` | checked by Laya {p} % |
| `ai.emb.disk` | `{free}` `{need}` | Needs {need} of disk space; {free} free. |
| `ai.emb.diskNeed` | `{need}` | Needs {need} of disk space. |
| `ai.emb.eta` | `{eta}` | {eta} left |
| `ai.emb.install` | `{size}` | Install the model ({size}) |
| `ai.emb.installHint` | `{host}` | A single download from {host}, checked against its pinned SHA-256, resumed if interrupted. Afterwards Laya wo… |
| `ai.emb.mirror` | `{host}` | mirror {host} |
| `ai.emb.noSpace` | `{free}` `{need}` | Not enough disk space: the install needs {need}, the disk has {free} free. Free some space, then check again. |
| `ai.emb.outdatedHint` | `{size}` | An older model pack is installed. The update is a {size} download, checked against its pinned SHA-256. |
| `ai.emb.progress` | `{got}` `{total}` | Downloading… {got} / {total} |
| `ai.emb.resume` | `{got}` | {got} already downloaded: the download resumes from there. |
| `ai.emb.testOdd` | `{lang}` `{ms}` `{tag}` `{tagP}` | Laya answered, but not as expected: « {tag} » ({tagP} %), language {lang}, in {ms} ms. Remove and reinstall t… |
| `ai.emb.testOk` | `{lang}` `{load}` `{ms}` `{tag}` `{tagP}` | Laya works: sample classified as « {tag} » ({tagP} %), language {lang}, in {ms} ms (loading: {load} ms). |
| `ai.emb.update` | `{size}` | Update the model ({size}) |
| `ai.emb.where` | `{dir}` `{size}` | {size} in {dir} |
| `ai.first.install` | `{size}` | Install Laya ({size}) |
| `ai.hub2.model` | `{state}` | Model: {state} |
| `ai.hub2.nOwn` | `{n}` | {n} with their own settings |
| `ai.hub2.tasksPill` | `{n}` `{on}` | {n} task(s), {on} on |
| `ai.lib.appliedMany` | `{n}` | Applied to {n} mods. |
| `ai.lib.appliedOne` | `{n}` `{name}` | Applied to {name} ({n} mods). |
| `ai.lib.apply` | `{n}` | Apply ({n}) |
| `ai.lib.applyAll` | `{n}` | Apply all ({n}) |
| `ai.lib.applyGroup` | `{n}` | Apply this profile ({n}) |
| `ai.lib.applying` | `{done}` `{total}` | Applying: {done} / {total} mods |
| `ai.lib.confirmCopies` | `{n}` | Includes {n} copies of the same mods in other profiles. |
| `ai.lib.confirmGo` | `{m}` `{n}` | Apply {n} changes to {m} mods |
| `ai.lib.confirmLead` | `{what}` | Apply the suggestions to {what}. Rows you ticked are kept as ticked; for the others, the first value of each… |
| `ai.lib.copies` | `{n}` | {n} copies |
| `ai.lib.dedupe` | `{c}` `{n}` | {n} mods are installed in several profiles ({c} extra copies): analyse each once and apply to every copy |
| `ai.lib.failedN` | `{n}` | {n} failed. |
| `ai.lib.includeGuesses` | `{n}` | Include Laya's low-confidence guesses ({n}) |
| `ai.lib.nMods` | `{n}` | {n} mods |
| `ai.lib.nSugg` | `{n}` | {n} suggestion(s) |
| `ai.lib.progress` | `{done}` `{total}` | {done} / {total} mods |
| `ai.lib.scopeAll` | `{n}` | All mods ({n}) |
| `ai.lib.scopeIncomplete` | `{n}` | Mods without a description or tags ({n}) |
| `ai.lib.summary` | `{n}` `{s}` `{total}` | {n} of {total} mods have suggestions ({s} s). |
| `ai.lib.summaryStopped` | `{ms}` `{n}` | Stopped. {n} mods with suggestions so far ({ms} s). |
| `ai.lib.undone` | `{n}` | Undone: {n} mods are back as they were. |
| `ai.lib.whereEvery` | `{n}` `{p}` | All {p} profiles ({n} mods) |
| `ai.lib.whereHere` | `{n}` | This profile ({n} mods) |
| `ai.lt.deleteConfirm` | `{name}` | Delete the task "{name}"? |
| `ai.lt.nTasks` | `{n}` | {n} tasks |
| `ai.lt.out.answer` | `{label}` | Answer: {label} |
| `ai.lt.out.guess` | `{label}` | Best guess: {label} |
| `ai.lt.out.unknown` | `{why}` | I don't know ({why}) |
| `ai.lt.ranLine` | `{n}` `{total}` | {n} of {total} mods answered. |
| `ai.lt.running` | `{name}` | Running "{name}"... |
| `ai.lt.t.idLine` | `{id}` | In a script: ai.classify with task {id} |
| `ai.lt.taskLine` | `{id}` `{n}` `{src}` | {n} labels · {src} · id {id} |
| `ai.reason.embFailed` | `{why}` | The built-in model failed ({why}). |
| `ai.reason.http` | `{code}` | The server answered HTTP {code}. |
| `ai.report.fEmail` | `{n}` | {n} e-mail address(es) |
| `ai.report.fIp` | `{n}` | {n} IP address(es) |
| `ai.report.fMachine` | `{n}` | {n} mention(s) of this PC’s name |
| `ai.report.fToken` | `{n}` | {n} secret(s) or token(s) |
| `ai.report.fUsername` | `{n}` | {n} mention(s) of your Windows account name |
| `ai.report.fUserPath` | `{n}` | {n} folder path(s) with your user name |
| `ai.report.hintCategory` | `{p}` `{v}` | Category: {v} ({p}) |
| `ai.report.hintDuplicate` | `{v}` | Looks like: “{v}” |
| `ai.report.hintSeverity` | `{p}` `{v}` | Severity: {v} ({p}) |
| `ai.set2.modelsFound` | `{n}` | {n} model(s) found. |
| `ai.set2.stCls` | `{v}` | Ranking: {v} |
| `ai.set2.stGen` | `{v}` | Writing: {v} |
| `ai.settings.testOk` | `{ms}` `{target}` | {target}: OK ({ms} ms) |
| `ai.sug3.rowsTitle` | `{n}` | Suggestions ({n}) |
| `ai.suggest.selected` | `{n}` | {n} selected |
| `ai.suggest.title` | `{name}` | Suggestions for {name} |
| `ai.suggest.withProvider` | `{provider}` | Files + {provider} |
| `ai.task.blocked` | `{why}` | Laya is not available: {why} |

### analytics

| Key | Variables | Text |
|---|---|---|
| `analytics.deletedAll` | `{n}` | Local data cleared · {n} packet deletion(s) requested |
| `analytics.liveStatus` | `{pending}` `{sent}` | {sent} sent, {pending} waiting |

### apps

| Key | Variables | Text |
|---|---|---|
| `apps.card.from` | `{source}` | from {source} |
| `apps.card.openAria` | `{name}` | Details for {name} |
| `apps.create.bundled` | `{f}` `{n}` | Published: {n} app(s) packed, {f} |
| `apps.create.clearBody` | `{n}` | This throws away the draft ({n} entr(ies)). Export it first to keep it. |
| `apps.create.opened` | `{n}` | Opened: {n} app(s) |
| `apps.create.packMissing` | `{n}` | {n} entr(ies) name a file that is not in the folder |
| `apps.create.pbDupe` | `{id}` `{n}` | {id} appears {n} times. Ids must be unique. |
| `apps.create.pbFileOnly` | `{id}` | {id}: a file, no address. Only the one-file publish carries it. |
| `apps.create.pbNoTitle` | `{id}` | {id}: no title. |
| `apps.create.pbNoUrl` | `{id}` | {id}: no download URL. Readers will skip this entry. |
| `apps.create.problems` | `{n}` | {n} thing(s) to look at |
| `apps.create.stillNeeded` | `{x}` | Still needed: {x} |
| `apps.detail.versionPair` | `{installed}` `{latest}` | v{installed} installed, v{latest} in the catalog |
| `apps.shownOf` | `{n}` `{total}` | {n} of {total} |
| `apps.someSourcesFailed` | `{n}` | {n} source(s) did not answer. Their apps are missing below. |
| `apps.sourceDisabled` | `{name}` | {name} is switched off. It stays in Sources. |
| `apps.sourceFailedOne` | `{n}` | {n} source did not answer. Its apps are missing below. |
| `apps.sources.bundleAdded` | `{n}` | Following: {n} app(s) |
| `apps.sources.fromIndex` | `{n}` | Added {n} app catalog(s) from that index. |
| `apps.sources.indexAll` | `{n}` | That index lists {n} app catalog(s) and you already follow them all. |
| `apps.sources.indexNone` | `{n}` | That index lists no app catalogs, only {n} entr(y/ies) of other kinds. |
| `apps.sources.indexNone2` | `{what}` | No app catalogs in that index, only {what}. Add those from their own screens. |
| `apps.sourcesFailedMany` | `{n}` | {n} sources did not answer. Their apps are missing below. |
| `apps.state.updatedToast` | `{name}` | {name} updated |
| `apps.updatesMany` | `{n}` | {n} updates |

### bcv2

| Key | Variables | Text |
|---|---|---|
| `bcv2.account.signedInAs` | `{name}` | Signed in as {name} |
| `bcv2.legal.revision` | `{r}` | revision {r} |
| `bcv2.legal.shipped` | `{v}` | you accepted version {v} |
| `bcv2.legal.version` | `{v}` | Version {v} |

### bench

| Key | Variables | Text |
|---|---|---|
| `bench.pointTime` | `{time}` | Time: {time} |
| `bench.ui.avg` | `{v}` | avg {v} |
| `bench.ui.elapsed` | `{t}` | {t} elapsed |
| `bench.ui.peak` | `{v}` | peak {v} |
| `bench.ui.samples` | `{n}` | {n} samples |
| `bench.ui.stepOf` | `{n}` `{total}` | Step {n} of {total} |

### benchmark

| Key | Variables | Text |
|---|---|---|
| `benchmark.importFailed` | `{error}` | Import failed: {error} |
| `benchmark.importSuccess` | `{count}` | {count} data points imported |

### cat

| Key | Variables | Text |
|---|---|---|
| `cat.badType` | `{t}` | No catalogue type called "{t}". |
| `cat.deleteAsk` | `{k}` | Delete the {k} catalogue you author on this machine? |
| `cat.deleted` | `{k}` | {k} catalogue deleted |
| `cat.entryOk` | `{id}` `{mode}` `{n}` | {mode}: {id} ({n} entr(ies)) |
| `cat.importedN` | `{n}` | {n} catalogue(s) followed |
| `cat.pubBadKind` | `{k}` `{list}` | “{k}” is not something BMM can publish. It knows: {list} |
| `cat.pubDone` | `{k}` `{n}` | Published {n} {k} entry(ies). |
| `cat.pubEmpty` | `{k}` | Nothing to publish: no {k} entries. The folder was left alone. |

### catpub

| Key | Variables | Text |
|---|---|---|
| `catpub.dropped` | `{n}` | {n} entr(y/ies) left out |
| `catpub.plusLinked` | `{l}` | plus {l} linked |
| `catpub.split` | `{f}` `{l}` | {f} packed, {l} linked |

### catsrc

| Key | Variables | Text |
|---|---|---|
| `catsrc.age.d` | `{n}` | {n} d ago |
| `catsrc.age.h` | `{n}` | {n} h ago |
| `catsrc.age.m` | `{n}` | {n} min ago |
| `catsrc.editor.addIndex` | `{n}` | Add the {n} catalogues |
| `catsrc.export.done` | `{n}` | {n} source(s) exported. |
| `catsrc.health.okN` | `{n}` | OK · {n} items |
| `catsrc.import.done` | `{n}` `{s}` | {n} source(s) added, {s} skipped. |
| `catsrc.import.msg` | `{n}` | {n} source(s) will be followed. Those you already follow are skipped. |
| `catsrc.indexAdded` | `{n}` | Added {n} catalogue(s) from that index. |
| `catsrc.lastOk` | `{a}` | Refreshed {a} |
| `catsrc.remove.msg` | `{name}` `{url}` | {name} ({url}) will no longer be fetched. A line stays in the history to bring it back. |
| `catsrc.retryFail` | `{e}` | Still no answer: {e} |
| `catsrc.summary` | `{f}` `{n}` `{off}` `{y}` | {n} sources, {y} of yours ({off} off). {f} did not answer. |
| `catsrc.test.index` | `{n}` | This is an index: it lists {n} catalogues. |
| `catsrc.test.indexImport` | `{n}` | {n} of them fit this list and can be added at once. |
| `catsrc.test.items` | `{n}` | {n} items |
| `catsrc.test.okNamed` | `{name}` | It answers: {name} |
| `catsrc.test.warnings` | `{n}` | {n} warnings |
| `catsrc.via` | `{i}` | via {i} |

### cm

| Key | Variables | Text |
|---|---|---|
| `cm.doneBundle` | `{f}` `{n}` | {n} packed into {f}: one file, nothing to host. |
| `cm.doneJson` | `{f}` `{n}` | {n} entr(y/ies) written to {f}. |
| `cm.dropped` | `{n}` | {n} entries could not be used |
| `cm.fromIndex` | `{n}` | Added {n} catalogue(s) from that index. |
| `cm.indexAll` | `{n}` | That index lists {n} catalogue(s) of this kind and you already follow them all. |
| `cm.indexNone` | `{what}` | No catalogue of this kind in that index. It holds {what}; add those from their own screens. |
| `cm.searchNone` | `{q}` | Nothing here matches "{q}". |
| `cm.someFailed` | `{list}` | These could not be written: {list} |

### common

| Key | Variables | Text |
|---|---|---|
| `common.contentIdCopied` | `{id}` | Content ID copied: {id}… |
| `common.idCopied` | `{name}` | ID copied: {name} |
| `common.version` | `{version}` | V{version} |

### community

| Key | Variables | Text |
|---|---|---|
| `community.filter.count` | `{n}` | {n} posts |

### conflict

| Key | Variables | Text |
|---|---|---|
| `conflict.allFiltered` | `{n}` | Nothing matches these filters ({n} mod(s) have conflicts). |
| `conflict.currentlyWins` | `{m}` | {m} is active, so its version of these files is the one on disk. |
| `conflict.filesCount` | `{count}` | {count} file(s) |
| `conflict.flipped` | `{n}` | Done: {n} file(s) changed hands. |
| `conflict.groupSource` | `{mod}` `{profile}` | Source: {mod} ({profile}) |
| `conflict.hiddenNote` | `{n}` | {n} more mod(s) have conflicts, hidden by the filters above. |
| `conflict.makeWin` | `{m}` | Make {m} win these files |
| `conflict.treeTruncated` | `{n}` `{total}` | Showing the first {n} of {total} shared files. |

### consent

| Key | Variables | Text |
|---|---|---|
| `consent.sent` | `{n}` | Receipts sent: {n} |

### crashmgr

| Key | Variables | Text |
|---|---|---|
| `crashmgr.laya.explainNote` | `{model}` | Written by {model} from the masked log. It can be wrong. |
| `crashmgr.laya.groupN` | `{n}` | Group {n} |
| `crashmgr.laya.groups` | `{g}` `{n}` | {n} crash reports in {g} groups of similar crashes. |
| `crashmgr.laya.similar` | `{g}` `{n}` | Group {g}: {n} similar |
| `crashmgr.laya.stepLine` | `{step}` | Next step: {step} |

### credits

| Key | Variables | Text |
|---|---|---|
| `credits.codeCommits` | `{n}` | {n} commits |
| `credits.codeOpenRepo` | `{repo}` | Open the {repo} repository |
| `credits.codeRepoCommits` | `{n}` `{repo}` | {n} commits in {repo} |
| `credits.codeRepos` | `{n}` | Commits in {n} repositories |
| `credits.codeSince` | `{year}` | since {year} |
| `credits.stackGroupsN` | `{n}` | {n} groups |
| `credits.stackShown` | `{n}` `{total}` | {n} of {total} |
| `credits.stackTotal` | `{n}` | {n} open-source components |

### csp

| Key | Variables | Text |
|---|---|---|
| `csp.conns` | `{n}` | What BMM connects to: {n} hosts |
| `csp.errNotDirective` | `{name}` | "{name}" is not a directive name. |
| `csp.executeWarning` | `{n}` | {n} that permit code execution |
| `csp.shippedPolicy` | `{n}` | Shipped policy: {n} directives |

### cv

| Key | Variables | Text |
|---|---|---|
| `cv.allWin` | `{m}` | {m} wins every file |
| `cv.applied` | `{d}` `{n}` | Done: {n} file(s) re-copied, {d} mod(s) disabled. |
| `cv.disableM` | `{m}` | Disable {m} |
| `cv.files` | `{n}` | {n} shared files |
| `cv.keepCopy` | `{m}` | Keep {m}'s copy |
| `cv.listCut` | `{n}` `{total}` | Showing {n} of {total}. |
| `cv.makeWin` | `{m}` | Make {m} win |
| `cv.moveDown` | `{m}` | Move {m} down |
| `cv.moveUp` | `{m}` | Move {m} up |
| `cv.onlyMod` | `{m}` | Only {m} |
| `cv.pairsTitle` | `{n}` | Conflicts by pair ({n}) |
| `cv.selectAll` | `{n}` | All {n} files |
| `cv.selected` | `{n}` | {n} selected |
| `cv.selectFile` | `{f}` | Select {f} |
| `cv.showMore` | `{n}` | Show {n} more |
| `cv.split` | `{a}` `{b}` `{na}` `{nb}` | {a}: {na}, {b}: {nb} |
| `cv.statusClean` | `{n}` `{p}` | {n} shared files between {p} pairs of mods. |
| `cv.statusDirty` | `{n}` | Applying changes {n} file(s) on disk. |
| `cv.statusDisable` | `{n}` | {n} mod(s) will be disabled. |
| `cv.winnerFor` | `{f}` | Which copy of {f} to keep |

### debug

| Key | Variables | Text |
|---|---|---|
| `debug.reportGenerated` | `{path}` | Report generated: {path} |

### deeplink

| Key | Variables | Text |
|---|---|---|
| `deeplink.keyLocked` | `{k}` | The key {k} is locked, and the passphrase given does not open it. |
| `deeplink.keyUnknown` | `{k}` | No identity key called “{k}”: the request goes unsigned. Check the id in Settings → Identity &amp; API. |
| `deeplink.opened` | `{action}` | Deep link: {action} |

### detail

| Key | Variables | Text |
|---|---|---|
| `detail.originLink` | `{h}` | A link · {h} |
| `detail.originRepo` | `{h}` | Server repo · {h} |
| `detail.originRepoUnverified` | `{h}` | Server repo · {h} (no checksums) |
| `detail.originSources` | `{n}` | {n} update source(s) |
| `detail.originUpdate` | `{h}` | Its own update address · {h} |

### dev

| Key | Variables | Text |
|---|---|---|
| `dev.label.rules` | `{n}` | {n} rules |
| `dev.label.shownOf` | `{n}` `{shown}` | {shown} of {n} |
| `dev.msg.rustFailed` | `{why}` | Could not read the Rust logs: {why} |
| `dev.msg.sheetFailed` | `{why}` | Could not read this stylesheet: {why} |

### dlg

| Key | Variables | Text |
|---|---|---|
| `dlg.refused` | `{action}` `{why}` | Link refused ({action}): {why} |

### docs

| Key | Variables | Text |
|---|---|---|
| `docs.diagram.backup-system.n.BUNDLE.desc` | `{date}` `{time}` | Builds a zip with a manifest of what went in, sealed with the passphrase when one is given. A scheduled backu… |
| `docs.diagram.hosting-flow.n.MANIFEST.desc` | `{id}` `{path}` | Writes just repo.json for mod folders already on this machine (folders, profiles or both), copying nothing. A… |
| `docs.diagram.ui.matches` | `{n}` | {n} found |
| `docs.diagram.ui.nodes` | `{n}` | {n} steps |
| `docs.diagram.ui.openDiagram` | `{title}` | Open: {title} |
| `docs.diagram.ui.refs` | `{n}` | {n} code references |

### fbc

| Key | Variables | Text |
|---|---|---|
| `fbc.testFail` | `{url}` `{why}` | No answer from {url}: {why} |
| `fbc.testOk` | `{kb}` `{kinds}` `{mb}` `{n}` | Reachable · reports on · {kinds} · body {kb} KB · {n} file(s), {mb} MB max |

### fbm

| Key | Variables | Text |
|---|---|---|
| `fbm.anonWhy` | `{n}` | Reports still arrive, but nobody can reply inside BMM and unlinked installs are limited to {n} a day. |
| `fbm.attachCap` | `{mb}` `{n}` | up to {n} files, {mb} MB in total |
| `fbm.budget` | `{max}` `{maxn}` `{n}` `{used}` | {used} of {max} used · {n} of {maxn} files |
| `fbm.contactLinkedAs` | `{name}` | Sent as {name}. Replies land in Messages &amp; reports and BMM’s notifications. |
| `fbm.skippedBig` | `{f}` | {f} was left out: the total would pass the size limit. |
| `fbm.sumFiles` | `{n}` | {n} file(s) |
| `fbm.sumSteps` | `{n}` | {n} listed |

### feedback

| Key | Variables | Text |
|---|---|---|
| `feedback.filesTooBig` | `{n}` | The attachments go over {n} MB in total. Remove the largest one and send again. |
| `feedback.queueFlushed` | `{n}` | {n} saved report(s) sent to BetterCommunity. |
| `feedback.rateLimited` | `{s}` | Too many reports. Try again in {s} s. |
| `feedback.tooLongBody` | `{n}` | Your description is longer than the {n} KB this project accepts. Shorten it, or move the detail into an attac… |
| `feedback.tooManyFiles` | `{n}` | {n} attachments at most. Remove some and send again. |
| `feedback.versionRefused` | `{v}` | This BMM version is too old to send reports. Update to {v} or newer. |

### flappy

| Key | Variables | Text |
|---|---|---|
| `flappy.dead` | `{best}` | Down. Click to try again. Best: {best} |
| `flappy.rpcDead` | `{best}` `{n}` | Scored {n} (best {best}) |
| `flappy.rpcPlaying` | `{n}` | Flapping: {n} points |

### history

| Key | Variables | Text |
|---|---|---|
| `history.revertError` | `{error}` | Error during revert: {error} |

### hub

| Key | Variables | Text |
|---|---|---|
| `hub.assets.promptDesc` | `{n}` | This tutorial ships with {n} assets: small games and a mod pack to practise with. |
| `hub.deleteAsk` | `{name}` | Delete “{name}”? The file and your progress in it are removed. |
| `hub.progressOf` | `{done}` `{total}` | {done} of {total} steps done |
| `hub.step` | `{current}` `{total}` | Step {current}/{total} |

### i18n

| Key | Variables | Text |
|---|---|---|
| `i18n.chars` | `{n}` `{src}` | {n} characters (source: {src}) |
| `i18n.hcFiles` | `{n}` | {n} files |
| `i18n.listCapped` | `{n}` | {n} more: narrow the search to see them |
| `i18n.phExtra` | `{name}` | {name} not in the source |
| `i18n.phMissing` | `{name}` | {name} missing |
| `i18n.progress` | `{done}` `{lang}` `{pct}` `{total}` | {lang} · {done}/{total} translated ({pct}%) |

### kofi

| Key | Variables | Text |
|---|---|---|
| `kofi.tierAria` | `{n}` | Tip {n} on Ko-fi |

### launch

| Key | Variables | Text |
|---|---|---|
| `launch.ann.opensIn` | `{host}` | Opens {host} in your browser |
| `launch.dotLabel` | `{n}` `{title}` `{total}` | Step {n} of {total}: {title} |

### laya

| Key | Variables | Text |
|---|---|---|
| `laya.dbg.benchDone` | `{ms}` `{n}` | {n} runs in {ms} ms. |
| `laya.dbg.benchProgress` | `{i}` `{n}` | Run {i} of {n} |
| `laya.dbg.decAccept` | `{label}` | Would accept "{label}" |
| `laya.dbg.decAmbiguous` | `{m}` `{need}` | Too close to call: {m} % ahead for {need} % needed |
| `laya.dbg.decBelow` | `{p}` `{t}` | Below the threshold: {p} % for {t} % needed |
| `laya.dbg.decRaw` | `{label}` | Highest score: "{label}" |
| `laya.dbg.exported` | `{n}` | {n} calls exported, without any text. |
| `laya.dbg.loadMs` | `{ms}` | loaded in {ms} ms |
| `laya.dbg.thresholdMark` | `{t}` | Threshold {t} % |
| `laya.dbg.verifyBad` | `{n}` | {n} file(s) do not match. Reinstall the model from Settings. |
| `laya.dbg.verifyOk` | `{ms}` `{n}` | All {n} files match their pins ({ms} ms). |

### legacy

| Key | Variables | Text |
|---|---|---|
| `legacy.andMore` | `{n}` `{names}` | {names} and {n} more |
| `legacy.failed` | `{error}` | Import failed: {error} |
| `legacy.imported` | `{n}` | {n} profile(s) imported |

### lib

| Key | Variables | Text |
|---|---|---|
| `lib.results` | `{m}` `{n}` | {n} of {m} |
| `lib.sel.count` | `{n}` | {n} selected |
| `lib.sel.disableTip` | `{n}` | Disable the {n} selected mod(s) that are on |
| `lib.sel.enableTip` | `{n}` | Enable the {n} selected mod(s) that are off |
| `lib.sel.jobDisable` | `{n}` | Disable {n} selected mod(s) |
| `lib.sel.jobEnable` | `{n}` | Enable {n} selected mod(s) |
| `lib.subtitle` | `{enabled}` `{s2}` `{total}` | {enabled} active on {total} mod{s2} |

### mapper

| Key | Variables | Text |
|---|---|---|
| `mapper.actionCancelled` | `{count}` | {count} action(s) cancelled |
| `mapper.archiveRezipFailed` | `{err}` | Your changes were saved, but packing the mod back failed: {err}. It is still a folder. |
| `mapper.confirmApply` | `{count}` | Do you really want to apply these {count} structure changes? |
| `mapper.confirmStagedDelete` | `{count}` | Do you want to mark {count} item(s) for permanent deletion? (Will be applied when clicking 'APPLY STRUCTURE') |
| `mapper.itemsMarkedForDelete` | `{count}` | {count} item(s) marked for deletion |
| `mapper.itemsMoved` | `{count}` `{target}` | {count} item(s) queued for “{target}” |
| `mapper.mappingCancelled` | `{count}` | {count} mappings cancelled |
| `mapper.modRootMapped` | `{count}` `{target}` | Whole mod ({count} items) mapped to "{target}" |
| `mapper.modRootSelected` | `{count}` | Whole mod root selected ({count} items). Double-click a destination folder to map it |
| `mapper.newModsDetected.many` | `{n}` | {n} new mods detected and added automatically |
| `mapper.pathCopiedCount` | `{count}` | {count} path(s) copied! |
| `mapper.pv.nFiles` | `{n}` | {n} files |
| `mapper.pv.nOver` | `{n}` | {n} overwritten |
| `mapper.pv.pending` | `{n}` | Changes to apply: {n} |
| `mapper.pv.warnConflicts` | `{names}` | Other mods write the same files: {names} |
| `mapper.pv.warnOverwrite` | `{n}` | {n} files will replace game files (backed up first). |
| `mapper.pv.warnRoot` | `{n}` | {n} files land at the game root. |

### md

| Key | Variables | Text |
|---|---|---|
| `md.sched.ahead` | `{here}` `{span}` `{tz}` | {here} is {span} ahead of {tz} right now |
| `md.sched.behind` | `{here}` `{span}` `{tz}` | {here} is {span} behind {tz} right now |
| `md.sched.same` | `{here}` `{tz}` | {here} is on the same clock as {tz} right now |

### mg

| Key | Variables | Text |
|---|---|---|
| `mg.conflicts` | `{n}` | {n} conflict(s) |
| `mg.missingSummary` | `{n}` | {n} dependency/ies named by a mod and provided by nothing: |
| `mg.summary` | `{c}` `{m}` `{r}` | {m} mods · {r} top-level · {c} conflicting pair(s) |

### mm

| Key | Variables | Text |
|---|---|---|
| `mm.cancelError` | `{err}` | Cancellation error: {err} |
| `mm.cat.addLinkName` | `{g}` | A name for it. Leave empty to use “{g}”. |
| `mm.cat.countAll` | `{n}` | {n} list(s), all packed |
| `mm.cat.doneBundle` | `{f}` `{n}` | {n} list(s) packed into {f}. One file, nothing to host. |
| `mm.cat.doneFolder` | `{l}` `{n}` | Catalogue written: {n} list(s) packed, {l} linked, plus catalog.json |
| `mm.cat.dropped` | `{n}` | {n} entr(y/ies) could not be used |
| `mm.cat.notLists` | `{list}` | Not mod lists, so left out: {list} |
| `mm.creds.hosts` | `{list}` | Concerns: {list} |
| `mm.creds.inKeys` | `{list}` `{n}` | {n} private identity key(s): {list} |
| `mm.creds.inKeysDone` | `{list}` | Added to your ring: {list} |
| `mm.creds.inPw` | `{list}` `{n}` | {n} download password(s), for: {list} |
| `mm.creds.inPwDone` | `{n}` | {n} password(s) remembered for this session |
| `mm.exportError` | `{err}` | Failed to export: {err} |
| `mm.fileTree` | `{count}` | File Tree ({count} files) |
| `mm.importError` | `{err}` | Failed to import: {err} |
| `mm.installError` | `{err}` | Installation error: {err} |
| `mm.installSuccess` | `{success}` `{total}` | {success}/{total} mod(s) installed. |

### mod

| Key | Variables | Text |
|---|---|---|
| `mod.activated` | `{name}` | "{name}" enabled. |
| `mod.add.conflictFiles` | `{n}` | {n} file(s) |
| `mod.add.conflictMore` | `{n}` | and {n} more |
| `mod.add.conflicts` | `{n}` | Shares files with {n} active mod(s): the one enabled last wins. |
| `mod.add.copyingSize` | `{size}` | Copying {size} into the mods folder… |
| `mod.add.failed` | `{e}` | Not added: {e} |
| `mod.add.files` | `{n}` | {n} files |
| `mod.add.kindArchive` | `{type}` | {type} archive |
| `mod.add.readFailed` | `{e}` | Could not read it: {e} |
| `mod.add.sizeArchive` | `{full}` `{packed}` | {packed} packed, {full} unpacked |
| `mod.added` | `{name}` | "{name}" imported and added to library. |
| `mod.archiveMoreFiles` | `{count}` | + {count} more files not displayed for performance (click Explore Archive above). |
| `mod.conflictsDesc` | `{mods}` | This mod shares files with: {mods}. |
| `mod.conflictsFound` | `{n}` | {n} conflict(s) found |
| `mod.deactivated` | `{name}` | "{name}" disabled. |
| `mod.deleteWarning` | `{name}` | Do you want to remove {name} ? |
| `mod.disabledCount` | `{count}` | {count} mod(s) disabled. |
| `mod.disableDependentsDesc` | `{names}` | The following mods are linked to this one and could be disabled: {names}. Do you want to disable them as well? |
| `mod.downloading` | `{name}` | Downloading "{name}"... |
| `mod.enabledCount` | `{count}` | {count} mod(s) enabled. |
| `mod.filesCount` | `{count}` | {count} installed files |
| `mod.idCopied` | `{id}` | ID copied: {id} |
| `mod.importConfirmDesc` | `{name}` | Do you want to download and install &lt;strong&gt;{name}&lt;/strong&gt; ? |
| `mod.installed` | `{name}` | "{name}" installed successfully! |
| `mod.removed` | `{name}` | "{name}" permanently deleted. |
| `mod.removedOnly` | `{name}` | "{name}" removed from list. |
| `mod.removeTagConfirm` | `{name}` | Are you sure you want to remove the tag {name} from this mod? |
| `mod.scanAdded.many` | `{n}` | {n} new mods added |
| `mod.scanFound` | `{count}` | {count} mod(s) discovered! |
| `mod.scanRemoved.many` | `{n}` | {n} mods removed |

### modpack

| Key | Variables | Text |
|---|---|---|
| `modpack.act.bypass` | `{n}` | Enable the {n} mod(s) without hashes anyway |
| `modpack.act.conflictInPack` | `{n}` | {n} file(s), both in the pack |
| `modpack.act.conflictOutside` | `{n}` | {n} file(s), stays on |
| `modpack.act.doneFailed` | `{n}` | {n} failed |
| `modpack.act.doneLine` | `{off}` `{on}` | {on} enabled, {off} disabled |
| `modpack.act.doneMissing` | `{n}` | {n} missing |
| `modpack.act.doneSha` | `{n}` | {n} without hashes |
| `modpack.act.exclusiveHint` | `{n}` | Turns off the {n} other mod(s) that are on now. |
| `modpack.act.failed` | `{e}` | The modpack could not be activated: {e} |
| `modpack.act.go` | `{n}` | Activate ({n}) |
| `modpack.act.goExclusive` | `{n}` | Turn off {n} other mod(s) |
| `modpack.act.integrityWarn` | `{n}` | {n} integrity warning(s) |
| `modpack.act.jobLabel` | `{name}` | Modpack « {name} » |
| `modpack.act.offLabel` | `{name}` | Deactivate « {name} » |
| `modpack.act.pickSub` | `{n}` | {n} pack(s). Pick one to see what it changes before anything is touched. |
| `modpack.act.queued` | `{name}` | « {name} » is being activated in the background. |
| `modpack.act.title` | `{name}` | Activate « {name} » |
| `modpack.addModErrors` | `{count}` | {count} mod(s) failed. |
| `modpack.applyPartial` | `{applied}` `{missing}` | {applied} mods enabled, {missing} missing. |
| `modpack.cat.build.done` | `{n}` | Catalogue written with {n} pack(s). |
| `modpack.cat.build.doneSome` | `{m}` `{n}` | Catalogue written with {n} pack(s). {m} skipped for having no address. |
| `modpack.cat.build.notPack` | `{f}` | {f} is not a modpack, skipped |
| `modpack.cat.installed` | `{name}` | “{name}” installed. |
| `modpack.cat.someFailed` | `{n}` | {n} catalogue(s) did not answer. |
| `modpack.countAll` | `{n}` | {n} packs |
| `modpack.countOf` | `{n}` `{total}` | {n} of {total} |
| `modpack.createdAt` | `{date}` | Created {date} |
| `modpack.modsCount` | `{count}` | {count} mod(s) |
| `modpack.noMatch` | `{q}` | No modpack matches "{q}". |
| `modpack.repair.denied` | `{name}` | {name}: access denied by server |
| `modpack.repair.incomplete` | `{errors}` | Incomplete repair: • {errors} |
| `modpack.repair.noLink` | `{name}` | {name}: no download link provided |
| `modpack.repair.noLinkSkipped` | `{name}` | {name}: no link provided, skipped. |
| `modpack.repair.notFound` | `{name}` | {name}: file not found on server |
| `modpack.repair.partial` | `{errors}` | Repaired, but some mods were skipped: • {errors} |
| `modpack.repair.repairing` | `{name}` | Repairing {name}… |
| `modpack.updatedAt` | `{date}` | Updated {date} |

### mods

| Key | Variables | Text |
|---|---|---|
| `mods.sha.missingDesc` | `{name}` | The mod "{name}" does not have a valid SHA hash. For security reasons, it is recommended to calculate the has… |

### notif

| Key | Variables | Text |
|---|---|---|
| `notif.dndQuietHours` | `{to}` | Quiet hours until {to}. Change them in Settings. |
| `notif.jobDone` | `{job}` | Finished: {job} |
| `notif.jobFailed` | `{err}` `{job}` | Failed: {job}. {err} |
| `notif.repeated` | `{n}` | Arrived {n} times |
| `notif.snoozedUntil` | `{when}` | back {when} |
| `notif.unreadN` | `{n}` | {n} unread |

### nudge

| Key | Variables | Text |
|---|---|---|
| `nudge.waiting.many` | `{n}` | {n} more messages waiting |

### oldInstalls

| Key | Variables | Text |
|---|---|---|
| `oldInstalls.backingUp` | `{name}` | Backing up {name}… |
| `oldInstalls.backupLede` | `{size}` | This folder holds the old version's data ({size}). This version already has its own copy. |
| `oldInstalls.backupSaved` | `{path}` | Your backup: {path} |
| `oldInstalls.confirmData` | `{size}` | This permanently deletes the folder below ({size}). It does not go to the Recycle Bin. |
| `oldInstalls.confirmQuickTitle` | `{n}` | Delete {n} item(s)? |
| `oldInstalls.found` | `{n}` `{size}` | {n} item(s) found, {size} in all |
| `oldInstalls.lineBackup` | `{path}` | Backup saved: {path} |
| `oldInstalls.lineCancelled` | `{name}` | {name}: uninstall cancelled. |
| `oldInstalls.lineDeleted` | `{name}` | Deleted {name} |
| `oldInstalls.lineKept` | `{name}` | Kept {name} |
| `oldInstalls.lineStillThere` | `{name}` | {name} is still installed. If its uninstaller is still open, finish it, then scan again. |
| `oldInstalls.lineUninstalled` | `{name}` | {name} uninstalled. |
| `oldInstalls.pointsTo` | `{path}` | Points to {path} |
| `oldInstalls.removeN` | `{n}` | Remove {n} selected… |
| `oldInstalls.summary` | `{done}` `{failed}` `{skipped}` | {done} removed, {failed} failed, {skipped} kept. |
| `oldInstalls.uninstalling` | `{name}` | Uninstalling {name}… Answer the uninstaller if it asks. |

### onboarding

| Key | Variables | Text |
|---|---|---|
| `onboarding.stepCounter` | `{current}` `{total}` | STEP {current} / {total} |

### order

| Key | Variables | Text |
|---|---|---|
| `order.applied` | `{n}` | Order applied: {n} file(s) re-deployed |
| `order.applyFailed` | `{e}` | The order is saved, but the game folder could not be fully updated: {e}. Re-apply finishes the job. |
| `order.contested` | `{n}` | {n} shared file(s) |
| `order.import.files` | `{n}` | {n} file(s) change winner |
| `order.import.fromTo` | `{m}` `{n}` | From position {n} to {m} |
| `order.import.inactive` | `{n}` | {n} not active |
| `order.import.inactiveList` | `{n}` | Installed, not active ({n}) |
| `order.import.missing` | `{n}` | {n} not installed |
| `order.import.missingList` | `{n}` | Not installed ({n}) |
| `order.import.moved` | `{n}` | {n} moved |
| `order.import.placed` | `{m}` `{n}` | {n} of {m} placed |
| `order.lib.moved` | `{f}` `{m}` `{n}` | {m}: position {n}, {f} file(s) re-deployed |
| `order.lib.position` | `{n}` `{t}` | Position {n} of {t} |
| `order.loadFailed` | `{e}` | Could not read the activation order: {e} |
| `order.more` | `{n}` | +{n} more |
| `order.moved` | `{m}` `{n}` | {m} moved to position {n} |
| `order.overriddenBy` | `{m}` `{n}` | {n} file(s) overridden by {m} |
| `order.overrides` | `{m}` `{n}` | Overrides {n} file(s) from {m} |
| `order.pending` | `{n}` | {n} file(s) will change hands |
| `order.position` | `{n}` | Position {n} |
| `order.reapplied` | `{n}` | Re-applied: {n} file(s) copied |
| `order.share.failed` | `{e}` | Could not share the order: {e} |
| `order.share.lede` | `{n}` | {n} active mod(s), named by what another PC can recognize, never by local paths. |
| `order.titleFor` | `{p}` | Activation order: {p} |
| `order.tools.listsCount` | `{n}` | {n} saved |

### orderList

| Key | Variables | Text |
|---|---|---|
| `orderList.act.already` | `{n}` | {n} already on |
| `orderList.act.disable` | `{n}` | {n} to turn off |
| `orderList.act.disableList` | `{n}` | Turned off ({n}) |
| `orderList.act.enable` | `{n}` | {n} to turn on |
| `orderList.act.enableList` | `{n}` | Turned on, in this order ({n}) |
| `orderList.act.missing` | `{n}` | {n} not found, skipped |
| `orderList.act.missingList` | `{n}` | Not found ({n}) |
| `orderList.activated` | `{d}` `{f}` `{m}` `{n}` | {n} mod(s) on, {d} turned off, {f} file(s) re-deployed, {m} not found. |
| `orderList.activatedCancelled` | `{d}` `{f}` `{n}` | Stopped: {n} mod(s) on, {d} turned off, {f} file(s) re-deployed. |
| `orderList.activateFailed` | `{e}` | Activation failed: {e} |
| `orderList.activateTitle` | `{m}` `{p}` | Activate {m} on {p} |
| `orderList.addedN` | `{n}` | {n} mod(s) added. |
| `orderList.addFromProfile` | `{p}` | Add the order of {p} |
| `orderList.addFromProfileTip` | `{p}` | Append the active mods of {p}, in their current order, skipping those already listed |
| `orderList.addSelected` | `{n}` | Add selected ({n}) |
| `orderList.applied` | `{n}` | Order applied to {n} profile(s). |
| `orderList.applyOne` | `{f}` `{n}` | {n} mod(s) placed, {f} file(s) re-deployed |
| `orderList.applyOneFailed` | `{e}` | failed: {e} |
| `orderList.applyPartial` | `{m}` `{n}` | Order applied to {n} of {m} profile(s). See below. |
| `orderList.applyTitle` | `{m}` | Apply the order of {m} |
| `orderList.count` | `{n}` | {n} mod(s) |
| `orderList.deleteConfirm` | `{m}` | Click Delete again to delete {m}. |
| `orderList.failed` | `{n}` | Could not turn on ({n}) |
| `orderList.fromProfileName` | `{p}` | Order of {p} |
| `orderList.importNotes` | `{n}` | Notes: {n} characters |
| `orderList.jobLabel` | `{m}` | List « {m} » |
| `orderList.loadFailed` | `{e}` | Could not read the order lists: {e} |
| `orderList.notesChars` | `{n}` | {n} characters |
| `orderList.notesCount` | `{m}` `{n}` | {n} / {m} characters |
| `orderList.notesEditorTitle` | `{m}` | Notes: {m} |
| `orderList.nowCalled` | `{m}` | Now called {m} |
| `orderList.pick.results` | `{n}` | {n} result(s) |
| `orderList.scopeSome` | `{n}` | For {n} profile(s) |
| `orderList.shareFileLedeNotes` | `{n}` | The whole list as a file, with its {n} characters of notes. |
| `orderList.shareLen` | `{m}` `{n}` | {n} / {m} characters |
| `orderList.shareTitle` | `{m}` | Share "{m}" |
| `orderList.st.active` | `{n}` | Active, #{n} |
| `orderList.st.activeTip` | `{n}` `{p}` | On in {p}, at position {n} of its order |
| `orderList.st.inactiveTip` | `{p}` | Installed in {p} but off: Activate turns it on |
| `orderList.st.outsideTip` | `{p}` | Installed on this PC, but not part of {p} |
| `orderList.sum.active` | `{n}` | {n} active |
| `orderList.sum.byName` | `{n}` | {n} matched by name |
| `orderList.sum.inactive` | `{n}` | {n} installed, off |
| `orderList.sum.missing` | `{n}` | {n} not found |
| `orderList.viewingFor` | `{p}` | State in {p} |
| `orderList.viewState` | `{p}` | Show the state of the mods in {p} |

### paths

| Key | Variables | Text |
|---|---|---|
| `paths.errFailed` | `{s}` | Could not work out where “{s}” is |

### plugins

| Key | Variables | Text |
|---|---|---|
| `plugins.apiChipOn` | `{port}` | Local API · port {port} |
| `plugins.applySuccess` | `{enabled}` | {enabled} mod(s) activated |
| `plugins.assets.added` | `{f}` | Added {f}. |
| `plugins.assets.errExists` | `{f}` | The plugin already ships a file called {f}. Rename yours, or remove that one first. |
| `plugins.assets.errTooBig` | `{0}` | Too big to show ({0} KB). |
| `plugins.assets.removed` | `{f}` | Removed {f}. |
| `plugins.assets.saved` | `{f}` | Saved as {f}. |
| `plugins.assets.title` | `{p}` | Files shipped with {p} |
| `plugins.auto.imported` | `{n}` | {n} automation(s) added, disabled. Review them in the Scheduler: |
| `plugins.auto.importedOnly` | `{n}` | {n} automation(s) added and left off. |
| `plugins.autoUpdated` | `{name}` `{v}` | Plugin "{name}" updated to v{v} |
| `plugins.bundle.followed` | `{n}` | {n} catalogue(s) followed |
| `plugins.bundleBadFile` | `{0}` | Not a catalogue bundle: {0} |
| `plugins.canJoin` | `{n}` | CAN JOIN: {n} mod(s) ready |
| `plugins.cannotJoin` | `{n}` | CANNOT JOIN: {n} issue(s) |
| `plugins.catNoSource` | `{id}` | "{id}" has no address and is not installed. Nobody will be able to get it |
| `plugins.catPacked` | `{f}` | packed into {f} |
| `plugins.catPackMissing` | `{list}` `{n}` | The catalogue names {n} file(s) that are not in the folder: {list} |
| `plugins.catPublished` | `{k}` `{n}` | Written: {n} plugin(s) packed, {k} left pointing at their address |
| `plugins.check.missingAsset` | `{f}` | The manifest lists the file {f}, and it is not there. That list is written from disk when the plugin is packe… |
| `plugins.check.missingScript` | `{f}` | The manifest declares the script {f}, and it is not in the folder. The plugin installs, applying it runs noth… |
| `plugins.check.undeclaredAsset` | `{f}` | {f} is in the folder but not in the manifest. It still works, but moderation only sees the manifest. |
| `plugins.chooseScriptDesc` | `{name}` | "{name}": pick a script. It runs a real program on your PC. |
| `plugins.compareIssues` | `{n}` | {n} issue(s) detected |
| `plugins.contents.autoAsks` | `{p}` | Written to use: {p} |
| `plugins.contents.autoSteps` | `{n}` | {n} step(s) |
| `plugins.contents.count` | `{n}` | {n} item(s) |
| `plugins.contents.folderWhat` | `{n}` `{s}` | {n} file(s), {s}. |
| `plugins.contents.missingWhy` | `{f}` | The manifest lists “{f}” but it is not in the plugin folder. This part will do nothing. |
| `plugins.contents.nFiles` | `{n}` | {n} file(s) |
| `plugins.createPermsN` | `{all}` `{n}` | {n} of {all} requested |
| `plugins.createSaved` | `{name}` | Plugin '{name}' saved locally |
| `plugins.deepLinkActivateDesc` | `{name}` | Activate the mod list for '{name}'? |
| `plugins.deepLinkModDisabled` | `{id}` | Mod '{id}' disabled |
| `plugins.deepLinkModEnabled` | `{id}` | Mod '{id}' enabled |
| `plugins.deepLinkNotFound` | `{id}` | Plugin '{id}' not installed |
| `plugins.deepLinkProfileActivated` | `{id}` | Profile '{id}' activated |
| `plugins.errChecksumMismatch` | `{actual}` `{expected}` | the downloaded file does not match the catalogue's checksum (expected {expected}, got {actual}). |
| `plugins.exportSuccess` | `{name}` | Plugin '{name}' exported |
| `plugins.fromIndex` | `{n}` | Added {n} plugin catalog(s) from that index. |
| `plugins.indexAll` | `{n}` | That index lists {n} plugin catalog(s) and you already follow them all. |
| `plugins.indexNone` | `{n}` | That index lists no plugin catalogs, only {n} entr(y/ies) of other kinds. |
| `plugins.indexNone2` | `{what}` | No plugin catalogs in that index, only {what}. Add those from their own screens. |
| `plugins.installSuccess` | `{name}` | Plugin '{name}' installed! |
| `plugins.modsNotFound` | `{mods}` | Mods not found: {mods} |
| `plugins.noChecksumBody` | `{name}` | The catalogue entry for "{name}" has no SHA-256, so BMM cannot check that the file it downloads is the one th… |
| `plugins.pcbAlready` | `{id}` | {id} is already in this catalogue |
| `plugins.pcbFromFile` | `{f}` | from {f} |
| `plugins.pcbNotPlugin` | `{f}` | {f} is not a plugin, left out |
| `plugins.perm.asksN` | `{all}` `{n}` | Asks for {n} of {all} |
| `plugins.perm.extra` | `{x}` | Granted but not asked for: {x} |
| `plugins.permsGranted` | `{n}` `{total}` | {n} / {total} granted |
| `plugins.ptEmptyResponse` | `{s}` | (empty response: {s}) |
| `plugins.ptNetworkError` | `{e}` | Network error: {e} Make sure BMM is running and the API is listening on port 51274. |
| `plugins.ptTruncated` | `{n}` | [truncated: {n} chars] |
| `plugins.qtFieldsRequired` | `{fields}` | {fields} are required |
| `plugins.qtPathParam` | `{n}` | Replaces :{n} in the address. |
| `plugins.runScriptsDesc` | `{n}` `{name}` | "{name}" wants to run {n} external script(s) on your computer. Only continue if you trust this plugin. |
| `plugins.scriptsRan` | `{n}` | Ran {n} script(s). |
| `plugins.shipCount` | `{n}` | {n} shipped |
| `plugins.shownOf` | `{n}` `{total}` | {n} of {total} |
| `plugins.tree.archive` | `{n}` | An archive holding {n} file(s) |
| `plugins.tree.chip` | `{b}` `{f}` | {f} file(s) · {b} |
| `plugins.tree.holds` | `{b}` `{n}` | {n} files · {b} |
| `plugins.tree.sum` | `{b}` `{d}` `{f}` | {f} file(s) in {d} folder(s) · {b} |
| `plugins.uninstallDesc` | `{name}` | Remove '{name}' and all its files? |
| `plugins.uninstallSuccess` | `{name}` | Plugin '{name}' removed |
| `plugins.updateNeedsChecksum` | `{name}` | {name}: an update is available, but its catalogue entry has no checksum. Install it from the catalogue to con… |

### prof

| Key | Variables | Text |
|---|---|---|
| `prof.bgCropError` | `{err}` | Cropping error: {err} |
| `prof.chk.free` | `{drive}` `{free}` | {free} free on {drive} |
| `prof.chk.sharedBackup` | `{profiles}` | Already the backup folder of: {profiles}. Each profile needs its own, or disabling a mod could restore anothe… |
| `prof.chk.sharedGame` | `{profiles}` | Also the game folder of: {profiles}. That works: the files a mod puts in the game belong to the game folder,… |
| `prof.chk.sharedMods` | `{profiles}` | Already the mods folder of: {profiles}. Both profiles will list the same mods. |
| `prof.confirmDisableSelected` | `{count}` | Do you want to disable all mods for the {count} selected profiles? |
| `prof.created` | `{name}` | Profile "{name}" created successfully. |
| `prof.createError` | `{err}` | Could not create the profile: {err} |
| `prof.deleteConfirmLabel` | `{name}` | Do you really want to delete the profile "{name}"? This action cannot be undone. |
| `prof.deleteError` | `{err}` | Delete error: {err} |
| `prof.duplicateFolderMsg` | `{profile}` | Warning: This mods folder is already used by profile: {profile} |
| `prof.hasActiveMods` | `{count}` | {count} mod(s) are still active in this profile. Disable them all before deleting? |
| `prof.importError` | `{err}` `{type}` | {type} import failed: {err} |
| `prof.importSuccess` | `{count}` `{type}` | {count} {type} profile(s) imported successfully. |
| `prof.modsActive` | `{count}` | {count} active mod(s) |
| `prof.modsDisabled` | `{count}` | {count} mod(s) disabled |
| `prof.need.lead` | `{what}` | Still needed: {what} |
| `prof.ovgmeImported` | `{count}` | {count} OvGME profile(s) imported successfully. |
| `prof.updated` | `{name}` | Profile "{name}" updated. |

### repo

| Key | Variables | Text |
|---|---|---|
| `repo.adv.count` | `{n}` | Tools: {n} |
| `repo.browse.downdetail` | `{s}` | BetterCommunity answered HTTP {s}. Server issue, not your connection. Try again shortly. |
| `repo.cat.b.count` | `{m}` `{n}` | {n} of {m} selected |
| `repo.cat.b.pulled` | `{m}` `{n}` | Added {n} of {m}. The rest were already here. |
| `repo.cat.followedN` | `{n}` | {n} catalogue(s) followed |
| `repo.cat.pick.export` | `{n}` | Export {n} |
| `repo.cat.saved` | `{n}` | Saved {n} repos. |
| `repo.checkingMod` | `{name}` | Checking "{name}" for updates… |
| `repo.claims` | `{c}` | claims “{c}” |
| `repo.convert.doneSigned` | `{backup}` `{v}` | Converted to format {v} and signed. Old manifest kept as {backup}. |
| `repo.convert.doneUnsigned` | `{backup}` `{v}` | Converted to format {v}, unsigned. Old manifest kept as {backup}. |
| `repo.convert.go` | `{v}` | Convert to {v} |
| `repo.convert.lead` | `{from}` `{to}` | Now {from}. After: format {to}. Nothing is written until you confirm. |
| `repo.convert.more` | `{n}` | And {n} more. |
| `repo.convert.upToDate` | `{v}` | Already format {v}. Nothing to change. |
| `repo.errPortInUse` | `{port}` | Port {port} is already in use by another application. |
| `repo.extras.applied` | `{n}` | {n} item(s) added to the repo. |
| `repo.extras.bundleOf` | `{t}` | A catalogue of {t}, carried inside the repo. No other host needed. |
| `repo.extras.catalogOf` | `{t}` | A {t} catalogue you follow. |
| `repo.extras.followed` | `{n}` | {n} catalogue(s) followed. |
| `repo.extras.installed` | `{n}` | {n} item(s) taken from this repo. |
| `repo.extras.lpDesc` | `{n}` | {n} program(s) |
| `repo.extras.pending` | `{n}` | Kept: {n} thing(s) will go in when a repo is made |
| `repo.extras.pendingTag` | `{n}` | {n} waiting |
| `repo.extras.taskAdded` | `{n}` | {n} automation(s) added, disabled. |
| `repo.follow.added` | `{name}` | Following {name}. |
| `repo.follow.applied` | `{n}` `{name}` | {name}: {n} mod(s) updated and applied. |
| `repo.follow.checkFailed` | `{err}` `{name}` | Could not check {name}: {err} |
| `repo.follow.downloaded` | `{n}` `{name}` | {name}: {n} mod(s) downloaded. |
| `repo.follow.everyMin` | `{n}` | every {n} minutes |
| `repo.follow.found` | `{n}` `{name}` | {name}: {n} of your mods have an update. |
| `repo.follow.foundManual` | `{n}` `{name}` | {name}: {n} update(s) found, but BMM cannot tell which profile they belong to. Update them from the mod list. |
| `repo.follow.heldGame` | `{n}` `{name}` | {name}: {n} update(s) found. A game is running, so nothing was installed; BMM tries again at the next check. |
| `repo.follow.installFailed` | `{err}` `{name}` | {name}: the update failed: {err} |
| `repo.follow.jobOff` | `{name}` | Update from {name}: turning mods off |
| `repo.follow.jobOn` | `{name}` | Update from {name}: turning mods back on |
| `repo.follow.lastCheck` | `{when}` | checked {when} |
| `repo.follow.lastError` | `{err}` | Last check failed: {err} |
| `repo.follow.updates` | `{n}` | {n} update(s) |
| `repo.follow.upToDate` | `{name}` | {name}: your mods are up to date. |
| `repo.followDlg.content` | `{mods}` `{profiles}` | {mods} mod(s) in {profiles} profile(s) |
| `repo.followDlg.errHttp` | `{code}` | The server answered HTTP {code}: there is no repo at this address, or it refuses BMM. |
| `repo.followDlg.fmtVersion` | `{v}` | repo.json format {v} |
| `repo.followDlg.testing` | `{url}` | Reading {url}… |
| `repo.format.label` | `{v}` | format {v} |
| `repo.format.legacy` | `{v}` | legacy {v} |
| `repo.format.legacyHint` | `{cur}` | Written by an older BMM. It still works; converting brings it to format {cur}. |
| `repo.format.needsHint` | `{cur}` | Today's BMM only reads this one through a repair. Convert it to format {cur}. |
| `repo.format.tooNew` | `{v}` | format {v} (newer than this BMM) |
| `repo.head.historyCount` | `{n}` | {n} repos in your history |
| `repo.head.joined` | `{name}` | Joined: {name} |
| `repo.hiddenN` | `{n}` | {n} hidden by you |
| `repo.hostMetaMods` | `{n}` | {n} mod(s) |
| `repo.modBaselined` | `{name}` | Now tracking "{name}". Re-check later to detect a new build. |
| `repo.modNoSource` | `{name}` | "{name}" has no update source. Use "Configure updates" to link one. |
| `repo.modSourceUnreachable` | `{name}` | Couldn't reach the update source for "{name}" |
| `repo.modUpToDate` | `{name}` | "{name}" is up to date |
| `repo.notifClientConnectedDetail` | `{creator_id}` `{protocol}` | {protocol} · ID: {creator\_id} |
| `repo.notifDownloadFinishedDetail` | `{creator_id}` `{file}` | {creator\_id} finished downloading {file} |
| `repo.notifDownloadStartedDetail` | `{creator_id}` `{file}` | {creator\_id} is downloading {file} |
| `repo.preview.extras` | `{n}` | Extras (plugins, themes, lists…): {n} |
| `repo.preview.modpacks` | `{n}` | Modpacks shared: {n} |
| `repo.preview.total` | `{files}` `{size}` | {files} files, {size} in all |
| `repo.profilesCount` | `{count}` | Profiles ({count}): |
| `repo.quick.doneFolder` | `{dir}` `{n}` | repo.json written in {dir}. Mods described: {n}. |
| `repo.quick.doneModpack` | `{dir}` `{n}` | Repo created in {dir}. Mods added: {n}. |
| `repo.quick.doneProfile` | `{dir}` | Repo created in {dir}. |
| `repo.quick.modsN` | `{n}` | {n} mods |
| `repo.quick.overwrite` | `{dir}` | {dir} already holds a repo. Rebuild it from this profile? |
| `repo.remote.errEmptyDir` | `{0}` | Nothing found under {0}. Is that the mods folder? |
| `repo.serverOnline` | `{port}` | Server online: port {port} |
| `repo.share.message` | `{link}` `{name}` `{url}` | Join my BMM repo « {name} »: {link} Or in BMM: Server Repo, Sync tab, paste {url} and press Fetch. |
| `repo.ssh.browserPicked` | `{dir}` | Remote folder: {dir} |
| `repo.ssh.downloading` | `{done}` `{file}` `{total}` | Fetching {done}/{total}: {file} |
| `repo.ssh.errAuth` | `{detail}` | Authentication failed: {detail} |
| `repo.ssh.errBadManifest` | `{detail}` | The server's repo.json could not be read: {detail} |
| `repo.ssh.errConnect` | `{detail}` `{host}` | Could not reach {host}: {detail} |
| `repo.ssh.errGeneric` | `{detail}` | SSH operation failed: {detail} |
| `repo.ssh.errHostKeyChanged` | `{fp}` | This server’s fingerprint changed ({fp}). Refused. If you rebuilt the machine, use “Forget the fingerprint”;… |
| `repo.ssh.errKeyDecode` | `{detail}` | That file is not a private key BMM can read: {detail} |
| `repo.ssh.errKeyRead` | `{detail}` | Could not read the key file: {detail} |
| `repo.ssh.errListDir` | `{detail}` `{dir}` | Could not read the remote folder {dir}: {detail} |
| `repo.ssh.errLocalDir` | `{dir}` | {dir} is not a folder. |
| `repo.ssh.errLocalWrite` | `{detail}` `{path}` | Could not write to {path}: {detail} |
| `repo.ssh.errNoManifest` | `{dir}` | No repo.json in {dir} on the server. The remote folder is probably one level too high, or points at the expor… |
| `repo.ssh.errNoSuchTarget` | `{name}` | No SSH target saved under the name "{name}". Check the name in "Publish over SSH". |
| `repo.ssh.errOpenRemote` | `{detail}` `{path}` | Could not open {path}: {detail} |
| `repo.ssh.errReadRemote` | `{detail}` `{path}` | Could not read {path}: {detail} |
| `repo.ssh.errRemoteMissing` | `{dir}` | The remote folder {dir} does not exist. |
| `repo.ssh.errSftp` | `{detail}` | SFTP could not start on the server: {detail} |
| `repo.ssh.errUnsafePath` | `{path}` | The server returned a path that would escape the destination folder ({path}). Transfer stopped. |
| `repo.ssh.pullConfirm` | `{dir}` | Fetch the remote repo into {dir}? Files with the same name are overwritten by the server's version. Files tha… |
| `repo.ssh.pulled` | `{n}` `{size}` | {n} file(s) fetched ({size}). |
| `repo.ssh.testNoDir` | `{dir}` | Connected, but {dir} does not exist yet. It will be created on the first upload. |
| `repo.ssh.testNotWritable` | `{dir}` | Connected, but {dir} cannot be written to. The upload would fail after transferring everything, so fix the pe… |
| `repo.ssh.testOk` | `{fp}` | Connected. Fingerprint {fp}. |
| `repo.ssh.testOkButNot` | `{fp}` | Connected (fingerprint {fp}), but publishing would fail. See below. |
| `repo.ssh.testWhyFix` | `{dir}` `{user}` | On the server: sudo chown {user} {dir}, or publish into a subfolder you own, e.g. {dir}/bmm. |
| `repo.ssh.testWhyOwner` | `{dir}` `{mode}` `{owner}` `{user}` | {dir} belongs to uid {owner} (mode {mode}) and BMM connected as “{user}”, who cannot write there. Your accoun… |
| `repo.ssh.uploaded` | `{n}` `{size}` | Published: {n} files, {size}. |
| `repo.ssh.uploading` | `{done}` `{file}` `{total}` | Uploading {done}/{total}: {file} |
| `repo.static.done` | `{n}` | Files written in the repo folder: {n} |
| `repo.static.md.share` | `{url}` | In BMM: Server Repo, Sync tab, paste {url} and press Fetch. The Share link tool also makes a one-click link. |
| `repo.stepChecking` | `{current}` `{mod}` `{profile}` `{total}` | Checking: {profile} - {mod} ({current}/{total}) |
| `repo.stepDownloading` | `{current}` `{mod}` `{profile}` `{total}` | Downloading: {profile} - {mod} ({current}/{total}) |
| `repo.stepExporting` | `{current}` `{mod}` `{profile}` `{total}` | Exporting: {profile} - {mod} ({current}/{total}) |
| `repo.stepFetchingPart` | `{current}` `{mod}` `{profile}` `{total}` | Fetching part: {profile} - {mod} (Block {current}/{total}) |
| `repo.stepPreparing` | `{current}` `{mod}` `{profile}` `{total}` | Preparing: {profile} - {mod} ({current}/{total}) |
| `repo.update.matchN` | `{m}` `{n}` | {n} of {m} |
| `repo.update.modN` | `{n}` | {n} mods |
| `repo.update.published` | `{n}` | {n} file(s) published. |
| `repo.update.publishMsg` | `{name}` | The folder above replaces what “{name}” is serving right now. Anyone syncing gets the new version on their ne… |
| `repo.update.pulled` | `{n}` | {n} file(s) fetched. Edit below, then publish back. |
| `repo.update.showMore` | `{n}` | Show {n} more |
| `repo.update.urlNoTarget` | `{name}` | No SSH target named “{name}”. Add it under Publish over SSH. |
| `repo.updateApply` | `{count}` | Update {count} mod(s) |
| `repo.updatesBaselined` | `{count}` | Now tracking {count} direct download(s). Re-check later to detect changes. |
| `repo.updatesFound` | `{count}` | {count} update(s) available |
| `repo.updatesRepoErrors` | `{count}` | {count} repo(s) could not be reached |
| `repo.validate.cacheHits` | `{n}` | {n} unchanged files were not read again (tick « Re-read every file » to force it). |
| `repo.validate.changed` | `{n}` | Files that differ from repo.json: {n}. |
| `repo.validate.duplicateIds` | `{n}` | Mods listed twice in one profile: {n}. |
| `repo.validate.emptyProfiles` | `{n}` | Profiles with no mods: {n}. |
| `repo.validate.filled` | `{n}` | Files with no hash yet: {n}. |
| `repo.validate.formatNewer` | `{v}` | Format {v}: newer than this BMM. Readable, some fields may be ignored. |
| `repo.validate.formatOk` | `{v}` | Format {v}: current. |
| `repo.validate.formatOld` | `{cur}` `{v}` | Format {v}: older than {cur}. |
| `repo.validate.formatTooNew` | `{v}` | Format {v}: too new for this BMM. Update BMM to check it. |
| `repo.validate.missing` | `{n}` | Listed files that are missing: {n}. |
| `repo.validate.progress` | `{done}` `{of}` `{size}` `{total}` | {done} / {total} files · {size} of {of} |
| `repo.validate.summary` | `{files}` `{mods}` `{profiles}` `{size}` | {profiles} profiles, {mods} mods, {files} files, {size}. |
| `repo.validate.took` | `{s}` | Checked in {s} s. |
| `repo.validate.verdictBad` | `{n}` | Problems to fix before sharing: {n}. |
| `repo.validate.verdictWarn` | `{n}` | Usable. Points to look at: {n}. |
| `repo.validate.which` | `{n}` | Show which ({n}) |
| `repo.version.alsoConverts` | `{v}` | The manifest is converted to format {v} at the same time. |
| `repo.version.confirm` | `{from}` `{to}` | Set the version from {from} to {to} and re-sign repo.json? |
| `repo.version.done` | `{backup}` `{v}` | Version {v} set and signed. Old manifest kept as {backup}. |
| `repo.version.same` | `{v}` | The repo is already at {v}. |

### res

| Key | Variables | Text |
|---|---|---|
| `res.byTask` | `{m}` | set by a task, {m} min left |
| `res.inForce` | `{p}` | In force: {p} |
| `res.pausedBy.plugin` | `{n}` | Paused by the plugin {n}. |
| `res.pausedBy.task` | `{n}` | Paused by the task “{n}”. |
| `res.pausedLeft` | `{m}` | Resumes by itself in {m} min. |

### resources

| Key | Variables | Text |
|---|---|---|
| `resources.link.presetSet` | `{name}` | Resource preset: {name} |

### restore

| Key | Variables | Text |
|---|---|---|
| `restore.confirmBody` | `{n}` | {n} section(s) will be written over what is there now. |
| `restore.count` | `{n}` `{size}` | {n} file(s) · {size} |
| `restore.done` | `{n}` | Restored {n} file(s). Reloading… |
| `restore.failed` | `{error}` | Restore failed: {error} |
| `restore.notif` | `{n}` `{sections}` | Restored {n} file(s) from a .DATABMM: {sections}. |
| `restore.previousAt` | `{path}` | Your previous data is at {path} |
| `restore.unreadable` | `{error}` | That file could not be read as a .DATABMM: {error} |
| `restore.written` | `{version}` `{when}` | Written {when} by BMM {version} |

### rstudio

| Key | Variables | Text |
|---|---|---|
| `rstudio.cutsnapped` | `{s}` | Cut ends at {s}s, the next resume point. |

### sched

| Key | Variables | Text |
|---|---|---|
| `sched.ai.tainted` | `{f}` | Laya’s answer cannot be used in «{f}» of this step. Branch on a label instead. |
| `sched.arm.done` | `{n}` `{s}` | set “{n}” to {s} |
| `sched.arm.gone` | `{n}` | no task with the id {n}, nothing changed |
| `sched.bk.done` | `{f}` `{mb}` `{n}` | wrote {f} ({mb} MB, {n} section(s)) |
| `sched.bl.overwriteTitle` | `{n}` | Replace the block “{n}”? |
| `sched.bl.overwriteUsed` | `{n}` | Blocks are shared by every task, so this replaces what {n} caller(s) run: |
| `sched.bl.saved` | `{n}` | Saved “{n}”. |
| `sched.bmms.ok` | `{n}` | {n} step(s) |
| `sched.call.missing` | `{n}` | No block named “{n}”. |
| `sched.catBundled` | `{f}` | Packed into {f}. |
| `sched.catDone` | `{n}` | Published {n} entry(ies). |
| `sched.catEmpty` | `{k}` | nothing to publish for "{k}", no catalogue written |
| `sched.chainLoop` | `{n}` `{name}` | Chain stopped after {n} tasks: “{name}” waits on itself in a loop. |
| `sched.cond.gonePlugin` | `{n}` | {n} (not installed here) |
| `sched.creds.keyActive` | `{k}` | The active key ({k}) |
| `sched.creds.keyMissing` | `{k}` | {k} (no longer on the ring) |
| `sched.dbg.finishedLine` | `{n}` `{s}` `{w}` | {w}: {n} step(s), {s}s |
| `sched.dbg.modeUntil` | `{n}` | running until “{n}” |
| `sched.dbg.trailN` | `{n}` | {n} value(s) |
| `sched.dcsHookOff` | `{n}` | DCS watcher removed from {n} folder(s). |
| `sched.dcsHookOk` | `{n}` | DCS watcher installed in {n} folder(s). |
| `sched.dl.steps` | `{n}` | {n} step(s) |
| `sched.exp.missing` | `{n}` | {n} referenced task(s) no longer exist and cannot be included. |
| `sched.exp.withSubs` | `{n}` | Including {n} task(s) this one calls. |
| `sched.exportedN` | `{n}` | Exported {n} automation(s) |
| `sched.filter.n` | `{n}` `{total}` | {n} of {total} |
| `sched.filter.total` | `{total}` | {total} tasks |
| `sched.flag.denied` | `{k}` `{list}` | “{k}” is not a storage setting a task may change. Allowed: {list}. |
| `sched.flow.delMany` | `{n}` | Delete these {n} steps, and everything inside them? |
| `sched.flow.folded` | `{n}` | {n} inside, folded |
| `sched.flow.lastRun` | `{when}` | Last run {when} |
| `sched.flow.nBranches` | `{n}` | {n} branch(es) |
| `sched.flow.nCases` | `{n}` | {n} case(s) |
| `sched.flow.needs` | `{what}` | needs “{what}” |
| `sched.gen.done` | `{n}` | Repo written to {n} |
| `sched.gen.errGone` | `{n}` | Profile(s) no longer on this machine: {n} |
| `sched.gw.found` | `{f}` `{n}` | Found {n}, using {f} |
| `sched.gw.ready` | `{f}` | watching {f} |
| `sched.http.badUrl` | `{u}` | Not an http(s) address: {u} |
| `sched.http.status` | `{s}` `{u}` | HTTP {s} from {u} |
| `sched.imp.checked` | `{n}` | the backup opened ({n} section(s)) |
| `sched.imp.plugin` | `{p}` | installed the plugin "{p}" |
| `sched.imp.read` | `{n}` | read a list of {n} mod(s) |
| `sched.imp.restored` | `{n}` | RESTORED {n} section(s) over the current data |
| `sched.imp.tasks` | `{n}` | added {n} automation(s), disabled |
| `sched.imp.unknownKind` | `{k}` | nothing here reads a "{k}" |
| `sched.importedIncl` | `{n}` | also restored {n} item(s) it needed |
| `sched.importStripped` | `{p}` | Imported disabled. It asked for: {p}. Grant what you want in its permissions. |
| `sched.insp.unresolved` | `{n}` | Names {n} thing(s) it does not include (they will fail on another machine): |
| `sched.key.exists` | `{k}` | "{k}" is already on the ring, left alone |
| `sched.key.made` | `{k}` | made the identity key "{k}" |
| `sched.listApply.done` | `{new}` `{on}` | {on} mod(s) turned on, {new} installed. |
| `sched.listApply.missing` | `{n}` | {n} mod(s) could not be found |
| `sched.net.badHeader` | `{s}` | The header “{s}” has an unusable name or value. |
| `sched.net.error` | `{s}` | Network error: {s} |
| `sched.net.refused` | `{why}` | Refused before sending: {why}. |
| `sched.net.status` | `{s}` | The server answered HTTP {s}. |
| `sched.order.notActive` | `{m}` | “{m}” is not active, so it has no place in the deployment order. |
| `sched.pa.copied` | `{f}` | copied {f} |
| `sched.pa.missing` | `{p}` | {p} (no longer installed) |
| `sched.pa.ran` | `{f}` | ran {f} |
| `sched.par.branch` | `{n}` | BRANCH {n} |
| `sched.par.some` | `{m}` `{n}` | {n} of {m} parallel branch(es) failed |
| `sched.pc.doneToast` | `{n}` | {n} automation(s) found in the catalogues |
| `sched.pc.e403` | `{c}` | That catalog is private ({c}). |
| `sched.pc.e5xx` | `{c}` | Server error ({c}). Your address is fine. |
| `sched.pc.followed` | `{n}` | Following: {n} automation(s). |
| `sched.pc.followedBundle` | `{n}` | Following that bundle: {n} automation(s), no host needed. |
| `sched.pc.fromIndex` | `{n}` | Added {n} automation catalog(s) from that index. |
| `sched.pc.indexAll` | `{n}` | That index lists {n} automation catalog(s) and you already follow them all. |
| `sched.pc.indexNone` | `{n}` | That index lists no automation catalogs ({n} entr(y/ies) of other kinds). |
| `sched.pc.skipped` | `{n}` | {n} skipped |
| `sched.permDenied` | `{what}` | This task is not permitted to {what}. Grant it in the task’s permissions. |
| `sched.permsN` | `{n}` `{total}` | {n} of {total} granted |
| `sched.pg.applied` | `{t}` | Started from “{t}”. Change anything below. |
| `sched.pg.inner` | `{n}` | +{n} inside |
| `sched.pg.permsNeed` | `{p}` | Needs {p}. Left unticked: grant it after reading the steps. |
| `sched.pg.steps` | `{n}` | {n} step(s) |
| `sched.pg.sub` | `{n}` | {n} ready-made tasks. Each one is complete and does something useful as is; pick one, read what it does, then… |
| `sched.presetd.sharedvar` | `{sharedNote}` | Writes one shared variable every other task can read as {sharedNote}. A building block rather than a finished… |
| `sched.presetReplaceBody` | `{n}` | A preset replaces this task: {n} step(s), its name, trigger and permissions. Undo brings it back. |
| `sched.prev.lede` | `{c}` `{n}` | {c} of {n} step(s) would actually change something. |
| `sched.prev.noteMaybe` | `{m}` | Read from the steps. Nothing was run. {m} of them depend on a branch or loop condition. |
| `sched.prof.errGone` | `{n}` | No profile with the id {n} |
| `sched.prof.made` | `{n}` | Created “{n}” |
| `sched.prof.reused` | `{n}` | Profile “{n}” already exists: reused |
| `sched.ref.more` | `{n}` | {n} more. Narrow the search to see them. |
| `sched.retry.again` | `{n}` `{t}` | failed, attempt {n} of {t}… |
| `sched.retry.againIn` | `{s}` | failed, trying again in {s}s |
| `sched.rm.done` | `{a}` `{c}` `{n}` `{r}` | {n} mod(s) indexed: {a} added, {c} changed, {r} REMOVED |
| `sched.scrEngOk` | `{program}` `{version}` | Will run with {program} ({version}) on this computer. |
| `sched.sparkFails` | `{m}` `{n}` | {n} of the last {m} runs failed |
| `sched.sparkOk` | `{m}` | last {m} runs all fine |
| `sched.ssh.targetDefault` | `{n}` | The default one ({n}) |
| `sched.ssh.targetMissing` | `{n}` | {n} (no longer saved) |
| `sched.switchGap` | `{m}` | Not handled: {m} (DEFAULT catches them). |
| `sched.syncMadeProfile` | `{n}` | Created the profile “{n}” |
| `sched.syncNoManifest` | `{e}` | Could not read that repo (no repo.json, or it is unreachable): {e} |
| `sched.syncPickProfile` | `{list}` | Name which repo profile to sync. Available: {list} |
| `sched.tcb.count` | `{n}` | {n} selected |
| `sched.tcb.countMix` | `{e}` `{l}` `{n}` | {n} selected ({e} packed, {l} linked) |
| `sched.tcb.done` | `{n}` | Catalogue written: {n} automation(s) plus catalog.json |
| `sched.tcb.doneMix` | `{e}` `{l}` | Catalogue written: {e} automation(s) packed, {l} linked, plus catalog.json |
| `sched.tcb.dropped` | `{n}` | {n} entr(y/ies) left out |
| `sched.tcb.notTask` | `{f}` | {f} is not an automation, skipped |
| `sched.tcb.packed` | `{f}` | saved as {f} |
| `sched.tcb.packMissing` | `{list}` `{n}` | The catalogue names {n} file(s) that are not in the folder: {list} |
| `sched.test.confirm` | `{s}` | Testing “{s}” runs it for real: whatever it changes is changed. Continue? |
| `sched.trRssFound` | `{n}` `{t}` | {n} item(s), newest: {t} |
| `sched.trScr.loaded` | `{f}` | loaded {f} |
| `sched.v.json` | `{variable}` | Not valid JSON (with every {variable} replaced by text). |
| `sched.valid.wrongFormat` | `{got}` `{want}` | Expected {want} and got {got}. |
| `sched.var.badName` | `{n}` | Not a usable variable name: {n} |
| `sched.view.badWindow` | `{n}` | Not a window this step can open: {n} |
| `sched.view.gone` | `{n}` | {n} (no longer a screen) |
| `sched.wait.gaveUp` | `{n}` `{s}` | gave up after {n} tries (last answer {s}) |
| `sched.wait.noSignal` | `{h}` | no signal on "{h}" before the timeout |
| `sched.wh.badHeader` | `{h}` | Not a header line: {h} |
| `sched.wh.badJson` | `{e}` | The body is not valid JSON: {e} |
| `sched.why.afterArming` | `{v}` | Watching for “{v}” to finish |
| `sched.why.afterIdle` | `{v}` | Waiting for “{v}” to finish |
| `sched.why.dueAt` | `{v}` | due {v} |
| `sched.why.eventArming` | `{v}` | listening for {v} |
| `sched.why.eventIdle` | `{v}` | waiting for {v} |
| `sched.why.probeIdle` | `{v}` | The script has not said yes (checked every {v} min) |
| `sched.why.rssArming` | `{v}` | Watching {v}: the first check will learn what is there. |
| `sched.why.rssIdle` | `{v}` | Watching {v}: no new item since the last check. |
| `sched.why.watchArming` | `{v}` | learning {v} |
| `sched.why.watchIdle` | `{v}` | waiting for {v} to change |

### settings

| Key | Variables | Text |
|---|---|---|
| `settings.appPicker.error` | `{err}` | Error: {err} |
| `settings.appPicker.selected` | `{n}` | {n} selected |
| `settings.bcKey.okN` | `{n}` | {n} notification(s) fetched. |
| `settings.bundleEmpty` | `{x}` | Nothing to take for: {x}. |
| `settings.bundleExported` | `{mb}` `{n}` | Wrote {mb} MB ({n} section(s)). |
| `settings.catIndex.added` | `{n}` | Added {n} catalog source(s). |
| `settings.catIndex.already` | `{n}` | {n} already there. |
| `settings.catIndex.holds` | `{n}` | This index lists {n} catalog(s). |
| `settings.catIndex.makeDone` | `{n}` | Index written with {n} catalogue(s). |
| `settings.catIndex.skipped` | `{n}` | {n} skipped. |
| `settings.catIndex.state.ok` | `{n}` | OK · {n} items |
| `settings.catIndex.willAdd` | `{what}` | Will add: {what}. |
| `settings.creatorKey.protection` | `{what}` | Creator key protection: {what} |
| `settings.creatorKey.refused` | `{why}` | The creator key store was refused: {why} |
| `settings.creatorKey.resetDone` | `{cid}` | Creator identity reset. Creator ID: {cid} |
| `settings.creatorKey.resetFailed` | `{why}` | Reset failed: {why} |
| `settings.creatorKey.state` | `{seq}` | Creator ID pinned to this install. Key rotations: {seq} |
| `settings.dataExportError` | `{err}` | Export error: {err} |
| `settings.dataImportError` | `{err}` | Import error: {err} |
| `settings.discordRpcDetails` | `{name}` | Profile: {name} |
| `settings.discordRpcStatus` | `{count}` | {count} active mods |
| `settings.identity.authKeyAuto` | `{name}` | Default ({name}) |
| `settings.langDownloadError` | `{err}` | Download error: {err} |
| `settings.langImportError` | `{err}` | Failed to import language: {err} |
| `settings.langRemoveConfirm` | `{code}` `{name}` | Remove language "{name}" ({code})? This deletes its .json file. |
| `settings.langRemoved` | `{name}` | Removed {name} |
| `settings.launchPackDeleteConfirmText` | `{name}` | Are you sure you want to delete the pack {name}? |
| `settings.launchPackError` | `{err}` | Error: {err} |
| `settings.link.done` | `{name}` | Linked as {name}. |
| `settings.lpImported` | `{n}` | Imported "{n}" |
| `settings.lpImportedMissing` | `{c}` `{n}` | Imported "{n}": {c} program(s) not found on this PC |
| `settings.searchCount` | `{n}` | Matching sections: {n} |
| `settings.searchEmpty` | `{q}` | No setting matches "{q}". |
| `settings.shortcutError` | `{err}` | Failed to save shortcut: {err} |
| `settings.shortcutUpdated` | `{key}` | Shortcut updated ({key}) |
| `settings.tagCreateError` | `{err}` | Tag creation error: {err} |
| `settings.tagDeleteError` | `{err}` | Tag deletion error: {err} |
| `settings.tipsRestored` | `{n}` | {n} tip(s) brought back. |

### sha

| Key | Variables | Text |
|---|---|---|
| `sha.act.bgNow` | `{name}` | Hashing {name} |
| `sha.act.idle` | `{h}` `{n}` | Nothing running. {h} of {n} mods have a baseline. |
| `sha.act.queue` | `{n}` | {n} waiting |
| `sha.act.run` | `{i}` `{n}` `{name}` | Checking {i} of {n}: {name} |
| `sha.andMore` | `{n}` | and {n} more |
| `sha.cap` | `{a}` `{b}` | Showing {a} of {b}. Search to narrow the list. |
| `sha.cidTip` | `{id}` | Content id: the fingerprint of the whole mod. {id} |
| `sha.copyHash` | `{f}` | Copy the hash of {f} |
| `sha.done.bad` | `{n}` | {n} with differences |
| `sha.done.failed` | `{n}` | {n} could not be read |
| `sha.done.ok` | `{n}` | {n} match |
| `sha.done.skipped` | `{n}` | {n} without a hash skipped |
| `sha.exported` | `{n}` | Report saved: {n} mods. |
| `sha.filesN` | `{n}` | {n} files |
| `sha.hashedOn` | `{d}` | hashed {d} |
| `sha.hashMissingN` | `{n}` | Hash {n} missing |
| `sha.queuedN` | `{n}` | {n} queued for hashing. |
| `sha.rep.added` | `{n}` | {n} added |
| `sha.rep.missing` | `{n}` | {n} missing |
| `sha.rep.modified` | `{n}` | {n} changed |
| `sha.rep.ok` | `{n}` | All {n} files match. |
| `sha.selected` | `{n}` | {n} selected |
| `sha.selectOne` | `{name}` | Select {name} |
| `sha.verifyAllN` | `{n}` | Verify {n} shown |

### sshact

| Key | Variables | Text |
|---|---|---|
| `sshact.destFileHint` | `{name}` | The file lands here as {name}. Changing it here applies to this transfer only. |
| `sshact.fetched` | `{n}` | Fetched: {n} bytes. |
| `sshact.published` | `{n}` | Published: {n} bytes. |

### sshbr

| Key | Variables | Text |
|---|---|---|
| `sshbr.count` | `{d}` `{f}` | {d} folder(s), {f} file(s) |

### sshsrv

| Key | Variables | Text |
|---|---|---|
| `sshsrv.confirmDelete` | `{name}` | Delete the server "{name}"? |
| `sshsrv.forgetConfirm` | `{host}` | Forget the trusted key of {host}? The next connection will show the server's key and ask again. |
| `sshsrv.stepLoggedIn` | `{user}` | Signed in as {user}. |
| `sshsrv.stepLogin` | `{user}` | Signing in as {user}… |
| `sshsrv.stepReach` | `{where}` | Reaching {where}… |
| `sshsrv.stepReached` | `{where}` | {where} answered. |
| `sshsrv.stepWritable` | `{dir}` `{n}` | {dir} exists and is writable ({n} item(s) in it). |

### stm

| Key | Variables | Text |
|---|---|---|
| `stm.dur.h` | `{h}` `{m}` | {h} h {m} min |
| `stm.dur.min` | `{n}` | {n} min |
| `stm.dur.s` | `{n}` | {n} s |
| `stm.game.effectOn` | `{k}` | Now: BMM works as if on Quiet. Held until you close the app: {k}. |
| `stm.game.fromProfile` | `{p}` | Found in the app folder of your profile “{p}”. |
| `stm.game.hGame` | `{g}` | An app is running: {g} |
| `stm.game.leaving` | `{d}` | The app closed: back to normal in {d}. |
| `stm.game.notAGame` | `{x}` | {x} is a browser or an everyday app: while it runs, app mode stays on. |
| `stm.game.since` | `{d}` | On for {d}. |
| `stm.gfx.pending` | `{a}` `{b}` | BMM started with “{a}”. “{b}” applies after a restart. |
| `stm.presets.appliedToast` | `{p}` | {p} applied. Undo is above the presets. |
| `stm.presets.applyP` | `{p}` | Apply {p} |
| `stm.presets.c.add` | `{r}` `{w}` | {w}: {r} |
| `stm.presets.c.alertOn` | `{c}` `{w}` | on, warning at {w} % free, critical at {c} % |
| `stm.presets.c.alerts` | `{a}` `{b}` | Space alerts: {a} → {b} |
| `stm.presets.c.change` | `{a}` `{b}` `{w}` | {w}: {a} → {b} |
| `stm.presets.c.intensity` | `{a}` `{b}` | Work intensity: {a} → {b} |
| `stm.presets.c.remove` | `{r}` `{w}` | {w}: rule removed ({r}) |
| `stm.presets.capsKept` | `{d}` | Speed caps kept as they are: {d}. |
| `stm.presets.changesN` | `{n}` | {n} changes |
| `stm.presets.free` | `{f}` `{t}` | {f} free of {t} |
| `stm.presets.nAdded` | `{n}` | {n} added |
| `stm.presets.nChanged` | `{n}` | {n} changed |
| `stm.presets.nRemoved` | `{n}` | {n} removed |
| `stm.presets.pcLine` | `{c}` `{d}` | {d} drives · {c} threads |
| `stm.presets.pcSummary` | `{c}` `{d}` | This PC: {d} drives, {c} threads |
| `stm.presets.previewTitle` | `{p}` | What {p} changes |
| `stm.presets.r.buffer` | `{n}` | {n} KiB steps |
| `stm.presets.r.cap` | `{n}` | cap {n} MB/s |
| `stm.presets.r.parallel` | `{n}` | {n} at once |
| `stm.presets.recTitle` | `{p}` | Recommended for this PC: {p} |
| `stm.presets.undo` | `{p}` | Undo {p} |
| `stm.presets.whyTitle` | `{p}` | Why {p}: |
| `stm.space.profilesNeed` | `{a}` `{p}` | Profiles: {p} for {a} free |
| `stm.space.usedByN` | `{n}` | Used by {n} profile folders |
| `stm.space.usedOf` | `{t}` `{u}` | {u} of {t} |
| `stm.subj.join` | `{s}` `{v}` | {v}: {s} |

### storage

| Key | Variables | Text |
|---|---|---|
| `storage.alertCriticalMod` | `{free}` `{label}` `{limit}` | Action blocked: Critical space on {label} disk ({free}% free, limit at {limit}%). |
| `storage.alertWarningMod` | `{free}` `{label}` `{limit}` | Warning: Low space on {label} disk ({free}% free, limit at {limit}%). |
| `storage.error` | `{err}` | Error: {err} |
| `storage.hwCpu` | `{n}` | {n} logical cores |
| `storage.optimized` | `{limit}` `{name}` | Optimization complete for {name}: {limit} MB/s |

### task

| Key | Variables | Text |
|---|---|---|
| `task.feed.badPath` | `{s}` | A feed file cannot be written there ({s}). |

### themes

| Key | Variables | Text |
|---|---|---|
| `themes.catalogExportedBundle` | `{f}` `{n}` | {n} theme(s) packed into {f}. One file, nothing to host. |
| `themes.catalogExportedFolder` | `{n}` | Wrote catalog.json and {n} theme file(s). Upload the folder as is. |
| `themes.dropinFound` | `{n}` | {n} preset(s) found |
| `themes.fromIndex` | `{n}` | Added {n} theme catalog(s) from that index. |
| `themes.importFailed` | `{list}` | Could not import: {list} |
| `themes.indexAll` | `{n}` | That index lists {n} theme catalog(s) and you already follow them all. |
| `themes.indexNone` | `{n}` | That index lists no theme catalogs, only {n} entr(y/ies) of other kinds. |
| `themes.indexNone2` | `{what}` | No theme catalogs in that index, only {what}. Add those from their own screens. |

### toast

| Key | Variables | Text |
|---|---|---|
| `toast.hashFailed` | `{id}` | Failed to hash mod {id} |
| `toast.openError` | `{err}` `{id}` | Error opening {id}: {err} |
| `toast.updatePartial` | `{applied}` `{errors}` | Update partial: {applied} applied, {errors} errors |

### tools

| Key | Variables | Text |
|---|---|---|
| `tools.cache.clean` | `{b}` | Empty the ticked ({b}) |
| `tools.cache.cleaned` | `{b}` | {b} freed. |
| `tools.cache.confirmMsg` | `{b}` `{names}` | {names}: {b} will be deleted. BMM rebuilds them when it needs them. |
| `tools.cache.summary` | `{t}` | {t} in caches and leftovers. |
| `tools.conflicts.files` | `{n}` | {n} file(s) |
| `tools.conflicts.summary` | `{a}` `{n}` | {n} conflicting pair(s), {a} active. |
| `tools.deployed.summary` | `{f}` `{m}` `{n}` `{p}` | {n} finding(s) in {p} profile(s): {m} active mod(s), {f} file(s) checked. |
| `tools.diff.onlyA` | `{a}` | Only in {a} |
| `tools.diff.onlyB` | `{b}` | Only in {b} |
| `tools.diff.summary` | `{a}` `{b}` `{n}` `{s}` | {a} and {b}: {n} difference(s), {s} mod(s) identical. |
| `tools.disk.perMod` | `{n}` | Per mod ({n}) |
| `tools.disk.summary` | `{p}` `{t}` | {t} in total across {p} profile(s) and BMM's data. |
| `tools.duplicates.copies` | `{n}` | {n} copies |
| `tools.duplicates.summary` | `{f}` `{h}` `{m}` `{s}` `{w}` | {m} duplicate mod(s), {f} set(s) of identical files, {w} that could be saved. {s} files listed, {h} hashed. |
| `tools.duplicates.wasted` | `{w}` | {w} duplicated |
| `tools.dupprofiles.counts` | `{a}` `{b}` `{s}` | {s} shared, {a} only in the first, {b} only in the second |
| `tools.dupprofiles.similar` | `{p}` | {p} alike |
| `tools.dupprofiles.summary` | `{n}` `{p}` | {n} pair(s) among {p} profile(s). |
| `tools.jsondiff.meta` | `{f}` | Also changed outside the entries: {f} |
| `tools.jsondiff.summary` | `{a}` `{b}` `{c}` `{m}` `{p}` `{s}` | {a} entries, then {b}: {p} added, {m} removed, {c} changed, {s} the same. |
| `tools.largefiles.summary` | `{m}` `{n}` `{s}` `{t}` | {n} file(s) of {m} or more, out of {s} file(s) ({t}) listed. |
| `tools.logs.clipped` | `{n}` | Only the last {n} matching lines are shown. The export holds them too. |
| `tools.logs.summary` | `{e}` `{n}` `{t}` `{w}` | {n} line(s) shown of {t}: {e} error(s), {w} warning(s). |
| `tools.moreInExport` | `{n}` | {n} more in the export. |
| `tools.names.summary` | `{m}` `{n}` | {n} mod(s) of {m} could be tidied. |
| `tools.orphans.summary` | `{m}` `{n}` `{p}` | {n} finding(s) in {p} profile(s) and {m} mod(s). |
| `tools.ranAt` | `{time}` | Result of {time} |
| `tools.validate.bad` | `{f}` `{n}` | Format {f}: {n} problem(s). |
| `tools.validate.ok` | `{f}` `{n}` | Format {f}: no problem found ({n} entries). |

### tut

| Key | Variables | Text |
|---|---|---|
| `tut.fieldHiddenIn` | `{where}` | That field is in “{where}”. Open it first. |
| `tut.where.coveredBy` | `{title}` | The “{title}” window is on top of it. |
| `tut.where.inDialog` | `{title}` | It’s inside “{title}”, which isn’t open yet. |
| `tut.where.missingOn` | `{page}` | It isn’t on screen yet. It’s on the {page} page and may appear after the previous step. |
| `tut.where.onTab` | `{tab}` | It’s on the “{tab}” tab. |

### tutc

| Key | Variables | Text |
|---|---|---|
| `tutc.issues` | `{n}` | {n} thing(s) to check |
| `tutc.movedTo` | `{n}` | Moved to position {n} |
| `tutc.removePartAsk` | `{name}` | Remove “{name}” and all its steps? |
| `tutc.stepN` | `{n}` `{total}` | Step {n} of {total} |
| `tutc.target.found` | `{n}` | Found on this screen ({n}). |

### tutcat

| Key | Variables | Text |
|---|---|---|
| `tutcat.b.saved` | `{n}` | Wrote catalog.json and {n} tutorial file(s). Upload the folder as is. |
| `tutcat.b.savedPartial` | `{names}` | Wrote the catalogue, but these could not be exported: {names} |
| `tutcat.b.write` | `{n}` | Export the catalogue ({n}) |

### update

| Key | Variables | Text |
|---|---|---|
| `update.availableToast` | `{version}` | BMM v{version} is available. Click here to see what is new. |
| `update.daysAgo` | `{n}` | {n} days ago |
| `update.dlProgress` | `{done}` `{total}` | Downloading {done} / {total} MB |
| `update.etaMin` | `{n}` | about {n} min left |
| `update.etaSec` | `{n}` | about {n} s left |
| `update.hoursAgo` | `{n}` | {n} h ago |
| `update.lastCheck` | `{when}` | Last check: {when} |
| `update.lastCheckFailed` | `{when}` | Last check failed: {when} |
| `update.minutesAgo` | `{n}` | {n} min ago |
| `update.pageNotFound` | `{name}` | Page not found: {name} |
| `update.sizeMb` | `{size}` | {size} MB |
| `update.speed` | `{speed}` | {speed} MB/s |
| `update.stagedBody` | `{n}` `{version}` | v{version} was downloaded and verified last time. It installs in {n} s. |
| `update.stagedReady` | `{version}` | v{version} was downloaded and verified last time. |
| `update.stagedToast` | `{version}` | v{version} is downloaded and verified. It installs the next time you start BMM. |

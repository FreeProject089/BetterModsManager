// The BMMScript reference page — every action, condition, value and loop source there is.
//
// Generated, never written, and the reason is the one this whole language is built on:
// BMMScript compiles to the BRICKS. It holds no list of action names of its own, so an
// action added to BMM is writable in script the same day. A hand-written reference is
// therefore the ONE part of BMMScript that can go stale — the page would keep promising 75
// actions while the app grew to 80, and nothing in the app would notice.
//
// So it is extracted from the same arrays the editor renders from — ACTION_TYPES,
// ACTION_GROUPS, COND_TYPES, VALUE_SOURCES, LOOP_SOURCES — with the parameter names taken
// from the RUNNER, one case per action, and the wording from the app's own dictionaries.
// `--check` runs in CI, so adding an action without regenerating fails the build instead of
// shipping a reference that lies.
//
// Run:            node scripts/gen-bmms-reference.mjs
// Verify (CI):    node scripts/gen-bmms-reference.mjs --check

import fs from 'node:fs';

const SRC = 'frontend/src/features/settings/scheduler.ts';
const OUT_EN = 'BMM Docs/docs/features/bmmscript-reference.md';
const OUT_FR = 'BMM Docs/docs/features/bmmscript-reference.fr.md';

const src = fs.readFileSync(SRC, 'utf8');

/** Die loudly. A generator that guesses produces a document that reads as authoritative. */
function bail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** The initialiser of `const NAME … = [ … ]`, brace-matched rather than found by `];`. */
function arrayBlock(name) {
  const decl = src.indexOf(`const ${name}`);
  if (decl < 0) bail(`${name} not found in scheduler.ts`);
  const open = src.indexOf('= [', decl);
  if (open < 0) bail(`${name} has no array initialiser`);
  let depth = 0;
  for (let i = open + 2; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return src.slice(open, i);
  }
  bail(`${name} initialiser is not closed`);
}

// ── the registry ─────────────────────────────────────────────────────────────
const actionBlock = arrayBlock('ACTION_TYPES');
const actions = [];
// Escaped quotes included: `[^']*` stops at the backslash in a label like
// `Rebuild a repo's manifest`, so that entry does not match and the count check below
// fails — correctly refusing, but over a shape that is perfectly legal JavaScript.
const reAction = /\{\s*v:\s*'((?:[^'\\]|\\.)+)'\s*,\s*label:\s*'((?:[^'\\]|\\.)*)'\s*(?:,\s*needs:\s*'([^']+)')?\s*,\s*group:\s*'([^']+)'\s*\}/g;
for (let m; (m = reAction.exec(actionBlock)); ) {
  actions.push({ type: m[1], label: m[2], needs: m[3] || null, group: m[4] });
}
// The drift alarm, same as gen-mcp-actions: an entry the regex cannot read is an entry the
// page silently omits, and a missing action is exactly the lie this file exists to prevent.
const declaredActions = (actionBlock.match(/\bv:\s*'/g) || []).length;
if (actions.length !== declaredActions) {
  bail(`extracted ${actions.length} actions but scheduler.ts declares ${declaredActions} — an entry's shape defeated the extractor; fix the extractor, not the registry`);
}
if (actions.length < 50) bail(`only ${actions.length} actions — too few to be right`);

const groups = [...arrayBlock('ACTION_GROUPS').matchAll(/\{\s*g:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*\}/g)]
  .map((m) => ({ g: m[1], label: m[2] }));
if (!groups.length) bail('ACTION_GROUPS came out empty');

const strList = (name, min) => {
  const out = [...arrayBlock(name).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (out.length < min) bail(`${name} came out with ${out.length} entries — too few to be right`);
  return out;
};
const conditions = strList('COND_TYPES', 20);
const sources = strList('VALUE_SOURCES', 10);
const loops = strList('LOOP_SOURCES', 5);

// ── parameter names, per ACTION ──────────────────────────────────────────────
//
// From runAction, whose switch has one case per action type, each reading `p.<name>`. Those
// reads ARE the parameters, because `do x(a: 1)` puts `a` into params and the runner reads
// `p.a` — one source, no table to keep in step.
//
// The obvious-looking alternative is the editor's form, and it is WRONG: `needs` is a form
// SHAPE, not an action. list.push, list.set and list.clear share one `needs` and read
// different parameters, so a form-derived list gives all three the union of all three. It
// looked right on the actions that happen to own their form, which is most of them — and
// cross-checking against the runner is the only reason that did not ship.
function functionBody(signature) {
  const s = src.indexOf(signature);
  if (s < 0) bail(`${signature} not found in scheduler.ts`);
  const open = src.indexOf('{', s);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i);
  }
  bail(`${signature} is not closed`);
}

const runner = functionBody('async function runAction');
const caseMarks = [...runner.matchAll(/\n[ \t]*case '([^']+)':/g)];

// A retired action keeps its case.
//
// An action can be replaced by a better one — `dcs.hook` became `game.watch` — and the case
// has to stay, or every task somebody already saved silently does nothing on that step. For
// a watcher that means the whole automation stops firing with no error anywhere.
//
// So a case is allowed to have no registry entry when it is DECLARED retired, on its own
// line, next to it. Declared rather than inferred: "a case with no entry" is also exactly
// what a typo in the registry looks like, and that is the thing this check exists to catch.
const retired = new Set([...src.matchAll(/@retired-action\s+([a-zA-Z0-9._]+)/g)].map((m) => m[1]));
const live = caseMarks.filter((m) => !retired.has(m[1]));
for (const name of retired) {
  if (!caseMarks.some((m) => m[1] === name)) {
    bail(`'${name}' is marked @retired-action but has no case — the note outlived the code it explains`);
  }
  if (actions.some((a) => a.type === name)) {
    bail(`'${name}' is marked @retired-action and is still in the registry — it is one or the other`);
  }
}
// By NAME, not by count.
//
// Counting alone passes a RENAME: `case 'restart'` mistyped as `case 'restartt'` leaves the
// number identical, so the check said nothing while the action silently stopped running.
// Verified by making that exact typo, watching this pass, and then writing this.
const caseNames = new Set(live.map((m) => m[1]));
const declared = new Set(actions.map((a) => a.type));
const noCase = [...declared].filter((v) => !caseNames.has(v));
const noEntry = [...caseNames].filter((v) => !declared.has(v));
if (noCase.length || noEntry.length) {
  const bits = [];
  if (noCase.length) bits.push(`declared with no case: ${noCase.join(', ')}`);
  // A case with no entry is unreachable from the editor, which is what a typo looks like.
  // Retire it on purpose with @retired-action if it is meant to stay for saved tasks.
  if (noEntry.length) bits.push(`a case nothing declares: ${noEntry.join(', ')}`);
  bail(`the registry and runAction disagree — ${bits.join('; ')}`);
}
if (live.length !== actions.length) {
  bail(`runAction has ${live.length} live cases but the registry declares ${actions.length} actions — the extractor cannot be trusted until those agree`);
}
const paramsByAction = {};
for (let k = 0; k < caseMarks.length; k++) {
  const from = caseMarks[k].index;
  const to = k + 1 < caseMarks.length ? caseMarks[k + 1].index : runner.length;
  const body = runner.slice(from, to);
  paramsByAction[caseMarks[k][1]] = [...new Set([...body.matchAll(/\bp\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
}

const paramsFor = (action) => paramsByAction[action] || [];

// ── the words, from the app's own dictionaries ─────────────────────────────
//
// The registry carries an English label inline, and the app never shows it — it renders
// `t('sched.act.' + v)`. Generating the French page from the inline labels would have
// produced a French document describing every action in English, which is the shape of
// half-translated page this project keeps finding and fixing.
//
// Descriptions (`sched.actd.*`) say more than the labels do, so they are what the table
// shows; the label is the fallback for anything without one.
const DICT = {
  en: JSON.parse(fs.readFileSync('frontend/Lang/en.json', 'utf8')),
  fr: JSON.parse(fs.readFileSync('frontend/Lang/fr.json', 'utf8')),
};
for (const lang of ['en', 'fr']) {
  const have = actions.filter((a) => DICT[lang]['sched.act.' + a.type]).length;
  // Not a soft warning. A page that silently falls back to English for half its rows looks
  // finished, and nobody re-reads a generated file.
  if (have !== actions.length) {
    bail(`${lang}.json describes ${have} of ${actions.length} actions — add the missing sched.act.* keys before regenerating`);
  }
}
const word = (lang, key, fallback = '') => DICT[lang][key] || fallback;

// ── the page ─────────────────────────────────────────────────────────────────
const L = {
  en: {
    title: 'BMMScript — every action, condition and value',
    lede: 'Generated from BMM\'s own registry, so it cannot describe a version of the app that does not exist. If an action is in the block editor, it is in this list.',
    note: 'Nothing here is a separate BMMScript feature. `do <name>(…)` writes whatever the block editor calls the action, and the parameter names are the ones the runner reads — which is why this page is extracted from the code rather than written beside it.',
    actionsH: 'Actions',
    actionsLede: 'Written `do <name>(param: value, …)`. An action with no parameters takes empty brackets: `do mods.scan()`.',
    colAction: 'Action', colWhat: 'What it does', colParams: 'Parameters',
    colCond: 'Condition', colTests: 'What it tests',
    noParams: '—',
    condH: 'Conditions',
    condLede: 'Written where a condition goes — after `if`, `case`, `waitfor`, `repeat while` and `repeat until`. `and` / `or` combine them, `not` inverts one, and brackets group.',
    condNote: '`all` and `any` are the grouping conditions; in script you normally write `and` and `or` instead and get the same thing. `value` is the comparison row, which is what `count >= 3` compiles to.',
    valH: 'Values you can read',
    valLede: 'Written by an action into the task, and readable afterwards in a comparison or an expression — `if disk.free_gb < 5`, `set total = benchmark.mbps * 2`.',
    valNote: 'A value nothing has written yet reads as zero. `lasttask.ok` is 1 or 0, and only means anything after a `run`.',
    loopH: 'What a loop can walk',
    loopLede: 'Written `for item in <source>`. Inside the loop, `{item.id}` and `{item.name}` are replaced in every text value.',
    loopNote: '`list` and `mapKeys` need a name: `for x in list "queue"`.',
    stepsH: 'Statements',
    stepsLede: 'The grammar itself, which — unlike everything above — is fixed. The full explanation of each is on the [main BMMScript page](bmmscript.md).',
    genH: 'Why this page is generated',
    genBody: 'BMMScript holds no list of action names: it compiles to the blocks, so an action added to BMM is writable in script the same day. That makes a hand-written reference the one part of the language that can go stale — it would keep promising the old count while the app grew. This page is extracted from the same arrays the block editor renders from, and CI fails if it is out of date.',
    counts: (a, c, v, l) => `${a} actions · ${c} conditions · ${v} values · ${l} loop sources`,
  },
  fr: {
    title: 'BMMScript — toutes les actions, conditions et valeurs',
    lede: 'Généré depuis le registre de BMM lui-même, donc cette page ne peut pas décrire une version de l\'application qui n\'existe pas. Si une action est dans l\'éditeur de blocs, elle est dans cette liste.',
    note: 'Rien ici n\'est une fonctionnalité BMMScript séparée. `do <nom>(…)` écrit ce que l\'éditeur de blocs appelle l\'action, et les noms de paramètres sont ceux que lit l\'exécuteur — c\'est pour cela que cette page est extraite du code plutôt qu\'écrite à côté.',
    actionsH: 'Actions',
    actionsLede: 'S\'écrit `do <nom>(param: valeur, …)`. Une action sans paramètre prend des parenthèses vides : `do mods.scan()`.',
    colAction: 'Action', colWhat: 'Ce qu\'elle fait', colParams: 'Paramètres',
    colCond: 'Condition', colTests: 'Ce qu\'elle teste',
    noParams: '—',
    condH: 'Conditions',
    condLede: 'S\'écrivent là où une condition va — après `if`, `case`, `waitfor`, `repeat while` et `repeat until`. `and` / `or` les combinent, `not` en inverse une, les parenthèses groupent.',
    condNote: '`all` et `any` sont les conditions de groupe ; en script on écrit normalement `and` et `or` à la place, pour le même résultat. `value` est la ligne de comparaison — c\'est ce que `count >= 3` produit.',
    valH: 'Valeurs lisibles',
    valLede: 'Écrites dans la tâche par une action, puis lisibles dans une comparaison ou une expression — `if disk.free_gb < 5`, `set total = benchmark.mbps * 2`.',
    valNote: 'Une valeur que rien n\'a encore écrite vaut zéro. `lasttask.ok` vaut 1 ou 0, et ne veut dire quelque chose qu\'après un `run`.',
    loopH: 'Ce qu\'une boucle peut parcourir',
    loopLede: 'S\'écrit `for item in <source>`. Dans la boucle, `{item.id}` et `{item.name}` sont remplacés dans toutes les valeurs texte.',
    loopNote: '`list` et `mapKeys` demandent un nom : `for x in list "queue"`.',
    stepsH: 'Instructions',
    stepsLede: 'La grammaire elle-même qui, contrairement à tout ce qui précède, est fixe. L\'explication complète de chacune est sur la [page principale BMMScript](bmmscript.fr.md).',
    genH: 'Pourquoi cette page est générée',
    genBody: 'BMMScript ne contient aucune liste de noms d\'actions : il compile vers les blocs, donc une action ajoutée à BMM est écrivable en script le jour même. Cela fait d\'une référence écrite à la main la seule partie du langage qui puisse devenir fausse — elle continuerait d\'annoncer l\'ancien nombre pendant que l\'application grandit. Cette page est extraite des mêmes tableaux que l\'éditeur de blocs, et la CI échoue si elle n\'est plus à jour.',
    counts: (a, c, v, l) => `${a} actions · ${c} conditions · ${v} valeurs · ${l} sources de boucle`,
  },
};

/** The statement list. Fixed, because the grammar is — the one hand-kept table here. */
const STATEMENTS = [
  ['do <action>(k: v)', 'Run one action', 'Faire une action'],
  ['if <cond> { } else { }', 'Branch', 'Brancher'],
  ['for x in <source> { }', 'Loop over a list', 'Boucler sur une liste'],
  ['repeat N times { }', 'Loop a fixed number of times', 'Boucler un nombre de fois'],
  ['repeat while|until <cond> { }', 'Loop until something changes', 'Boucler jusqu\'à ce que ça change'],
  ['wait 30s', 'Pause', 'Attendre'],
  ['waitfor <cond> timeout 2h poll 10s', 'Wait for something to become true', 'Attendre qu\'une condition devienne vraie'],
  ['try { } catch { }', 'Carry on when a step fails', 'Continuer si une étape échoue'],
  ['switch { case <cond> { } default { } }', 'The first case that holds, and only that one', 'Le premier cas vrai, et lui seul'],
  ['parallel { branch { } branch { } }', 'Run branches at the same time', 'Lancer des branches en même temps'],
  ['parallel settle { … }', 'Let every branch finish, then report failures', 'Laisser tout finir, puis dire ce qui a échoué'],
  ['set x = <expr>', 'A number, through the expression evaluator', 'Un nombre, via l\'évaluateur d\'expressions'],
  ['set s = "text"', 'A text variable', 'Une variable texte'],
  ['set n: number = 0', 'Typed, checked as you write it', 'Typé, vérifié à l\'écriture'],
  ['shared set k = "v"', 'A variable every task can read', 'Une variable que toutes les tâches lisent'],
  ['clear x', 'Remove a variable', 'Supprimer une variable'],
  ['call "block name"', 'Run a shared block here', 'Exécuter un bloc partagé ici'],
  ['run "Task" · spawn "Task"', 'Another task, waiting or not', 'Une autre tâche, en attendant ou non'],
  ['script python { … }', 'Real code, taken exactly as written', 'Du vrai code, pris tel quel'],
  ['break · continue · stop', 'Leave the loop, skip an item, end the task', 'Quitter la boucle, passer, finir la tâche'],
];

/**
 * `forApp` builds the SAME page for Help & other inside BMM.
 *
 * Two differences, both because the in-app reader is not mkdocs: the hub draws the title
 * itself, and md-lite has no admonitions — an `!!! info` block would render as a literal
 * `!!! info ""` line. Everything else, tables included, md-lite already handles.
 *
 * The alternative was a second hand-written list in the app, which is the exact failure this
 * generator exists to prevent — and it would have been the copy nobody thought to update.
 */
function page(lang, forApp = false) {
  const s = L[lang];
  const other = forApp
    ? (lang === 'en' ? 'doc:bmmscript' : 'doc:bmmscript')
    : (lang === 'en' ? 'bmmscript.md' : 'bmmscript.fr.md');
  const out = [];
  if (!forApp) {
    out.push(`# ${s.title}`);
    out.push('');
    out.push('!!! info ""');
    out.push('');
    out.push(`    ${s.counts(actions.length, conditions.length, sources.length, loops.length)}`);
    out.push('');
  } else {
    out.push(`**${s.counts(actions.length, conditions.length, sources.length, loops.length)}**`);
    out.push('');
  }
  out.push(`> ${s.lede}`);
  out.push('');
  out.push(s.note);
  out.push('');

  out.push(`## ${s.actionsH}`);
  out.push('');
  out.push(s.actionsLede);
  out.push('');
  for (const g of groups) {
    const mine = actions.filter((a) => a.group === g.g);
    if (!mine.length) continue;
    out.push(`### ${word(lang, 'sched.grp.' + g.g, g.label)}`);
    out.push('');
    out.push(`| ${s.colAction} | ${s.colWhat} | ${s.colParams} |`);
    out.push('|---|---|---|');
    for (const a of mine) {
      const ps = paramsFor(a.type);
      // The description says more than the label; the label is the fallback for the handful
      // that have none. Table cells, so a `|` in a translation would break the row.
      const what = (word(lang, 'sched.actd.' + a.type) || word(lang, 'sched.act.' + a.type, a.label)).replace(/\|/g, '\|');
      out.push(`| \`${a.type}\` | ${what} | ${ps.length ? ps.map((p) => `\`${p}\``).join(' · ') : s.noParams} |`);
    }
    out.push('');
  }

  out.push(`## ${s.condH}`);
  out.push('');
  out.push(s.condLede);
  out.push('');
  out.push(`| ${s.colCond} | ${s.colTests} |`);
  out.push('|---|---|');
  for (const c of conditions) {
    out.push(`| \`${c}\` | ${word(lang, 'sched.cond.' + c, c).replace(/\|/g, '\|')} |`);
  }
  out.push('');
  out.push(s.condNote);
  out.push('');

  out.push(`## ${s.valH}`);
  out.push('');
  out.push(s.valLede);
  out.push('');
  out.push(sources.map((v) => `\`${v}\``).join(' · '));
  out.push('');
  out.push(s.valNote);
  out.push('');

  out.push(`## ${s.loopH}`);
  out.push('');
  out.push(s.loopLede);
  out.push('');
  out.push(loops.map((v) => `\`${v}\``).join(' · '));
  out.push('');
  out.push(s.loopNote);
  out.push('');

  out.push(`## ${s.stepsH}`);
  out.push('');
  out.push(s.stepsLede.replace('bmmscript.md', other).replace('bmmscript.fr.md', other));
  out.push('');
  out.push(`| | |`);
  out.push('|---|---|');
  for (const [syntax, en, fr] of STATEMENTS) {
    out.push(`| \`${syntax}\` | ${lang === 'en' ? en : fr} |`);
  }
  out.push('');

  out.push(`## ${s.genH}`);
  out.push('');
  out.push(s.genBody);
  out.push('');
  return out.join('\n');
}

// The in-app copy, as a module rather than a file the app fetches: Help & other is offline,
// and a reference that needs the network is a reference that is missing when the network is
// what you were trying to fix.
// The KEYWORDS, taken from the parser rather than from a list somebody typed.
//
// The editor's syntax colouring needs to know which words are grammar and which are just
// names, and a hand-kept copy of that answer is the same trap as a hand-kept action list:
// it is wrong the day the language grows a statement, and it is wrong *quietly* — a new
// keyword simply renders as an identifier and nobody notices.
//
// Two sources inside the compiler, because the grammar uses two mechanisms:
//   · the arms of `match w.as_str()` in `fn stmt` — every statement head;
//   · every `at_word("…")` / `eat_word("…")` — the header words (task, every, allow,
//     describe) and the ones that appear mid-statement (else, catch, in, while, until).
// Lower-cased, because that is what the parser compares against: it lower-cases the word
// before matching, so `WaitFor` and `waitfor` are the same statement to it and should look
// the same in the box.
const RS = 'src-tauri/src/commands/bmms.rs';
const rs = fs.readFileSync(RS, 'utf8');

function statementHeads() {
  const at = rs.indexOf('fn stmt(&mut self)');
  if (at < 0) bail('fn stmt not found in bmms.rs — the parser was restructured');
  const m = rs.indexOf('match w.as_str() {', at);
  if (m < 0 || m - at > 4000) bail('the statement match in fn stmt was not where it used to be');
  const block = rs.slice(m, m + 30000);
  const arms = block.match(/\n\s{12}(?:"[a-z]+"\s*\|\s*)*"[a-z]+"\s*=>/g) || [];
  const out = new Set();
  for (const a of arms) for (const w of a.match(/"([a-z]+)"/g) || []) out.add(w.slice(1, -1));
  if (out.size < 10) bail(`only ${out.size} statement head(s) found — the extraction broke`);
  return out;
}

function wordKeywords() {
  const out = new Set();
  for (const m of rs.matchAll(/(?:at_word|eat_word)\("([a-zA-Z]+)"\)/g)) out.add(m[1].toLowerCase());
  if (!out.has('task') || !out.has('every')) bail('the header keywords were not found in bmms.rs');
  return out;
}

const keywords = [...new Set([...statementHeads(), ...wordKeywords()])].sort();

const OUT_APP = 'frontend/src/docs/bmms-reference.gen.ts';
const appModule = `// GENERATED by scripts/gen-bmms-reference.mjs — do not edit.
//
// The in-app half of the BMMScript reference, so Help & other lists exactly what BMM Docs
// lists and neither can drift from the app. Regenerate with:
//     node scripts/gen-bmms-reference.mjs

export const BMMS_REFERENCE: { en: string; fr: string } = {
    en: ${JSON.stringify(page('en', true))},
    fr: ${JSON.stringify(page('fr', true))},
};

/**
 * Every word the parser treats as grammar, lower-cased as it compares them.
 *
 * Extracted from src-tauri/src/commands/bmms.rs so the editor's colouring cannot fall
 * behind the language: a statement added to the compiler shows up here on the next
 * regeneration, and CI fails if somebody forgets.
 */
export const BMMS_KEYWORDS: string[] = ${JSON.stringify(keywords)};
`;


// The machine-readable vocabulary, for anything OUTSIDE BMM that needs to know what a
// BMMScript may say — today, BCWEB's `.bmmscript` checker in /dev/tools.
//
// Published as a file rather than reimplemented over there, because the alternative is a
// second list of 75 action names living in another repository, and that list is wrong the
// day somebody adds an action here. An admin uploads this as the `bmms-vocabulary.json`
// platform asset; the checker says the vocabulary has not been published rather than
// pretending every name it cannot recognise is a typo.
//
// It is a VOCABULARY, not a grammar. Nothing outside BMM compiles BMMScript — there is one
// compiler, in Rust, and a second one is exactly the thing this language was designed to
// avoid needing.
const OUT_VOCAB = 'dist-assets/bmms-vocabulary.json';
const vocabulary = JSON.stringify({
  generatedFrom: 'frontend/src/features/settings/scheduler.ts',
  actions: actions.map((a) => ({ type: a.type, group: a.group, params: paramsFor(a.type) })),
  conditions,
  values: sources,
  loopSources: loops,
  keywords,
  // The four capabilities a task can grant itself. Hard-coded because they are the runner's
  // permission model rather than a registry — the same four the review screen names.
  permissions: ['command', 'script', 'deeplink', 'stopProcess'],
  scriptEngines: ['powershell', 'cmd', 'bash', 'python', 'node', 'rust'],
}, null, 2) + '\n';

const want = { [OUT_EN]: page('en'), [OUT_FR]: page('fr'), [OUT_APP]: appModule, [OUT_VOCAB]: vocabulary };

// Content, not bytes. Git checks these files out with CRLF on Windows while the generator
// writes LF, so a byte comparison reports "stale" on a clean tree with nothing wrong — and a
// gate that cries wolf on checkout is one people learn to re-run until it agrees.
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

if (process.argv.includes('--check')) {
  let bad = 0;
  for (const [file, text] of Object.entries(want)) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!sameText(cur, text)) { console.error(`✗ ${file} is stale`); bad++; }
  }
  if (bad) {
    console.error('\n  The reference lists every action, condition and value BMM has. Regenerate:');
    console.error('  node scripts/gen-bmms-reference.mjs');
    process.exit(1);
  }
  console.log(`✓ BMMScript reference is current (${actions.length} actions, ${conditions.length} conditions, ${sources.length} values)`);
} else {
  for (const [file, text] of Object.entries(want)) {
    fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  console.log(`✓ wrote the BMMScript reference — ${actions.length} actions, ${conditions.length} conditions, ${sources.length} values, ${loops.length} loop sources`);
}

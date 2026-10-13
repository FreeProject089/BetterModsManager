// The translators' reference: every translation key that takes a {variable}, and which ones.
//
// A translator sees `"{n} new mods added"` and has to know that `{n}` is filled by the app and
// must survive the translation letter for letter, while `{variables}` in a scheduler hint is
// plain text they may translate. That knowledge lived in the code. This page is generated from
// the same audit check-i18n-vars.mjs runs, so it lists exactly the variables the gate enforces,
// and `--check` fails CI when a key gains or loses one without the page following.
//
// Run:            node scripts/gen-i18n-vars-reference.mjs
// Verify (CI):    node scripts/gen-i18n-vars-reference.mjs --check

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, audit, LITERAL } from './check-i18n-vars.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'BMM Docs', 'docs', 'reference');
const OUT = { en: join(DOCS, 'translation-variables.md'), fr: join(DOCS, 'translation-variables.fr.md') };
const CHECK = process.argv.includes('--check');

if (!existsSync(DOCS)) {
    // BMM Docs is a separate repo and may not be checked out beside this one.
    console.log('· BMM Docs not present: translation-variables page not generated');
    process.exit(0);
}

/** What the usual names mean. A name not listed here is explained by its key's text. */
const GLOSSARY = {
    n: ['a number (a count, an index, a position)', 'un nombre (un total, un rang, une position)'],
    count: ['a number of items', 'un nombre d’éléments'],
    total: ['the total the count is out of', 'le total sur lequel porte le compte'],
    m: ['a second number, or a name, next to {n}', 'un second nombre, ou un nom, à côté de {n}'],
    name: ['a name (mod, profile, task, file…)', 'un nom (mod, profil, tâche, fichier…)'],
    err: ['an error message', 'un message d’erreur'],
    e: ['an error message', 'un message d’erreur'],
    error: ['an error message', 'un message d’erreur'],
    id: ['an identifier', 'un identifiant'],
    path: ['a file or folder path', 'un chemin de fichier ou de dossier'],
    file: ['a file name', 'un nom de fichier'],
    v: ['a version or a value', 'une version ou une valeur'],
    version: ['a version number', 'un numéro de version'],
    s: ['seconds, or a short word the code picks', 'des secondes, ou un mot court choisi par le code'],
    size: ['a size, already formatted (KB, MB…)', 'une taille déjà formatée (Ko, Mo…)'],
    type: ['a kind of thing (an importer, a format…)', 'un genre (un importateur, un format…)'],
    url: ['a web address', 'une adresse web'],
    host: ['a server name', 'un nom de serveur'],
    profile: ['a profile name', 'un nom de profil'],
    mod: ['a mod name', 'un nom de mod'],
    x: ['a list or a detail the code inserts', 'une liste ou un détail inséré par le code'],
    label: ['a short title', 'un titre court'],
    date: ['a date', 'une date'],
    time: ['a time', 'une heure'],
};

const TEXT = {
    en: {
        title: '# Translation variables',
        intro: [
            'Some texts in BMM contain a word between braces, such as `{n}` or `{name}`. BMM replaces it with a value',
            'when it shows the text: `"{n} new mods added"` becomes « 3 new mods added ». This page lists every key that',
            'takes one, with the names it uses, so a translation can keep them.',
            '',
            'It is generated from the app’s own audit (`scripts/check-i18n-vars.mjs`), the same one that fails the build',
            'when a translation and the code disagree. It cannot go out of date.',
        ],
        rulesH: '## Rules for translators',
        rules: [
            '- **Copy every variable exactly.** `{n}` stays `{n}`: not `{nombre}`, not `{N}`, not `(n)`. A renamed variable is shown to the user with its braces.',
            '- **Keep all of them.** Each variable of the English text must appear in yours. You may move them, and the order may change.',
            '- **Never add one.** A variable the app does not fill is shown as-is.',
            '- **Plurals come in pairs.** A key ending in `.one` is used for exactly one item and has no number in it; its `.many` twin carries `{n}`. Write each as a full sentence: no `(s)` or `(x)`.',
            '- **Some braces are text.** The keys listed under [Braces that are text](#braces-that-are-text) show BMM’s scheduler syntax (`{variables}`, `{name}`) to the reader. Those are not filled in: translate them like any other word.',
        ],
        glossH: '## Common names',
        glossHead: '| Variable | Usually |',
        litH: '## Braces that are text',
        litIntro: 'These keys contain braces that are shown to the reader as they are. Nothing is filled in.',
        litHead: '| Key | Why |',
        keysH: '## Every key with variables',
        keysIntro: (n) => `${n} keys, grouped by their first segment. The text is the English one, shortened.`,
        head: '| Key | Variables | Text |',
        uses: 'used',
    },
    fr: {
        title: '# Variables des traductions',
        intro: [
            'Certains textes de BMM contiennent un mot entre accolades, comme `{n}` ou `{name}`. BMM le remplace par une',
            'valeur au moment d’afficher le texte : `"{n} nouveaux mods ajoutés"` devient « 3 nouveaux mods ajoutés ». Cette',
            'page liste chaque clé qui en utilise, avec les noms employés, pour que la traduction les garde.',
            '',
            'Elle est générée à partir de l’audit de l’application (`scripts/check-i18n-vars.mjs`), celui qui fait échouer',
            'la compilation quand une traduction et le code ne sont pas d’accord. Elle ne peut pas être périmée.',
        ],
        rulesH: '## Règles pour les traducteurs',
        rules: [
            '- **Recopiez chaque variable à l’identique.** `{n}` reste `{n}` : ni `{nombre}`, ni `{N}`, ni `(n)`. Une variable renommée s’affiche avec ses accolades.',
            '- **Gardez-les toutes.** Chaque variable du texte anglais doit apparaître dans le vôtre. Vous pouvez les déplacer, l’ordre peut changer.',
            '- **N’en ajoutez jamais.** Une variable que l’application ne remplit pas s’affiche telle quelle.',
            '- **Les pluriels vont par paire.** Une clé en `.one` sert pour un seul élément et ne contient pas de nombre ; sa jumelle `.many` porte `{n}`. Écrivez chacune comme une vraie phrase : pas de `(s)` ni de `(x)`.',
            '- **Certaines accolades sont du texte.** Les clés de la section [Accolades qui sont du texte](#accolades-qui-sont-du-texte) montrent la syntaxe du planificateur (`{variables}`, `{name}`). Rien n’y est remplacé : traduisez-les comme n’importe quel mot.',
        ],
        glossH: '## Noms courants',
        glossHead: '| Variable | En général |',
        litH: '## Accolades qui sont du texte',
        litIntro: 'Ces clés contiennent des accolades montrées telles quelles au lecteur. Rien n’y est remplacé.',
        litHead: '| Clé | Pourquoi |',
        keysH: '## Toutes les clés avec variables',
        keysIntro: (n) => `${n} clés, regroupées par leur premier segment. Le texte est le texte français, raccourci.`,
        head: '| Clé | Variables | Texte |',
        uses: 'utilisée',
    },
};

/** Table-cell safe: no pipes, no HTML, one line, bounded. */
function cell(s, max = 110) {
    let v = String(s).replace(/\s+/g, ' ').trim();
    if (v.length > max) v = v.slice(0, max - 1).trimEnd() + '…';
    return v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, 'ʼ').replace(/\*/g, '\\*').replace(/_/g, '\\_');
}

const code = (names) => names.map((n) => `\`{${n}}\``).join(' ');

export function render(lang, dicts, keys) {
    const T = TEXT[lang];
    const L = lang === 'en' ? 0 : 1;
    const out = [T.title, '', ...T.intro, '', T.rulesH, '', ...T.rules, ''];

    // Glossary: the listed names actually in use, most used first.
    const freq = new Map();
    for (const [key, k] of keys) if (!LITERAL.has(key)) for (const v of k.vars) freq.set(v, (freq.get(v) || 0) + 1);
    out.push(T.glossH, '', T.glossHead, '|---|---|');
    for (const [v] of [...freq].filter(([v]) => GLOSSARY[v]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        out.push(`| \`{${v}}\` | ${GLOSSARY[v][L]} |`);
    }
    out.push('');

    out.push(T.litH, '', T.litIntro, '', T.litHead, '|---|---|');
    for (const [k, why] of [...LITERAL].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`| \`${k}\` | ${cell(why)} |`);
    out.push('');

    const real = [...keys].filter(([k]) => !LITERAL.has(k)).sort((a, b) => a[0].localeCompare(b[0]));
    out.push(T.keysH, '', T.keysIntro(real.length), '');
    const groups = new Map();
    for (const [k, v] of real) {
        const g = k.split('.')[0];
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push([k, v]);
    }
    for (const [g, rows] of groups) {
        out.push(`### ${g}`, '', T.head, '|---|---|---|');
        for (const [k, v] of rows) out.push(`| \`${k}\` | ${code(v.vars)} | ${cell(dicts[lang][k] ?? dicts.en[k])} |`);
        out.push('');
    }
    return out.join('\n');
}

const { dicts, uses } = collect(ROOT);
const { keys } = audit(dicts, uses);
let stale = 0;
for (const lang of ['en', 'fr']) {
    const text = render(lang, dicts, keys);
    const cur = existsSync(OUT[lang]) ? readFileSync(OUT[lang], 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur === text) continue;
    if (CHECK) { console.error(`✗ ${OUT[lang].slice(ROOT.length + 1)} is stale: run node scripts/gen-i18n-vars-reference.mjs`); stale++; }
    else { writeFileSync(OUT[lang], text); console.log(`wrote ${OUT[lang].slice(ROOT.length + 1)}`); }
}
if (stale) process.exit(1);
if (CHECK) console.log(`✓ translation-variables reference is current (${keys.size} keys)`);

// Every action the API asks the interface to perform, the interface knows how to perform.
//
// Some routes do not act themselves. They emit `bmm://api-exec` and let the interface do the
// work "exactly as a human would" — fill the form, click the button — so dialogs, options and
// confirmations are the real ones. The route answers 202 immediately, before the interface has
// been asked, and always with `{"ok":true,"driven_by":"bmm-ui"}`.
//
// Which means an action with no case in that switch reports SUCCESS and does nothing. Not an
// error, not a warning, not a log — over HTTP there is nothing to tell "done" from "ignored".
//
// `POST /api/catalogs` shipped like that. It dispatched `catalog/follow` and `catalog/unfollow`,
// the switch had a case for neither, and the switch had no `default`. The route answered 202,
// and the catalogue was not followed. The deeplink `bmm://catalog/follow` worked the whole
// time, so the capability was there and only the bridge was missing.
//
// Nothing could see it: two files, two languages, one string literal each side. tsc has no
// opinion about a switch that does not cover a string, and a missing case is not a type error.
import fs from 'node:fs';

const API = 'src-tauri/src/api/mod.rs';
const UI = 'frontend/src/core/api_activity.ts';
for (const f of [API, UI]) {
  if (!fs.existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const rs = fs.readFileSync(API, 'utf8');
const ts = fs.readFileSync(UI, 'utf8');

const sent = new Set();
for (const m of rs.matchAll(/api_exec_reply\(&?\w+,\s*"([a-z0-9/_-]+)"/g)) sent.add(m[1]);
// The one that picks its action at run time: `let action = if … { "a" } else { "b" }`.
for (const m of rs.matchAll(/let action = if [^;]*?\{\s*"([a-z0-9/_-]+)"\s*\}\s*else\s*\{\s*"([a-z0-9/_-]+)"/g)) { sent.add(m[1]); sent.add(m[2]); }
// And anything emitting the event directly, in case a route stops going through the helper.
for (const m of rs.matchAll(/emit\("bmm:\/\/api-exec"[\s\S]{0,200}?"action":\s*"([a-z0-9/_-]+)"/g)) sent.add(m[1]);

const at = ts.indexOf('switch (action)');
if (at < 0) { console.error('✗ the api-exec switch is not where this check looks — it cannot be trusted'); process.exit(2); }
const body = ts.slice(at);
const handled = new Set([...body.matchAll(/case '([a-z0-9/_-]+)'/g)].map((m) => m[1]));
const hasDefault = /\n\s+default:/.test(body.slice(0, body.indexOf('\n        }')));

if (sent.size < 10 || handled.size < 10) {
  console.error(`✗ read ${sent.size} dispatched action(s) and ${handled.size} case(s) — too few to be right`);
  process.exit(2);
}

const problems = [];
for (const a of [...sent].sort()) {
  if (!handled.has(a)) problems.push(`the API dispatches "${a}" and the interface has no case for it — the route answers 202 and nothing happens`);
}
if (!hasDefault) {
  problems.push('the api-exec switch has no `default` — an action it does not know is ignored in silence, in the copy somebody is running');
}

if (problems.length) {
  console.error('✗ api-exec:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ api-exec OK — ${sent.size} dispatched action(s), all handled, and an explicit default`);

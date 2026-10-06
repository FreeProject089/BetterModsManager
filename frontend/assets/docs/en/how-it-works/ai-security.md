# AI security

Laya is optional, and most of it runs on your PC. It still reads text BMM does not control (a
mod's readme, a report, a file a task names) and some of it can reach a server you chose. This
page is the short threat model: what can go wrong, and what stops it.

## The surfaces

| Surface | Who can call it | Where the text goes |
|---|---|---|
| Suggest, Ask Laya, report check (in the app) | You, by a click | The built-in Laya; your laya-serve; a writing model you set up |
| Scheduled tasks (`ai.classify`, `ai.ask`, `ai.suggest_mod_metadata`) | A task you granted **Laya (AI)** | The built-in Laya or your laya-serve (never BetterCommunity) |
| [Local Laya API](doc-page:features/ai-api) | A program on this PC with the token | The built-in Laya only |
| CLI and MCP (`bmm ai-*`, `bmm_ai_*`) | You, or an AI client you connected | Same as the app |
| BetterCommunity AI (site moderation, smart search, Discord bot) | The site and its members | The site's own provider |

## Threats and defences

**Prompt injection.** A readme can say "ignore your instructions". Every untrusted text reaches a
model inside a fence, cleaned first: no hidden characters, no HTML comments, no images, no fence
it could close. The built-in Laya also blanks every reserved token of its tokenizer (`<eos>`,
`<bos>`, `<mask>`, `<pad>`…) in the text, the question and the label ids, so no text can end its
segment early. Laya only **chooses** among options it is given (your tags, your labels, real
sources) and can answer "none". A writing model's output is checked again: a link (with or without
`https://`, any domain ending), an IP address, a network path (`\\host\share`), a file or a path
must be written in the sources, word for word; `javascript:`, `data:` and `ms-…:` links and
commands (`Remove-Item`, `certutil`, `mshta`, `rundll32`, `Invoke-…`, `schtasks`…) are always
refused.

**An answer used as a command.** In a task, the free text from `ai.ask` and
`ai.suggest_mod_metadata` is marked untrusted, and so is any copy of it. It may go into a message,
a log line or a file's content. Anywhere else (a program, a script, a path, an address, a header,
a condition that looks at a file) the step fails. A label from `ai.classify` is always one of the
task's own labels or `none`, whatever the engine answers.

**A web page or another program reaching the local API.** It listens on 127.0.0.1 only. A request
whose `Host` is not this server is refused (DNS rebinding), a request from a web page is refused
unless its exact origin is listed, and everything but `/health` needs a 256-bit token stored only
as a hash. An MCP client can turn the API on or off but is never given a token.

**Server-side requests to the wrong place (SSRF).** A writing model on this PC must be on
loopback (`localhost`, 127.x, ::1; a name like `x.localhost` is NOT loopback); a remote one must
be https on a public address, an IPv4 hidden in an IPv6 (`[::ffff:10.0.0.1]`) included. A request
to loopback skips any system proxy. No redirect is followed, and answers are capped at 1 MiB.
BetterCommunity is reached only at `https://bettercommunity.ch` (or the https test address that
`app.cfg` names, never a local one): the page cannot point it anywhere else.

**Keys.** Stored with Windows DPAPI or the system keyring, never shown back, never logged, never in
an error message. Each key is bound to the address it was saved for (scheme, host, port) and is
only ever sent there. Changing the address clears the key: type it again for the new server. A key
never travels over plain http, except to this PC.

**Custom labels and tasks.** A label, a description, an example, a question or an imported file is
untrusted text. It only becomes a Laya option or the Laya question, never a system prompt, a
command or a path. Each string is bounded (64 / 300 / 200 / 300 characters, 5 examples, 32 labels,
32 tasks), made single-line, cleaned like any untrusted text and scrubbed of the model's reserved
tokens (`<eos>`, `<mask>`…, any case) so it cannot close its segment or forge an option marker.
The settings file is read with unknown fields refused and every number bounded; an import or a
program's change is refused rather than corrected. An answer is only ever one of the labels given,
or `none`. Programs read these settings but change them only if the user allowed it in Settings,
and cannot grant themselves that permission.

**Exhaustion.** Caps on text, questions and options; one engine run at a time (two for the API);
short queues; timeouts; 20 Laya steps and 2 minutes per task run, 30 steps a minute for all tasks,
60 API requests a minute per caller; refusals are logged a few per minute, not one line each.

**Privacy.** Logs carry counts, sizes and codes, never the text, the question or the answer. The
built-in Laya sends nothing. Tasks and the local API never use BetterCommunity.

**Switches.** The AI master switch, `--no-ai` (or `BMM_NO_AI=1`) and a running game stop every
Laya step and every API answer; turning AI off stops the API within seconds.

## Known limits

- The untrusted mark of a shared variable is kept in the app's local storage; clearing it clears
  the mark.
- Ten wrong tokens in a minute lock every local caller out for that minute: any program on this
  PC can do that on purpose.
- A classification is a probability. Use a minimum (`aiLabel … min: 0.8`) before acting on one.

# Start-up screen & announcements


When BMM has something to tell you at launch, it says it in **one window** with **Previous** and
**Next** — not in a string of dialogs that open one after the other. When it has nothing to say,
nothing opens.

## What can be in it

Each subject is one **step**. Only the steps that apply to this launch are shown, always in this
order — the questions first, so that once they are answered you can close at any time:

| Step | When it appears | What it keeps |
|---|---|---|
| Language | First launch, until a language is confirmed | The language you pick |
| Terms of service | When the terms must be accepted (first launch, or after the text changed) | Your acceptance of *this* text |
| Privacy policy | Together with the terms | That you have read *this* version |
| File access | Once, from the second launch, until you choose | Full or limited access |
| Telemetry | Once, from the second launch, until you answer | Your answer and the three options |
| Crash notice | After a session that ended in a crash | Which report you were shown |
| What's new | Once per version of BMM | That this version's notes were shown |
| Test build | Every launch of a PTB build | — |
| Announcements | When BetterCommunity has published one for your version | How many times you saw it |
| BetterCommunity | Every launch, until you tick *Don't show at startup* | Your opt-out |
| Ko-fi | Every launch, until you choose *later* (a month) or *never* | Your answer |

On the very first launch only the language, the terms and the privacy policy (and a crash notice,
if there is one) are shown; the rest waits for the second launch, and the welcome tour starts once
the window is closed.

## Questions that need an answer

The language, the terms, the privacy policy, file access and telemetry are **questions**: the step
waits for your answer. While a question is unanswered, **Next** stays disabled, the steps after it
cannot be reached, and **Close** (or <kbd>Esc</kbd>) brings you back to it instead of closing.
What gets saved is exactly what the separate dialogs used to save — the same settings, the same
values. Declining the terms still quits BMM.

Everything else is **information**: skip it, close on it, or tick **Don't show again** at the bottom
left when the step offers it.

## Keyboard

| Key | Does |
|---|---|
| <kbd>→</kbd> / <kbd>←</kbd> | Next / previous step |
| <kbd>Enter</kbd> | The main button (Next, or the step's own confirm) |
| <kbd>Esc</kbd> | Close — or go back to a question still waiting |
| <kbd>Tab</kbd> | Moves inside the window only, never behind it |

The dots at the bottom are clickable, and **2 / 5** at the top says where you are. Screen readers
announce each step by its number and title.

## Seeing it again

- Command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>) → **Show what's new**: this version's release notes
  plus BetterCommunity's current announcements, whatever you have already seen.
- **Settings → Tasky & BMM Settings → Start-up screen → Show what's new** does the same.

## Settings

Two switches in **Settings → Tasky & BMM Settings**, right under *BetterCommunity notifications*:

- **Start-up screen** — off: only the questions that need an answer still appear (language, terms,
  privacy policy, file access, telemetry). Release notes, announcements and reminders do not.
- **BetterCommunity announcements at start-up** — off: BMM does not even ask the site for them.

## Announcements from BetterCommunity

The BetterCommunity team can put a card in the start-up screen: a chosen blog post, automatically
the latest BMM blog post, or a custom notice. They decide how often it shows — **every launch**,
**once**, or **a set number of times** — between which dates, and for which BMM versions.

How BMM handles it:

- **It never slows the start-up.** The request is made early and the window waits for it at most
  about a second and a half. A slower answer is added to the window if it is still open, or shown
  at the next launch from the saved copy.
- **Offline is silent.** No error, no retry: the saved copy, or nothing.
- **An unchanged feed costs nothing.** BMM keeps the last answer with its `ETag` and asks
  "has it changed?" — an unchanged feed answers *304* with no content.
- **Nothing identifies you.** The request carries your BMM version and language, and no account,
  creator ID or key.
- **Counting is local.** BMM counts how many times it showed each card on this PC. When the team
  publishes a new revision of a card, the count starts again — and so does *Don't show again*.
- **Nothing in a card is trusted as markup.** The title and summary are shown as plain text;
  a link opens in your browser and only if it is `https://`; a picture is shown only if it comes
  from BetterCommunity itself, otherwise the card simply has none.

For the exact feed format, see *GET /api/bmm/launch* in the BetterCommunity API reference.

## For plugin and core developers

A step is registered once and the deck does the rest:

```ts
registerLaunchStep({
  id: 'my-step',
  priority: 85,                       // lower = earlier; questions sit at 10–50
  required: false,                    // true = a question the reader must answer
  when: (ctx) => !ctx.firstRun,       // may return a Promise; capped at 4 s, errors = no
  title: () => t('my.step.title'),
  render: (el, api) => { /* draw into el; api.complete(), api.next(), api.closeThen(fn) */ },
});
```

`when` is asked once, in parallel with every other step. A step that throws or times out is left
out; the deck is never held up by it. A required step either calls `api.complete()` when its
choice is made, or provides `commit()`, which runs when the reader presses **Next**.

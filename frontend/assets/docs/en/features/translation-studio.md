# Translation studio

The Translation studio is where you translate BMM, fix a wording, or start a new language. It
replaces the old translation sandbox. Open it from **Settings → Language**.

## A window you can move

The studio is a **floating window** over BMM, and it can **pop out** into a window of its own
(**Open in its own window** in its header, or drag the header past the edge of BMM). Put it on
another screen and keep BMM next to it. Closing the window, or **Back into BMM's window**, brings it
back. See [Panels in their own window](doc-page:features/settings#panels-in-their-own-window).

## Translating, key by key

Every text in BMM is a **key**. The studio lists them with the language you are editing beside the
source text, and shows **{lang}: n of total translated** and a progress bar per language.

- **Show** filters the list: **Missing** (no translation yet), **Changed** (you edited it) or
  **Same** (identical to the source, which is sometimes right and sometimes a forgotten key).
- Search by key or by text.
- :kbd[Up] and :kbd[Down] move through the list, :kbd[Enter] edits, :kbd[Alt+Up] and
  :kbd[Alt+Down] change key from the editor, :kbd[Esc] goes back to the list. The **next missing**
  button walks from gap to gap.
- **Pick a text in BMM** (the pointer): click any text in the app and its key opens in the studio
  (:kbd[Esc] stops). The **Untranslated text** tab scans the screen for text that is not translated
  at all.
- **Find in the app** outlines where the key appears on the current screen, or tells you to open the
  view that shows it.

## Variables and checks

Many texts carry **variables** such as `{name}` or `{n}`. The editor shows them as **chips**:
click one to **insert it at the cursor**. BMM checks your translation and warns when:

- a variable is missing or added (the text would break),
- the **HTML tags** differ from the source,
- the **leading or trailing space** differs from the source.

When everything agrees, it says *Variables and tags match*. See the [translation
variables](doc-page:reference/translation-variables) reference for each key's variables.

## Drafts, and seeing them live

What you type is saved as a **draft**, not into the app's language files. The header counts the
drafts of the language; **Revert all** drops them (click again to confirm).

Switch on **Live in the app** and the **whole app shows your drafts** until you switch it off or
close the studio: the quickest way to see a translation in context. If you edit another language
than the one BMM is shown in, the studio says so.

## Import, export, new language

- **Export** writes the language as a `.json` file; share it, or send it to be included in BMM.
- **Import** reads a language file. If it has the same keys BMM already has, nothing changes; if it
  differs, the differences are loaded as **drafts** for you to review; if it is a language BMM does
  not have, it is installed as a **new language**. A file that is not a language `.json` is refused.
- **Create a language** asks for a **code** (two or three letters, optionally a region: `de`,
  `es`, `pt-br`), its **name in that language**, and what to **start from**: nothing (every key
  starts missing) or a copy of an existing language. The file goes into BMM's `Lang` folder.

**French is the base**: a key not translated in a language falls back to French, and a key missing
everywhere shows its raw id. `en`, `fr` and the template cannot be deleted.

# Customise navigation

The sidebar is yours to arrange. Press the **pencil at the bottom of the sidebar** (or use
**Settings → Navigation & custom pages**) to open the editor. It was rebuilt in 1.0.3 around a
preview you can drag, and a guided way to add buttons.

## Your sidebar

The editor shows **your sidebar** as a live preview. Pick a row to change it.

- **Drag** a row to move it, or press :kbd[Alt+↑] / :kbd[Alt+↓]. Drop it under a section to group it.
- **Rename** a row (**Original name** puts it back), **change its icon**, and **show or hide** it. A
  hidden page still opens from links and shortcuts. **Settings always stays**, because this editor
  lives there.
- **Sections** are headings: the buttons under one belong to it. Deleting a section keeps its buttons
  where they are.
- Each row wears a badge: **BMM page** (part of BMM), or, for what you added, **Shortcut**, **Tool**,
  **Website** or **My page**.
- **Pages without a button** lists your own pages that no longer have one: **Add to sidebar**, or
  delete the page.
- **Reset the sidebar** puts order, names and sections back to the default and removes your buttons.
  Your pages are kept.

## Add a button

**Add a button** is a guided flow with a step bar (*Type, Name & icon, Start from, Permissions,
Preview*; the last three only for your own page):

1. **What should the button open?**
    - **A BMM page**: a second way into one of BMM's pages.
    - **A BMM tool**: the theme editor, storage, the benchmark and other tools.
    - **A website**: shown inside BMM, isolated from it (it cannot reach BMM, your files or your mods).
      The address starts with `https://`; some sites refuse to be shown inside another app.
    - **My own page**: HTML, CSS and JS you write, running in a sandbox.
2. **Name it and pick an icon.** The icon picker has a search box, **icon themes** (Places, Files &
   data, Create, Tools, People, Status, Games & mods, BMM), your **recent** icons and **more icons**.
3. **Start from** (own page): a ready-made starter, each of which works as it is, or a page you
   already made.
4. **Permissions** (own page): see below.
5. **Preview**: the page, running in its sandbox exactly as the button will show it. You can edit its
   code afterwards (**Edit the page**).

The starters are: blank, notes (a notepad that keeps what you write), dashboard (BMM's version,
language and theme), checklist (a to-do list kept between sessions), system (your system, memory and
processor count), fetch (loads data from a site you allow), clipboard (copies and pastes text) and
multi (two linked pages, to grow from). Each says which permissions it uses.

## Permissions of your own pages

Everything starts **off**: a page never reaches your files, your mods or BMM itself. **What this page
may do** lists the permissions, each with a **risk level** (low risk, some risk, higher risk), and
you turn on only what the page needs. **Sites it may contact** is a list of origins, one per line
(`https://api.example.com`); nothing else is reachable.

**Quick set** turns on a sensible group in one click:

| Quick set | Turns on |
|---|---|
| **Nothing** | Nothing: fully isolated |
| **Local only** | Storage, notifications and app info |
| **Local + internet** | Local only, plus the sites you list. **It no longer turns on the clipboard**: grant that one yourself if the page needs it |

The preview is **sandboxed** with only the permissions you turned on. See the [security
model](doc-page:how-it-works/security#custom-pages-review) for how a `.bmmnav` you import is reviewed:
its pages arrive with no permission.

!!! tip "Backups"

    The layout, each page's source and its permissions are three separate things. The **Navigation
    & custom pages** section of a [`.DATABMM` backup](doc-page:features/settings#data) takes all three.

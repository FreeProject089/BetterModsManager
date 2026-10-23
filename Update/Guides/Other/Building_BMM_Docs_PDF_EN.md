# Building BMM Docs — the site and the PDF

`BMM Docs/` is the public MkDocs Material site (its **own git repo**, published to GitHub
Pages). It builds two things: the HTML site, and a single-file PDF of the whole documentation.

---

## 1. Setup

```bash
cd "BMM Docs"
pip install -r requirements.txt
```

> [!IMPORTANT]
> **`mkdocs` may not be on your PATH — use `python -m mkdocs`.** With a **Microsoft Store**
> Python (the usual case on Windows), pip installs `mkdocs.exe` under
> `%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.12_*\LocalCache\local-packages\Python312\Scripts`,
> which is **not** on PATH by default. `mkdocs serve` then fails with *"le terme «mkdocs» n'est
> pas reconnu"*. Every command in this guide works as `python -m mkdocs …`; that form needs no
> PATH change and is what the project's own tooling uses.
>
> To get the bare command, add that folder to your user PATH once and reopen the terminal:
>
> ```powershell
> [Environment]::SetEnvironmentVariable('PATH',
>   [Environment]::GetEnvironmentVariable('PATH','User') + ';' +
>   "$env:LOCALAPPDATA\Packages\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\LocalCache\local-packages\Python312\Scripts",
>   'User')
> ```
>
> Note `python -c "import sysconfig; print(sysconfig.get_path('scripts'))"` gives you the **wrong**
> folder for Store Python — it points at the read-only `WindowsApps` directory, which has no
> `mkdocs.exe`.

Pinned versions:

```
mkdocs==1.6.1
mkdocs-material==9.5.44
mkdocs-static-i18n==1.2.3
mkdocs-with-pdf==0.9.3
Pillow==11.0.0
```

---

## 2. The site (what contributors use)

```bash
python -m mkdocs serve            # http://127.0.0.1:8000 — French at /fr/
python -m mkdocs build --strict   # what CI gates on
```

> [!IMPORTANT]
> `--strict` turns a **broken internal link into a build failure**. Run it before pushing —
> it's the same gate CI uses, and it's the usual reason a docs PR goes red.

Bilingual convention: `page.md` is English, `page.fr.md` is its French sibling; untranslated
pages fall back to English.

---

## 3. The PDF

```bash
python -m mkdocs build -f mkdocs.pdf.yml
# → site/pdf/bettermodsmanager.pdf
```

> [!CAUTION]
> **Order matters if you build both.** `mkdocs build` **cleans `site/` first**, so a site build
> after a PDF build deletes the PDF. Always run the PDF pass **last**:
>
> ```bash
> python -m mkdocs build --strict         # site + the strict link gate
> python -m mkdocs build -f mkdocs.pdf.yml   # PDF, into the site that already exists
> ```
>
> `mkdocs.pdf.yml` INHERITs `mkdocs.yml` and its plugin list is a superset, so the second pass
> reproduces the same site and adds the PDF.

> [!WARNING]
> **This needs GTK system libraries and is effectively Linux/CI-only.** The PDF renders through
> `mkdocs-with-pdf` → WeasyPrint, which needs real cairo/pango libs. On a typical Windows box it
> dies with `cannot load library 'libgobject-2.0-0'`.

### Why there are two config files

MkDocs **imports every plugin listed in a config, even a disabled one**. Putting `with-pdf` in
`mkdocs.yml` therefore made plain `mkdocs serve` crash on any Windows machine without GTK — i.e.
most of them. So:

- `mkdocs.yml` — what contributors use. **No PDF plugin.** Works everywhere, no GTK needed.
- `mkdocs.pdf.yml` — `INHERIT: mkdocs.yml` plus the `with-pdf` plugin. Used by CI.

> [!NOTE]
> Because `plugins:` is a **list**, the child config *replaces* the parent's list rather than
> merging. That's why `mkdocs.pdf.yml` re-declares `search` and `i18n` alongside `with-pdf`. If
> you add a plugin to `mkdocs.yml`, add it to `mkdocs.pdf.yml` too or the PDF build loses it.

### System libraries (Debian/Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info
```

Without these you get an opaque cairo/pango error rather than a clear "missing dependency".

### Building the PDF on Windows anyway

Use WSL, or Docker:

```bash
docker run --rm -v "$PWD":/docs -w /docs python:3.12-slim bash -c "
  apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info &&
  pip install -r requirements.txt &&
  python -m mkdocs build --strict &&
  python -m mkdocs build -f mkdocs.pdf.yml"
```

---

## 4. Screenshot annotations

Annotated screenshots are **generated**, not hand-edited: a raw `*.png` plus a `*.json`
annotation spec produce `*.annotated.png`.

```bash
python tools/annotate.py           # regenerate
python tools/annotate.py --check   # CI gate: fails if a generated file is stale
```

If you change a `.json` spec or replace a raw screenshot, re-run `annotate.py` and commit the
regenerated `.annotated.png`, or CI fails on the `--check`.

---

## 5. CI

`.github/workflows/docs.yml` builds on push to `master` / PR, and deploys to GitHub Pages from
`master`. Steps, in order:

1. `actions/checkout@v4` **with `lfs: true`**
2. a guard that fails if any `.bmmreplay` is still an LFS pointer
3. Python 3.12
4. the apt libs above
5. `pip install -r requirements.txt`
6. `python tools/annotate.py --check`
7. `mkdocs build --strict` — the site, and the strict link gate
8. `mkdocs build -f mkdocs.pdf.yml` — the PDF, **last**, because a site build cleans `site/`
9. upload the PDF artifact → deploy Pages (master only)

### Two bugs this workflow used to have

Both are fixed; they are recorded because the symptom in each case was *silence*, not an error.

> [!NOTE]
> **The PDF was never rendered.** The build step ran `mkdocs build --strict` with an env var
> `ENABLE_PDF: "1"` that **nothing in the repo reads** — `mkdocs.yml` has no `!ENV` hook and no
> `with-pdf` entry. So no PDF existed, and `upload-artifact` was uploading nothing. Fixed by the
> two explicit passes in steps 7–8.

> [!NOTE]
> **Every inline replay on the published site was broken.** The `.bmmreplay` files are
> LFS-tracked, but the checkout had no `lfs: true`, so CI got 130-byte pointer files, mkdocs
> copied them to `site/` verbatim, and the player tried to parse
> `version https://git-lfs.github.com/spec/v1…` as an rrweb event stream — showing nothing, with
> no error. It worked locally only because a dev clone has the real files. Fixed by `lfs: true`
> plus the step-2 guard, so a pointer can never reach the site again.

---

## 6. Checklist before pushing docs

- [ ] `python -m mkdocs build --strict` passes (no broken internal links).
- [ ] New page has both `page.md` **and** `page.fr.md`, and is in the `nav` — plus a
      `nav_translations` entry for its French title.
- [ ] `python tools/annotate.py --check` passes.
- [ ] If you added a plugin to `mkdocs.yml`, mirror it into `mkdocs.pdf.yml`.
- [ ] New `.bmmreplay` recordings committed **through git-lfs** (see *Embedding replays & video*),
      and `git lfs ls-files` lists them — a file committed before `.gitattributes` matched it goes
      in as a normal blob and silently defeats the CI guard's opposite case.

# Building BMM Docs — the site and the PDF

`BMM Docs/` is the public MkDocs Material site (its **own git repo**, published to GitHub
Pages). It builds two things: the HTML site, and a single-file PDF of the whole documentation.

---

## 1. Setup

```bash
cd "BMM Docs"
pip install -r requirements.txt
```

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
mkdocs serve                # http://127.0.0.1:8000 — French at /fr/
mkdocs build --strict       # what CI gates on
```

> [!IMPORTANT]
> `--strict` turns a **broken internal link into a build failure**. Run it before pushing —
> it's the same gate CI uses, and it's the usual reason a docs PR goes red.

Bilingual convention: `page.md` is English, `page.fr.md` is its French sibling; untranslated
pages fall back to English.

---

## 3. The PDF

```bash
mkdocs build -f mkdocs.pdf.yml
# → site/pdf/bettermodsmanager.pdf
```

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
  mkdocs build -f mkdocs.pdf.yml"
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
`master`. Steps: Python 3.12 → the apt libs above → `pip install -r requirements.txt` →
`python tools/annotate.py --check` → build → upload the PDF artifact → deploy.

> [!CAUTION]
> **Known bug — CI does not actually produce the PDF.** The build step runs
> `mkdocs build --strict` with an env var `ENABLE_PDF: "1"`, but `ENABLE_PDF` is referenced
> **nowhere else in the repo** — `mkdocs.yml` has no `!ENV` hook and no `with-pdf` entry. So no
> PDF is rendered, and the `upload-artifact` step (`if-no-files-found: error`) should be failing.
> The correct step is:
>
> ```yaml
> run: |
>   mkdocs build --strict                 # site (also the strict link gate)
>   mkdocs build -f mkdocs.pdf.yml        # PDF → site/pdf/bettermodsmanager.pdf
> ```

---

## 6. Checklist before pushing docs

- [ ] `mkdocs build --strict` passes (no broken internal links).
- [ ] New page has both `page.md` **and** `page.fr.md`, and is in the `nav` — plus a
      `nav_translations` entry for its French title.
- [ ] `python tools/annotate.py --check` passes.
- [ ] If you added a plugin to `mkdocs.yml`, mirror it into `mkdocs.pdf.yml`.
- [ ] New `.bmmreplay` recordings committed **through git-lfs** (see *Embedding replays & video*).

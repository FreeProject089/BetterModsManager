"""One-language edition of the BMM Docs print page, for the release tool's PDF step.

With mkdocs-static-i18n, mkdocs-print-site-plugin writes ONE /print_page/, and the French
pass of the i18n build overwrites it: the « English » print page of mkdocs.pdf-chrome.yml
came out in French (seen 2026-10-14). So each language is built as its own single-language
site:

  1. docs/ is copied to <cache>/docs-<lang>; for French every `page.fr.md` replaces
     `page.md`, for English the `.fr.md` pages are removed;
  2. <cache>/mkdocs-<lang>.yml INHERITs the docs' own mkdocs.pdf-chrome.yml (theme, markdown
     extensions, stylesheets stay the docs' own) and overrides only docs_dir, site_dir, the
     theme language, absolute custom_dir / hooks, the nav titles (French: the i18n plugin's
     own nav_translations) and the plugins (search + print-site, no i18n).

Nothing is written inside the docs repository.

    python lang_config.py <BMM Docs dir> <cache dir> <en|fr>   ->  prints the config path
"""
import shutil
import sys
from pathlib import Path

import yaml


class _Loader(yaml.SafeLoader):
    pass


# mkdocs.yml carries !!python/name tags (markdown extensions): read them as plain values, they
# are only needed by mkdocs itself, which reads the inherited file directly.
_Loader.add_multi_constructor("tag:yaml.org,2002:python/", lambda loader, suffix, node: None)
_Loader.add_multi_constructor("!", lambda loader, suffix, node: None)

TEXT = {
    "en": {"title": "BetterModsManager — Documentation", "toc": "Contents"},
    "fr": {"title": "BetterModsManager — Documentation (français)", "toc": "Sommaire"},
}


def translate(nav, words):
    out = []
    for item in nav:
        if isinstance(item, dict):
            (title, value), = item.items()
            out.append({words.get(title, title): translate(value, words) if isinstance(value, list) else value})
        else:
            out.append(item)
    return out


def main():
    docs_repo = Path(sys.argv[1]).resolve()
    cache = Path(sys.argv[2]).resolve()
    lang = sys.argv[3] if len(sys.argv) > 3 else "fr"
    base = yaml.load((docs_repo / "mkdocs.yml").read_text(encoding="utf-8"), Loader=_Loader)
    words = {}
    if lang != "en":
        for p in base.get("plugins", []):
            if isinstance(p, dict) and "i18n" in p:
                for entry in p["i18n"].get("languages", []):
                    if entry.get("locale") == lang:
                        words = entry.get("nav_translations", {}) or {}

    src = docs_repo / (base.get("docs_dir") or "docs")
    dst = cache / f"docs-{lang}"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    for f in list(dst.rglob("*.fr.md")):
        if lang == "fr":
            f.replace(f.with_name(f.name[: -len(".fr.md")] + ".md"))
        else:
            f.unlink()

    cfg = {
        "INHERIT": str((docs_repo / "mkdocs.pdf-chrome.yml").resolve()),
        "docs_dir": str(dst),
        "site_dir": str(cache / f"docs-site-{lang}"),
        "theme": {"custom_dir": str((docs_repo / base["theme"]["custom_dir"]).resolve()), "language": lang},
        "hooks": [str((docs_repo / h).resolve()) for h in base.get("hooks", [])],
        "nav": translate(base.get("nav", []), words),
        "plugins": [
            {"search": {"lang": [lang]}},
            {"print-site": {
                "add_to_navigation": False,
                "print_page_title": TEXT[lang]["title"],
                "add_cover_page": True,
                "add_table_of_contents": True,
                "toc_title": TEXT[lang]["toc"],
                "enumerate_headings": False,
                "enumerate_figures": False,
            }},
        ],
    }
    out = cache / f"mkdocs-{lang}.yml"
    out.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()

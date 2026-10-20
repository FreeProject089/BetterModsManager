"""One-language edition of the BMM Docs print page, for the release tool's PDF step.

BMM Docs now ships this itself: tools/build_pdf_chrome.py builds each language as its own
single-language site (with the i18n plugin the French pass overwrote the one print page, so the
"English" book came out French). This release tool used to carry a copy of that logic; it now
calls the docs' own `language_config`, so there is one implementation, not two that drift.

Only the build directory differs: the docs' script builds under `<BMM Docs>/.pdf-chrome-build`,
this one under the release tool's cache, so nothing is written inside the docs repository.

    python lang_config.py <BMM Docs dir> <cache dir> <en|fr>
        -> prints two lines: the generated mkdocs config, then the site directory
"""
import importlib.util
import sys
from pathlib import Path


def main():
    docs = Path(sys.argv[1]).resolve()
    cache = Path(sys.argv[2]).resolve()
    lang = sys.argv[3]
    script = docs / "tools" / "build_pdf_chrome.py"
    if not script.exists():
        sys.exit(f"{script} not found: update BMM Docs (the release tool relies on its language_config)")
    spec = importlib.util.spec_from_file_location("bmm_docs_build_pdf_chrome", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "language_config"):
        sys.exit("BMM Docs tools/build_pdf_chrome.py has no language_config(): update BMM Docs")
    mod.BUILD = cache / "docs-pdf-build"
    mod.BUILD.mkdir(parents=True, exist_ok=True)
    cfg, site = mod.language_config(lang, docs / "mkdocs.pdf-chrome.yml", "light")
    print(cfg)
    print(site)


if __name__ == "__main__":
    main()

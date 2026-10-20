"""Top-level bookmarks of a PDF as JSON [{"title", "page"}] (page is 1-based), and the page count.

    python outline_pages.py <file.pdf>
"""
import json
import sys

from pypdf import PdfReader


def main():
    r = PdfReader(sys.argv[1])
    items = []
    for it in r.outline:
        if isinstance(it, list):
            continue
        try:
            items.append({"title": str(it.title), "page": r.get_destination_page_number(it) + 1})
        except Exception:
            items.append({"title": str(getattr(it, "title", "")), "page": None})
    print(json.dumps({"pages": len(r.pages), "outline": items}, ensure_ascii=False))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Banc d'essai pour « Mettre à jour depuis le serveur ».

Crée un faux dossier de mods et le sert en HTTP avec un index de répertoire au **format
nginx** — c'est important : le serveur intégré de Python produit un listing sans taille ni
date, ce qui forcerait BMM à tout re-hasher à chaque passage. Tu ne pourrais donc pas
tester ce qui compte, à savoir la reprise des hashes.

    python serve_test_repo.py            # crée le dossier si absent, puis sert sur :8777
    python serve_test_repo.py --port 9000
    python serve_test_repo.py --reset    # repart d'un dossier neuf

Ensuite, dans BMM → Server Repo → onglet Host → « Mettre à jour depuis le serveur » :

    URL du dossier des mods : http://127.0.0.1:8777/mods
    Ton repo.json local     : <ce dossier>/repo.json   (via Parcourir, il n'a pas
                              besoin d'exister — c'est justement le cas « création »)
    Nom du repo / Jeu       : ce que tu veux, utilisés uniquement à la création

Scénario conseillé :

  1. « VÉRIFIER » → doit annoncer « aucun manifeste précédent » et tout mettre à hasher.
  2. « METTRE À JOUR » → écrit repo.json, dit « créé ».
  3. « VÉRIFIER » à nouveau → tout doit être **repris**, 0 octet à télécharger.
     C'est le test qui prouve que le système sert à quelque chose.
  4. Lance ce script avec --touch pour modifier un seul fichier, puis « VÉRIFIER » →
     un seul fichier à hasher.
  5. Supprime un dossier de mod, « VÉRIFIER » → il doit apparaître en « disparus ».
"""

import argparse
import html
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODS = ROOT / "mods"

# Assez de variété pour exercer les cas qui cassent : un sous-dossier, un espace dans un
# nom, et un fichier au-dessus de 4 Mo pour déclencher les hashes de blocs.
FIXTURE = {
    "cool-mod": {
        "readme.txt": b"cool mod\n",
        "Data/textures/a.dds": b"A" * 2048,
        "Data/textures/big file.dds": b"B" * (5 * 1024 * 1024),
    },
    "other-mod": {
        "b.pak": b"C" * 4096,
        "Data/config.ini": b"[settings]\nvalue=1\n",
    },
    "third-mod": {
        "notes.md": b"# third\n",
    },
}


def build(reset: bool) -> None:
    if reset and MODS.exists():
        shutil.rmtree(MODS)
    if MODS.exists():
        print(f"Dossier deja present : {MODS}")
        return
    for mod, files in FIXTURE.items():
        for rel, data in files.items():
            path = MODS / mod / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    total = sum(len(d) for f in FIXTURE.values() for d in f.values())
    print(f"Cree {MODS} — {len(FIXTURE)} mods, {total / 1024 / 1024:.1f} Mo")


def touch_one() -> None:
    """Modifie un seul fichier, pour vérifier qu'un seul est re-hashé."""
    target = MODS / "other-mod" / "b.pak"
    if not target.exists():
        sys.exit("Lance d'abord le script sans --touch.")
    target.write_bytes(b"C" * 4096 + b"MODIFIE" + str(time.time()).encode())
    print(f"Modifie {target.relative_to(ROOT)} — « VERIFIER » ne doit citer que ce fichier.")


class NginxIndex(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler avec un index au format nginx.

    Le format compte autant que le contenu : le parseur de BMM lit `<a href>` puis la
    taille et la date qui suivent sur la même ligne, et refuse une taille arrondie plutôt
    que de l'approximer. Un index sans ces colonnes est valide mais force un re-hash
    complet à chaque fois — donc le reproduire fidèlement est tout l'intérêt de ce script.
    """

    def list_directory(self, path):
        try:
            names = sorted(os.listdir(path), key=lambda n: (not os.path.isdir(os.path.join(path, n)), n.lower()))
        except OSError:
            self.send_error(404, "No permission to list directory")
            return None

        rows = ['<html><head><title>Index of {}</title></head><body>'.format(html.escape(self.path)),
                '<h1>Index of {}</h1><hr><pre><a href="../">../</a>'.format(html.escape(self.path))]
        for name in names:
            full = os.path.join(path, name)
            st = os.stat(full)
            when = datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%d-%b-%Y %H:%M")
            if os.path.isdir(full):
                link = f'{name}/'
                size = "-"
            else:
                link = name
                size = str(st.st_size)
            # nginx pads the name column; the parser only needs the order, not the width.
            from urllib.parse import quote
            rows.append(
                '<a href="{href}">{shown}</a>{pad}{when} {size:>19}'.format(
                    href=quote(link), shown=html.escape(link),
                    pad=" " * max(1, 52 - len(link)), when=when, size=size,
                )
            )
        rows.append("</pre><hr></body></html>")
        body = "\n".join(rows).encode("utf-8", "surrogateescape")

        self.send_response(200)
        self.send_header("Content-type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        import io as _io
        return _io.BytesIO(body)

    def log_message(self, fmt, *args):
        # One line per request, so you can watch BMM fetch only what it said it would.
        sys.stderr.write("  %s\n" % (fmt % args))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--reset", action="store_true", help="repartir d'un dossier neuf")
    ap.add_argument("--touch", action="store_true", help="modifier un seul fichier, puis quitter")
    args = ap.parse_args()

    if args.touch:
        touch_one()
        return

    build(args.reset)
    os.chdir(ROOT)
    # Loopback only: this serves a directory listing with no authentication, and it has no
    # business being reachable from the network.
    srv = HTTPServer(("127.0.0.1", args.port), NginxIndex)
    print(f"\n  URL a coller dans BMM :  http://127.0.0.1:{args.port}/mods")
    print(f"  repo.json local       :  {ROOT / 'repo.json'}")
    print("\n  Ctrl+C pour arreter.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nArrete.")


if __name__ == "__main__":
    main()

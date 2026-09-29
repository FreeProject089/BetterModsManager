"""The fixed multilingual sample set used to measure the ONNX variants against the fp32 PyTorch
reference, and (a subset of it) to build the Rust golden fixture.

The questions are exactly the ones BMM asks (src-tauri/src/commands/ai_core.rs: classify_mod and
triage_report): per mod, one yes/no question per tag, the language choice and the adult-content
yes/no; per report, the category and severity choices. 59 texts in EN/FR/DE/ES/IT/PT/RU/PL/JA/ZH,
186 question-answers (84 choice, 102 yes/no).
"""

LANGS = [("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish"), ("it", "Italian"),
         ("pt", "Portuguese"), ("ru", "Russian"), ("pl", "Polish"), ("zh", "Chinese"), ("ja", "Japanese")]
CATS = ["crash", "bug", "performance", "install", "mod_conflict", "ui", "other"]
SEVS = ["low", "medium", "high", "critical"]

def tagq(name):
    return {"type": "noul", "instructions": 'Is this game mod about "%s"? Answer yes only if the text clearly says so.' % name}

def mod_questions(tags):
    q = {}
    for i, t in enumerate(tags):
        q["tag_%d" % i] = tagq(t)
    q["language"] = {"type": "choice", "instructions": "In which language is this text written?",
                     "criteria": {c: n for c, n in LANGS}}
    q["nsfw"] = {"type": "noul", "instructions": "Does this game mod contain sexual or adult-only content?"}
    return q

def report_questions():
    return {
        "category": {"type": "choice", "instructions": "What kind of problem does this report describe?",
                     "criteria": {c: c.replace("_", " ") for c in CATS}},
        "severity": {"type": "choice", "instructions": "How severe is the problem for the user?",
                     "criteria": {s: s for s in SEVS}},
    }

MODS = [
    ("en", "Name: Better Rifles Pack\nDescription: Adds twelve new assault rifles and sniper rifles with custom sounds and reload animations.", ["Weapons", "Maps"]),
    ("en", "Name: Desert Canyon\nDescription: A large multiplayer map set in a desert canyon with caves, bridges and a ruined village.", ["Maps", "Weapons"]),
    ("en", "Name: HD Ambient Sounds\nDescription: Replaces every ambient sound of the game with high quality recordings: wind, rain, birds and city noise.", ["Sound", "Graphics"]),
    ("en", "Name: Realistic Lighting\nDescription: New shaders, volumetric fog and improved shadows. Requires a decent GPU.", ["Graphics", "Sound"]),
    ("en", "Name: Cockpit Tweaks\nDescription: Fixes several cockpit gauges and adds a working clock to the F-16 instrument panel.", ["Aircraft", "Maps"]),
    ("en", "Name: Nude Skins Collection\nDescription: Adult-only character skins with explicit nudity. 18+ only.", ["Skins", "Weapons"]),
    ("en", "Name: UI Overhaul\nDescription: A cleaner interface: new inventory screen, smaller HUD and a better map legend.", ["Interface", "Sound"]),
    ("fr", "Nom : Pack d'armes réalistes\nDescription : Ajoute quinze nouvelles armes à feu avec des sons et des animations de rechargement inédits.", ["Armes", "Cartes"]),
    ("fr", "Nom : Vallée perdue\nDescription : Une nouvelle carte immense avec des forêts, une rivière et un château en ruine à explorer.", ["Cartes", "Armes"]),
    ("fr", "Nom : Sons d'ambiance HD\nDescription : Remplace les bruits d'ambiance par des enregistrements de haute qualité : vent, pluie, oiseaux.", ["Son", "Graphismes"]),
    ("fr", "Nom : Éclairage amélioré\nDescription : Nouveaux shaders, brouillard volumétrique et ombres plus douces pour une meilleure image.", ["Graphismes", "Son"]),
    ("fr", "Nom : Tenues légères\nDescription : Contenu réservé aux adultes : personnages dénudés et scènes explicites.", ["Tenues", "Cartes"]),
    ("de", "Name: Realistische Waffen\nBeschreibung: Fügt zehn neue Gewehre und Pistolen mit eigenen Geräuschen und Nachladeanimationen hinzu.", ["Waffen", "Karten"]),
    ("de", "Name: Alpenkarte\nBeschreibung: Eine große Karte in den Alpen mit Dörfern, Seen und verschneiten Gipfeln.", ["Karten", "Waffen"]),
    ("de", "Name: Bessere Beleuchtung\nBeschreibung: Neue Shader, volumetrischer Nebel und schönere Schatten für das ganze Spiel.", ["Grafik", "Sound"]),
    ("de", "Name: Motorsound-Paket\nBeschreibung: Ersetzt alle Motorgeräusche der Fahrzeuge durch echte Aufnahmen.", ["Sound", "Karten"]),
    ("es", "Nombre: Armas realistas\nDescripción: Añade doce armas nuevas con sonidos propios y animaciones de recarga.", ["Armas", "Mapas"]),
    ("es", "Nombre: Isla tropical\nDescripción: Un mapa enorme con playas, selva, cuevas y un volcán activo.", ["Mapas", "Armas"]),
    ("es", "Nombre: Sonido envolvente\nDescripción: Reemplaza la música y los efectos de sonido con grabaciones en alta calidad.", ["Sonido", "Gráficos"]),
    ("es", "Nombre: Interfaz limpia\nDescripción: Un menú de inventario nuevo y un HUD más pequeño y legible.", ["Interfaz", "Armas"]),
    ("ru", "Название: Оружейный пак\nОписание: Добавляет десять новых винтовок и пистолетов с новыми звуками и анимациями.", ["Оружие", "Карты"]),
    ("ru", "Название: Зимний лес\nОписание: Большая новая карта с заснеженным лесом, деревней и замёрзшим озером.", ["Карты", "Оружие"]),
    ("ru", "Название: Улучшенная графика\nОписание: Новые шейдеры, объёмный туман и мягкие тени.", ["Графика", "Звук"]),
    ("ja", "名前: リアル武器パック\n説明: 新しいライフルとピストルを十種類追加します。独自のサウンドとリロードアニメーション付き。", ["武器", "マップ"]),
    ("ja", "名前: 砂漠マップ\n説明: 洞窟、橋、廃村がある広大な砂漠のマルチプレイヤーマップです。", ["マップ", "武器"]),
    ("ja", "名前: 高画質ライティング\n説明: 新しいシェーダーとボリュメトリックフォグで画質を向上させます。", ["グラフィック", "サウンド"]),
    ("it", "Nome: Armi realistiche\nDescrizione: Aggiunge dieci nuove armi con suoni e animazioni di ricarica personalizzati.", ["Armi", "Mappe"]),
    ("it", "Nome: Collina toscana\nDescrizione: Una grande mappa con vigneti, un borgo medievale e strade di campagna.", ["Mappe", "Armi"]),
    ("pt", "Nome: Armas realistas\nDescrição: Adiciona doze armas novas com sons e animações de recarga próprios.", ["Armas", "Mapas"]),
    ("pt", "Nome: Floresta tropical\nDescrição: Um mapa enorme com rios, cachoeiras e uma aldeia abandonada.", ["Mapas", "Armas"]),
    ("pl", "Nazwa: Realistyczna broń\nOpis: Dodaje dziesięć nowych karabinów i pistoletów z własnymi dźwiękami.", ["Broń", "Mapy"]),
    ("pl", "Nazwa: Zimowa mapa\nOpis: Duża mapa z zaśnieżonym lasem, wioską i zamarzniętym jeziorem.", ["Mapy", "Broń"]),
    ("zh", "名称：真实武器包\n描述：添加十把新的步枪和手枪，带有全新的音效和换弹动画。", ["武器", "地图"]),
    ("zh", "名称：沙漠地图\n描述：一张巨大的沙漠多人地图，包含洞穴、桥梁和废弃村庄。", ["地图", "武器"]),
]

REPORTS = [
    ("en", "The game crashes to desktop every time I load my save after enabling the rifle pack. Error: access violation in dx11.dll."),
    ("en", "The mod list takes 40 seconds to open and the whole app freezes while scrolling."),
    ("en", "The installer fails with 'access denied' when I choose Program Files."),
    ("en", "Two mods overwrite the same texture file and the second one wins, so the first mod is broken."),
    ("en", "The settings button text is cut off in the sidebar when the window is small."),
    ("en", "Small typo in the French translation of the about page."),
    ("fr", "Le jeu plante au lancement depuis que j'ai activé le pack de sons. Écran noir puis retour au bureau."),
    ("fr", "L'application est très lente quand j'ai plus de 500 mods, chaque clic prend plusieurs secondes."),
    ("fr", "Impossible d'installer le mod : le fichier zip est refusé avec une erreur de chemin."),
    ("fr", "Deux mods modifient le même fichier de configuration et entrent en conflit."),
    ("fr", "Le bouton Enregistrer est caché derrière la barre latérale."),
    ("de", "Das Spiel stürzt beim Laden der Karte ab, seit ich den Waffenmod installiert habe."),
    ("de", "Die Anwendung ist sehr langsam und braucht eine Minute zum Starten."),
    ("de", "Die Installation bricht mit einem Fehler beim Entpacken ab."),
    ("es", "El juego se cierra de golpe al abrir el menú de armas después de instalar el mod."),
    ("es", "La aplicación va muy lenta y consume toda la memoria."),
    ("es", "El texto del botón de ajustes se sale del recuadro."),
    ("ru", "Игра вылетает на рабочий стол при загрузке сохранения после установки мода."),
    ("ru", "Приложение очень медленно открывает список модов."),
    ("ja", "MODを有効にするとゲームが起動時にクラッシュします。"),
    ("ja", "設定画面のボタンの文字が切れて表示されます。"),
    ("it", "Il gioco si blocca durante il caricamento della mappa dopo aver installato la mod."),
    ("pt", "O jogo fecha sozinho quando abro o inventário depois de instalar o mod."),
    ("pl", "Gra zawiesza się przy wczytywaniu zapisu po włączeniu modu."),
    ("zh", "安装模组后游戏在加载存档时崩溃。"),
]


def all_items():
    items = []
    for i, (lang, text, tags) in enumerate(MODS):
        items.append({"id": "mod%02d" % i, "lang": lang, "kind": "mod", "state": {"body": text}, "questions": mod_questions(tags)})
    for i, (lang, text) in enumerate(REPORTS):
        items.append({"id": "rep%02d" % i, "lang": lang, "kind": "report", "state": {"body": text}, "questions": report_questions()})
    return items


# One or two per language, both kinds, the adult-content cases included: 72 rows.
GOLDEN_IDS = ["mod00", "mod05", "mod07", "mod11", "mod12", "mod16", "mod20", "mod23", "mod26", "mod28", "mod30", "mod32",
              "rep00", "rep01", "rep06", "rep07", "rep11", "rep14", "rep17", "rep19", "rep21", "rep22", "rep23", "rep24"]


def golden_items():
    by = {it["id"]: it for it in all_items()}
    return [by[i] for i in GOLDEN_IDS]


if __name__ == "__main__":
    import json
    items = all_items()
    with open("samples.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    print("items", len(items), "question-answers", sum(len(it["questions"]) for it in items))

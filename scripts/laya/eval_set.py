"""The labelled BMM-shaped evaluation set for the Laya pipeline (« Laya v2 » precision work).

    python scripts/laya/eval_set.py      -> writes src-tauri/tests/laya_eval.json

Unlike samples.py (which measures a QUANTIZATION against the fp32 reference, whatever the answer),
this set carries the RIGHT answer, written by hand: which of the user's tags a mod belongs to,
what language its text is in, what kind of problem a report describes and how bad it is, and
which earlier report (if any) a new one duplicates. It is what `measure_pipeline` (the ignored
test in src-tauri/src/commands/ai_embedded.rs) scores the old and the new question sets against.

The texts look like what BMM actually hands the classifier: `provider_text` for a mod (Name /
Author / Description / Excerpt / Files lines), the masked report body for a report. Written for
this set — no text is copied from a real mod page or a real user's report.

156 tuning items: 64 mods (tags + language + adult content), 48 reports (category + severity),
24 duplicate checks, 20 language-only snippets. EN / FR / DE / ES / IT / PT / RU / PL / JA / ZH.
"""
import json
import os

# The user's tag vocabulary, as BMM stores it (custom_tags: id + name). Two users: one English,
# one French — a French user tags English mods with French tag names, which is the hard case.
VOCAB = {
    "en": ["Aircraft", "Maps", "Weapons", "Sound", "Graphics", "Interface", "Liveries", "Missions",
           "Utilities", "Vehicles", "Characters", "Gameplay", "Fixes", "Adult"],
    "fr": ["Avions", "Cartes", "Armes", "Son", "Graphismes", "Interface", "Livrées", "Missions",
           "Utilitaires", "Véhicules", "Personnages", "Gameplay", "Correctifs", "Adulte"],
}
# The same tags, index for index (the gold labels are written once, in English).
EN2FR = dict(zip(VOCAB["en"], VOCAB["fr"]))


def mod(i, lang, vocab, text, tags, nsfw=False):
    names = tags if vocab == "en" else [EN2FR[t] for t in tags]
    return {"id": "m%02d" % i, "task": "mod", "lang": lang, "vocab": vocab, "text": text, "tags": names, "nsfw": nsfw}


MODS = [
    mod(1, "en", "en", "Name: F-4E Improved Cockpit\nAuthor: GaugeWorks\nDescription: Reworked cockpit textures and fixed gauges for the F-4E Phantom.\nExcerpt: Fixes the fuel flow gauge and the misaligned HSI needle. Adds 4K cockpit textures.\nFiles: Mods/aircraft/F-4E/Cockpit/Textures/panel.dds, entry.lua, README.txt", ["Aircraft", "Fixes"]),
    mod(2, "en", "en", "Name: Caucasus Winter\nAuthor: SnowTeam\nDescription: Winter terrain textures for the Caucasus map: snow on the ground, frozen lakes and bare trees.\nFiles: Bazar/Terrain/Caucasus/winter/snow_01.dds, textures.lua", ["Maps", "Graphics"]),
    mod(3, "en", "en", "Name: GBU-39 Small Diameter Bomb\nAuthor: OrdnanceLab\nDescription: Adds the GBU-39 SDB with a correct 3D model, launcher rack and guidance logic.\nFiles: Mods/weapons/GBU-39/shape/gbu39.edm, entry.lua", ["Weapons"]),
    mod(4, "en", "en", "Name: Real Engine Sounds\nAuthor: AudioCraft\nDescription: Recorded jet engine sounds for startup, idle and afterburner. Replaces the stock engine audio.\nFiles: Sounds/Effects/Aircrafts/Engines/ab_loop.ogg, sdef/engine.sdef", ["Sound"]),
    mod(5, "en", "en", "Name: Reshade Cinematic Preset\nAuthor: PixelPusher\nDescription: A ReShade preset with sharper image, better contrast and subtle film grain for screenshots.\nFiles: reshade-shaders/Shaders/LumaSharpen.fx, CinematicPreset.ini", ["Graphics"]),
    mod(6, "en", "en", "Name: Kneeboard Pages Pack\nAuthor: Nav\nDescription: Printable kneeboard pages: airfield charts, radio frequencies and TACAN channels shown in the cockpit.\nFiles: Kneeboard/charts_01.png, Kneeboard/freqs.png", ["Interface", "Utilities"]),
    mod(7, "en", "en", "Name: 494th Squadron Livery\nAuthor: Painter\nDescription: Squadron paint scheme for the F-15E with correct tail codes and nose art.\nFiles: Liveries/F-15ESE/494th/description.lua, 494th_fuselage.dds", ["Liveries", "Aircraft"]),
    mod(8, "en", "en", "Name: Operation Red Dawn\nAuthor: MissionMaker\nDescription: A 12-mission single-player campaign with briefings, voice-overs and dynamic weather.\nFiles: Missions/Campaigns/RedDawn/RD01.miz, RD02.miz, briefing.pdf", ["Missions"]),
    mod(9, "en", "en", "Name: Mod Load Order Tool\nAuthor: Toolsmith\nDescription: A small utility that checks which files each mod replaces and exports a load order report.\nFiles: tools/loadorder.exe, config.ini", ["Utilities"]),
    mod(10, "en", "en", "Name: M1A2 Abrams Tank\nAuthor: ArmorWorks\nDescription: Adds a drivable M1A2 main battle tank with a detailed interior and tracks physics.\nFiles: Mods/tech/M1A2/shapes/m1a2.edm, entry.lua", ["Vehicles"]),
    mod(11, "en", "en", "Name: Better Pilot Models\nAuthor: CharacterLab\nDescription: New high-detail pilot and ground crew models with better faces and animations.\nFiles: Bazar/World/Shapes/pilot_new.edm", ["Characters"]),
    mod(12, "en", "en", "Name: Realistic Damage Model\nAuthor: Physics\nDescription: Changes how aircraft take damage: fuel leaks, hydraulic failures and wing loss are more realistic.\nFiles: Scripts/Aircrafts/_Common/Damage.lua", ["Gameplay", "Aircraft"]),
    mod(13, "en", "en", "Name: Night Vision Fix\nAuthor: Fixer\nDescription: Corrects the too-bright night vision goggles and the green tint after the 2.9 update.\nFiles: Bazar/shaders/nvg.fx", ["Fixes", "Graphics"]),
    mod(14, "en", "en", "Name: Pinup Nose Art (18+)\nAuthor: Anon\nDescription: Nude pinup nose art for bombers. Contains explicit nudity, adults only.\nFiles: Liveries/B-17G/pinup/nose.dds", ["Adult", "Liveries"], True),
    mod(15, "en", "en", "Name: Syria Airfields Update\nAuthor: MapFix\nDescription: Adds missing taxiway signs and fixes runway lights on five Syrian airfields.\nFiles: Mods/terrains/Syria/Airfields/signs.lua", ["Maps", "Fixes"]),
    mod(16, "en", "en", "Name: Radio Chatter Overhaul\nAuthor: VoiceActors\nDescription: More than 400 new ATC and wingman voice lines recorded by real pilots.\nFiles: Sounds/Speech/ATC/en/*.ogg", ["Sound"]),
    mod(17, "en", "en", "Name: Minimal HUD\nAuthor: CleanUI\nDescription: Hides the labels, shrinks the message box and moves the radio menu to the side.\nFiles: Config/View/Server.lua, UI/ui_theme.lua", ["Interface"]),
    mod(18, "en", "en", "Name: Humvee Pack\nAuthor: Motorpool\nDescription: Five Humvee variants with working lights, doors and a mounted machine gun.\nFiles: Mods/tech/Humvee/entry.lua", ["Vehicles", "Weapons"]),
    mod(19, "en", "en", "Name: Dynamic Campaign Generator\nAuthor: DCG\nDescription: Generates random missions and a persistent front line between sorties.\nFiles: Scripts/DCG/generator.lua, Missions/DCG_template.miz", ["Missions", "Gameplay"]),
    mod(20, "en", "en", "Name: Texture Compression Fix\nAuthor: Perf\nDescription: Recompresses oversized textures to BC7 to cut VRAM use and fix stutter on 8 GB cards.\nFiles: Bazar/Textures/*.dds", ["Fixes", "Graphics"]),
    mod(21, "en", "en", "Name: Spitfire Mk IX Invasion Stripes\nAuthor: WWIIPaint\nDescription: D-Day invasion stripes livery for the Spitfire, historically accurate squadron letters.\nFiles: Liveries/SpitfireLFMkIX/DDay/description.lua", ["Liveries"]),
    mod(22, "en", "en", "Name: Hot Babes Pilots\nAuthor: xx\nDescription: Replaces pilots with sexy half naked women. NSFW content, 18+.\nFiles: Bazar/World/Shapes/pilot_girl.edm", ["Adult", "Characters"], True),
    mod(23, "en", "en", "Name: Carrier Deck Crew\nAuthor: NavalOps\nDescription: Animated deck crew on the aircraft carrier: shooters, handlers and the landing signal officer.\nFiles: Mods/tech/DeckCrew/entry.lua", ["Characters", "Vehicles"]),
    mod(24, "en", "en", "Name: Smoke and Fire Effects\nAuthor: FXLab\nDescription: New particle effects for explosions, burning wrecks and smoke trails.\nFiles: Bazar/Effects/ParticleSystem2/explosion.lua", ["Graphics"]),
    # A French user: French tag names, texts in French AND in English.
    mod(25, "fr", "fr", "Name: Cockpit Mirage 2000C HD\nAuthor: Rafale\nDescription: Textures du cockpit du Mirage 2000C refaites en 4K, instruments plus lisibles.\nFiles: Mods/aircraft/M-2000C/Cockpit/Textures/tableau.dds, entry.lua", ["Aircraft", "Graphics"]),
    mod(26, "fr", "fr", "Name: Carte Normandie Été\nAuthor: Bocage\nDescription: Nouvelles textures de terrain pour la carte Normandie : champs, haies et villages en été.\nFiles: Mods/terrains/Normandy/summer/champs.dds", ["Maps", "Graphics"]),
    mod(27, "fr", "fr", "Name: Missiles MICA améliorés\nAuthor: Armurier\nDescription: Corrige la portée et le guidage des missiles MICA IR et EM, nouveaux modèles 3D.\nFiles: Mods/weapons/MICA/entry.lua", ["Weapons", "Fixes"]),
    mod(28, "fr", "fr", "Name: Sons de moteur réalistes\nAuthor: Audio\nDescription: Remplace les sons des moteurs à réaction par des enregistrements réels : démarrage, ralenti et postcombustion.\nFiles: Sounds/Effects/Aircrafts/Engines/pc.ogg", ["Sound"]),
    mod(29, "fr", "fr", "Name: Livrée Patrouille de France\nAuthor: PAF\nDescription: Livrée de la Patrouille de France pour l'Alpha Jet, avec les numéros de chaque avion.\nFiles: Liveries/AJS37/PAF/description.lua", ["Liveries"]),
    mod(30, "fr", "fr", "Name: Campagne Opération Serval\nAuthor: Mali\nDescription: Une campagne de 10 missions solo au Sahel, briefings en français et météo dynamique.\nFiles: Missions/Campaigns/Serval/S01.miz", ["Missions"]),
    mod(31, "fr", "fr", "Name: Outil de sauvegarde des profils\nAuthor: Outils\nDescription: Petit utilitaire qui sauvegarde vos profils et vos réglages de contrôles avant une mise à jour.\nFiles: backup.exe, backup.ini", ["Utilities"]),
    mod(32, "fr", "fr", "Name: VAB Mk3\nAuthor: Blindés\nDescription: Ajoute le véhicule blindé VAB Mk3 avec tourelle téléopérée et intérieur détaillé.\nFiles: Mods/tech/VAB/entry.lua", ["Vehicles"]),
    mod(33, "fr", "fr", "Name: Interface épurée\nAuthor: UIFR\nDescription: Menus plus clairs, HUD réduit et messages radio déplacés sur le côté de l'écran.\nFiles: UI/theme.lua, Config/View/Server.lua", ["Interface"]),
    mod(34, "fr", "fr", "Name: Correctif vision nocturne\nAuthor: Fix\nDescription: Corrige les JVN trop lumineuses depuis la mise à jour 2.9 et la teinte verte excessive.\nFiles: Bazar/shaders/nvg.fx", ["Fixes", "Graphics"]),
    mod(35, "en", "fr", "Name: Ground Crew Voices\nAuthor: Voices\nDescription: New voice lines for the ground crew: refuel, rearm and startup calls.\nFiles: Sounds/Speech/GroundCrew/*.ogg", ["Sound"]),
    mod(36, "en", "fr", "Name: F-16 Tiger Meet Livery\nAuthor: Tiger\nDescription: NATO Tiger Meet special paint for the F-16C Viper.\nFiles: Liveries/F-16C_50/TigerMeet/description.lua", ["Liveries", "Aircraft"]),
    mod(37, "en", "fr", "Name: Realistic Radar\nAuthor: Sensors\nDescription: Changes radar detection ranges and clutter so that low-flying targets are harder to see.\nFiles: Scripts/Database/Sensors/radar.lua", ["Gameplay"]),
    mod(38, "en", "fr", "Name: Tanker Mission Pack\nAuthor: AAR\nDescription: Eight air-to-air refueling training missions, from basic to night refueling in turbulence.\nFiles: Missions/Training/AAR_01.miz", ["Missions"]),
    mod(39, "fr", "fr", "Name: Personnages féminins (adultes)\nAuthor: x\nDescription: Remplace les pilotes par des personnages féminins dénudés. Contenu explicite, réservé aux adultes.\nFiles: Bazar/World/Shapes/pilote_f.edm", ["Adult", "Characters"], True),
    mod(40, "fr", "fr", "Name: Effets d'explosion\nAuthor: FX\nDescription: Nouvelles explosions, fumées et incendies plus réalistes, particules plus détaillées.\nFiles: Bazar/Effects/ParticleSystem2/explosion.lua", ["Graphics"]),
    mod(41, "fr", "fr", "Name: Porte-avions Charles de Gaulle\nAuthor: Marine\nDescription: Ajoute le porte-avions Charles de Gaulle avec pont animé et catapultes fonctionnelles.\nFiles: Mods/tech/CdG/entry.lua", ["Vehicles"]),
    mod(42, "fr", "fr", "Name: Gameplay hélicoptère réaliste\nAuthor: Rotor\nDescription: Modifie l'effet de sol, l'anneau tourbillonnaire et la consommation de carburant des hélicoptères.\nFiles: Scripts/Aircrafts/Helicopters/flight.lua", ["Gameplay", "Aircraft"]),
    # Other languages, English vocabulary.
    mod(43, "de", "en", "Name: Tornado IDS Cockpit Fix\nAuthor: Luftwaffe\nDescription: Behebt falsche Anzeigen im Cockpit des Tornado und fügt fehlende Schalter hinzu.\nFiles: Mods/aircraft/Tornado/Cockpit/Scripts/devices.lua", ["Aircraft", "Fixes"]),
    mod(44, "de", "en", "Name: Deutschland Karte\nAuthor: Karten\nDescription: Eine große Karte von Norddeutschland mit Städten, Autobahnen und Flugplätzen aus dem Kalten Krieg.\nFiles: Mods/terrains/Germany/terrain.cfg.lua", ["Maps"]),
    mod(45, "de", "en", "Name: Leopard 2A6\nAuthor: Panzer\nDescription: Fügt den Kampfpanzer Leopard 2A6 mit detailliertem Modell und Ketten hinzu.\nFiles: Mods/tech/Leopard2/entry.lua", ["Vehicles"]),
    mod(46, "de", "en", "Name: Funkverkehr Deutsch\nAuthor: Stimmen\nDescription: Deutsche Sprachausgabe für Tower, AWACS und Flügelmann.\nFiles: Sounds/Speech/de/*.ogg", ["Sound"]),
    mod(47, "de", "en", "Name: Bessere Wolken\nAuthor: Wetter\nDescription: Neue Wolkentexturen und schönere Sonnenuntergänge, weniger Flackern.\nFiles: Bazar/shaders/clouds.fx", ["Graphics"]),
    mod(48, "de", "en", "Name: Einsatzpaket Kalter Krieg\nAuthor: Missionen\nDescription: Sechs Einsätze über der Fulda-Lücke mit Briefings auf Deutsch.\nFiles: Missions/ColdWar/Fulda_01.miz", ["Missions"]),
    mod(49, "es", "en", "Name: Pintura Ejército del Aire\nAuthor: Pintor\nDescription: Esquema de pintura del Ejército del Aire para el F/A-18C Hornet.\nFiles: Liveries/FA-18C_hornet/EdA/description.lua", ["Liveries"]),
    mod(50, "es", "en", "Name: Sonidos de armas\nAuthor: Audio\nDescription: Reemplaza los sonidos de cañones, cohetes y misiles con grabaciones reales.\nFiles: Sounds/Effects/Weapons/gun.ogg", ["Sound", "Weapons"]),
    mod(51, "es", "en", "Name: Herramienta de copia\nAuthor: Util\nDescription: Utilidad para copiar y restaurar tus configuraciones de mandos entre instalaciones.\nFiles: copia.exe", ["Utilities"]),
    mod(52, "es", "en", "Name: Mapa Islas Malvinas\nAuthor: Sur\nDescription: Un mapa con las islas, sus bases aéreas y el mar del sur.\nFiles: Mods/terrains/Falklands/terrain.cfg.lua", ["Maps"]),
    mod(53, "es", "en", "Name: Misiles corregidos\nAuthor: Fix\nDescription: Corrige el alcance y la guía de los misiles AIM-120 tras la última actualización.\nFiles: Mods/weapons/AIM120/entry.lua", ["Weapons", "Fixes"]),
    mod(54, "it", "en", "Name: Livrea Frecce Tricolori\nAuthor: PAN\nDescription: Livrea delle Frecce Tricolori per l'MB-339 con i numeri di ogni aereo.\nFiles: Liveries/MB-339/PAN/description.lua", ["Liveries"]),
    mod(55, "it", "en", "Name: Carta Sardegna\nAuthor: Mappe\nDescription: Una nuova mappa della Sardegna con aeroporti, città e montagne.\nFiles: Mods/terrains/Sardinia/terrain.cfg.lua", ["Maps"]),
    mod(56, "it", "en", "Name: Suoni motore Eurofighter\nAuthor: Audio\nDescription: Nuovi suoni registrati per il motore dell'Eurofighter, avvio e postbruciatore.\nFiles: Sounds/Effects/Aircrafts/EF2000/engine.ogg", ["Sound", "Aircraft"]),
    mod(57, "pt", "en", "Name: Pintura FAB\nAuthor: Brasil\nDescription: Pintura da Força Aérea Brasileira para o F-5E Tiger II.\nFiles: Liveries/F-5E-3/FAB/description.lua", ["Liveries"]),
    mod(58, "pt", "en", "Name: Interface limpa\nAuthor: UI\nDescription: Menus mais simples e um HUD menor e mais legível.\nFiles: UI/theme.lua", ["Interface"]),
    mod(59, "ru", "en", "Name: Су-27 кабина HD\nAuthor: Сухой\nDescription: Новые текстуры кабины Су-27 в 4K и исправленные приборы.\nFiles: Mods/aircraft/Su-27/Cockpit/Textures/panel.dds", ["Aircraft", "Graphics"]),
    mod(60, "ru", "en", "Name: Звуки двигателей\nAuthor: Звук\nDescription: Заменяет звуки двигателей реальными записями.\nFiles: Sounds/Effects/Engines/al31.ogg", ["Sound"]),
    mod(61, "ru", "en", "Name: Т-90 танк\nAuthor: Броня\nDescription: Добавляет танк Т-90 с детальной моделью и гусеницами.\nFiles: Mods/tech/T90/entry.lua", ["Vehicles"]),
    mod(62, "pl", "en", "Name: Malowanie Polskich Sił Powietrznych\nAuthor: Malarz\nDescription: Malowanie dla F-16C w barwach polskiej eskadry.\nFiles: Liveries/F-16C_50/PL/description.lua", ["Liveries"]),
    mod(63, "pl", "en", "Name: Kampania Bałtycka\nAuthor: Misje\nDescription: Kampania ośmiu misji nad Morzem Bałtyckim z odprawami po polsku.\nFiles: Missions/Campaigns/Baltic/B01.miz", ["Missions"]),
    mod(64, "ja", "en", "Name: 零戦 塗装パック\nAuthor: 塗装\nDescription: 零戦のための歴史的な塗装を十種類追加します。\nFiles: Liveries/A6M/zero/description.lua", ["Liveries"]),
]


def rep(i, lang, text, category, severity):
    return {"id": "r%02d" % i, "task": "report", "lang": lang, "text": text, "category": category, "severity": severity}


REPORTS = [
    rep(1, "en", "Title: BMM closes when I enable a mod\nThe app disappears without any message as soon as I click the toggle of a big mod. Crash log says: thread 'main' panicked at 'index out of bounds'.", "crash", "high"),
    rep(2, "en", "Title: Game crashes to desktop after installing the F-4E mod\nDCS starts, I get to the menu, then it closes with 'Access violation' in dcs.log. Removing the mod fixes it.", "crash", "high"),
    rep(3, "en", "Title: Typo in the settings page\nThe label says 'Compresion' instead of 'Compression' under Storage.", "ui", "low"),
    rep(4, "en", "Title: Library takes a minute to open\nWith 900 mods the library view needs about 60 seconds to show anything and the fan spins up.", "performance", "medium"),
    rep(5, "en", "Title: Installer fails with error 1603\nThe MSI stops at 80% with error 1603 and rolls back. Cannot install BMM at all.", "install", "high"),
    rep(6, "en", "Title: Two mods overwrite the same cockpit file\nWhen both the F-16 HUD mod and the cockpit texture pack are enabled, one of them silently loses: the HUD is back to default.", "mod_conflict", "medium"),
    rep(7, "en", "Title: Profile switch forgets enabled mods\nAfter switching profiles and back, three mods that were enabled are shown as disabled although the files are still deployed.", "bug", "medium"),
    rep(8, "en", "Title: All my mods were deleted from the game folder\nAfter the last update every mod file disappeared from Saved Games and the backups folder is empty too. Weeks of work lost.", "bug", "critical"),
    rep(9, "en", "Title: Dark theme button text is unreadable\nOn the dark theme the buttons in the repo tab are dark grey on black, I can barely read them.", "ui", "low"),
    rep(10, "en", "Title: Hashing uses 100% CPU for hours\nThe integrity check never finishes on my 200 GB mod folder and the whole PC becomes sluggish.", "performance", "high"),
    rep(11, "en", "Title: Cannot install: missing WebView2\nSetup says WebView2 runtime is missing and the download link in the dialog does nothing.", "install", "medium"),
    rep(12, "en", "Title: Tooltip overlaps the close button\nIn the mod details panel the tooltip covers the X button so I have to move the mouse away first.", "ui", "low"),
    rep(13, "en", "Title: Load order ignored for texture mods\nI moved the livery pack above the texture pack but the game still shows the textures from the lower mod.", "mod_conflict", "medium"),
    rep(14, "en", "Title: Sync from repo downloads everything again\nEvery sync re-downloads 40 GB even though nothing changed on the server.", "bug", "medium"),
    rep(15, "en", "Title: Freeze when dragging a mod\nBMM freezes (not responding) for 20 seconds each time I drag a mod in the list, then it recovers.", "performance", "medium"),
    rep(16, "en", "Title: Suggestion: dark mode for the docs\nIt would be nice if the documentation pages followed the app theme.", "other", "low"),
    rep(17, "en", "Title: Uninstaller left files behind\nAfter uninstalling, C:\\Program Files\\BetterModsManager still has 300 MB of files and a service.", "install", "low"),
    rep(18, "en", "Title: Crash on startup after update 3.2\nBMM shows the splash screen and exits. Every start. Log: 'failed to parse data.json: EOF while parsing'.", "crash", "critical"),
    rep(19, "en", "Title: Question about repo passwords\nHow do I share a repo with only my squadron? Is there a way to set a password?", "other", "low"),
    rep(20, "en", "Title: Mods from two profiles fight over the same files\nProfile A and B share the game folder and enabling a mod in B breaks a mod in A.", "mod_conflict", "high"),
    rep(21, "fr", "Titre : BMM plante au démarrage\nDepuis la mise à jour, BMM se ferme tout seul juste après l'écran de chargement. Le journal indique « panicked at called Option::unwrap() on a None value ».", "crash", "critical"),
    rep(22, "fr", "Titre : Le jeu plante quand j'active le mod Mirage\nDCS se ferme sur le bureau pendant le chargement de la mission, seulement avec le mod activé.", "crash", "high"),
    rep(23, "fr", "Titre : Faute d'orthographe dans le menu\nIl est écrit « Paramêtres » au lieu de « Paramètres » dans la barre latérale.", "ui", "low"),
    rep(24, "fr", "Titre : La bibliothèque est très lente\nAvec 1200 mods, le défilement de la liste saccade et chaque clic met deux secondes à répondre.", "performance", "medium"),
    rep(25, "fr", "Titre : Impossible d'installer BMM\nL'installateur s'arrête avec « erreur 2503 » et annule tout. Même en administrateur.", "install", "high"),
    rep(26, "fr", "Titre : Deux mods modifient le même fichier\nLe mod de livrées et le mod de textures remplacent tous les deux fuselage.dds, et c'est le mauvais qui gagne.", "mod_conflict", "medium"),
    rep(27, "fr", "Titre : Le bouton Exporter ne fait rien\nDans Listes .MM, cliquer sur Exporter n'ouvre aucune fenêtre et rien n'est écrit.", "bug", "medium"),
    rep(28, "fr", "Titre : Tous mes profils ont disparu\nAprès un redémarrage du PC, BMM s'ouvre sans aucun profil ni mod. data.json fait 0 octet.", "bug", "critical"),
    rep(29, "fr", "Titre : Texte blanc sur fond blanc\nAvec le thème clair, les titres des cartes dans Paramètres sont illisibles.", "ui", "low"),
    rep(30, "fr", "Titre : Le calcul des empreintes bloque le PC\nLa vérification d'intégrité occupe tout le disque pendant une heure et le jeu rame.", "performance", "high"),
    rep(31, "fr", "Titre : Demande : pouvoir trier par auteur\nCe serait pratique de trier la bibliothèque par auteur de mod.", "other", "low"),
    rep(32, "fr", "Titre : La désinstallation a laissé des fichiers\nAprès désinstallation il reste un dossier de 200 Mo dans AppData et une entrée dans le menu démarrer.", "install", "low"),
    rep(33, "fr", "Titre : Ordre de chargement ignoré\nJ'ai mis le pack de sons au-dessus mais c'est toujours l'autre mod qui fournit engine.ogg.", "mod_conflict", "medium"),
    rep(34, "fr", "Titre : La synchro retélécharge tout\nChaque synchronisation du dépôt retélécharge 30 Go alors que rien n'a changé.", "bug", "medium"),
    rep(35, "fr", "Titre : Fenêtre figée pendant l'analyse\nPendant le scan du dossier de mods, BMM ne répond plus pendant une minute.", "performance", "medium"),
    rep(36, "fr", "Titre : Question sur le mode jeu\nC'est quoi exactement le mode jeu ? Est-ce que ça ferme BMM quand je lance DCS ?", "other", "low"),
    rep(37, "fr", "Titre : Crash en ouvrant le planificateur\nL'application se ferme d'un coup dès que j'ouvre l'onglet Planificateur. Erreur « stack overflow » dans le journal.", "crash", "high"),
    rep(38, "fr", "Titre : Le menu déroulant sort de l'écran\nSur un écran 1366x768 la liste des profils dépasse en bas et on ne peut pas choisir les derniers.", "ui", "medium"),
    rep(39, "fr", "Titre : Conflit entre deux profils\nLes profils A et B partagent le même dossier de jeu et activer un mod dans B casse un mod de A.", "mod_conflict", "high"),
    rep(40, "fr", "Titre : Les mods activés sont perdus\nAprès avoir changé de profil, trois mods activés apparaissent désactivés alors que les fichiers sont toujours là.", "bug", "medium"),
    rep(41, "de", "Titel: BMM stürzt beim Start ab\nNach dem Update schließt sich BMM sofort nach dem Ladebildschirm. Im Log steht 'panicked at index out of bounds'.", "crash", "critical"),
    rep(42, "de", "Titel: Bibliothek sehr langsam\nMit 800 Mods braucht die Liste 40 Sekunden zum Laden.", "performance", "medium"),
    rep(43, "de", "Titel: Installation schlägt fehl\nDas Setup bricht mit Fehler 1603 ab und macht alles rückgängig.", "install", "high"),
    rep(44, "de", "Titel: Tippfehler in den Einstellungen\nDort steht 'Speicherplaz' statt 'Speicherplatz'.", "ui", "low"),
    rep(45, "es", "Título: BMM se cierra al activar un mod\nLa aplicación desaparece sin mensaje al pulsar el interruptor de un mod grande.", "crash", "high"),
    rep(46, "es", "Título: Dos mods sobrescriben el mismo archivo\nEl pack de texturas y la librea reemplazan el mismo archivo y gana el equivocado.", "mod_conflict", "medium"),
    rep(47, "es", "Título: El instalador no funciona\nEl instalador dice que falta WebView2 y el enlace no hace nada.", "install", "medium"),
    rep(48, "es", "Título: Texto ilegible en el tema oscuro\nLos botones de la pestaña de repositorio son grises sobre negro.", "ui", "low"),
]


def dup(i, lang, text, known, gold):
    return {"id": "d%02d" % i, "task": "dup", "lang": lang, "text": text, "known": known, "dup": gold}


KNOWN_EN = [
    "BMM crashes when enabling a large mod",
    "Library view is slow with hundreds of mods",
    "Installer error 1603 during setup",
    "Dark theme buttons are unreadable in the repo tab",
    "Repo sync downloads everything every time",
    "Profile switch loses the enabled mods",
]
KNOWN_FR = [
    "BMM plante au démarrage après la mise à jour",
    "La bibliothèque est lente avec beaucoup de mods",
    "L'installateur échoue avec l'erreur 2503",
    "Texte illisible avec le thème clair dans Paramètres",
    "La synchronisation du dépôt retélécharge tout",
    "Le bouton Exporter des listes .MM ne fait rien",
]
DUPS = [
    dup(1, "en", "Title: App closes when I toggle a big mod\nAs soon as I switch on a 5 GB mod, BMM vanishes. No error dialog.", KNOWN_EN, 0),
    dup(2, "en", "Title: Scrolling the mod list is very slow\nWith 700 mods, the library needs ages to render and scrolling stutters.", KNOWN_EN, 1),
    dup(3, "en", "Title: Setup rolls back with 1603\nThe MSI fails near the end with error 1603.", KNOWN_EN, 2),
    dup(4, "en", "Title: Can't read buttons on the dark theme\nIn Server Repo, button text is almost black on black.", KNOWN_EN, 3),
    dup(5, "en", "Title: Every sync re-downloads the whole repo\nNothing changed on the server but 30 GB are fetched again.", KNOWN_EN, 4),
    dup(6, "en", "Title: Mods get disabled after changing profile\nI switch profile and come back: my enabled mods show as disabled.", KNOWN_EN, 5),
    dup(7, "en", "Title: Tooltip hides the close button\nIn mod details the tooltip covers the X.", KNOWN_EN, None),
    dup(8, "en", "Title: Scheduler task never runs at night\nMy nightly backup task did not fire for a week.", KNOWN_EN, None),
    dup(9, "en", "Title: Hashing never finishes\nIntegrity check runs for hours on 200 GB.", KNOWN_EN, None),
    dup(10, "en", "Title: Uninstall leaves 300 MB behind\nProgram Files still has BMM files after uninstall.", KNOWN_EN, None),
    dup(11, "en", "Title: Crash right after enabling the Harrier pack\nToggling the pack on makes BMM exit immediately.", KNOWN_EN, 0),
    dup(12, "en", "Title: Wrong mod wins a file conflict\nTwo mods replace the same texture and the lower one wins.", KNOWN_EN, None),
    dup(13, "fr", "Titre : BMM se ferme dès l'ouverture\nDepuis la dernière version, l'application quitte juste après le logo.", KNOWN_FR, 0),
    dup(14, "fr", "Titre : Liste des mods très lente\nAvec 900 mods, afficher la bibliothèque prend une minute.", KNOWN_FR, 1),
    dup(15, "fr", "Titre : Erreur 2503 à l'installation\nImpossible d'installer : erreur 2503 puis annulation.", KNOWN_FR, 2),
    dup(16, "fr", "Titre : Thème clair illisible\nLes titres des cartes des paramètres sont blancs sur blanc.", KNOWN_FR, 3),
    dup(17, "fr", "Titre : Le dépôt se retélécharge en entier\nChaque synchro reprend les 40 Go depuis zéro.", KNOWN_FR, 4),
    dup(18, "fr", "Titre : Exporter la liste ne marche pas\nLe bouton Exporter dans Listes .MM n'ouvre rien.", KNOWN_FR, 5),
    dup(19, "fr", "Titre : Le planificateur ne lance rien\nMa tâche de 3 h du matin ne s'exécute jamais.", KNOWN_FR, None),
    dup(20, "fr", "Titre : Question sur le mode jeu\nQue fait le mode jeu exactement ?", KNOWN_FR, None),
    dup(21, "fr", "Titre : Conflit de fichiers entre deux mods\nLe mauvais mod gagne sur fuselage.dds.", KNOWN_FR, None),
    dup(22, "fr", "Titre : Le disque tourne à fond pendant la vérification\nLa vérification d'intégrité bloque le PC.", KNOWN_FR, None),
    dup(23, "fr", "Titre : Crash au lancement depuis la 3.2\nBMM s'arrête tout de suite au démarrage.", KNOWN_FR, 0),
    dup(24, "fr", "Titre : Faute dans la barre latérale\nIl est écrit Paramêtres.", KNOWN_FR, None),
]


def lang(i, code, text):
    return {"id": "l%02d" % i, "task": "lang", "lang": code, "text": text}


LANGS_ONLY = [
    lang(1, "en", "Unpack the archive into your Saved Games folder and enable the mod in the manager."),
    lang(2, "fr", "Décompressez l'archive dans le dossier Saved Games puis activez le mod dans le gestionnaire."),
    lang(3, "de", "Entpacke das Archiv in den Ordner Saved Games und aktiviere die Mod im Manager."),
    lang(4, "es", "Descomprime el archivo en la carpeta Saved Games y activa el mod en el gestor."),
    lang(5, "it", "Estrai l'archivio nella cartella Saved Games e attiva la mod nel gestore."),
    lang(6, "pt", "Extraia o arquivo na pasta Saved Games e ative o mod no gerenciador."),
    lang(7, "ru", "Распакуйте архив в папку Saved Games и включите мод в менеджере."),
    lang(8, "pl", "Rozpakuj archiwum do folderu Saved Games i włącz moda w menedżerze."),
    lang(9, "ja", "アーカイブをSaved Gamesフォルダーに展開し、マネージャーでMODを有効にしてください。"),
    lang(10, "zh", "将压缩包解压到 Saved Games 文件夹，然后在管理器中启用该模组。"),
    lang(11, "en", "Requires the latest open beta. Known issue: the left MFD flickers at night."),
    lang(12, "fr", "Nécessite la dernière bêta ouverte. Problème connu : l'écran gauche clignote la nuit."),
    lang(13, "de", "Benötigt die neueste offene Beta. Bekanntes Problem: das linke MFD flackert nachts."),
    lang(14, "es", "Requiere la última beta abierta. Problema conocido: la pantalla izquierda parpadea de noche."),
    lang(15, "it", "Richiede l'ultima beta aperta. Problema noto: il display sinistro sfarfalla di notte."),
    lang(16, "pt", "Requer a última beta aberta. Problema conhecido: a tela esquerda pisca à noite."),
    lang(17, "ru", "Требуется последняя открытая бета. Известная проблема: левый дисплей мерцает ночью."),
    lang(18, "pl", "Wymaga najnowszej otwartej bety. Znany problem: lewy wyświetlacz migocze w nocy."),
    lang(19, "fr", "Livrée 4K"),
    lang(20, "en", "v1.2 changelog: fixed textures"),
]


# ── BLIND set ────────────────────────────────────────────────────────────────────────────────
# Written AFTER the keyword lists and the question wording in ai_laya.rs were frozen, and never
# used to tune them: the figures on it are the honest ones. It also uses a vocabulary of tags
# BMM has no concept for (eras, « Multiplayer », « Cosmetic »…), where only the model's
# judgement can help — the case keyword evidence cannot cover.
VOCAB["era"] = ["WWII", "Cold War", "Modern", "Helicopters", "Naval", "Multiplayer", "Training", "Realism", "Cosmetic", "Performance"]


def bmod(i, lang, vocab, text, tags, nsfw=False):
    return {"id": "bm%02d" % i, "task": "mod", "lang": lang, "vocab": vocab, "text": text, "tags": tags, "nsfw": nsfw, "blind": True}


BLIND_MODS = [
    bmod(1, "en", "era", "Name: P-51D Mustang Sound Overhaul\nDescription: Merlin engine recordings for the P-51D, taken from a restored warbird.\nFiles: Sounds/Effects/Aircrafts/P-51D/merlin.ogg", ["WWII"]),
    bmod(2, "en", "era", "Name: MiG-21 Fishbed Upgrade\nDescription: Improves the 1970s MiG-21bis: RSBN navigation, better radar scope and period-correct cockpit labels.\nFiles: Mods/aircraft/MiG-21bis/Cockpit/labels.lua", ["Cold War"]),
    bmod(3, "en", "era", "Name: F-35A Lightning II\nDescription: A fifth-generation stealth fighter with sensor fusion and a modern glass cockpit.\nFiles: Mods/aircraft/F-35A/entry.lua", ["Modern"]),
    bmod(4, "en", "era", "Name: UH-1H Door Gunner AI\nDescription: The Huey's door gunners now pick targets on their own and call them out.\nFiles: Mods/aircraft/UH-1H/Scripts/gunner.lua", ["Helicopters", "Realism"]),
    bmod(5, "en", "era", "Name: Arleigh Burke Destroyer\nDescription: Adds a guided-missile destroyer with working SAM launchers and a helicopter deck.\nFiles: Mods/tech/DDG-51/entry.lua", ["Naval", "Modern"]),
    bmod(6, "en", "era", "Name: Server Slot Blocker\nDescription: For dedicated server admins: reserves slots for squadron members and kicks players with the wrong mods.\nFiles: Scripts/Hooks/slotblock.lua", ["Multiplayer"]),
    bmod(7, "en", "era", "Name: Carrier Landing School\nDescription: Twelve lessons with an instructor voice that teach case I and case III recoveries step by step.\nFiles: Missions/Training/CV_01.miz", ["Training", "Naval"]),
    bmod(8, "en", "era", "Name: Real G-Effects\nDescription: Stronger blackouts and redouts, pilot fatigue after sustained high-G turns.\nFiles: Config/G-effects.lua", ["Realism"]),
    bmod(9, "en", "era", "Name: Shiny Canopy Reflections\nDescription: Purely visual: nicer reflections on the canopy glass. No effect on gameplay.\nFiles: Bazar/shaders/canopy.fx", ["Cosmetic"]),
    bmod(10, "en", "era", "Name: FPS Booster Config\nDescription: Tuned graphics.lua that raises frame rates on mid-range PCs by trimming draw distance and shadow cascades.\nFiles: Config/graphics.lua", ["Performance"]),
    bmod(11, "en", "era", "Name: Bf 109 K-4 Luftwaffe Skins\nDescription: Twenty historical paint schemes of JG 27 and JG 53 from 1944-45.\nFiles: Liveries/Bf-109K-4/JG27/description.lua", ["WWII", "Cosmetic"]),
    bmod(12, "en", "era", "Name: Mi-24P Hind Checklist Trainer\nDescription: Interactive startup checklist for the Hind gunship, with hints for every switch.\nFiles: Missions/Training/Mi24_start.miz", ["Helicopters", "Training"]),
    bmod(13, "en", "era", "Name: Fulda Gap 1985\nDescription: A dynamic NATO vs Warsaw Pact campaign on the inner German border, 1985.\nFiles: Missions/Campaigns/Fulda85/F01.miz", ["Cold War"]),
    bmod(14, "en", "era", "Name: Kiowa Warrior\nDescription: Adds the OH-58D scout helicopter with its mast-mounted sight.\nFiles: Mods/aircraft/OH58D/entry.lua", ["Helicopters", "Modern"]),
    bmod(15, "en", "era", "Name: Coop Mission Pack 4 Players\nDescription: Six missions built for four human pilots flying together online.\nFiles: Missions/MP/coop_01.miz", ["Multiplayer"]),
    bmod(16, "en", "era", "Name: Low VRAM Textures\nDescription: Half-resolution terrain textures so the game fits into 4 GB video cards without stutters.\nFiles: Bazar/Terrain/lowres/*.dds", ["Performance"]),
    bmod(17, "en", "era", "Name: Battleship Yamato\nDescription: The Imperial Japanese Navy battleship, with 46 cm guns and AA batteries, for Pacific missions.\nFiles: Mods/tech/Yamato/entry.lua", ["Naval", "WWII"]),
    bmod(18, "en", "era", "Name: Realistic Radio Range\nDescription: Radios now fade with distance and terrain blocks line of sight.\nFiles: Scripts/radio.lua", ["Realism"]),
    bmod(19, "fr", "era", "Name: Spitfire - Sons Merlin\nDescription: Enregistrements du moteur Merlin d'un Spitfire restauré de 1943.\nFiles: Sounds/Effects/Spitfire/merlin.ogg", ["WWII"]),
    bmod(20, "fr", "era", "Name: Frégate FREMM\nDescription: Ajoute la frégate multi-missions FREMM de la Marine nationale avec son hélicoptère.\nFiles: Mods/tech/FREMM/entry.lua", ["Naval", "Modern"]),
    bmod(21, "fr", "era", "Name: École de voltige\nDescription: Leçons guidées de voltige : tonneau, boucle, renversement, avec un moniteur.\nFiles: Missions/Training/voltige_01.miz", ["Training"]),
    bmod(22, "fr", "era", "Name: Gazelle - panne réaliste\nDescription: Pannes moteur et hydrauliques réalistes pour la Gazelle, selon l'usure.\nFiles: Mods/aircraft/SA342/failures.lua", ["Helicopters", "Realism"]),
    bmod(23, "fr", "era", "Name: Serveur - messages de bienvenue\nDescription: Affiche un message de bienvenue et les règles du serveur aux joueurs qui se connectent.\nFiles: Scripts/Hooks/welcome.lua", ["Multiplayer"]),
    bmod(24, "fr", "era", "Name: Mirage III - années 60\nDescription: Le Mirage IIIE tel qu'en 1964, avec ses instruments d'époque.\nFiles: Mods/aircraft/MirageIII/entry.lua", ["Cold War"]),
    bmod(25, "fr", "era", "Name: Ombres allégées\nDescription: Réduit la qualité des ombres lointaines pour gagner 15 images par seconde.\nFiles: Config/shadows.lua", ["Performance"]),
    bmod(26, "fr", "era", "Name: Casques colorés\nDescription: Change seulement la couleur des casques des pilotes. Aucun effet sur le jeu.\nFiles: Bazar/World/Shapes/helmet.dds", ["Cosmetic"]),
    bmod(27, "de", "era", "Name: Stuka Sirenen\nDescription: Die Jericho-Trompete der Ju 87 mit originalen Aufnahmen aus dem Zweiten Weltkrieg.\nFiles: Sounds/Effects/Ju87/siren.ogg", ["WWII"]),
    bmod(28, "de", "era", "Name: Tiger Hubschrauber\nDescription: Fügt den Eurocopter Tiger mit Visier und Raketen hinzu.\nFiles: Mods/aircraft/Tiger/entry.lua", ["Helicopters", "Modern"]),
    bmod(29, "es", "era", "Name: Portaaviones Juan Carlos I\nDescription: Buque de asalto anfibio de la Armada con cubierta para Harrier y helicópteros.\nFiles: Mods/tech/JCI/entry.lua", ["Naval", "Modern"]),
    bmod(30, "es", "era", "Name: Más FPS\nDescription: Configuración para ganar rendimiento en ordenadores modestos.\nFiles: Config/graphics.lua", ["Performance"]),
    # Known-concept vocabulary, texts written after the freeze.
    bmod(31, "en", "en", "Name: A-10C Warthog Sharkmouth\nDescription: The famous shark mouth paint for the 23rd Fighter Group Warthogs.\nFiles: Liveries/A-10C/Shark/description.lua", ["Liveries", "Aircraft"]),
    bmod(32, "en", "en", "Name: Persian Gulf Night Lights\nDescription: Brighter city lights and highways at night over the Strait of Hormuz.\nFiles: Mods/terrains/PersianGulf/night.lua", ["Maps", "Graphics"]),
    bmod(33, "en", "en", "Name: Laser Guided Rockets\nDescription: APKWS rockets with laser guidance for the AH-64 and the A-10.\nFiles: Mods/weapons/APKWS/entry.lua", ["Weapons"]),
    bmod(34, "en", "en", "Name: Trackir Profile Pack\nDescription: Head tracking curves for twelve modules, plus a small launcher that switches them.\nFiles: tools/profiles.exe", ["Utilities"]),
    bmod(35, "fr", "fr", "Name: Hélico Puma - sons\nDescription: Nouveaux bruits de rotor et de turbine pour le Puma.\nFiles: Sounds/Effects/Puma/rotor.ogg", ["Sound"]),
    bmod(36, "fr", "fr", "Name: Scénarios Balkans\nDescription: Huit missions d'interdiction au-dessus des Balkans, briefings en français.\nFiles: Missions/Balkans/B01.miz", ["Missions"]),
]

BLIND_REPORTS = [
    {"id": "br%02d" % i, "task": "report", "lang": lang, "text": text, "category": c, "severity": sv, "blind": True}
    for i, (lang, text, c, sv) in enumerate([
        ("en", "Title: Crash when opening Modpacks\nBMM closes instantly each time I click Modpacks in the sidebar.", "crash", "high"),
        ("en", "Title: Search box ignores accents\nTyping 'theme' does not find 'thème' in the palette.", "bug", "low"),
        ("en", "Title: Activation of a 30 GB profile takes 25 minutes\nThe disk is at 100 % the whole time.", "performance", "medium"),
        ("en", "Title: Update installer asks for admin every time\nEach update pops UAC twice and then fails with error 5.", "install", "high"),
        ("en", "Title: Terrain mod and texture mod replace terrain.cfg.lua\nThe last enabled one always wins and breaks the other.", "mod_conflict", "medium"),
        ("en", "Title: Close button hidden behind the title bar\nOn a 125 % scaled screen the X of the settings dialog is cut off.", "ui", "low"),
        ("en", "Title: My backup folder was wiped\nAfter restoring a snapshot, the Backups folder is empty and the originals are gone.", "bug", "critical"),
        ("en", "Title: Could you add a portable mode?\nI would like to run BMM from a USB stick.", "other", "low"),
        ("en", "Title: BMM will not start after Windows update\nDouble-clicking does nothing; the log says 'WebView2 failed to initialize'.", "crash", "critical"),
        ("en", "Title: Modlist export writes an empty file\nThe .mm file is 0 KB although I have 40 mods.", "bug", "medium"),
        ("fr", "Titre : Plantage en ouvrant les Modpacks\nBMM se ferme d'un coup quand je clique sur Modpacks.", "crash", "high"),
        ("fr", "Titre : L'activation est très lente\nActiver un profil de 20 Go prend 15 minutes et le PC rame.", "performance", "medium"),
        ("fr", "Titre : La mise à jour demande les droits admin puis échoue\nErreur 5 après la fenêtre UAC.", "install", "high"),
        ("fr", "Titre : Deux mods de terrain se remplacent\nLe dernier activé écrase terrain.cfg.lua de l'autre.", "mod_conflict", "medium"),
        ("fr", "Titre : Texte coupé dans la barre latérale\nLe mot « Planificateur » est tronqué.", "ui", "low"),
        ("fr", "Titre : Mes sauvegardes ont été effacées\nAprès une restauration, le dossier Backups est vide.", "bug", "critical"),
        ("fr", "Titre : Idée : un mode portable\nPouvoir lancer BMM depuis une clé USB.", "other", "low"),
        ("fr", "Titre : BMM ne démarre plus\nDepuis la mise à jour de Windows, rien ne se passe au lancement.", "crash", "critical"),
        ("de", "Titel: Absturz beim Öffnen der Modpacks\nBMM schließt sich sofort.", "crash", "high"),
        ("es", "Título: La activación es muy lenta\nActivar un perfil de 20 GB tarda 15 minutos.", "performance", "medium"),
    ], start=1)
]

_KB = ["Crash when opening the Modpacks screen", "Profile activation is very slow on big profiles", "Update fails with error 5 after UAC", "Close button cut off on scaled screens", "Backups folder emptied after a restore", "Terrain mods overwrite each other"]
BLIND_DUPS = [
    {"id": "bd%02d" % i, "task": "dup", "lang": lang, "text": text, "known": _KB, "dup": gold, "blind": True}
    for i, (lang, text, gold) in enumerate([
        ("en", "Title: Modpacks tab closes the app\nClicking Modpacks makes BMM disappear.", 0),
        ("en", "Title: Enabling a 40 GB profile takes forever\nHalf an hour of disk at 100 %.", 1),
        ("en", "Title: Error 5 when updating\nThe updater fails right after the admin prompt.", 2),
        ("en", "Title: Settings dialog X is not visible at 150 % scaling\nI cannot close it.", 3),
        ("en", "Title: Scheduler ignores my weekly task\nNothing ran on Sunday.", None),
        ("en", "Title: Dark theme too dark\nCould the background be lighter?", None),
        ("fr", "Titre : L'onglet Modpacks fait planter BMM\nUn clic et l'application se ferme.", 0),
        ("fr", "Titre : Sauvegardes disparues après restauration\nLe dossier Backups est vide.", 4),
        ("fr", "Titre : Deux terrains se marchent dessus\nterrain.cfg.lua est remplacé par le dernier.", 5),
        ("fr", "Titre : Le planificateur ne lance pas ma tâche\nRien ne s'est exécuté dimanche.", None),
        ("fr", "Titre : Faute dans les réglages\nIl manque un accent.", None),
        ("fr", "Titre : Question sur les dépôts\nComment partager un dépôt avec mon escadron ?", None),
    ], start=1)
]


def main():
    items = MODS + REPORTS + DUPS + LANGS_ONLY + BLIND_MODS + BLIND_REPORTS + BLIND_DUPS
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids)), "duplicate id"
    out = {
        "note": "Hand-labelled BMM-shaped evaluation set for the Laya pipeline. Built by scripts/laya/eval_set.py; scored by measure_pipeline in src-tauri/src/commands/ai_embedded.rs.",
        "vocab": VOCAB,
        "items": items,
    }
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(root, "src-tauri", "tests", "laya_eval.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    by = {}
    for i in items:
        by[i["task"]] = by.get(i["task"], 0) + 1
    print(path, len(items), by)


if __name__ == "__main__":
    main()

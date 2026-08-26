# 📦 Emballer ou lier — et le bundle en un seul fichier

*🇬🇧 [English version](Embed_Or_Link_EN.md).*

Chaque catalogue de BMM est un `catalog.json` qui liste des choses vivant quelque part.
**Où** est désormais une décision que tu prends **par entrée**, dans tous les constructeurs,
et les deux mêmes mots veulent dire la même chose partout :

| Choix | Ce qui se passe |
|---|---|
| **Emballer le fichier** | BMM écrit le fichier à côté de `catalog.json` et l'entrée le nomme, en relatif. |
| **Mettre un lien** | L'entrée porte une adresse `https://` et rien n'est écrit pour elle. |

Un catalogue peut mélanger les deux librement. C'est tout l'intérêt : emballer les trois
petites automatisations, lier celle de 90 Mo que quelqu'un héberge déjà, dans un seul
document.

---

## Pourquoi du relatif

L'adresse d'une entrée emballée est un simple nom de fichier — `Nightly-tidy.bmmpa`, pas
`https://ton-hebergeur/Nightly-tidy.bmmpa`. Le lecteur la résout par rapport à l'endroit d'où
il a récupéré le catalogue, donc le dossier continue de fonctionner s'il est déplacé, copié
ou forké. Être forké est la vie normale d'un dossier sur GitHub, et un catalogue qui nomme son
propre hébergeur cesse de marcher à cet instant-là.

Chaque constructeur propose encore une **adresse où les fichiers vivront**, et vide est
presque toujours la bonne réponse. Elle ne préfixe que les entrées **emballées** — une entrée
liée a déjà dit où elle vit, et la préfixer réécrirait l'adresse de quelqu'un d'autre en une
adresse chez toi.

---

## Le bundle

Coche **Publier en UN seul fichier** et tu obtiens un `.bmmbundle` au lieu d'un dossier : le
`catalog.json` et chaque fichier qu'il emballe, en une seule chose à envoyer. Rien à héberger,
aucune adresse à maintenir en vie.

Trois choses à savoir :

- **C'est toi qui choisis où il va.** Les fichiers sont écrits dans un dossier de travail que
  personne ne voit, le bundle est enregistré là où tu dis, et le dossier de travail est
  supprimé ensuite — rien n'est laissé nulle part.
- **Seul ce que le catalogue utilise est emballé.** Le bundle contient `catalog.json` et
  exactement les fichiers que ses entrées nomment. Pas ce qui traînait dans le dossier.
- **C'est un zip avec sa propre extension.** Renomme-le en `.zip` et n'importe quel outil
  l'ouvre. L'extension existe pour qu'on distingue un catalogue d'une archive de mod d'un
  coup d'œil, et pour que double-cliquer dessus ne veuille jamais dire « décompresse ça dans
  mes téléchargements ».

Un catalogue qui n'a que des liens n'a rien à emballer, donc l'option se désactive toute
seule — une archive contenant un seul `catalog.json` n'est pas un bundle, c'est un
`catalog.json` qu'il faut d'abord dézipper.

### En suivre un

Chaque écran de catalogue qui peut suivre une adresse peut aussi ouvrir un bundle : *Ouvrir un
fichier bundle…*. Il est vérifié **à l'ouverture** et pas à la prochaine lecture, donc un
fichier qui n'est pas un catalogue échoue tout de suite, avec la raison.

Une entrée dans un bundle peut quand même être un lien. Les deux sortes sont distinguées
entrée par entrée avant que l'une ou l'autre soit suivie, et tout ce qui n'est ni l'une ni
l'autre — un schéma, un chemin absolu, un `..` — est refusé plutôt que réparé.

---

## Quels constructeurs l'ont

| Catalogue | Où | Emballer | Lier | Bundle |
|---|---|---|---|---|
| Automatisations | Planificateur → Fichiers… → *Mes catalogues…* | oui | oui | oui |
| Plugins | Plugins → Mes catalogues → *.bmmbundle…* | oui | oui | oui |
| Tutoriels | Hub des tutoriels → *Catalogues* | oui | oui | oui |
| Thèmes | Galerie de thèmes → *Catalogues…* | oui¹ | oui | oui |
| Listes de mods | Listes de mods → *Catalogues…* | oui | oui | oui |
| Modpacks | Modpacks → Catalogues → *Publier* | oui² | oui | s.o.² |
| Apps | — | non³ | oui | non³ |

¹ Les thèmes ont un troisième choix, **Le garder dans le catalogue** — le corps écrit en
ligne, ce que contient tout catalogue de thèmes publié jusqu'ici, et toujours le défaut.
*Emballer* écrit un `.bmmtheme` à côté du catalogue à la place.

² Un `.cbmp` **est** déjà un bundle : il porte ses packs. Ce qui lui manquait, c'étaient les
liens.

³ Une entrée d'app pointe vers un binaire d'installation. BMM n'en a jamais de copie, donc il
n'y a rien à emballer — et le faire marcher voudrait dire exécuter un binaire sorti d'une
archive que quelqu'un t'a envoyée, ce qui est une autre question que d'y lire un document
JSON.

---

## Pour les plugins, le champ adresse **est** le choix

Il n'y a pas de contrôle en plus sur une ligne de plugin. Remplis l'adresse et l'entrée est
**liée** ; laisse-la vide et le plugin est **emballé**, s'il est installé ici. Chaque ligne
dit laquelle des trois situations elle est :

- **Emballer le fichier** — installé ici, donc une adresse vide veut dire « emballe-le »
- **Mettre un lien** — une adresse est remplie
- **pas de source** — installé nulle part et sans adresse, ce qui publierait une entrée que
  personne ne peut suivre

---

## Ce que voit le lecteur

Rien ne change pour la personne qui suit ton catalogue. Une entrée emballée est récupérée à
côté du catalogue, ou lue dans le bundle ; une entrée liée est récupérée à son adresse. Les
deux finissent sur le même écran de revue, et rien ne s'installe sans avoir été lu d'abord.

Si tu le publies sur BetterCommunity, son outil **Inspect a BMM file** lit un bundle et dit
combien d'entrées sont embarquées, combien viennent d'ailleurs, quels hôtes celles-là
utilisent, et si l'archive contient réellement tout ce que le catalogue nomme.

---

## Voir aussi

- [Catalogues d'automatisations](Automation_Catalog_Guide_FR.md)
- [Catalogues de plugins](Plugin_Catalog_Guide_FR.md)
- [Catalogues de thèmes](Theme_Catalog_Guide_FR.md)
- [Le format du catalogue de presets](preset-catalog-format_FR.md)
- [Le format de l'index de catalogues](catalog-index-format_FR.md)

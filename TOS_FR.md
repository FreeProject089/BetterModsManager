# Better Mods Manager (BMM) - Conditions d'Utilisation (TOS)

Les présentes Conditions d'Utilisation (« Conditions ») constituent une entente légale entre vous et l'équipe de développement de Better Mods Manager pour l'utilisation de Better Mods Manager (« Logiciel »). Better Mods Manager est un **logiciel libre et open-source** distribué sous licence GPL‑3.0 — ces Conditions décrivent simplement un usage acceptable et l'absence de garantie ; elles ne restreignent pas les libertés accordées par la GPL‑3.0.

## 1. CONCESSION DE LICENCE
Better Mods Manager est un logiciel libre sous licence **GNU General Public License v3.0 (GPL-3.0)**. Vous êtes encouragé à étudier, modifier et redistribuer le Logiciel conformément aux termes de la licence GPL-3.0. Une copie du texte complet de la licence est disponible dans le fichier LICENSE fourni avec ce Logiciel.

## 2. EXCLUSION DE GARANTIE "TEL QUEL"
LE LOGICIEL EST FOURNI "TEL QUEL", SANS GARANTIE D'AUCUNE SORTE, EXPRESSE OU IMPLICITE, INCLUANT, MAIS SANS S'Y LIMITER, LES GARANTIES DE QUALITÉ MARCHANDE, D'ADÉQUATION À UN USAGE PARTICULIER ET D'ABSENCE DE CONTREFAÇON. LES AUTEURS OU TITULAIRES DE DROIT D'AUTEUR NE SERONT EN AUCUN CAS TENUS POUR RESPONSABLES DE TOUTE RÉCLAMATION, DOMMAGE OU AUTRE RESPONSABILITÉ, QUE CE SOIT DANS LE CADRE D'UNE ACTION CONTRACTUELLE, DÉLICTUELLE OU AUTRE, DÉCOULANT DU LOGICIEL OU DE SON UTILISATION.

## 3. RESPONSABILITÉ ET RISQUES DE L'UTILISATEUR
Better Mods Manager est conçu pour gérer et injecter des modifications dans vos fichiers de jeu. **LE MODDING DE VOS FICHIERS DE JEU COMPORTE DES RISQUES INHÉRENTS.**
- Vous reconnaissez que BMM modifiera, déplacera ou remplacera des fichiers au sein de vos installations de jeu.
- Bien que BMM inclue des fonctions de sécurité telles qu'un système de sauvegarde, il n'y a aucune garantie contre la perte de données ou la corruption du jeu.
- **Vous êtes seul responsable** de toute modification effectuée par le Logiciel et de toute conséquence sur l'installation de votre jeu, le statut de votre compte en ligne ou la stabilité de votre système.

## 4. SYSTÈME DE PLUGINS
Better Mods Manager inclut un système de Plugins permettant aux utilisateurs d'installer, de créer et de partager des extensions (fichiers `.bmmplug`) qui étendent les fonctionnalités du Logiciel.

- **Installation de plugins :** Vous pouvez installer des plugins depuis le catalogue officiel BMM ou depuis des fichiers `.bmmplug` locaux. En installant un plugin tiers, vous acceptez l'entière responsabilité de son contenu et de son comportement. L'équipe BMM n'audite pas, n'approuve pas et ne garantit pas la sécurité des plugins soumis par la communauté.
- **Création et exportation de plugins :** Vous pouvez créer des plugins locaux et les exporter sous forme d'archives `.bmmplug`. Vous êtes seul responsable du contenu que vous distribuez. Vous ne devez pas inclure de code malveillant, d'actifs non autorisés ou de contenu portant atteinte aux droits de propriété intellectuelle de tiers dans tout plugin que vous publiez ou partagez.
- **Catalogue de plugins :** Les plugins listés dans le catalogue officiel BMM ont été soumis par des contributeurs de la communauté. Leur présence dans le catalogue ne constitue pas un aval de l'équipe BMM. L'équipe BMM se réserve le droit de retirer tout plugin du catalogue à tout moment et sans préavis.

## 5. API PLUGIN LOCALE
Better Mods Manager inclut un serveur HTTP local optionnel qui s'exécute sur votre machine (port par défaut **51274**) et permet à des scripts et outils externes d'interagir avec le Logiciel.

- **Périmètre :** L'API Plugin est un service strictement local. Elle se lie exclusivement à `127.0.0.1` (localhost) et n'est pas accessible depuis Internet ou d'autres appareils de votre réseau, sauf si vous configurez explicitement une redirection de port ou un proxy (ce qui se fait entièrement à vos propres risques).
- **Jeton d'API :** L'accès à l'API Plugin est protégé par un jeton généré par BMM. **Vous êtes seul responsable de la confidentialité de ce jeton.** Ne partagez pas votre jeton publiquement, ne le commettez pas dans des dépôts de contrôle de version et ne l'incluez dans aucun fichier susceptible d'être exposé à des tiers non autorisés.
- **Scripts tiers :** Tout script, application ou outil utilisant votre jeton d'API pour interagir avec BMM agit en votre nom. Vous acceptez l'entière responsabilité des actions effectuées par tout logiciel tiers auquel l'accès à l'API Plugin a été accordé.
- **Sécurité :** L'équipe BMM n'est pas responsable des dommages, pertes de données ou accès non autorisés résultant d'une mauvaise utilisation de l'API Plugin ou de l'exposition de votre jeton d'API.

## 6. GÉNÉRATEUR DE SCRIPTS ET EXPORT ZIP
Better Mods Manager inclut un Générateur de Scripts qui produit des extraits de code et des archives de projets complets (fichiers ZIP) pour interagir avec l'API Plugin dans différents langages de programmation.

- **Code généré :** Les scripts générés par le Générateur de Scripts sont fournis à titre pratique. Vous êtes responsable de la révision, de la sécurisation et du déploiement sécurisé de tout code généré avant de l'utiliser dans un environnement de production ou partagé.
- **Fichiers `.env` et sécurité du jeton :** Lorsque l'option "Utiliser .env pour le jeton" est activée, le projet ZIP exporté inclut un fichier `.env` contenant votre jeton d'API. Un fichier `.gitignore` est inclus pour éviter le téléversement accidentel de ce fichier vers des dépôts publics. **Vous êtes seul responsable de vous assurer que les fichiers `.env` ne sont jamais exposés publiquement.** L'équipe BMM n'accepte aucune responsabilité pour les conséquences découlant d'une exposition accidentelle du jeton.
- **Aucune garantie sur les scripts générés :** Les scripts générés sont fournis "tels quels" à des fins éducatives et d'automatisation. L'équipe BMM ne garantit pas leur adéquation à un usage particulier ou leur compatibilité avec votre environnement.

## 7. DÉPÔTS DE SERVEURS ET MODÉRATION
Better Mods Manager offre la possibilité de se connecter à des dépôts de serveurs hébergés par la communauté ou officiels.
- Les administrateurs de tout serveur de dépôt, y compris les serveurs officiels de Better Mods Manager, se réservent le droit de bannir ou de restreindre l'accès à tout utilisateur ou adresse IP à tout moment et pour n'importe quelle raison, notamment en cas d'abus, d'utilisation excessive de la bande passante ou de violation des directives de la communauté.
- Le contournement d'un bannissement permanent à l'aide de comptes alternatifs, de VPN ou de services proxy est strictement interdit.

## 8. VIE PRIVÉE ET DONNÉES
Better Mods Manager respecte votre vie privée :
- Aucune donnée personnelle n'est collectée ou transmise à des serveurs externes sans votre consentement explicite.
- **Télémétrie optionnelle (opt‑in) :** BMM inclut une fonction d'analytique optionnelle **DÉSACTIVÉE par défaut**. Si — et seulement si — vous l'activez explicitement, BMM envoie des données d'usage et de performance **anonymes et agrégées** (par ex. Creator ID anonyme, profil matériel/système, quelles vues/fonctions/modals vous utilisez, FPS/temps de frame/jank/mémoire, débit du benchmark, **décomptes** de contenu, et une localisation **approximative** basée sur l'IP, jamais précise) vers un tableau de bord BMM auto‑hébergé. Cela n'inclut jamais le contenu de vos fichiers/mods ni les valeurs que vous saisissez. Vous pouvez la désactiver à tout moment, exporter ou effacer le cache local, et **demander l'effacement de n'importe quel paquet de données** (appliqué après une vérification obligatoire de ≤72h, ou immédiatement sur approbation d'un admin). Les données collectées sont purgées automatiquement après une période de conservation. Voir **PRIVACY_FR.md** pour les détails.
- **Rapports de crash :** En cas de bug de l'application, un rapport de diagnostic est généré localement. Vous pouvez choisir de partager ce rapport avec les développeurs sur Discord pour nous aider à corriger le problème.
- **Mises à jour automatiques :** Si activé, le Logiciel vérifiera les nouvelles versions sur GitHub.
- **API Plugin :** Tout le trafic de l'API Plugin est local à votre machine. Aucune requête API, aucun jeton ni aucune donnée de requête n'est transmis aux serveurs BMM.

## 9. COMMUNAUTÉ ET SUPPORT
BMM est un projet communautaire. Le support est fourni au mieux de nos capacités via nos canaux communautaires (Discord, Forums).

## 10. EXÉCUTER VOTRE PROPRE CODE (PLANIFICATEUR)
Le Planificateur peut lancer des programmes externes et exécuter des scripts que vous écrivez
(PowerShell, CMD, Bash, Python). **Ces capacités sont désactivées par défaut et s'accordent tâche
par tâche, individuellement.** Une tâche dont la permission manque échoue avec un message ; elle ne
s'exécute jamais en silence.

Le code que vous écrivez s'exécute avec **vos** privilèges et peut faire tout ce que vous pouvez
faire sur votre machine. Le Logiciel ne le relit pas, ne l'isole pas et ne le bride pas. Vous êtes
responsable de ce que font vos propres automatisations, y compris sur minuterie en votre absence —
c'est la raison pour laquelle les options destructrices d'une synchronisation de dépôt planifiée
(écraser, supprimer les surplus) sont désactivées par défaut.

## 11. COMPTES ET BETTERCOMMUNITY
L'usage du Logiciel n'exige aucun compte. Si vous choisissez d'en créer ou d'en lier un :

- Vous êtes responsable de vos identifiants et de l'activité effectuée sous votre compte.
- Les clés d'API que vous créez sont limitées en portée. Une clé n'accorde que les permissions
  affichées à sa création, et vous pouvez la révoquer à tout moment depuis votre page de compte —
  ce qui invalide toutes ses copies.
- Un compte peut être suspendu ou fermé en cas d'abus, de contenu illégal, ou de tentative de
  contourner la modération ou les contrôles d'accès. Dans la mesure du possible, la raison vous
  sera indiquée.
- Vous pouvez supprimer votre compte. Le contenu que vous avez publié peut subsister lorsque son
  retrait casserait l'installation d'autres utilisateurs ; voir les conditions de la plateforme.

## 12. CONTENU QUE VOUS PUBLIEZ
Si vous soumettez un élément à un catalogue, hébergez un Dépôt Serveur, ou publiez quoi que ce soit
via BetterCommunity :

- Vous restez propriétaire de ce que vous publiez.
- Vous confirmez avoir le droit de le distribuer. **Ne redistribuez pas de contenu tiers payant ou
  sous licence que vous n'avez pas l'autorisation de partager.**
- Vous accordez ce qui est nécessaire pour l'héberger, l'afficher et le livrer aux utilisateurs qui
  le demandent — rien de plus.
- Un contenu peut être retiré ou délisté s'il est illégal, contrefaisant, malveillant, ou s'il
  dépasse une limite de la plateforme. Les décisions de modération sont contestables via les
  canaux de support.

## 13. SERVICES PAYANTS
Certains services BetterCommunity (hébergement de dépôts, pools de stockage, boosts) sont payants.
Le Logiciel lui-même reste gratuit.

- Les prix, les conditions de facturation et le contenu de chaque offre sont affichés avant achat.
- Les abonnements récurrents se renouvellent jusqu'à résiliation ; les durées prépayées non.
- Les remboursements et l'annulation relèvent de la page Paiements & Remboursements du site
  BetterCommunity, qui fait partie des présentes Conditions pour les services payants.
- Un abonnement échu suspend la ressource hébergée après son délai de grâce plutôt que de la
  supprimer immédiatement.

## 14. MODIFICATION DES PRÉSENTES CONDITIONS
Ces Conditions peuvent évoluer avec le Logiciel. Les changements substantiels seront annoncés dans
l'application et sur le site BetterCommunity avant leur entrée en vigueur. Continuer à utiliser le
Logiciel après cela vaut acceptation. Chaque version porte la date d'effet ci-dessous, et les
versions précédentes restent consultables dans l'historique du dépôt.

## 15. RÉSILIATION
Vous pouvez cesser d'utiliser le Logiciel à tout moment ; le désinstaller met fin aux présentes
Conditions pour vous, à l'exception des sections qui survivent par nature (exclusion de garantie,
responsabilité, contenu déjà publié). L'accès aux services BetterCommunity peut être suspendu pour
les motifs de la section 11. Rien ici ne limite les droits que la GPL-3.0 vous accorde sur le
Logiciel lui-même.

## 16. DROIT APPLICABLE
Les présentes Conditions sont régies par le droit matériel **suisse**, à l'exclusion de
ses règles de conflit de lois et de la Convention des Nations Unies sur les contrats de vente
internationale de marchandises (CVIM).

Rien ici ne retire les protections que le droit de la consommation de votre pays de résidence
vous accorde et auxquelles il n'est pas possible de renoncer par contrat. Si vous êtes un
consommateur résidant dans l'UE ou au Royaume-Uni, vous conservez le droit d'agir devant les
tribunaux de votre propre pays.

## 17. CONTACT
Questions sur ces Conditions : le formulaire de contact du site BetterCommunity, ou le Discord du
projet. Les demandes relatives aux données personnelles, y compris l'accès et l'effacement, sont
traitées comme décrit dans **PRIVACY_FR.md**.

---

**Date d'effet :** 13 août 2026 · **S'applique à :** BMM 1.0.0 et versions ultérieures

En utilisant Better Mods Manager, vous reconnaissez avoir lu, compris et accepté d'être lié par
les présentes conditions.

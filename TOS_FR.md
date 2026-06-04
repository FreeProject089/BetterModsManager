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
- **Rapports de crash :** En cas de bug de l'application, un rapport de diagnostic est généré localement. Vous pouvez choisir de partager ce rapport avec les développeurs sur Discord pour nous aider à corriger le problème.
- **Mises à jour automatiques :** Si activé, le Logiciel vérifiera les nouvelles versions sur GitHub.
- **API Plugin :** Tout le trafic de l'API Plugin est local à votre machine. Aucune requête API, aucun jeton ni aucune donnée de requête n'est transmis aux serveurs BMM.

## 9. COMMUNAUTÉ ET SUPPORT
BMM est un projet communautaire. Le support est fourni au mieux de nos capacités via nos canaux communautaires (Discord, Forums).

---
En utilisant Better Mods Manager, vous reconnaissez avoir lu, compris et accepté d'être lié par les termes de ce contrat.

# Mettre BMM à jour

Tu vas chercher une nouvelle version, lire ce qui a changé, et l'installer. Tes profils, tes mods et tes réglages sont conservés.

[Montre-moi : réglages de mise à jour](show:settings/updates) [Ouvrir les notes de version](show:notes) [S'entraîner avec le tutoriel](show:tutorial/other/updates)

**Il te faut :** rien d'autre. Si tu as installé BMM avec BetterInstaller, la mise à jour passe par lui toute seule.

![La fenêtre des notes de version, avec l'histoire de la 1.0 épinglée au-dessus des versions](assets/docs/media/screenshots/guide-release-notes.png)

:::note[Pourquoi BMM vérifie avant d'installer]
L'installateur est vérifié contre le manifeste signé de la version et son SHA-256 avant de s'exécuter. Un fichier qui ne correspond pas est affiché en rouge, et l'installer n'est pas recommandé.
:::

## Étapes

- [ ] **Laisse BMM te prévenir.** Il vérifie au démarrage. Dans **Paramètres, Mise à jour automatique**, tu peux ajouter une vérification pendant qu'il reste ouvert (toutes les 6 heures, ou chaque jour). *Tu vois :* une fenêtre avec les notes de la nouvelle version.
- [ ] **Ou vérifie à la main.** Appuie sur **Vérifier les mises à jour** dans la barre de titre ou dans les Paramètres. *Tu vois :* soit la nouvelle version, soit un message qui dit que tu es à jour.
- [ ] **Lis les notes.** Ouvre les **Notes de version** depuis la fenêtre de mise à jour. *Tu vois :* l'onglet **Versions**, la plus récente d'abord, avec **Les nouveautés de la 1.0** épinglées au-dessus de la liste. Commence par là si tu as sauté quelques versions.
- [ ] **Choisis un bouton.** **Installer maintenant** télécharge, vérifie et installe, le tout dans BMM. **Installer au prochain lancement** installe au prochain démarrage. **Me le rappeler demain** ne télécharge rien.
- [ ] **Attends les trois étapes.** *Tu vois :* **Téléchargement** (taille, vitesse, temps restant), **Vérification**, **Installation**, puis BMM redémarre.

## Quelle version suivre

| Canal | Ce que tu reçois |
|---|---|
| **Stable** | Seulement des versions testées. Le choix par défaut. |
| **Pré-version** | Des versions bêta avant qu'elles soient finales : les correctifs en premier, et les bugs en premier. |

Change-le dans **Paramètres, Mise à jour automatique, Canal de mise à jour**.

## Si ça ne marche pas

| Tu vois | Fais ceci |
|---|---|
| L'installateur n'a pas démarré | La fenêtre dit pourquoi en clair (autorisation refusée, antivirus qui retient le fichier, une stratégie). Appuie sur **Réessayer**. |
| Un message rouge sur la somme de contrôle | N'installe pas. Appuie sur **Télécharger depuis la page de la version** et compare. |
| Tu es en 0.9.11 | Accepte d'abord la 0.9.12, puis la mise à jour vers la 1.0 qu'elle propose ensuite. |
| Une version majeure, comme 0.9 vers 1.0 | C'est une installation complète avec l'installateur, et BMM copie tes données au premier lancement. |

:::tip[Un an de retard, c'est un problème]
Un gestionnaire de mods très en retard sur les dépôts qu'il lit finira par ne plus être d'accord avec eux. Si tu désactives la vérification automatique, mets à jour à la main de temps en temps.
:::

## Ensuite

[Installer BMM](doc-page:getting-started/install) détaille la mise à jour et l'installateur. Ce qui a changé à chaque version : [Historique des changements & notes de version](doc-page:features/history).

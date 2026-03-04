/**
 * i18n.js — Simple FR/EN internationalization
 */

const translations = {
    fr: {
        // Navigation
        'nav.library': 'Bibliothèque',
        'nav.profiles': 'Profils',
        'nav.modlists': 'Listes .MM',
        'nav.settings': 'Paramètres',
        'nav.docs': 'Documentation',
        'nav.activeProfile': 'PROFIL ACTIF',

        // Library
        'lib.title': 'Bibliothèque de Mods',
        'lib.subtitle.empty': 'Ajoutez votre premier mod.',
        'lib.subtitle': '{enabled} actif{s1} sur {total} mod{s2}',
        'lib.scan': 'Scanner',
        'lib.addMod': 'Ajouter un mod',
        'lib.enableAll': 'Tout activer',
        'lib.search': 'Rechercher un mod...',
        'lib.filterAll': 'Tous',
        'lib.filterEnabled': 'Actifs',
        'lib.filterDisabled': 'Inactifs',
        'lib.emptyTitle': 'Aucun mod trouvé',
        'lib.emptyDesc': 'Créez un profil et ajoutez vos premiers mods.',
        'lib.selectProfile': '— Sélectionnez un profil —',
        'lib.search': 'Rechercher un mod...',

        // Mods
        'mod.active': 'ACTIF',
        'mod.inactive': 'INACTIF',
        'mod.activate': 'Activer',
        'mod.deactivate': 'Désactiver',
        'mod.activated': '"{name}" activé — fichiers copiés.',
        'mod.deactivated': '"{name}" désactivé — fichiers restaurés.',
        'mod.saved': 'Mod sauvegardé.',
        'mod.deleted': '"{name}" supprimé.',
        'mod.deleteFirst': 'Désactivez le mod avant de le supprimer.',
        'mod.confirmDelete': 'Supprimer "{name}" de la bibliothèque ?',
        'mod.allEnabled': 'Tous les mods sont déjà actifs.',
        'mod.enabledCount': '{count} mod(s) activé(s).',
        'mod.scanNone': 'Aucun nouveau mod détecté.',
        'mod.scanFound': '{count} mod(s) découvert(s) !',
        'mod.transferComplete': 'Transfert terminé !',

        // Mod detail
        'detail.name': 'Nom',
        'detail.version': 'Version',
        'detail.author': 'Auteur',
        'detail.description': 'Description',
        'detail.folder': 'Dossier du mod',
        'detail.files': 'Fichiers installés',
        'detail.links': 'Liens de téléchargement',
        'detail.addLink': '+ Ajouter un lien',
        'detail.save': 'Sauvegarder',

        // Profiles
        'prof.title': 'Profils',
        'prof.subtitle': 'Gérez vos configurations par jeu',
        'prof.new': 'Nouveau profil',
        'prof.importOvgme': 'Importer OvGME',
        'prof.emptyTitle': 'Aucun profil',
        'prof.emptyDesc': 'Créez votre premier profil pour commencer ou importez vos configurations OvGME.',
        'prof.create': 'Créer un profil',
        'prof.name': 'Nom du profil',
        'prof.game': 'Nom du jeu',
        'prof.gamePath': 'Répertoire du jeu',
        'prof.modsPath': 'Dossier des mods',
        'prof.backupPath': 'Dossier de sauvegarde',
        'prof.browse': 'Parcourir',
        'prof.cancel': 'Annuler',
        'prof.createBtn': 'Créer',
        'prof.editTitle': 'Éditer le profil',
        'prof.saveBtn': 'Enregistrer',
        'prof.deleted': 'Profil supprimé.',
        'prof.confirmDelete': 'Supprimer ce profil ?',
        'prof.updated': 'Profil "{name}" mis à jour.',
        'prof.created': 'Profil "{name}" créé avec succès.',
        'prof.ovgmeImported': '{count} profil(s) OvGME importé(s) avec succès.',
        'prof.ovgmeNone': 'Aucun nouveau profil OvGME trouvé.',
        'prof.active': 'Actif',

        // Modlist
        'mm.title': 'Listes de Mods',
        'mm.subtitle': 'Partagez et importez des configurations complètes',
        'mm.import': 'Importer .MM',
        'mm.export': 'Exporter .MM',
        'mm.installAll': 'Tout installer',

        // Settings
        'settings.title': 'Paramètres',
        'settings.subtitle': 'Configuration de l\'application',
        'settings.about': 'À propos',
        'settings.aboutDesc': 'Gestionnaire de mods universel moderne. Conçu pour tous les jeux.',
        'settings.shortcuts': 'Raccourcis clavier',
        'settings.shortcutNewProfile': 'Nouveau profil',
        'settings.shortcutAddMod': 'Ajouter un mod',
        'settings.shortcutExport': 'Exporter la liste',
        'settings.shortcutImport': 'Importer une liste',
        'settings.language': 'Langue',
        'settings.updateNotes': 'Notes de mise à jour',
        'settings.viewNotes': 'Voir les notes',
        'settings.tutorialTitle': 'Tutoriel (Tasky)',
        'settings.restartTutorial': 'Redémarrer le tutoriel',

        // Credits
        'credits.title': 'Crédits',
        'credits.subtitle': 'L\'\u00e9quipe derrière Better Mod Manager',
        'credits.developer': 'Développeur',
        'credits.discord': 'Rejoindre le Discord',
        'credits.license': 'Licence',
        'credits.licenseDesc': 'Ce logiciel est distribué sous licence Apache 2.0.',

        // FAQ
        'faq.title': 'Questions fréquentes (FAQ)',
        'faq.q1': 'Est-ce que mes mods sont conservés si je change de profil ?',
        'faq.a1': 'Oui ! Chaque profil garde son propre état de mods. Quand vous revenez sur un profil, vos mods activés sont toujours là, même après redémarrage.',
        'faq.q2': 'Quelle est la différence entre .MM et .JSON ?',
        'faq.a2': 'Aucune techniquement ! .MM est simplement un fichier .JSON renommé pour faciliter le partage entre joueurs.',
        'faq.q3': 'Que se passe-t-il si je supprime un mod activé ?',
        'faq.a3': 'Vous devez d\'abord désactiver le mod pour que ses fichiers soient retirés du jeu, puis vous pouvez le supprimer en toute sécurité.',
        'faq.q4': 'Comment mettre à jour un mod ?',
        'faq.a4': 'Désactivez le mod, remplacez ses fichiers dans le dossier des mods, puis réactivez-le. Le backup sera recréé automatiquement.',

        // Docs
        'docs.title': 'Documentation',
        'docs.subtitle': 'Guide d\'utilisation de Better Mod Manager',
        'docs.howModdingWorks': 'Comment fonctionne le modding ?',
        'docs.howModdingWorksDesc': 'Le modding consiste à modifier ou ajouter des fichiers au jeu original. Better Mod Manager simplifie ce processus en gardant vos mods séparés du jeu ("Dossier des mods"). Lorsque vous "Activez" un mod, BMM copie intelligemment les fichiers du mod dans le répertoire du jeu.',
        'docs.backups': 'À quoi sert le dossier Backup ?',
        'docs.backupsDesc': 'La sécurité avant tout ! Si l\'activation d\'un mod nécessite de remplacer un fichier original du jeu, BMM va d\'abord sauvegarder l\'original dans le dossier Backup que vous avez défini. Ainsi, lorsque vous désactivez le mod, le fichier original est restauré, laissant votre jeu intact.',
        'docs.mmFormat': 'Comprendre le format .MM',
        'docs.mmFormatDesc': 'L\'extension .MM a été créée pour partager facilement vos listes de mods. Sous le capot, il s\'agit simplement d\'un format .JSON standard. L\'extension personnalisée permet à vos amis de se repérer plus facilement et de l\'importer en un clic.',
        'docs.enableDisable': 'Activer & Désactiver',
        'docs.enableDisableDesc': 'Utilisez le switch sur chaque carte de mod pour gérér son état. Les fichiers sont transférés en arrière-plan. Veillez toujours à désactiver un mod avant de le supprimer pour éviter que ses fichiers ne restent orphelins dans le jeu.',

        // Onboarding
        'onboard.s1.title': 'Bienvenue !',
        'onboard.s1.text': 'Bienvenue sur Better Mod Manager ! Je suis Tasky, votre assistant. Je vais vous expliquer chaque section de l\'application pour que vous soyez opérationnel en quelques minutes.',
        'onboard.s2.title': 'Profils — Votre point de départ',
        'onboard.s2.text': 'La page Profils vous permet de créer des configurations par jeu. Chaque profil contient le chemin du jeu, un dossier pour vos mods, un dossier de backup, et même une couleur et icône personnalisées.',
        'onboard.s3.title': 'Importer depuis OvGME',
        'onboard.s3.text': 'Vous migrez depuis OvGME ? Pas de souci ! Le bouton "Importer OvGME" récupère automatiquement vos profils et mods existants. Ils sont copiés en toute indépendance.',
        'onboard.s4.title': 'Bibliothèque — Gérer vos mods',
        'onboard.s4.text': 'La Bibliothèque affiche tous les mods de votre profil actif. Utilisez "Scanner" pour détecter auto les mods, ou "Ajouter un mod" pour sélectionner un dossier. Vous pouvez changer de profil directement depuis le dropdown en haut.',
        'onboard.s5.title': 'Activer et Désactiver un mod',
        'onboard.s5.text': 'Chaque mod a un bouton toggle. L\'activation copie les fichiers dans le répertoire du jeu. La désactivation restaure les fichiers originaux depuis le backup. Pensez toujours à désactiver avant de supprimer !',
        'onboard.s6.title': 'Éditer et personnaliser',
        'onboard.s6.text': 'Cliquez sur un mod pour voir son panneau de détails. Modifiez le nom, la version, l\'auteur, ajoutez des liens de téléchargement… Tout est sauvegardé dans votre profil.',
        'onboard.s7.title': 'Listes .MM — Partager facilement',
        'onboard.s7.text': 'La page Listes .MM vous permet d\'exporter votre configuration complète en un fichier .MM (c\'est du JSON renommé). Envoyez-le à un ami, il importe et installe tout en un clic !',
        'onboard.s8.title': 'C\'est parti !',
        'onboard.s8.text': 'Vous êtes prêt ! Consultez la Documentation et la FAQ pour plus de détails. N\'oubliez pas de visiter la page Crédits et de rejoindre notre Discord. Bonne gestion de mods !',
        'onboard.next': 'Suivant →',
        'onboard.skip': 'Passer',

        // Common
        'common.error': 'Erreur',
        'common.success': 'Succès',
        'common.loading': 'Chargement...',
        'common.importing': 'Importation...',
        'common.installing': 'Installation en cours...',
        'common.copying': 'Copie en cours...',
    },
    en: {
        // Navigation
        'nav.library': 'Library',
        'nav.profiles': 'Profiles',
        'nav.modlists': '.MM Lists',
        'nav.settings': 'Settings',
        'nav.docs': 'Documentation',
        'nav.activeProfile': 'ACTIVE PROFILE',

        // Library
        'lib.title': 'Mod Library',
        'lib.subtitle.empty': 'Add your first mod.',
        'lib.subtitle': '{enabled} active on {total} mod{s2}',
        'lib.scan': 'Scan',
        'lib.addMod': 'Add a mod',
        'lib.enableAll': 'Enable all',
        'lib.search': 'Search a mod...',
        'lib.filterAll': 'All',
        'lib.filterEnabled': 'Enabled',
        'lib.filterDisabled': 'Disabled',
        'lib.emptyTitle': 'No mods found',
        'lib.emptyDesc': 'Create a profile and add your first mods.',
        'lib.selectProfile': '— Select a profile —',
        'lib.search': 'Search mods...',

        // Mods
        'mod.active': 'ACTIVE',
        'mod.inactive': 'INACTIVE',
        'mod.activate': 'Enable',
        'mod.deactivate': 'Disable',
        'mod.activated': '"{name}" enabled — files copied.',
        'mod.deactivated': '"{name}" disabled — files restored.',
        'mod.saved': 'Mod saved.',
        'mod.deleted': '"{name}" deleted.',
        'mod.deleteFirst': 'Disable the mod before deleting it.',
        'mod.confirmDelete': 'Delete "{name}" from the library?',
        'mod.allEnabled': 'All mods are already active.',
        'mod.enabledCount': '{count} mod(s) enabled.',
        'mod.scanNone': 'No new mods detected.',
        'mod.scanFound': '{count} mod(s) discovered!',
        'mod.transferComplete': 'Transfer complete!',

        // Mod detail
        'detail.name': 'Name',
        'detail.version': 'Version',
        'detail.author': 'Author',
        'detail.description': 'Description',
        'detail.folder': 'Mod folder',
        'detail.files': 'Installed files',
        'detail.links': 'Download links',
        'detail.addLink': '+ Add a link',
        'detail.save': 'Save',

        // Profiles
        'prof.title': 'Profiles',
        'prof.subtitle': 'Manage your configurations per game',
        'prof.new': 'New profile',
        'prof.importOvgme': 'Import OvGME',
        'prof.emptyTitle': 'No profiles',
        'prof.emptyDesc': 'Create your first profile to get started or import your OvGME configurations.',
        'prof.create': 'Create a profile',
        'prof.name': 'Profile name',
        'prof.game': 'Game name',
        'prof.gamePath': 'Game directory',
        'prof.modsPath': 'Mods folder',
        'prof.backupPath': 'Backup folder',
        'prof.browse': 'Browse',
        'prof.cancel': 'Cancel',
        'prof.createBtn': 'Create',
        'prof.editTitle': 'Edit profile',
        'prof.saveBtn': 'Save',
        'prof.deleted': 'Profile deleted.',
        'prof.confirmDelete': 'Delete this profile?',
        'prof.updated': 'Profile "{name}" updated.',
        'prof.created': 'Profile "{name}" created successfully.',
        'prof.ovgmeImported': '{count} OvGME profile(s) imported successfully.',
        'prof.ovgmeNone': 'No new OvGME profiles found.',
        'prof.active': 'Active',

        // Modlist
        'mm.title': 'Mod Lists',
        'mm.subtitle': 'Share and import complete configurations',
        'mm.import': 'Import .MM',
        'mm.export': 'Export .MM',
        'mm.installAll': 'Install all',

        // Settings
        'settings.title': 'Settings',
        'settings.subtitle': 'Application configuration',
        'settings.about': 'About',
        'settings.aboutDesc': 'Universal modern mod manager. Built for all games.',
        'settings.shortcuts': 'Keyboard shortcuts',
        'settings.shortcutNewProfile': 'New profile',
        'settings.shortcutAddMod': 'Add a mod',
        'settings.shortcutExport': 'Export list',
        'settings.shortcutImport': 'Import a list',
        'settings.language': 'Language',
        'settings.updateNotes': 'Update notes',
        'settings.viewNotes': 'View notes',
        'settings.tutorialTitle': 'Tutorial (Tasky)',
        'settings.restartTutorial': 'Restart tutorial',

        // Credits
        'credits.title': 'Credits',
        'credits.subtitle': 'The team behind Better Mod Manager',
        'credits.developer': 'Developer',
        'credits.discord': 'Join our Discord',
        'credits.license': 'License',
        'credits.licenseDesc': 'This software is distributed under the Apache 2.0 license.',

        // FAQ
        'faq.title': 'Frequently Asked Questions (FAQ)',
        'faq.q1': 'Are my mods kept if I switch profiles?',
        'faq.a1': 'Yes! Each profile keeps its own mod state. When you return to a profile, your enabled mods are still there, even after a restart.',
        'faq.q2': 'What is the difference between .MM and .JSON?',
        'faq.a2': 'Technically none! .MM is simply a .JSON file renamed to make sharing between players easier.',
        'faq.q3': 'What happens if I delete an enabled mod?',
        'faq.a3': 'You must first disable the mod so its files are removed from the game, then you can safely delete it.',
        'faq.q4': 'How do I update a mod?',
        'faq.a4': 'Disable the mod, replace its files in the mods folder, then re-enable it. The backup will be recreated automatically.',

        // Docs
        'docs.title': 'Documentation',
        'docs.subtitle': 'Better Mod Manager User Guide',
        'docs.howModdingWorks': 'How does modding work?',
        'docs.howModdingWorksDesc': 'Modding means modifying or adding files to the original game. Better Mod Manager simplifies this process by keeping your mods separate from the game ("Mods folder"). When you "Enable" a mod, BMM smartly copies the mod files into the game directory.',
        'docs.backups': 'What is the Backup folder for?',
        'docs.backupsDesc': 'Safety first! If enabling a mod requires replacing an original game file, BMM will first backup the original into your defined Backup folder. This way, when you disable the mod, the original file is restored, leaving your game intact.',
        'docs.mmFormat': 'Understanding the .MM format',
        'docs.mmFormatDesc': 'The .MM extension was created to easily share your mod lists. Under the hood, it\'s simply a standard .JSON format. The custom extension makes it easier for your friends to find and import it in one click.',
        'docs.enableDisable': 'Enable & Disable',
        'docs.enableDisableDesc': 'Use the switch on each mod card to manage its state. Files are transferred in the background. Always make sure to disable a mod before deleting it to avoid leaving its files orphaned in the game.',

        // Onboarding
        'onboard.s1.title': 'Welcome!',
        'onboard.s1.text': 'Welcome to Better Mod Manager! I\'m Tasky, your assistant. I\'ll walk you through each section of the app so you can be up and running in just a few minutes.',
        'onboard.s2.title': 'Profiles — Your starting point',
        'onboard.s2.text': 'The Profiles page lets you create per-game configurations. Each profile contains the game path, a mods folder, a backup folder, and even a custom color and icon.',
        'onboard.s3.title': 'Import from OvGME',
        'onboard.s3.text': 'Migrating from OvGME? No worries! The "Import OvGME" button automatically retrieves your existing profiles and mods. They are copied independently.',
        'onboard.s4.title': 'Library — Manage your mods',
        'onboard.s4.text': 'The Library shows all mods for your active profile. Use "Scan" to auto-detect mods, or "Add a mod" to select a folder. You can switch profiles directly from the dropdown at the top.',
        'onboard.s5.title': 'Enable and Disable a mod',
        'onboard.s5.text': 'Each mod has a toggle button. Enabling copies files to the game directory. Disabling restores originals from backup. Always disable before deleting!',
        'onboard.s6.title': 'Edit and customize',
        'onboard.s6.text': 'Click a mod to open its detail panel. Edit the name, version, author, add download links... Everything is saved per profile.',
        'onboard.s7.title': '.MM Lists — Easy sharing',
        'onboard.s7.text': 'The .MM Lists page lets you export your complete configuration as a .MM file (it\'s just renamed JSON). Send it to a friend, they import and install everything in one click!',
        'onboard.s8.title': 'Let\'s go!',
        'onboard.s8.text': 'You are ready! Check the Documentation and FAQ for more details. Don\'t forget to visit the Credits page and join our Discord. Happy mod managing!',
        'onboard.next': 'Next →',
        'onboard.skip': 'Skip',

        // Common
        'common.error': 'Error',
        'common.success': 'Success',
        'common.loading': 'Loading...',
        'common.importing': 'Importing...',
        'common.installing': 'Installing...',
        'common.copying': 'Copying...',
    }
};

let currentLang = localStorage.getItem('bmm-lang') || 'fr';

export function t(key, params = {}) {
    const dict = translations[currentLang] || translations.fr;
    let str = dict[key] || translations.fr[key] || key;
    for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return str;
}

export function getLang() {
    return currentLang;
}

export function setLang(lang) {
    if (translations[lang]) {
        currentLang = lang;
        localStorage.setItem('bmm-lang', lang);
        applyTranslations();
    }
}

export function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        el.placeholder = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        el.title = t(key);
    });
}

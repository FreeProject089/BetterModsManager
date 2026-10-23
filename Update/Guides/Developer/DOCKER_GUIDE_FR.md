# Guide Docker pour un serveur léger BMM

Ce guide explique comment lancer un serveur de repository BMM avec Docker.

---

## Prérequis

* Docker installé sur ton système (Linux ou Windows)
* Un repository généré avec le support Docker activé

---

## Générer un repository prêt pour Docker

1. Dans BMM, va dans l’onglet **Repository**
2. Active **“Compress as .ZIP archive”** si tu veux un fichier ZIP
3. Dans la section **Standalone Server Settings** :

   * Coche **“Docker Support”**
   * Choisis ton type d’hôte :

     * **Linux Host** pour les installations Docker Linux
     * **Windows Host** pour les installations Docker Windows
4. Définis le port souhaité (par défaut : 8000)
5. Clique sur **Export** pour générer le repository

Le dossier / ZIP généré contiendra :

* `Dockerfile` → configuration de l’image Docker
* `docker-compose.yml` → configuration Docker Compose (sans mot de passe)
* `.env` → le mot de passe admin, lu par `docker-compose.yml` via `env_file`. Garde-le privé.
* `.gitignore` / `.dockerignore` → chacun reçoit une ligne `.env` (ajoutée à un fichier existant,
  jamais remplacé), pour que le mot de passe reste hors de git et hors de l'image
* `BMM-Standalone-Server.bat` (Windows) ou `.sh` (Linux) → scripts standalone
* `mods/` → fichiers des mods
* `repo.json` → configuration du repository

---

## Lancer avec Docker

### Option 1 : Docker Compose (recommandé)

1. Va dans le dossier du repository généré
2. Lance :

```bash
docker-compose up -d
```

Cela va :

* Construire l’image Docker
* Démarrer le container en arrière-plan
* Exposer le port configuré
* Monter les fichiers du repository comme volumes

---

### Option 2 : Build + Run Docker

1. Va dans le dossier du repository
2. Construis l’image :

```bash
docker build -t bmm-repo-server .
```

3. Lance le container :

```bash
docker run -d -p 8000:8000 --name bmm-server bmm-repo-server
```

Remplace `8000` si tu as choisi un autre port.

---

## Accéder au serveur

Une fois le container lancé :

* **URL du repository** : `http://localhost:8000/repo.json`
* **Dashboard admin** : `http://localhost:8000/dashboard`

Utilise le mot de passe admin défini lors de la génération (par défaut : `admin`).

---

## Gestion du container

### Voir les logs

```bash
docker-compose logs -f
```

### Stopper le serveur

```bash
docker-compose down
```

### Redémarrer le serveur

```bash
docker-compose restart
```

---

## Mettre à jour le repository

1. Arrêter le container
2. Modifier les fichiers du dossier repository
3. Redémarrer le container

---

## Dépannage

### Port déjà utilisé

* Change le port dans `docker-compose.yml` (section `ports`)
* Ou arrête le service qui utilise déjà le port

---

### Problèmes de permissions (Linux)

```bash
sudo docker-compose up -d
```

---

### Container ne démarre pas

Vérifie les logs :

```bash
docker-compose logs
```

Causes fréquentes :

* Fichiers manquants (`mods/`, `repo.json`, `Info.json`)
* Mauvaise configuration du port
* Mot de passe admin incorrect

---

## Configuration avancée

### Port personnalisé

Dans `docker-compose.yml` :

```yaml
ports:
  - "TON_PORT:TON_PORT"
```

---

### Volumes

Le `docker-compose.yml` monte :

* `mods/` → mods (lecture seule)
* `repo.json` → config repo (lecture seule)
* `bans.json` → bans (lecture seule)
* `whitelist.json` → whitelist (lecture seule)
* `server.log` → logs (lecture/écriture)
* `history.json` → historique downloads (lecture/écriture)

---

### Variables d’environnement

Le mot de passe admin n'est **pas** dans `docker-compose.yml`. BMM l'écrit dans `.env` à côté :

```bash
# .env
ADMIN_PASSWORD='ton_mot_de_passe'
```

et le fichier compose le lit :

```yaml
env_file:
  - .env
environment:
  - PORT=8000
```

Pour changer le mot de passe, modifie `.env` puis lance `docker compose up -d` : le serveur
préfère `ADMIN_PASSWORD` venu de son environnement à la valeur inscrite à l'export. Sous Linux et
macOS, le fichier est créé lisible par son seul propriétaire (`chmod 600`).

---

## Notes Windows

* Docker Desktop doit être en mode **Windows containers**
* Le Dockerfile utilise une base **Windows Nano Server** (ltsc2022). Node.js 22 LTS est
  téléchargé dans une étape Server Core, vérifié par son SHA-256, puis copié (Nano Server n'a pas
  PowerShell). Le serveur tourne sous le compte non privilégié `ContainerUser`, avec l'écriture
  sur `C:\app` seulement ; le health check appelle `node`, pas PowerShell.
* Les images Linux utilisent `node:22` (Alpine), épinglée par version et digest, et tournent sous
  un utilisateur `bmm` non root.
* Certaines fonctionnalités Linux peuvent ne pas être dispo

---

## Notes Linux

* Base image : **Alpine Linux**
* Utilise `dumb-init` pour gérer les signaux
* Tourne en utilisateur non-root (plus sécurisé)

---

## Sécurité

1. Change le mot de passe admin par défaut
2. Utilise un firewall
3. Évite d’exposer le dashboard publiquement
4. Mets à jour régulièrement les images Docker
5. Utilise un tunnel type Cloudflare si accès public

---

## Support

* Documentation BMM
* Logs Docker
* Vérifie que tous les fichiers requis sont présents

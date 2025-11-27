# Rocket.Chat Custom Client - Test Playground

Un playground minimaliste pour tester Rocket.Chat comme backend avec un frontend HTML simple.

## Architecture

```
┌──────────────────────┐         ┌──────────────────────────────┐
│   LOCAL MACHINE      │         │   SERVER                     │
│                      │         │   (localhost or your IP)     │
│   frontend/          │  HTTP   │                              │
│   ├── index.html     │ ──────> │   Rocket.Chat (:3001)        │
│   └── app.js         │   WS    │   └── MongoDB                │
│                      │ <────── │                              │
└──────────────────────┘         └──────────────────────────────┘
```

## Setup Serveur

### 1. Cloner le repo sur le serveur

```bash
ssh user@your-server-ip
cd ~
git clone https://github.com/NathanJ60/rocketchat-custom-client.git
cd rocketchat-custom-client
```

### 2. Lancer Docker Compose

```bash
docker compose up -d
```

Attendre 1-2 minutes que Rocket.Chat démarre complètement.

### 3. Initialiser Rocket.Chat

```bash
chmod +x init-rocketchat.sh
./init-rocketchat.sh
```

Ce script va :
- Attendre que Rocket.Chat soit prêt
- Créer un utilisateur admin (testadmin / admin123)
- Créer un channel #test
- Afficher les tokens d'authentification

## Setup Local (Frontend)

### 1. Ouvrir le frontend

Simplement ouvrir `frontend/index.html` dans un navigateur :

```bash
open frontend/index.html
# ou
firefox frontend/index.html
# ou double-clic sur le fichier
```

### 2. Se connecter

- Username: `testadmin`
- Password: `admin123`
- Cliquer sur **LOGIN**

### 3. Tester

- Écrire un message dans le champ texte
- Cliquer sur **SEND**
- Les messages apparaissent en temps réel via WebSocket

## Configuration

### Changer l'IP du serveur

Éditer `frontend/app.js` ligne 4-5 :

```javascript
const ROCKETCHAT_HOST = 'localhost';  // Votre IP ou localhost
const ROCKETCHAT_PORT = '3001';
```

### Credentials par défaut

| Champ | Valeur |
|-------|--------|
| Username | testadmin |
| Password | admin123 |
| Email | admin@test.com |

## Endpoints API utilisés

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/login` | Authentification |
| `GET /api/v1/channels.info` | Info du channel |
| `GET /api/v1/channels.messages` | Récupérer messages |
| `POST /api/v1/chat.postMessage` | Envoyer message |
| `POST /api/v1/im.create` | Créer un DM |
| `POST /api/v1/rooms.upload/:rid` | Upload fichier/audio |
| `WS /websocket` | WebSocket (DDP) |

## Fonctionnalités

- Messages texte en temps réel
- Messages privés (DM)
- Messages vocaux (enregistrement micro)
- Liste des utilisateurs
- Multi-channels

## Dépannage

### Rocket.Chat ne démarre pas

```bash
# Voir les logs
docker compose logs rocketchat

# Vérifier que MongoDB replica set est initialisé
docker compose logs mongo-init-replica
```

### Erreur CORS

Le docker-compose inclut déjà les variables pour activer CORS :
```yaml
- OVERWRITE_SETTING_API_Enable_CORS=true
- OVERWRITE_SETTING_API_CORS_Origin=*
```

### WebSocket ne se connecte pas

1. Vérifier que le port 3001 est ouvert sur le serveur
2. Vérifier le firewall : `ufw allow 3001`
3. Vérifier dans la console du navigateur (F12)

### Reset complet

```bash
docker compose down -v
docker compose up -d
./init-rocketchat.sh
```

## Structure du projet

```
rocketchat-custom-client/
├── docker-compose.yml      # Config Docker
├── init-rocketchat.sh      # Script d'init
├── frontend/
│   ├── index.html          # Interface HTML
│   └── app.js              # Logique JS
└── README.md
```

## License

MIT

# Bot-Installation auf Pterodactyl

## 1. Repository

Git-Repository:

```text
https://github.com/HundixD/Planlos-Create-Core.git
```

Wenn dieser Server nur den Bot betreibt, muss Pterodactyl als Arbeitsverzeichnis den Ordner `bot` verwenden oder die Bot-Dateien müssen beim Deployment in den Hauptordner gelegt werden.

## 2. Umgebungsvariablen

Kopiere `bot/.env.example` nach `bot/.env` und trage dort Bot-Token, Client-ID, Server-ID, Rollen-ID, Minecraft-Adresse und API-Schlüssel ein.

Der API-Schlüssel gehört niemals in GitHub oder in öffentlich sichtbaren Website-Code.

## 3. Installation

```bash
cd bot
npm install
npm start
```

## 4. Bot-Rechte

Der Bot benötigt mindestens:

- Kanäle ansehen
- Nachrichten senden
- Nachrichtenverlauf lesen
- Rollen verwalten

Die Bot-Rolle muss über der Verifiziert-Rolle stehen.

## 5. API

Gesundheitsprüfung ohne Schlüssel:

```text
GET /api/health
```

Geschützte Endpunkte:

```text
GET /api/minecraft/status
GET /api/discord/stats
GET /api/projects
GET /api/content
```

Header:

```text
X-API-Key: DEIN_API_KEY
```

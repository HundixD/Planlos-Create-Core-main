# Planlos Create Core

Zentrale Plattform für den **Planlos Create Server**.

Das Repository enthält zunächst den Discord-Bot mit Regelbestätigung, Whitelist, Projektmeldungen, Content-Creator-Beiträgen, Minecraft-Serverstatus und einer geschützten REST-API. Die Website wird anschließend als eigener Bereich ergänzt.

## Aktueller Stand

**Version 0.1.0 – Bot Core**

- Discord.js
- Slash-Commands
- JSON-Datenspeicher
- Regelbestätigung mit Rollenvergabe
- Minecraft-Status
- REST-API für die spätere Website
- Pterodactyl-kompatibler Einstieg über `server.js`

## Ordner

```text
bot/       Discord-Bot und API
website/   spätere Website
shared/    gemeinsam genutzte Strukturen
docs/      Dokumentation
```

## Sicherheit

Die Datei `.env` darf niemals in GitHub hochgeladen werden. Nutze `bot/.env.example` als Vorlage.

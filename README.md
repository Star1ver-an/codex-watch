# Codex Watch

Wear OS companion app and local bridge for monitoring Codex desktop tasks and handling approval requests from a smartwatch.

## Project layout

- `codex-watch-bridge/` — Node.js/TypeScript bridge that reads local Codex state and serves the watch over authenticated WebSocket/TLS.
- `CodexWatch/` — Wear OS client built with Kotlin, Jetpack Compose, and Wear OS APIs.
- `Codex-Watch方案设计.md` — architecture and milestone notes.
- `run-bridge-hidden.vbs` — Windows helper for starting the bridge hidden.

## Quick start

### Bridge

```powershell
cd codex-watch-bridge
npm install
npm run build
npm run bridge
```

The bridge prints the LAN port, pairing PIN, and a newly generated token on first start. Keep the generated `bridge.config.json` private; it is intentionally ignored by Git.

### Wear OS app

Open `CodexWatch/` in Android Studio, sync Gradle, and run the app on a Wear OS device. Pair it with the bridge using the host and port shown by the bridge.

See the component READMEs for protocol details, device setup, and Windows helper scripts.

## Security notes

The bridge uses a pairing PIN, token authentication, and certificate pinning for the LAN connection. Runtime credentials and generated certificates are local-only files and are excluded from this repository.

# ProgressiveRummy
Web version of Progressive Rummy card game.

## Multiplayer (Socket.IO)
This repository now includes server-backed multiplayer with synchronized lobby/game/chat snapshots.

### Tech
- Frontend: static HTML/CSS/JS (existing UI)
- Backend: Node.js + Express + Socket.IO
- Shared contract: `shared/events.js`

### Run locally
1. Install dependencies:
```bash
npm install
```
2. Start server:
```bash
npm start
```
3. Open:
- `http://localhost:3000`

### Dev mode
```bash
npm run dev
```

### Key files
- `server/index.js`: Socket.IO server and event handlers
- `server/state/store.js`: in-memory authoritative lobby/session/chat store
- `server/state/rules.js`: initial game-state construction + snapshot scrubbing
- `shared/events.js`: shared event names and game-action enums
- `client/multiplayer-client.js`: browser client wrapper for Socket.IO events

### Hosting notes
- Host frontend and backend together (same origin) for easiest setup.
- If split domains, set `CLIENT_ORIGIN` on the server and use WSS URL in client.
- Lobby creation/join/spectate/setup/start are synchronized via Socket.IO.
- Chat is server-enforced (200 chars, 5 per 10s per session, 100 per round per lobby).
- Game state sync uses `sync_state` actions (shared-state mode) so multi-browser play works now.
- For anti-cheat hardening, move per-turn rule validation fully into `server/state/rules.js` and reject invalid action payloads.

### Environment variables
- `PORT` (default: `3000`)
- `CLIENT_ORIGIN` (default: `*`)

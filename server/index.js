import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import { Server } from "socket.io";

import { EVENTS, GAME_ACTIONS } from "../shared/events.js";
import { LobbyStore } from "./state/store.js";
import { buildInitialGameState, scrubSnapshotForViewer } from "./state/rules.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN }));
app.use(express.json());
app.use(express.static(rootDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "progressive-rummy-server" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN }
});

const store = new LobbyStore();

function emitLobbyList() {
  io.emit(EVENTS.LOBBY_LIST_UPDATE, store.listLobbySummaries());
}

function emitLobbySnapshot(lobbyId) {
  const lobby = store.getLobby(lobbyId);
  if (!lobby) return;

  for (const [socketId, session] of store.socketToSession.entries()) {
    if (session.lobbyId !== lobby.id) continue;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const raw = store.snapshotForSession(lobby, session);
    const payload = scrubSnapshotForViewer(raw, session.id);
    socket.emit(EVENTS.LOBBY_SNAPSHOT, payload);
    socket.emit(EVENTS.GAME_SNAPSHOT, payload.gameState || null);
    socket.emit(EVENTS.CHAT_UPDATE, payload.chat || { byRoundCount: 0, messages: [] });
  }
}

function fail(socket, message) {
  socket.emit(EVENTS.ERROR, { message });
}

io.on("connection", (socket) => {
  socket.emit(EVENTS.LOBBY_LIST_UPDATE, store.listLobbySummaries());

  socket.on(EVENTS.SESSION_HELLO, (payload = {}) => {
    const session = store.upsertSession(socket.id, payload.name || "Player");
    socket.emit(EVENTS.SESSION_ACK, { sessionId: session.id, name: session.name });
  });

  socket.on(EVENTS.LOBBY_LIST, () => {
    socket.emit(EVENTS.LOBBY_LIST_UPDATE, store.listLobbySummaries());
  });

  socket.on(EVENTS.LOBBY_CREATE, (payload = {}) => {
    const lobby = store.createLobby({
      ownerSocketId: socket.id,
      ownerName: payload.ownerName,
      lobbyName: payload.lobbyName,
      maxPlayers: payload.maxPlayers,
      cardBackStyle: payload.cardBackStyle
    });

    socket.join(lobby.id);
    emitLobbyList();
    emitLobbySnapshot(lobby.id);
  });

  socket.on(EVENTS.LOBBY_OPEN_SETUP, (payload = {}) => {
    const lobby = store.getLobby(payload.lobbyId);
    if (!lobby) return fail(socket, "Lobby not found.");
    const session = store.getSession(socket.id);
    if (!session) return fail(socket, "Session not found.");
    session.lobbyId = lobby.id;
    socket.join(lobby.id);
    emitLobbySnapshot(lobby.id);
  });

  socket.on(EVENTS.LOBBY_JOIN_SEAT, (payload = {}) => {
    const result = store.joinSeat({
      socketId: socket.id,
      lobbyId: payload.lobbyId,
      seatIndex: payload.seatIndex,
      playerName: payload.playerName
    });
    if (!result.ok) return fail(socket, result.reason);

    socket.join(result.lobby.id);
    emitLobbyList();
    emitLobbySnapshot(result.lobby.id);
  });

  socket.on(EVENTS.LOBBY_SPECTATE, (payload = {}) => {
    const result = store.spectate({
      socketId: socket.id,
      lobbyId: payload.lobbyId,
      spectatorName: payload.spectatorName
    });
    if (!result.ok) return fail(socket, result.reason);

    socket.join(result.lobby.id);
    emitLobbyList();
    emitLobbySnapshot(result.lobby.id);
  });

  socket.on(EVENTS.LOBBY_UPDATE_SETUP, (payload = {}) => {
    const result = store.updateSetup({
      socketId: socket.id,
      lobbyId: payload.lobbyId,
      maxPlayers: payload.maxPlayers,
      slots: payload.slots
    });
    if (!result.ok) return fail(socket, result.reason);

    emitLobbyList();
    emitLobbySnapshot(result.lobby.id);
  });

  socket.on(EVENTS.GAME_START, (payload = {}) => {
    const result = store.startGame({
      socketId: socket.id,
      lobbyId: payload.lobbyId,
      buildInitialGameState
    });
    if (!result.ok) return fail(socket, result.reason);

    emitLobbyList();
    emitLobbySnapshot(result.lobby.id);
  });

  socket.on(EVENTS.CHAT_SEND, (payload = {}) => {
    const result = store.addChat({
      socketId: socket.id,
      lobbyId: payload.lobbyId,
      text: payload.text
    });
    if (!result.ok) return fail(socket, result.reason);

    emitLobbySnapshot(result.lobby.id);
  });

  socket.on(EVENTS.GAME_ACTION, (payload = {}) => {
    const session = store.getSession(socket.id);
    if (!session?.lobbyId) return fail(socket, "Join a lobby first.");

    const lobby = store.getLobby(session.lobbyId);
    if (!lobby || lobby.phase !== "in_progress") return fail(socket, "Game is not active.");

    // Authoritative round logic should be executed server-side here.
    // Scaffold keeps the contract and validation boundary in place.
    const action = payload.action;
    if (!Object.values(GAME_ACTIONS).includes(action)) {
      return fail(socket, "Unsupported game action.");
    }
    if (action === GAME_ACTIONS.SYNC_STATE) {
      if (session.role === "spectator") return fail(socket, "Spectators cannot submit game actions.");
      if (!payload.gameState || typeof payload.gameState !== "object") return fail(socket, "Missing game state payload.");
      const previousRound = lobby.round;
      lobby.gameState = payload.gameState;
      if (Number.isInteger(payload.round)) {
        lobby.round = payload.round;
      } else if (Number.isInteger(payload.gameState.round)) {
        lobby.round = payload.gameState.round;
      }
      if (lobby.round !== previousRound) {
        lobby.chat.byRoundCount = 0;
        lobby.chat.bySessionTimestamps = new Map();
      }
      emitLobbyList();
      emitLobbySnapshot(lobby.id);
      return;
    }

    fail(socket, "Unsupported game action for this server mode.");
  });

  socket.on("disconnect", () => {
    const session = store.clearSocket(socket.id);
    if (!session?.lobbyId) return;
    const lobby = store.getLobby(session.lobbyId);
    if (!lobby) return;

    for (const slot of lobby.slots) {
      if (slot.occupantSessionId === session.id && !slot.isOwner) {
        slot.occupied = false;
        slot.name = "";
        slot.occupantSessionId = null;
      }
    }

    lobby.spectators = lobby.spectators.filter((n) => n !== session.name);
    emitLobbyList();
    emitLobbySnapshot(lobby.id);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Progressive Rummy server listening on http://localhost:${PORT}`);
});

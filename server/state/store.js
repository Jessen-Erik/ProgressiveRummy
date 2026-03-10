import { randomUUID } from "node:crypto";

const MAX_PLAYERS = 7;
const MIN_PLAYERS = 2;

function clampPlayers(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 4;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
}

function normalizeName(name, fallback = "Player") {
  const safe = String(name ?? "").trim();
  return safe.slice(0, 24) || fallback;
}

export class LobbyStore {
  constructor() {
    this.lobbies = new Map();
    this.socketToSession = new Map();
    this.userWins = new Map();
  }

  upsertSession(socketId, name) {
    const existing = this.socketToSession.get(socketId);
    const next = {
      id: existing?.id || randomUUID(),
      name: normalizeName(name, "Player"),
      role: existing?.role || "none",
      lobbyId: existing?.lobbyId || null,
      seatIndex: existing?.seatIndex ?? -1
    };
    this.socketToSession.set(socketId, next);
    return next;
  }

  getSession(socketId) {
    return this.socketToSession.get(socketId) || null;
  }

  clearSocket(socketId) {
    const session = this.socketToSession.get(socketId);
    this.socketToSession.delete(socketId);
    return session;
  }

  createLobby({ ownerSocketId, ownerName, lobbyName, maxPlayers, cardBackStyle = 1 }) {
    const ownerSession = this.upsertSession(ownerSocketId, ownerName);
    const size = clampPlayers(maxPlayers);
    const id = randomUUID();
    const slots = [];

    for (let i = 0; i < size; i++) {
      if (i === 0) {
        slots.push({
          type: "human",
          occupied: true,
          name: ownerSession.name,
          occupantSessionId: ownerSession.id,
          isOwner: true
        });
      } else {
        slots.push({
          type: "human",
          occupied: false,
          name: "",
          occupantSessionId: null,
          isOwner: false
        });
      }
    }

    const lobby = {
      id,
      name: normalizeName(lobbyName, "Lobby"),
      ownerSessionId: ownerSession.id,
      ownerName: ownerSession.name,
      cardBackStyle: Math.max(1, Math.min(5, Number(cardBackStyle) || 1)),
      maxPlayers: size,
      phase: "setup",
      round: 1,
      slots,
      seatToPlayer: {},
      spectators: [],
      hasRecordedWin: false,
      gameState: null,
      chat: {
        byRoundCount: 0,
        bySessionTimestamps: new Map(),
        messages: []
      }
    };

    this.lobbies.set(id, lobby);
    ownerSession.role = "owner";
    ownerSession.lobbyId = id;
    ownerSession.seatIndex = 0;
    return lobby;
  }

  getLobby(lobbyId) {
    return this.lobbies.get(lobbyId) || null;
  }

  listLobbySummaries() {
    return [...this.lobbies.values()].map((lobby) => {
      const names = lobby.slots
        .filter((s) => s.type === "ai" || (s.type === "human" && s.occupied && s.name))
        .map((s) => s.name);
      const setupOpenSeats = lobby.phase === "setup"
        ? lobby.slots
          .map((s, idx) => ({ s, idx }))
          .filter(({ s }) => s.type === "human" && !s.occupied)
          .map(({ idx }) => idx)
        : [];
      const aiSeatIndices = lobby.slots
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.type === "ai")
        .map(({ idx }) => idx);
      return {
        id: lobby.id,
        name: lobby.name,
        phase: lobby.phase,
        round: lobby.round,
        maxPlayers: lobby.maxPlayers,
        playersJoined: names.length,
        playerNames: names,
        spectators: [...lobby.spectators],
        setupOpenSeats,
        aiSeatIndices
      };
    });
  }

  takeoverAiSeat({ socketId, lobbyId, seatIndex, playerName }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: "Lobby not found." };
    if (lobby.phase !== "setup" && lobby.phase !== "in_progress") {
      return { ok: false, reason: "Lobby is not joinable." };
    }

    const session = this.upsertSession(socketId, playerName);
    // Taking over AI seat always promotes caller to a human player in this lobby.

    const idx = Number(seatIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= lobby.maxPlayers) return { ok: false, reason: "Invalid seat." };
    const slot = lobby.slots[idx];
    if (!slot || slot.type !== "ai") return { ok: false, reason: "Selected seat is not AI." };

    slot.type = "human";
    slot.occupied = true;
    slot.occupantSessionId = session.id;
    slot.name = session.name;

    session.role = "player";
    session.lobbyId = lobby.id;
    session.seatIndex = idx;
    lobby.spectators = lobby.spectators.filter((n) => n !== session.name);

    if (lobby.phase === "in_progress" && lobby.gameState) {
      const playerIndex = lobby.seatToPlayer ? lobby.seatToPlayer[idx] : undefined;
      if (playerIndex !== undefined && lobby.gameState.players?.[playerIndex]) {
        lobby.gameState.players[playerIndex].isAI = false;
        lobby.gameState.players[playerIndex].name = session.name;
      }
    }

    return { ok: true, lobby, session };
  }

  joinSeat({ socketId, lobbyId, seatIndex, playerName }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: "Lobby not found." };
    if (lobby.phase !== "setup") return { ok: false, reason: "Lobby already in progress." };

    const session = this.upsertSession(socketId, playerName);
    const idx = Number(seatIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= lobby.maxPlayers) return { ok: false, reason: "Invalid seat." };
    const slot = lobby.slots[idx];
    if (slot.type !== "human") return { ok: false, reason: "Seat is not human." };
    if (slot.occupied) return { ok: false, reason: "Seat already occupied." };

    slot.occupied = true;
    slot.name = session.name;
    slot.occupantSessionId = session.id;

    session.role = "player";
    session.lobbyId = lobby.id;
    session.seatIndex = idx;

    lobby.spectators = lobby.spectators.filter((n) => n !== session.name);
    return { ok: true, lobby, session };
  }

  spectate({ socketId, lobbyId, spectatorName }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: "Lobby not found." };

    const session = this.upsertSession(socketId, spectatorName);
    session.role = "spectator";
    session.lobbyId = lobby.id;
    session.seatIndex = -1;

    if (!lobby.spectators.includes(session.name)) lobby.spectators.push(session.name);
    return { ok: true, lobby, session };
  }

  updateSetup({ socketId, lobbyId, maxPlayers, slots }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: "Lobby not found." };
    if (lobby.phase !== "setup") return { ok: false, reason: "Cannot edit setup after game start." };

    const session = this.getSession(socketId);
    if (!session) return { ok: false, reason: "Session not found." };
    const isOwner = session.id === lobby.ownerSessionId;
    const isSeatedPlayer = session.role === "player" && session.lobbyId === lobby.id && session.seatIndex >= 0;
    if (!isOwner && !isSeatedPlayer) return { ok: false, reason: "Only owner or joined players can edit setup." };

    const targetSize = clampPlayers(maxPlayers);

    while (lobby.slots.length < targetSize) {
      lobby.slots.push({ type: "human", occupied: false, name: "", occupantSessionId: null, isOwner: false });
    }
    if (lobby.slots.length > targetSize) {
      lobby.slots = lobby.slots.slice(0, targetSize);
    }
    lobby.maxPlayers = targetSize;

    if (Array.isArray(slots)) {
      for (let i = 0; i < lobby.maxPlayers; i++) {
        const incoming = slots[i];
        if (!incoming) continue;
        const existing = lobby.slots[i];
        const newType = incoming.type === "ai" ? "ai" : "human";
        existing.type = newType;

        if (newType === "ai") {
          existing.occupied = true;
          existing.occupantSessionId = null;
          existing.name = normalizeName(incoming.name, `AI ${i + 1}`);
        } else if (existing.isOwner) {
          existing.occupied = true;
          existing.name = normalizeName(incoming.name, existing.name || "Owner");
        } else if (!existing.occupied) {
          existing.name = normalizeName(incoming.name, "");
        }
      }
    }

    return { ok: true, lobby };
  }

  startGame({ socketId, lobbyId, buildInitialGameState }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: "Lobby not found." };
    if (lobby.phase !== "setup") return { ok: false, reason: "Game already started." };

    const session = this.getSession(socketId);
    if (!session || session.id !== lobby.ownerSessionId) return { ok: false, reason: "Only owner can start game." };

    const activePlayers = [];
    const seatToPlayer = {};

    for (let i = 0; i < lobby.maxPlayers; i++) {
      const s = lobby.slots[i];
      if (s.type === "ai") {
        seatToPlayer[i] = activePlayers.length;
        activePlayers.push({ name: s.name, isAI: true });
      } else if (s.occupied && s.name) {
        seatToPlayer[i] = activePlayers.length;
        activePlayers.push({ name: s.name, isAI: false, sessionId: s.occupantSessionId });
      }
    }

    if (activePlayers.length < 2 || activePlayers.length > 7) {
      return { ok: false, reason: "Need 2-7 active players to start." };
    }

    lobby.phase = "in_progress";
    lobby.round = 1;
    lobby.hasRecordedWin = false;
    lobby.seatToPlayer = seatToPlayer;
    lobby.chat.byRoundCount = 0;
    lobby.chat.messages = [];
    lobby.chat.bySessionTimestamps = new Map();

    lobby.gameState = buildInitialGameState(activePlayers);
    return { ok: true, lobby };
  }

  recordLobbyWinnerIfNeeded(lobby) {
    if (!lobby || lobby.hasRecordedWin) return null;
    const game = lobby.gameState;
    if (!game || game.phase !== "gameOver" || !Array.isArray(game.players) || game.players.length === 0) {
      return null;
    }

    const sorted = [...game.players].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    const winnerName = normalizeName(sorted[0]?.name, "");
    if (!winnerName) return null;

    const prev = this.userWins.get(winnerName) || 0;
    this.userWins.set(winnerName, prev + 1);
    lobby.hasRecordedWin = true;
    lobby.phase = "completed";
    return winnerName;
  }

  leaderboardTop(limit = 10) {
    return [...this.userWins.entries()]
      .map(([name, wins]) => ({ name, wins }))
      .sort((a, b) => (b.wins - a.wins) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  addChat({ socketId, lobbyId, text, now = Date.now() }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return { ok: false, reason: "Lobby not found." };
    if (lobby.phase !== "in_progress") return { ok: false, reason: "Chat available only during active rounds." };

    const session = this.getSession(socketId);
    if (!session) return { ok: false, reason: "Session not found." };

    const trimmed = String(text ?? "").trim();
    if (!trimmed) return { ok: false, reason: "Message cannot be empty." };
    if (trimmed.length > 200) return { ok: false, reason: "Message exceeds 200 characters." };

    const timestamps = lobby.chat.bySessionTimestamps.get(session.id) || [];
    const recent = timestamps.filter((t) => now - t < 10000);
    if (recent.length >= 5) return { ok: false, reason: "Rate limit: max 5 messages per 10 seconds." };
    if (lobby.chat.byRoundCount >= 100) return { ok: false, reason: "Round chat limit reached (100)." };

    recent.push(now);
    lobby.chat.bySessionTimestamps.set(session.id, recent);
    lobby.chat.byRoundCount += 1;

    const msg = {
      id: randomUUID(),
      round: lobby.round,
      sender: session.name,
      text: trimmed,
      ts: now
    };

    lobby.chat.messages.push(msg);
    lobby.chat.messages = lobby.chat.messages.slice(-1000);
    return { ok: true, lobby, message: msg };
  }

  snapshotForSession(lobby, session) {
    const base = {
      id: lobby.id,
      name: lobby.name,
      ownerName: lobby.ownerName,
      phase: lobby.phase,
      round: lobby.round,
      maxPlayers: lobby.maxPlayers,
      cardBackStyle: lobby.cardBackStyle,
      slots: lobby.slots.map((s) => ({
        type: s.type,
        occupied: s.occupied,
        name: s.name,
        isOwner: s.isOwner
      })),
      spectators: [...lobby.spectators],
      seatToPlayer: lobby.seatToPlayer,
      chat: {
        byRoundCount: lobby.chat.byRoundCount,
        messages: [...lobby.chat.messages]
      },
      gameState: lobby.gameState
    };

    if (!session) return base;
    const isOwner = session.id === lobby.ownerSessionId;
    return { ...base, sessionRole: isOwner ? "owner" : session.role };
  }
}

const SUITS = ["C", "D", "H", "S"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RED_SUITS = new Set(["D", "H"]);

const ROUND_REQUIREMENTS = {
  1: { sets: 2, runs: 0 },
  2: { sets: 1, runs: 1 },
  3: { sets: 0, runs: 2 },
  4: { sets: 3, runs: 0 },
  5: { sets: 2, runs: 1 },
  6: { sets: 1, runs: 2 },
  7: { sets: 0, runs: 3 }
};

const EVENTS = {
  SESSION_HELLO: "session:hello",
  SESSION_ACK: "session:ack",
  LOBBY_CREATE: "lobby:create",
  LOBBY_DELETE: "lobby:delete",
  LOBBY_LIST: "lobby:list",
  LOBBY_LIST_UPDATE: "lobby:list:update",
  LOBBY_OPEN_SETUP: "lobby:open-setup",
  LOBBY_JOIN_SEAT: "lobby:join-seat",
  LOBBY_SPECTATE: "lobby:spectate",
  LOBBY_TAKEOVER_AI: "lobby:takeover-ai",
  LOBBY_UPDATE_SETUP: "lobby:update-setup",
  LOBBY_SNAPSHOT: "lobby:snapshot",
  GAME_START: "game:start",
  GAME_ACTION: "game:action",
  GAME_COMPLETE: "game:complete",
  GAME_SNAPSHOT: "game:snapshot",
  CHAT_SEND: "chat:send",
  CHAT_UPDATE: "chat:update",
  LEADERBOARD_UPDATE: "leaderboard:update",
  ERROR: "error:server"
};

const GAME_ACTIONS = {
  SYNC_STATE: "sync_state"
};

const state = {
  lobbies: [],
  nextLobbyId: 1,
  activeLobbyId: null,
  session: { name: "", role: "none", seatIndex: -1 },
  players: [],
  round: 1,
  dealerIndex: 0,
  currentPlayer: 0,
  drawPile: [],
  discardPile: [],
  tableMelds: [],
  nextMeldId: 1,
  phase: "setup",
  log: [],
  draftMelds: [],
  selectedCardIds: new Set(),
  buyingOrder: [],
  buyingIndex: 0,
  discardBoughtBy: null,
  lastDiscarderIndex: null,
  turnTakenThisRound: [],
  pendingRoundWinnerIndex: null,
  gameOver: false,
  aiTimer: null,
  viewerIndex: 0,
  lastDiscardRenderId: null,
  turnDiscardDecisionMade: false,
  chatMessages: [],
  chatRecentTimestamps: [],
  chatRoundCount: 0,
  socket: null,
  sessionId: null,
  isApplyingServerState: false,
  leaderboard: {
    totalWins: [],
    lowestWinningScores: []
  },
  lobbyRefreshTimer: null,
  lastLobbyId: null,
  theme: "light",
  roundSummary: null,
  showRoundSummary: false,
  roundRevealEndsAt: 0,
  roundRevealShownFor: 0
};
state.selectedCardBackStyle = 1;

const el = (id) => document.getElementById(id);

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  state.theme = next;
  document.body.setAttribute("data-theme", next);
  const btn = el("themeToggle");
  if (btn) btn.textContent = next === "dark" ? "Light Theme" : "Dark Theme";
  try {
    localStorage.setItem("pr_theme", next);
  } catch (_err) {
    // Ignore storage errors in restricted environments.
  }
}

function initTheme() {
  let saved = "light";
  try {
    saved = localStorage.getItem("pr_theme") || "light";
  } catch (_err) {
    saved = "light";
  }
  applyTheme(saved);
}

function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

function activeLobby() {
  return state.lobbies.find((l) => l.id === state.activeLobbyId) || null;
}

function upsertLobbyFromSnapshot(snapshot) {
  const idx = state.lobbies.findIndex((l) => l.id === snapshot.id);
  if (idx >= 0) state.lobbies[idx] = { ...state.lobbies[idx], ...snapshot };
  else state.lobbies.unshift({ ...snapshot });
}

function applyGameStateSnapshot(gameState) {
  if (!gameState) return;
  const previousRound = state.round;
  state.isApplyingServerState = true;
  state.round = gameState.round;
  state.dealerIndex = gameState.dealerIndex;
  state.currentPlayer = gameState.currentPlayer;
  state.phase = gameState.phase;
  state.drawPile = gameState.drawPile || [];
  state.discardPile = gameState.discardPile || [];
  state.tableMelds = gameState.tableMelds || [];
  state.nextMeldId = gameState.nextMeldId || 1;
  state.draftMelds = gameState.draftMelds || [];
  state.buyingOrder = gameState.buyingOrder || [];
  state.buyingIndex = gameState.buyingIndex || 0;
  state.discardBoughtBy = gameState.discardBoughtBy ?? null;
  state.lastDiscarderIndex = Number.isInteger(gameState.lastDiscarderIndex) ? gameState.lastDiscarderIndex : null;
  state.players = gameState.players || [];
  if (Array.isArray(gameState.turnTakenThisRound) && gameState.turnTakenThisRound.length === state.players.length) {
    state.turnTakenThisRound = [...gameState.turnTakenThisRound];
  } else {
    state.turnTakenThisRound = state.players.map(() => false);
    if (Number.isInteger(gameState.currentPlayer) && gameState.currentPlayer >= 0 && gameState.currentPlayer < state.players.length) {
      state.turnTakenThisRound[gameState.currentPlayer] = true;
    }
  }
  state.pendingRoundWinnerIndex = Number.isInteger(gameState.pendingRoundWinnerIndex)
    ? gameState.pendingRoundWinnerIndex
    : null;
  state.turnDiscardDecisionMade = !!gameState.turnDiscardDecisionMade;
  if (gameState.round !== previousRound && state.roundRevealShownFor !== gameState.round) {
    state.roundRevealShownFor = gameState.round;
    state.roundRevealEndsAt = Date.now() + 1600;
  }

  const lobby = activeLobby();
  if (state.session.role === "spectator") {
    state.viewerIndex = Math.max(0, state.players.findIndex((p) => !p.isAI));
  } else if (lobby && lobby.seatToPlayer && state.session.seatIndex >= 0) {
    const mapped = lobby.seatToPlayer[state.session.seatIndex];
    if (mapped !== undefined) state.viewerIndex = mapped;
  }
  renderAll();
  state.isApplyingServerState = false;
}

function applyLobbySnapshot(snapshot) {
  upsertLobbyFromSnapshot(snapshot);
  state.activeLobbyId = snapshot.id;
  state.lastLobbyId = snapshot.id;
  if (snapshot.sessionRole) state.session.role = snapshot.sessionRole;
  if (snapshot.chat) {
    state.chatMessages = snapshot.chat.messages || [];
    state.chatRoundCount = snapshot.chat.byRoundCount || 0;
  }
  if (snapshot.phase === "setup") {
    enterSetupLobby();
  } else if (snapshot.phase === "in_progress") {
    showGame();
    if (snapshot.gameState) applyGameStateSnapshot(snapshot.gameState);
  }
  renderLobbyList();
  renderRejoinButton();
}

function connectSocketIfAvailable() {
  if (state.socket || typeof window.io !== "function") return;
  const socket = window.io({ transports: ["websocket"] });
  state.socket = socket;

  socket.on("connect", () => {
    socket.emit(EVENTS.SESSION_HELLO, { name: state.session.name || "Player" });
    socket.emit(EVENTS.LOBBY_LIST);
  });

  socket.on(EVENTS.SESSION_ACK, (payload) => {
    state.sessionId = payload.sessionId;
    if (payload.name) state.session.name = payload.name;
  });

  socket.on(EVENTS.LOBBY_LIST_UPDATE, (list) => {
    state.lobbies = Array.isArray(list) ? list.map((x) => ({ ...x })) : [];
    renderLobbyList();
    renderRejoinButton();
  });

  socket.on(EVENTS.LEADERBOARD_UPDATE, (rows) => {
    if (Array.isArray(rows)) {
      // Backward compatibility with old server payload.
      state.leaderboard = {
        totalWins: rows.map((r) => ({ name: r.name, wins: r.wins })),
        lowestWinningScores: []
      };
    } else {
      state.leaderboard = {
        totalWins: Array.isArray(rows?.totalWins) ? rows.totalWins.map((r) => ({ name: r.name, wins: r.wins })) : [],
        lowestWinningScores: Array.isArray(rows?.lowestWinningScores)
          ? rows.lowestWinningScores.map((r) => ({ name: r.name, score: r.score }))
          : []
      };
    }
    renderLeaderboard();
  });

  socket.on(EVENTS.LOBBY_SNAPSHOT, (snapshot) => {
    if (!snapshot?.id) return;
    applyLobbySnapshot(snapshot);
  });

  socket.on(EVENTS.GAME_SNAPSHOT, (gameState) => {
    if (gameState) applyGameStateSnapshot(gameState);
  });

  socket.on(EVENTS.CHAT_UPDATE, (chat) => {
    if (!chat) return;
    state.chatMessages = chat.messages || [];
    state.chatRoundCount = chat.byRoundCount || 0;
    renderChat();
  });

  socket.on(EVENTS.ERROR, (payload) => {
    if (payload?.message) alert(payload.message);
  });
}

function emitSocket(eventName, payload) {
  if (!state.socket) return false;
  state.socket.emit(eventName, payload);
  return true;
}

function setLobbyRefreshActive(active) {
  if (active) {
    if (state.lobbyRefreshTimer) return;
    state.lobbyRefreshTimer = setInterval(() => {
      emitSocket(EVENTS.LOBBY_LIST);
    }, 3000);
    return;
  }
  if (state.lobbyRefreshTimer) {
    clearInterval(state.lobbyRefreshTimer);
    state.lobbyRefreshTimer = null;
  }
}

function chatSenderName() {
  if (state.session?.name) return state.session.name;
  const viewer = viewerPlayerObj();
  return viewer?.name || "User";
}

function addChatMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { ok: false, reason: "Message cannot be empty." };
  if (trimmed.length > 200) return { ok: false, reason: "Message exceeds 200 characters." };
  const lobby = activeLobby();
  if (emitSocket(EVENTS.CHAT_SEND, { lobbyId: lobby?.id, text: trimmed })) {
    return { ok: true };
  }

  if (state.phase === "setup" || state.phase === "gameOver") return { ok: false, reason: "Chat is available during active rounds only." };
  const now = Date.now();
  state.chatRecentTimestamps = state.chatRecentTimestamps.filter((t) => now - t < 10000);
  if (state.chatRecentTimestamps.length >= 5) return { ok: false, reason: "Rate limit: max 5 messages per 10 seconds." };
  if (state.chatRoundCount >= 100) return { ok: false, reason: "Round chat limit reached (100 messages)." };
  state.chatRecentTimestamps.push(now);
  state.chatRoundCount += 1;
  state.chatMessages.push({ round: state.round, sender: chatSenderName(), text: trimmed, ts: now });
  state.chatMessages = state.chatMessages.slice(-500);
  return { ok: true };
}

function renderCardBackPicker() {
  const wrap = el("cardBackPicker");
  if (!wrap) return;
  const options = [1, 2, 3, 4, 5];
  wrap.innerHTML = options.map((n) => `
    <button type="button" class="card-back-option ${state.selectedCardBackStyle === n ? "selected" : ""}" data-back="${n}">
      <div class="card-back back-style-${n}"></div>
      <div class="tiny">${n}</div>
    </button>
  `).join("");
}

function setCardBackChoice(styleNum) {
  if (styleNum < 1 || styleNum > 5) return;
  state.selectedCardBackStyle = styleNum;
  renderCardBackPicker();
}

function cardId(card) { return `${card.rank}-${card.suit}-${card.deck}-${card.uid}`; }
function isWild(card) { return card.rank === "2"; }

function rankToValue(rank) {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

function cardPoints(card) {
  if (card.rank === "2") return 20;
  if (card.rank === "A") return 15;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function cardLabel(card) {
  const suitMap = { C: "♣", D: "♦", H: "♥", S: "♠" };
  return `${card.rank}${suitMap[card.suit]}`;
}

function suitSymbol(suit) {
  return { C: "♣", D: "♦", H: "♥", S: "♠" }[suit];
}

function suitName(suit) {
  return { C: "Clubs", D: "Diamonds", H: "Hearts", S: "Spades" }[suit] || suit;
}

function meldDisplayLabel(meld) {
  if (meld.type === "set") {
    const v = validateSet(meld.cards);
    const rank = v.ok && v.rank ? v.rank : "?";
    return `SET of ${rank}`;
  }
  const v = validateRun(meld.cards);
  const suit = v.ok && v.suit ? suitName(v.suit) : "?";
  return `RUN of ${suit}`;
}

function renderCardFaceContent(card) {
  return `
    <div class="corner-top">${card.rank}${suitSymbol(card.suit)}</div>
    <div class="center">${suitSymbol(card.suit)}</div>
    <div class="corner-bottom">${card.rank}${suitSymbol(card.suit)}</div>
  `;
}

function renderCardModel(card, opts = {}) {
  const selectable = !!opts.selectable;
  const checked = !!opts.checked;
  const disabled = !!opts.disabled;
  const extraClass = opts.extraClass || "";
  const css = RED_SUITS.has(card.suit) ? "red" : "black";
  const selectCss = selectable ? "selectable" : "";
  const disabledCss = disabled ? "disabled" : "";
  const checkbox = selectable
    ? `<input type="checkbox" ${checked ? "checked" : ""} data-id="${cardId(card)}" ${disabled ? "disabled" : ""} />`
    : "";

  return `
    <label class="playing-card ${css} ${selectCss} ${disabledCss} ${extraClass}">
      ${checkbox}
      ${renderCardFaceContent(card)}
    </label>
  `;
}

function renderFlippingCardModel(card, backStyle, delayMs) {
  const css = RED_SUITS.has(card.suit) ? "red" : "black";
  return `
    <div class="flip-card" style="--flip-delay:${delayMs}ms;">
      <div class="flip-card-inner">
        <div class="flip-face flip-front playing-card ${css}">
          ${renderCardFaceContent(card)}
        </div>
        <div class="flip-face flip-back">
          <div class="card-back back-style-${backStyle}"></div>
        </div>
      </div>
    </div>
  `;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(deckCount) {
  const cards = [];
  let uid = 1;
  for (let d = 1; d <= deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit, deck: d, uid: uid++ });
      }
    }
  }
  return shuffle(cards);
}

function dealCountForRound(round) {
  return round <= 4 ? 10 : 12;
}

function requirementText(round) {
  const req = ROUND_REQUIREMENTS[round];
  return `Round ${round}: ${req.sets} set(s), ${req.runs} run(s)`;
}

function addLog(msg) {
  state.log.unshift(msg);
  state.log = state.log.slice(0, 200);
  renderLog();
}

function rotateDealer() {
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
}

function nextIndex(idx) {
  return (idx + 1) % state.players.length;
}

function reshuffleIfNeeded() {
  if (state.drawPile.length > 0) return;
  if (state.discardPile.length <= 1) return;
  const top = state.discardPile.pop();
  state.drawPile = shuffle(state.discardPile.splice(0));
  state.discardPile = [top];
  addLog("Draw pile was empty. Discard pile reshuffled into draw pile.");
}

function drawOne() {
  reshuffleIfNeeded();
  if (state.drawPile.length === 0) return null;
  return state.drawPile.pop();
}

function serializeCurrentGameState() {
  return {
    round: state.round,
    dealerIndex: state.dealerIndex,
    currentPlayer: state.currentPlayer,
    phase: state.phase,
    drawPile: state.drawPile,
    discardPile: state.discardPile,
    tableMelds: state.tableMelds,
    nextMeldId: state.nextMeldId,
    draftMelds: state.draftMelds,
    turnDiscardDecisionMade: state.turnDiscardDecisionMade,
    buyingOrder: state.buyingOrder,
    buyingIndex: state.buyingIndex,
    discardBoughtBy: state.discardBoughtBy,
    lastDiscarderIndex: state.lastDiscarderIndex,
    turnTakenThisRound: state.turnTakenThisRound,
    pendingRoundWinnerIndex: state.pendingRoundWinnerIndex,
    players: state.players
  };
}

function markTurnTaken(idx) {
  if (!Array.isArray(state.turnTakenThisRound) || state.turnTakenThisRound.length !== state.players.length) {
    state.turnTakenThisRound = state.players.map(() => false);
  }
  if (Number.isInteger(idx) && idx >= 0 && idx < state.turnTakenThisRound.length) {
    state.turnTakenThisRound[idx] = true;
  }
}

function allPlayersHaveTakenTurnThisRound() {
  if (!Array.isArray(state.turnTakenThisRound) || state.turnTakenThisRound.length !== state.players.length) {
    return false;
  }
  return state.turnTakenThisRound.every(Boolean);
}

function beginTurnForPlayer(idx) {
  state.currentPlayer = idx;
  state.phase = "offerDiscard";
  state.discardBoughtBy = null;
  state.buyingOrder = [];
  state.buyingIndex = 0;
  state.turnDiscardDecisionMade = false;
  markTurnTaken(idx);
}

function handlePlayerWentOut(winnerIndex) {
  if (!Number.isInteger(state.pendingRoundWinnerIndex)) {
    state.pendingRoundWinnerIndex = winnerIndex;
  }

  if (allPlayersHaveTakenTurnThisRound()) {
    roundEnd(state.pendingRoundWinnerIndex);
    return true;
  }

  const next = nextIndex(state.currentPlayer);
  beginTurnForPlayer(next);
  addLog(`${state.players[winnerIndex].name} is out of cards. Round will end after everyone has had one turn this round.`);
  addLog(`Turn passes to ${currentPlayerObj().name}.`);
  renderAll();
  syncGameStateToServer();
  return false;
}

function syncGameStateToServer() {
  if (state.isApplyingServerState) return;
  const lobby = activeLobby();
  if (!lobby || lobby.phase !== "in_progress") return;
  if (!state.socket) return;
  emitSocket(EVENTS.GAME_ACTION, {
    action: GAME_ACTIONS.SYNC_STATE,
    lobbyId: lobby.id,
    round: state.round,
    gameState: serializeCurrentGameState()
  });
}

function currentPlayerObj() {
  return state.players[state.currentPlayer];
}

function viewerPlayerObj() {
  return state.players[state.viewerIndex];
}

function cardByIdInHand(player, id) {
  return player.hand.find((c) => cardId(c) === id);
}

function selectedCardsFromHand() {
  const player = currentPlayerObj();
  return [...state.selectedCardIds]
    .map((id) => cardByIdInHand(player, id))
    .filter(Boolean);
}

function removeCardsFromHand(player, cards) {
  const removeIds = new Set(cards.map(cardId));
  player.hand = player.hand.filter((c) => !removeIds.has(cardId(c)));
}

function cardsPointsTotal(cards) {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0);
}

function combinations(arr, size) {
  const out = [];
  function walk(start, path) {
    if (path.length === size) {
      out.push([...path]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      walk(i + 1, path);
      path.pop();
    }
  }
  walk(0, []);
  return out;
}

function randomChance(probability) {
  return Math.random() < probability;
}

function validateSet(cards) {
  if (cards.length < 3) return { ok: false, reason: "A set needs at least 3 cards." };
  const wilds = cards.filter(isWild);
  const nonWild = cards.filter((c) => !isWild(c));
  if (nonWild.length === 0) return { ok: false, reason: "A set cannot be made only of 2s." };
  if (wilds.length > nonWild.length) return { ok: false, reason: "A set cannot have more wilds than non-wild cards." };
  const rank = nonWild[0].rank;
  if (!nonWild.every((c) => c.rank === rank)) return { ok: false, reason: "Set non-wild cards must match rank." };
  return { ok: true, rank };
}

function validateRun(cards) {
  if (cards.length < 4) return { ok: false, reason: "A run needs at least 4 cards." };
  const wilds = cards.filter(isWild);
  const nonWild = cards.filter((c) => !isWild(c));
  if (nonWild.length === 0) return { ok: false, reason: "A run cannot be made only of 2s." };
  if (wilds.length > nonWild.length) return { ok: false, reason: "A run cannot have more wilds than non-wild cards." };

  const suit = nonWild[0].suit;
  if (!nonWild.every((c) => c.suit === suit)) return { ok: false, reason: "Run non-wild cards must share suit." };

  const n = cards.length;
  const wildCount = wilds.length;
  const lowRanks = nonWild.map((c) => rankToValue(c.rank));
  const highRanks = nonWild.map((c) => (c.rank === "A" ? 14 : rankToValue(c.rank)));

  const canMakeSequence = (rawRanks) => {
    const ranks = [...rawRanks].sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] === ranks[i - 1]) return false;
    }
    // With Ace high support, highest consecutive start is 15 - run length.
    for (let start = 1; start <= 15 - n; start++) {
      const seq = new Set(Array.from({ length: n }, (_, i) => start + i));
      let allIncluded = true;
      for (const r of ranks) {
        if (!seq.has(r)) {
          allIncluded = false;
          break;
        }
      }
      if (!allIncluded) continue;
      if (n - ranks.length === wildCount) return true;
    }
    return false;
  };

  if (canMakeSequence(lowRanks) || canMakeSequence(highRanks)) {
    return { ok: true, suit };
  }

  return { ok: false, reason: "Run cards cannot form one consecutive sequence." };
}

function validateMeldByType(type, cards) {
  return type === "set" ? validateSet(cards) : validateRun(cards);
}

function runValueForMode(card, aceHigh) {
  if (card.rank === "A") return aceHigh ? 14 : 1;
  return rankToValue(card.rank);
}

function runCandidates(cards) {
  const wilds = cards.filter(isWild);
  const nonWild = cards.filter((c) => !isWild(c));
  if (nonWild.length === 0) return [];

  const n = cards.length;
  const out = [];

  for (const aceHigh of [false, true]) {
    const mapped = nonWild.map((c) => ({ card: c, value: runValueForMode(c, aceHigh) }));
    const byValue = new Map();
    let duplicate = false;
    for (const entry of mapped) {
      if (byValue.has(entry.value)) {
        duplicate = true;
        break;
      }
      byValue.set(entry.value, entry.card);
    }
    if (duplicate) continue;

    for (let start = 1; start <= 15 - n; start++) {
      const seq = Array.from({ length: n }, (_, i) => start + i);
      const seqSet = new Set(seq);
      let includesAll = true;
      for (const entry of mapped) {
        if (!seqSet.has(entry.value)) {
          includesAll = false;
          break;
        }
      }
      if (!includesAll) continue;

      const missing = seq.filter((v) => !byValue.has(v));
      if (missing.length !== wilds.length) continue;

      const wildQueue = [...wilds];
      const ordered = [];
      const wildValues = [];
      for (let i = 0; i < seq.length; i++) {
        const v = seq[i];
        if (byValue.has(v)) {
          ordered.push(byValue.get(v));
        } else {
          ordered.push(wildQueue.shift());
          wildValues.push(v);
        }
      }

      out.push({
        aceHigh,
        start,
        top: seq[seq.length - 1],
        ordered,
        wildValues,
        hasBottomWild: wildValues.includes(seq[0]),
        hasTopWild: wildValues.includes(seq[seq.length - 1])
      });
    }
  }

  return out;
}

function pickRunCandidate(cards, preferEdgeWild = null) {
  let candidates = runCandidates(cards);
  if (!candidates.length) return null;

  if (preferEdgeWild === "top") {
    const filtered = candidates.filter((c) => c.hasTopWild);
    if (filtered.length) candidates = filtered;
  } else if (preferEdgeWild === "bottom") {
    const filtered = candidates.filter((c) => c.hasBottomWild);
    if (filtered.length) candidates = filtered;
  }

  candidates.sort((a, b) => (b.top - a.top) || (b.start - a.start));
  return candidates[0];
}

function orderRunCardsLowToHigh(cards, preferEdgeWild = null) {
  const chosen = pickRunCandidate(cards, preferEdgeWild);
  return chosen ? chosen.ordered : [...cards];
}

function buildCandidateMelds(hand, type) {
  const minSize = type === "set" ? 3 : 4;
  const maxSize = Math.min(hand.length, type === "set" ? 5 : 7);
  const found = [];
  const seen = new Set();

  for (let size = minSize; size <= maxSize; size++) {
    const groups = combinations(hand, size);
    for (const g of groups) {
      const v = validateMeldByType(type, g);
      if (!v.ok) continue;
      const key = g.map(cardId).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        type,
        cards: g,
        ids: new Set(g.map(cardId)),
        points: cardsPointsTotal(g),
        anchor: type === "set" ? v.rank : v.suit
      });
    }
  }

  return found;
}

function conflictWithChosen(candidate, chosen) {
  for (const m of chosen) {
    for (const id of candidate.ids) {
      if (m.ids.has(id)) return true;
    }
  }
  return false;
}

function pickBestRoundPlan(hand, round) {
  const req = ROUND_REQUIREMENTS[round];
  const setCandidates = buildCandidateMelds(hand, "set");
  const runCandidates = buildCandidateMelds(hand, "run");
  let best = null;

  function evaluate(chosen) {
    if (chosen.filter((m) => m.type === "set").length !== req.sets) return;
    if (chosen.filter((m) => m.type === "run").length !== req.runs) return;

    const setAnchors = chosen.filter((m) => m.type === "set").map((m) => m.anchor);
    if (new Set(setAnchors).size !== setAnchors.length) return;

    const runAnchors = chosen.filter((m) => m.type === "run").map((m) => m.anchor);
    if (new Set(runAnchors).size !== runAnchors.length) return;

    const usedIds = new Set(chosen.flatMap((m) => [...m.ids]));
    const removedPoints = chosen.reduce((sum, m) => sum + m.points, 0);
    const removedCount = usedIds.size;
    const remainingCards = hand.length - removedCount;
    if (round === 7 && remainingCards !== 0) return;

    const score = removedPoints * 3 + removedCount * 2 - remainingCards + Math.random() * 0.5;
    if (!best || score > best.score) {
      best = {
        score,
        melds: chosen.map((m) => ({ type: m.type, cards: [...m.cards] })),
        usedIds
      };
    }
  }

  function chooseRuns(start, neededRuns, chosen) {
    if (neededRuns === 0) {
      evaluate(chosen);
      return;
    }
    for (let i = start; i < runCandidates.length; i++) {
      const c = runCandidates[i];
      if (conflictWithChosen(c, chosen)) continue;
      if (chosen.some((m) => m.type === "run" && m.anchor === c.anchor)) continue;
      chosen.push(c);
      chooseRuns(i + 1, neededRuns - 1, chosen);
      chosen.pop();
    }
  }

  function chooseSets(start, neededSets, chosen) {
    if (neededSets === 0) {
      chooseRuns(0, req.runs, chosen);
      return;
    }
    for (let i = start; i < setCandidates.length; i++) {
      const c = setCandidates[i];
      if (conflictWithChosen(c, chosen)) continue;
      if (chosen.some((m) => m.type === "set" && m.anchor === c.anchor)) continue;
      chosen.push(c);
      chooseSets(i + 1, neededSets - 1, chosen);
      chosen.pop();
    }
  }

  chooseSets(0, req.sets, []);
  return best;
}

function cardKeepScore(hand, card) {
  if (isWild(card)) return 100;

  const others = hand.filter((c) => cardId(c) !== cardId(card));
  const sameRank = others.filter((c) => !isWild(c) && c.rank === card.rank).length;
  const wilds = others.filter(isWild).length;
  const setNear = sameRank + wilds;

  const sameSuit = others.filter((c) => !isWild(c) && c.suit === card.suit).map((c) => rankToValue(c.rank));
  const rv = rankToValue(card.rank);
  let runNear = 0;
  for (const n of sameSuit) {
    if (Math.abs(n - rv) <= 2) runNear++;
  }
  runNear += Math.min(wilds, 2);

  return setNear * 3 + runNear * 2 - cardPoints(card) * 0.2;
}

function chooseDiscardCardAI(player) {
  const ranked = [...player.hand]
    .map((c) => ({ c, score: cardKeepScore(player.hand, c) + Math.random() * 0.2 }))
    .sort((a, b) => a.score - b.score);
  return ranked[0]?.c || null;
}

function layoffPotentialPoints(hand) {
  let points = 0;
  for (const c of hand) {
    for (const m of state.tableMelds) {
      const v = validateMeldByType(m.type, [...m.cards, c]);
      if (v.ok) {
        points += cardPoints(c);
        break;
      }
    }
  }
  return points;
}

function handUtilityForCurrentRound(player, hand) {
  if (player.hasMetRound) {
    return layoffPotentialPoints(hand) - cardsPointsTotal(hand) * 0.15;
  }
  const plan = pickBestRoundPlan(hand, state.round);
  if (!plan) return -cardsPointsTotal(hand) * 0.15;
  const removedPoints = cardsPointsTotal([...plan.usedIds].map((id) => hand.find((c) => cardId(c) === id)).filter(Boolean));
  return removedPoints - (hand.length - plan.usedIds.size) * 2;
}

function canSubmitRoundMelds(player, draftMelds, round) {
  const req = ROUND_REQUIREMENTS[round];
  const sets = draftMelds.filter((m) => m.type === "set");
  const runs = draftMelds.filter((m) => m.type === "run");

  if (sets.length !== req.sets || runs.length !== req.runs) {
    return { ok: false, reason: `This round requires exactly ${req.sets} set(s) and ${req.runs} run(s).` };
  }

  const setRanks = [];
  for (const m of sets) {
    const v = validateSet(m.cards);
    if (!v.ok) return { ok: false, reason: v.reason };
    setRanks.push(v.rank);
  }
  if (new Set(setRanks).size !== setRanks.length) {
    return { ok: false, reason: "Multiple sets in the same round cannot have the same number." };
  }

  const runSuits = [];
  for (const m of runs) {
    const v = validateRun(m.cards);
    if (!v.ok) return { ok: false, reason: v.reason };
    runSuits.push(v.suit);
  }
  if (new Set(runSuits).size !== runSuits.length) {
    return { ok: false, reason: "Multiple runs in the same round cannot have the same suit." };
  }

  const usedIds = draftMelds.flatMap((m) => m.cards.map(cardId));
  if (new Set(usedIds).size !== usedIds.length) {
    return { ok: false, reason: "A card cannot be used in multiple melds." };
  }

  if (round === 7) {
    const willRemove = new Set(usedIds);
    const remaining = player.hand.filter((c) => !willRemove.has(cardId(c)));
    if (remaining.length !== 0) {
      return { ok: false, reason: "Round 7 requires hand size 0 when the 3 runs are accepted." };
    }
  }

  return { ok: true };
}

function scoreHand(cards) {
  return cards.reduce((sum, c) => sum + cardPoints(c), 0);
}

function buildRoundSummary(winnerIndex) {
  const meldMap = new Map(state.tableMelds.map((m) => [m.id, m]));
  const players = state.players.map((p, idx) => {
    const roundPoints = idx === winnerIndex ? 0 : scoreHand(p.hand);
    const melds = (p.melds || [])
      .map((id) => meldMap.get(id))
      .filter(Boolean)
      .map((m) => ({
        id: m.id,
        type: m.type,
        cards: [...m.cards]
      }));
    return {
      name: p.name,
      isWinner: idx === winnerIndex,
      roundPoints,
      remainingCards: [...p.hand],
      melds
    };
  });
  return {
    round: state.round,
    endedBy: state.players[winnerIndex]?.name || "Unknown",
    players
  };
}

function renderRoundSummaryModal() {
  const modal = el("roundSummaryModal");
  const title = el("roundSummaryTitle");
  const body = el("roundSummaryBody");
  if (!modal || !title || !body) return;
  if (!state.showRoundSummary || !state.roundSummary) {
    modal.style.display = "none";
    return;
  }

  const summary = state.roundSummary;
  title.textContent = `Round ${summary.round} Complete`;

  body.innerHTML = `
    <p class="tiny">${summary.endedBy} ended the round.</p>
    <div class="round-summary-grid">
      ${summary.players.map((p) => `
        <div class="round-summary-player">
          <h3 class="summary-title">${p.name}${p.isWinner ? " (Round Winner)" : ""}</h3>
          <p class="summary-line"><strong>Points Gained:</strong> ${p.roundPoints}</p>
          <p class="summary-line"><strong>Melds:</strong></p>
          ${p.melds.length
            ? p.melds.map((m) => `
              <div class="summary-line">
                #${m.id} ${m.type.toUpperCase()}: ${m.cards.map(cardLabel).join(", ")}
              </div>
            `).join("")
            : `<p class="summary-line muted">No melds played.</p>`
          }
          <p class="summary-line"><strong>Remaining Cards:</strong></p>
          ${p.remainingCards.length
            ? `<div class="summary-line">${p.remainingCards.map(cardLabel).join(", ")}</div>`
            : `<p class="summary-line muted">No cards remaining.</p>`
          }
        </div>
      `).join("")}
    </div>
  `;
  modal.style.display = "flex";
}

function closeRoundSummary() {
  state.showRoundSummary = false;
  renderRoundSummaryModal();
}

function promptRunWildPlacement() {
  const modal = el("wildMoveModal");
  const topBtn = el("chooseWildTop");
  const bottomBtn = el("chooseWildBottom");
  if (!modal || !topBtn || !bottomBtn) {
    return Promise.resolve("top");
  }

  return new Promise((resolve) => {
    const finish = (choice) => {
      topBtn.onclick = null;
      bottomBtn.onclick = null;
      modal.style.display = "none";
      resolve(choice);
    };
    topBtn.onclick = () => finish("top");
    bottomBtn.onclick = () => finish("bottom");
    modal.style.display = "flex";
  });
}

function openHelpModal() {
  const modal = el("helpModal");
  if (!modal) return;
  modal.style.display = "flex";
}

function closeHelpModal() {
  const modal = el("helpModal");
  if (!modal) return;
  modal.style.display = "none";
}

function renderLastRoundSummaryButton() {
  const btn = el("viewLastRoundSummary");
  if (!btn) return;
  const hasSummary = !!state.roundSummary;
  btn.disabled = !hasSummary;
}

function viewLastRoundSummary() {
  if (!state.roundSummary) return;
  state.showRoundSummary = true;
  renderRoundSummaryModal();
}

function roundEnd(winnerIndex) {
  clearAiTimer();
  const lobby = activeLobby();
  const winner = state.players[winnerIndex];
  state.pendingRoundWinnerIndex = null;
  state.roundSummary = buildRoundSummary(winnerIndex);
  state.showRoundSummary = true;
  addLog(`${winner.name} ended Round ${state.round}. Scoring remaining hands...`);

  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (i === winnerIndex) continue;
    const pts = scoreHand(p.hand);
    p.score += pts;
    addLog(`${p.name} receives ${pts} point(s) from cards left in hand.`);
  }

  if (state.round === 7) {
    state.gameOver = true;
    state.phase = "gameOver";
    if (lobby) {
      // Keep lobby in-progress locally until final gameOver snapshot is synced.
      // Server will mark lobby completed after recording the winner.
      lobby.round = 7;
    }
    const sorted = [...state.players].sort((a, b) => a.score - b.score);
    const winnerText = sorted[0].name + " wins with " + sorted[0].score + " point(s).";
    if (lobby?.id) {
      emitSocket(EVENTS.GAME_COMPLETE, {
        lobbyId: lobby.id,
        winnerName: sorted[0].name,
        winnerScore: sorted[0].score
      });
    }
    el("gameOverArea").style.display = "block";
    el("gameOverArea").innerHTML = `<h2>Game Over</h2><p>${winnerText}</p>`;
    addLog(winnerText);
    renderAll();
    syncGameStateToServer();
    return;
  }

  state.round += 1;
  if (lobby) lobby.round = state.round;
  rotateDealer();
  startRound();
}
function startRound() {
  clearAiTimer();
  const lobby = activeLobby();
  if (lobby) lobby.round = state.round;
  state.tableMelds = [];
  state.nextMeldId = 1;
  state.draftMelds = [];
  state.selectedCardIds.clear();

  const dealCount = dealCountForRound(state.round);
  const deckCount = state.players.length <= 5 ? 2 : 3;
  state.drawPile = buildDeck(deckCount);
  state.discardPile = [];

  for (const p of state.players) {
    p.hand = [];
    p.melds = [];
    p.hasMetRound = false;
  }

  for (let i = 0; i < dealCount; i++) {
    for (const p of state.players) {
      p.hand.push(state.drawPile.pop());
    }
  }

  state.discardPile.push(state.drawPile.pop());
  state.turnTakenThisRound = state.players.map(() => false);
  state.pendingRoundWinnerIndex = null;
  beginTurnForPlayer(nextIndex(state.dealerIndex));
  state.lastDiscarderIndex = null;
  state.chatRoundCount = 0;
  state.chatRecentTimestamps = [];
  state.roundRevealShownFor = state.round;
  state.roundRevealEndsAt = Date.now() + 1600;

  addLog(`Round ${state.round} started. Dealer: ${state.players[state.dealerIndex].name}. ${state.players[state.currentPlayer].name} begins.`);
  renderAll();
  syncGameStateToServer();
}

function showHome() {
  clearAiTimer();
  setLobbyRefreshActive(true);
  el("homeArea").style.display = "block";
  el("setupArea").style.display = "none";
  el("scoreBar").style.display = "none";
  el("gameArea").style.display = "none";
  renderLobbyList();
  renderLeaderboard();
  renderRejoinButton();
  emitSocket(EVENTS.LOBBY_LIST);
}

function showSetup() {
  setLobbyRefreshActive(false);
  el("homeArea").style.display = "none";
  el("setupArea").style.display = "block";
  el("scoreBar").style.display = "none";
  el("gameArea").style.display = "none";
}

function showGame() {
  setLobbyRefreshActive(false);
  el("homeArea").style.display = "none";
  el("setupArea").style.display = "none";
  el("scoreBar").style.display = "block";
  el("gameArea").style.display = "grid";
}

function lobbyNames(lobby) {
  if (Array.isArray(lobby.playerNames)) return lobby.playerNames;
  if (!Array.isArray(lobby.slots)) return [];
  return lobby.slots
    .filter((s) => (s.type === "ai") || (s.type === "human" && s.occupied && s.name && s.name.trim()))
    .map((s) => s.name.trim());
}

function lobbyPlayerCount(lobby) {
  return lobbyNames(lobby).length;
}

function renderLobbyList() {
  const wrap = el("lobbyList");
  if (!wrap) return;
  if (state.lobbies.length === 0) {
    wrap.innerHTML = `<p class="tiny muted">No lobbies yet.</p>`;
    return;
  }

  wrap.className = "lobby-list";
  wrap.innerHTML = state.lobbies.map((lobby) => {
    const phaseText = lobby.phase === "setup"
      ? "In Progress (Setup)"
      : (lobby.phase === "in_progress" ? `In Progress (Round ${lobby.round})` : "Completed");
    const names = lobbyNames(lobby);
    const emptyHumanSlots = Array.isArray(lobby.setupOpenSeats)
      ? lobby.setupOpenSeats.map((idx) => ({ idx }))
      : (Array.isArray(lobby.slots)
        ? lobby.slots.map((s, idx) => ({ s, idx })).filter(({ s }) => s.type === "human" && !s.occupied)
        : []);

    const setupJoinButtons = lobby.phase === "setup"
      ? emptyHumanSlots.map(({ idx }) => `<button data-action="join-seat" data-lobby="${lobby.id}" data-seat="${idx}">Join Seat ${idx + 1}</button>`).join("")
      : "";
    const aiSeatIndices = Array.isArray(lobby.aiSeatIndices)
      ? lobby.aiSeatIndices
      : (Array.isArray(lobby.slots)
        ? lobby.slots.map((s, idx) => ({ s, idx })).filter(({ s }) => s.type === "ai").map(({ idx }) => idx)
        : []);
    const takeoverButtons = (lobby.phase === "setup" || lobby.phase === "in_progress")
      ? aiSeatIndices.map((idx) => `<button data-action="takeover-ai" data-lobby="${lobby.id}" data-seat="${idx}">Take AI Seat ${idx + 1}</button>`).join("")
      : "";

    const spectatorButton = lobby.phase === "setup" || lobby.phase === "in_progress"
      ? `<button data-action="spectate" data-lobby="${lobby.id}">Spectate</button>`
      : "";

    const ownerOpenButton = lobby.phase === "setup"
      ? `<button class="secondary" data-action="open-setup" data-lobby="${lobby.id}">Open Setup</button>`
      : "";
    const ownerDeleteButton = lobby.ownerSessionId && state.sessionId && lobby.ownerSessionId === state.sessionId
      ? `<button class="secondary" data-action="delete-lobby" data-lobby="${lobby.id}">Delete Lobby</button>`
      : "";

    return `
      <div class="lobby-item">
        <div class="lobby-title">${lobby.name}</div>
        <div class="lobby-meta">Phase: ${phaseText}</div>
        <div class="lobby-meta">Players: ${lobby.playersJoined ?? lobbyPlayerCount(lobby)}/${lobby.maxPlayers}</div>
        <div class="lobby-meta">Names: ${names.length ? names.join(", ") : "(none)"}</div>
        <div class="row">
          ${ownerOpenButton}
          ${ownerDeleteButton}
          ${setupJoinButtons}
          ${takeoverButtons}
          ${spectatorButton}
        </div>
      </div>
    `;
  }).join("");
}

function renderLeaderboard() {
  const wrap = el("leaderboardList");
  if (!wrap) return;
  const winsRows = state.leaderboard.totalWins || [];
  const lowScoreRows = state.leaderboard.lowestWinningScores || [];
  wrap.className = "leaderboard-list";
  const lowScoresHtml = lowScoreRows.length ? `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        ${lowScoreRows.map((entry, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${idx === 0 ? "<span class='trophy-icon' title='Top Rank'>🏆</span> " : ""}${entry.name}</td>
            <td>${entry.score}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : "<p class='tiny muted'>No completed games yet.</p>";
  const winsHtml = winsRows.length ? `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Wins</th>
        </tr>
      </thead>
      <tbody>
        ${winsRows.map((entry, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${idx === 0 ? "<span class='trophy-icon' title='Top Rank'>🏆</span> " : ""}${entry.name}</td>
            <td>${entry.wins}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : "<p class='tiny muted'>No wins recorded yet.</p>";

  wrap.innerHTML = `
    <div class="card">
      <h3>Lowest Winning Scores</h3>
      ${lowScoresHtml}
    </div>
    <div class="card">
      <h3>Total Wins</h3>
      ${winsHtml}
    </div>
  `;
}

function renderRejoinButton() {
  const btn = el("rejoinLobby");
  if (!btn) return;
  const lobbyId = state.lastLobbyId || state.activeLobbyId;
  const lobby = state.lobbies.find((l) => l.id === lobbyId);
  if (!lobby) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-block";
  btn.textContent = `Rejoin ${lobby.name}`;
}

function rejoinLastLobby() {
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server.");
    return;
  }
  const lobbyId = state.lastLobbyId || state.activeLobbyId;
  if (!lobbyId) return;
  const lobby = state.lobbies.find((l) => l.id === lobbyId);
  if (!lobby) {
    alert("Last lobby is no longer available.");
    return;
  }
  state.activeLobbyId = lobbyId;
  if (lobby.phase === "setup") {
    emitSocket(EVENTS.LOBBY_OPEN_SETUP, { lobbyId });
    enterSetupLobby();
    return;
  }
  if (lobby.phase === "in_progress") {
    const name = state.session.name || "Spectator";
    emitSocket(EVENTS.LOBBY_SPECTATE, { lobbyId, spectatorName: name });
  }
}

function adjustLobbySlotCount(lobby, count) {
  const clamped = Math.max(2, Math.min(7, count));
  if (clamped > lobby.slots.length) {
    for (let i = lobby.slots.length; i < clamped; i++) {
      lobby.slots.push({ name: "", type: "human", occupied: false, isOwner: false });
    }
  } else if (clamped < lobby.slots.length) {
    lobby.slots = lobby.slots.slice(0, clamped);
  }
  lobby.maxPlayers = clamped;
}

function buildPlayerInputs() {
  const lobby = activeLobby();
  const wrap = el("playerInputs");
  if (!lobby || !wrap) return;

  const requested = Number(el("setupPlayerCount").value);
  if (!Number.isNaN(requested) && requested >= 2 && requested <= 7 && state.session.role === "owner") {
    adjustLobbySlotCount(lobby, requested);
  } else {
    el("setupPlayerCount").value = String(lobby.maxPlayers);
  }

  const canEdit = state.session.role === "owner";
  wrap.innerHTML = "";
  for (let i = 0; i < lobby.maxPlayers; i++) {
    const slot = lobby.slots[i];
    const row = document.createElement("div");
    row.className = "row";
    row.style.border = "1px solid var(--line)";
    row.style.padding = "6px";
    row.style.borderRadius = "8px";

    const label = document.createElement("span");
    label.textContent = `Seat ${i + 1}:`;

    const input = document.createElement("input");
    input.type = "text";
    input.id = `p${i + 1}`;
    input.value = slot.name || "";
    input.placeholder = slot.type === "human" ? "Empty human slot" : "AI name";
    input.maxLength = 20;
    input.disabled = !canEdit;

    const mode = document.createElement("select");
    mode.id = `ptype${i + 1}`;
    mode.innerHTML = `
      <option value="human" ${slot.type === "human" ? "selected" : ""}>Human</option>
      <option value="ai" ${slot.type === "ai" ? "selected" : ""}>AI</option>
    `;
    mode.disabled = !canEdit;

    const occ = document.createElement("span");
    occ.className = "tiny muted";
    occ.textContent = slot.type === "ai"
      ? "AI active"
      : (slot.occupied ? "Occupied" : "Open");

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(mode);
    row.appendChild(occ);
    wrap.appendChild(row);
  }
}

function saveLobbySetupFromInputs() {
  const lobby = activeLobby();
  if (!lobby || state.session.role !== "owner") return;
  for (let i = 0; i < lobby.maxPlayers; i++) {
    const slot = lobby.slots[i];
    const raw = (el(`p${i + 1}`)?.value || "").trim();
    const type = (el(`ptype${i + 1}`)?.value || "human");
    slot.type = type;
    if (type === "ai") {
      slot.occupied = true;
      slot.name = raw || `AI ${i + 1}`;
    } else {
      if (slot.isOwner) {
        slot.occupied = true;
        slot.name = raw || state.session.name || `Owner`;
      } else if (slot.occupied) {
        slot.name = raw || slot.name || `Player ${i + 1}`;
      } else {
        slot.name = raw || "";
      }
    }
  }
}

function collectSetupPayloadFromInputs() {
  const lobby = activeLobby();
  const maxPlayers = Number(el("setupPlayerCount").value) || lobby?.maxPlayers || 4;
  const slots = [];
  for (let i = 0; i < maxPlayers; i++) {
    const existing = lobby?.slots?.[i] || { name: "", type: "human" };
    const inputEl = el(`p${i + 1}`);
    const modeEl = el(`ptype${i + 1}`);
    const raw = ((inputEl ? inputEl.value : existing.name) || "").trim();
    const type = (modeEl ? modeEl.value : existing.type) || "human";
    slots.push({ name: raw, type });
  }
  return { maxPlayers, slots };
}

function createLobby() {
  const ownerName = (el("ownerName").value || "").trim() || "Player 1";
  const lobbyName = (el("newLobbyName").value || "").trim() || `Lobby ${state.nextLobbyId}`;
  const count = Number(el("playerCount").value);
  if (Number.isNaN(count) || count < 2 || count > 7) {
    alert("Player count must be from 2 to 7.");
    return;
  }
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server. Start the Node server and refresh.");
    return;
  }
  state.session.name = ownerName;
  state.session.role = "owner";
  state.session.seatIndex = 0;
  emitSocket(EVENTS.LOBBY_CREATE, { ownerName, lobbyName, maxPlayers: count, cardBackStyle: state.selectedCardBackStyle });
}

function enterSetupLobby() {
  const lobby = activeLobby();
  if (!lobby) return;
  el("setupLobbyTitle").textContent = `Lobby Setup: ${lobby.name}`;
  el("setupPlayerCount").value = String(lobby.maxPlayers);
  const canEditSetup = state.session.role === "owner";
  el("setupPlayerCount").disabled = !canEditSetup;
  el("buildPlayers").disabled = !canEditSetup;
  el("startGame").disabled = state.session.role !== "owner";
  showSetup();
  buildPlayerInputs();
}

function joinLobbySeat(lobbyId, seatIndex) {
  const lobby = state.lobbies.find((l) => l.id === lobbyId);
  if (!lobby || lobby.phase !== "setup") return;

  const name = (prompt("Enter player name for this seat:", `Player ${seatIndex + 1}`) || "").trim();
  if (!name) return;
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server.");
    return;
  }
  state.session.name = name;
  state.session.role = "player";
  state.session.seatIndex = seatIndex;
  emitSocket(EVENTS.LOBBY_JOIN_SEAT, { lobbyId, seatIndex, playerName: name });
  // Explicitly request/setup-open so Join Seat always navigates into lobby setup view.
  state.activeLobbyId = lobbyId;
  emitSocket(EVENTS.LOBBY_OPEN_SETUP, { lobbyId });
}

function spectateLobby(lobbyId) {
  const lobby = state.lobbies.find((l) => l.id === lobbyId);
  if (!lobby) return;
  const name = (prompt("Enter spectator name:", "Spectator") || "Spectator").trim() || "Spectator";
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server.");
    return;
  }
  state.session.name = name;
  state.session.role = "spectator";
  state.session.seatIndex = -1;
  emitSocket(EVENTS.LOBBY_SPECTATE, { lobbyId, spectatorName: name });
}

function openSetupLobby(lobbyId) {
  const lobby = state.lobbies.find((l) => l.id === lobbyId);
  if (!lobby || lobby.phase !== "setup") return;
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server.");
    return;
  }
  emitSocket(EVENTS.LOBBY_OPEN_SETUP, { lobbyId });
}

function handleLobbyListClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  const lobbyId = btn.getAttribute("data-lobby");
  if (!lobbyId) return;
  if (action === "join-seat") {
    const seat = Number(btn.getAttribute("data-seat"));
    joinLobbySeat(lobbyId, seat);
  } else if (action === "spectate") {
    spectateLobby(lobbyId);
  } else if (action === "takeover-ai") {
    const seat = Number(btn.getAttribute("data-seat"));
    takeoverAiSeat(lobbyId, seat);
  } else if (action === "open-setup") {
    openSetupLobby(lobbyId);
  } else if (action === "delete-lobby") {
    deleteLobby(lobbyId);
  }
  renderLobbyList();
}

function deleteLobby(lobbyId) {
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server.");
    return;
  }
  const lobby = state.lobbies.find((l) => l.id === lobbyId);
  if (!lobby) return;
  if (lobby.ownerSessionId !== state.sessionId) {
    alert("Only the lobby owner can delete this lobby.");
    return;
  }
  if (!confirm(`Delete lobby "${lobby.name}"?`)) return;
  emitSocket(EVENTS.LOBBY_DELETE, { lobbyId });
  if (state.activeLobbyId === lobbyId) state.activeLobbyId = null;
}

function takeoverAiSeat(lobbyId, seatIndex) {
  if (!state.socket || !state.socket.connected) {
    alert("Not connected to multiplayer server.");
    return;
  }

  let name = state.session.name;
  if (!name) {
    name = (prompt("Enter spectator name to take over AI seat:", "Player") || "").trim();
    if (!name) return;
  }

  state.session.name = name;
  emitSocket(EVENTS.LOBBY_TAKEOVER_AI, { lobbyId, seatIndex, playerName: name });
}

function startGame() {
  clearAiTimer();
  const lobby = activeLobby();
  if (!lobby || lobby.phase !== "setup") return;
  if (state.session.role !== "owner") {
    alert("Only the lobby owner can start the game.");
    return;
  }
  if (state.socket && state.socket.connected) {
    const setupPayload = collectSetupPayloadFromInputs();
    emitSocket(EVENTS.LOBBY_UPDATE_SETUP, { lobbyId: lobby.id, ...setupPayload });
    emitSocket(EVENTS.GAME_START, { lobbyId: lobby.id });
    return;
  }
  alert("Not connected to multiplayer server.");
}

function clearAiTimer() {
  if (state.aiTimer) {
    clearTimeout(state.aiTimer);
    state.aiTimer = null;
  }
}

function aiActorIndexForPhase() {
  if (state.phase === "buying") return state.buyingOrder[state.buyingIndex];
  if (["offerDiscard", "currentDraw", "mainAction"].includes(state.phase)) return state.currentPlayer;
  return null;
}

function scheduleAiAction() {
  if (state.gameOver) return;
  if (state.aiTimer) return;
  if (state.socket && state.session.role !== "owner") return;
  const actorIndex = aiActorIndexForPhase();
  if (actorIndex === null || actorIndex === undefined) return;
  const actor = state.players[actorIndex];
  if (!actor?.isAI) return;
  state.aiTimer = setTimeout(() => {
    state.aiTimer = null;
    runAiAction();
  }, 450);
}

function runAiAction() {
  if (state.gameOver) return;
  const actorIndex = aiActorIndexForPhase();
  if (actorIndex === null || actorIndex === undefined) return;
  const actor = state.players[actorIndex];
  if (!actor?.isAI) return;

  if (state.phase === "offerDiscard") {
    const topDiscard = state.discardPile[state.discardPile.length - 1];
    const baseUtility = handUtilityForCurrentRound(actor, actor.hand);
    const withDiscardUtility = topDiscard ? handUtilityForCurrentRound(actor, [...actor.hand, topDiscard]) : baseUtility;
    const utilityDelta = withDiscardUtility - baseUtility;
    const shouldTake = utilityDelta > 2 || randomChance(0.12 + Math.min(0.45, Math.max(0, utilityDelta / 10)));
    offerDiscardDecision(shouldTake);
    return;
  }

  if (state.phase === "buying") {
    const topDiscard = state.discardPile[state.discardPile.length - 1];
    const baseUtility = handUtilityForCurrentRound(actor, actor.hand);
    const withDiscardPenalty = topDiscard ? handUtilityForCurrentRound(actor, [...actor.hand, topDiscard]) - 8 : baseUtility - 8;
    const utilityDelta = withDiscardPenalty - baseUtility;
    const shouldBuy = utilityDelta > 3 || randomChance(0.06 + Math.min(0.35, Math.max(0, utilityDelta / 12)));
    buyerDecision(shouldBuy);
    return;
  }

  if (state.phase === "currentDraw") {
    const topDiscard = state.discardPile[state.discardPile.length - 1];
    const baseUtility = handUtilityForCurrentRound(actor, actor.hand);
    const withDiscard = topDiscard ? handUtilityForCurrentRound(actor, [...actor.hand, topDiscard]) : baseUtility;
    const utilityDelta = withDiscard - baseUtility;
    if (topDiscard && (utilityDelta > 1 || randomChance(0.2 + Math.min(0.45, Math.max(0, utilityDelta / 10))))) {
      currentDraw("discard");
    } else {
      currentDraw("deck");
    }
    return;
  }

  if (state.phase === "mainAction") {
    aiMainAction(actor);
  }
}

function aiMainAction(player) {
  if (!player.hasMetRound) {
    const plan = pickBestRoundPlan(player.hand, state.round);
    if (plan) {
      state.draftMelds = plan.melds.map((m) => ({ type: m.type, cards: [...m.cards] }));
      submitRoundMelds();
      if (state.phase !== "mainAction") return;
    }
  }

  if (player.hasMetRound) {
    let changed = true;
    let safety = 0;
    while (changed && safety < 50) {
      changed = false;
      safety += 1;
      const byPoints = [...player.hand].sort((a, b) => cardPoints(b) - cardPoints(a));
      for (const c of byPoints) {
        let bestMeld = null;
        for (const m of state.tableMelds) {
          const v = validateMeldByType(m.type, [...m.cards, c]);
          if (v.ok) {
            bestMeld = m;
            break;
          }
        }
        if (bestMeld && randomChance(0.88)) {
          bestMeld.cards.push(c);
          if (bestMeld.type === "run") {
            bestMeld.cards = orderRunCardsLowToHigh(bestMeld.cards);
          }
          removeCardsFromHand(player, [c]);
          addLog(`${player.name} laid off ${cardLabel(c)} to Meld #${bestMeld.id}.`);
          changed = true;
          if (player.hand.length === 0) {
            handlePlayerWentOut(state.currentPlayer);
            return;
          }
          break;
        }
      }
    }
  }

  const discard = chooseDiscardCardAI(player);
  if (!discard) return;
  state.selectedCardIds.clear();
  state.selectedCardIds.add(cardId(discard));
  discardSelected();
}

function offerDiscardDecision(take) {
  const p = currentPlayerObj();
  if (state.phase !== "offerDiscard") return;
  state.turnDiscardDecisionMade = true;

  if (take) {
    p.hand.push(state.discardPile.pop());
    state.phase = "mainAction";
    addLog(`${p.name} picked up from discard pile.`);
  } else {
    state.phase = "buying";
    state.discardBoughtBy = null;
    state.buyingOrder = [];
    let idx = nextIndex(state.currentPlayer);
    while (idx !== state.currentPlayer) {
      if (idx !== state.lastDiscarderIndex && !state.players[idx]?.hasMetRound) {
        state.buyingOrder.push(idx);
      }
      idx = nextIndex(idx);
    }
    state.buyingIndex = 0;
    if (state.buyingOrder.length === 0) {
      state.phase = "currentDraw";
      addLog(`${p.name} declined discard. No eligible buyers (players already down cannot buy).`);
    } else {
      addLog(`${p.name} declined discard. Buying phase begins.`);
    }
  }

  renderAll();
  syncGameStateToServer();
}

function buyerDecision(buy) {
  if (state.phase !== "buying") return;
  if (!state.turnDiscardDecisionMade) return;
  const buyerIdx = state.buyingOrder[state.buyingIndex];
  if (buyerIdx === undefined || buyerIdx === null) {
    state.phase = "currentDraw";
    renderAll();
    syncGameStateToServer();
    return;
  }
  const buyer = state.players[buyerIdx];
  if (!buyer || buyer.hasMetRound) {
    state.buyingIndex += 1;
    if (state.buyingIndex >= state.buyingOrder.length) {
      state.phase = "currentDraw";
      addLog("All eligible buyers passed.");
    }
    renderAll();
    syncGameStateToServer();
    return;
  }
  const topDiscard = state.discardPile[state.discardPile.length - 1];

  if (buy) {
    buyer.hand.push(state.discardPile.pop());
    const penalty = drawOne();
    if (penalty) buyer.hand.push(penalty);

    state.discardBoughtBy = buyerIdx;
    state.phase = "currentDraw";

    const penaltyText = penalty ? ` and penalty ${cardLabel(penalty)}` : "";
    addLog(`${buyer.name} bought ${cardLabel(topDiscard)}${penaltyText}.`);
  } else {
    addLog(`${buyer.name} passed on buying ${cardLabel(topDiscard)}.`);
    state.buyingIndex += 1;
    if (state.buyingIndex >= state.buyingOrder.length) {
      state.phase = "currentDraw";
      addLog("No one bought the discard card.");
    }
  }

  renderAll();
  syncGameStateToServer();
}

function currentDraw(source) {
  if (state.phase !== "currentDraw") return;
  const p = currentPlayerObj();
  let card = null;
  if (source === "discard") {
    if (state.discardPile.length === 0) return;
    card = state.discardPile.pop();
  } else {
    card = drawOne();
  }

  if (!card) {
    addLog(`${p.name} could not draw a card (no cards available).`);
  } else {
    p.hand.push(card);
    addLog(`${p.name} drew ${cardLabel(card)} from ${source === "discard" ? "discard" : "draw"} pile.`);
  }
  state.phase = "mainAction";
  renderAll();
  syncGameStateToServer();
}

function addDraftMeld(type) {
  const p = currentPlayerObj();
  if (state.phase !== "mainAction" || p.hasMetRound) return;

  const cards = selectedCardsFromHand();
  if (cards.length === 0) {
    alert("Select cards from hand first.");
    return;
  }

  const draftUsed = new Set(state.draftMelds.flatMap((m) => m.cards.map(cardId)));
  if (cards.some((c) => draftUsed.has(cardId(c)))) {
    alert("Some selected cards are already in another draft meld.");
    return;
  }

  const validation = validateMeldByType(type, cards);
  if (!validation.ok) {
    alert(validation.reason);
    return;
  }

  state.draftMelds.push({ type, cards: [...cards] });
  for (const c of cards) state.selectedCardIds.delete(cardId(c));
  renderAll();
  syncGameStateToServer();
}

function removeDraftMeld(index) {
  state.draftMelds.splice(index, 1);
  renderAll();
  syncGameStateToServer();
}

function submitRoundMelds() {
  const p = currentPlayerObj();
  if (state.phase !== "mainAction" || p.hasMetRound) return;

  const check = canSubmitRoundMelds(p, state.draftMelds, state.round);
  if (!check.ok) {
    alert(check.reason);
    return;
  }

  for (const draft of state.draftMelds) {
    const meldCards = draft.type === "run"
      ? orderRunCardsLowToHigh(draft.cards)
      : [...draft.cards];
    const meld = {
      id: state.nextMeldId++,
      ownerIndex: state.currentPlayer,
      type: draft.type,
      cards: meldCards
    };
    state.tableMelds.push(meld);
    p.melds.push(meld.id);
    removeCardsFromHand(p, meldCards);
  }

  p.hasMetRound = true;
  state.draftMelds = [];
  state.selectedCardIds.clear();

  addLog(`${p.name} successfully met Round ${state.round} requirements.`);

  if (p.hand.length === 0) {
    handlePlayerWentOut(state.currentPlayer);
    return;
  }

  renderAll();
}

async function layOffToMeld() {
  const p = currentPlayerObj();
  if (state.phase !== "mainAction" || !p.hasMetRound) return;

  const targetId = Number(el("targetMeld")?.value);
  if (!targetId) {
    alert("Choose a target meld first.");
    return;
  }

  const cards = selectedCardsFromHand();
  if (cards.length === 0) {
    alert("Select card(s) to lay off.");
    return;
  }

  const meld = state.tableMelds.find((m) => m.id === targetId);
  if (!meld) {
    alert("Target meld not found.");
    return;
  }

  const previousRunCandidate = meld.type === "run" ? pickRunCandidate(meld.cards) : null;
  const combined = [...meld.cards, ...cards];
  const v = validateMeldByType(meld.type, combined);
  if (!v.ok) {
    alert(`Cannot lay off: ${v.reason}`);
    return;
  }

  if (meld.type === "run") {
    let preferEdgeWild = null;
    const addedNonWild = cards.filter((c) => !isWild(c));
    const replacedWildValue = !!previousRunCandidate
      && previousRunCandidate.wildValues.length > 0
      && addedNonWild.some((c) => previousRunCandidate.wildValues.includes(runValueForMode(c, previousRunCandidate.aceHigh)));

    if (replacedWildValue) {
      preferEdgeWild = await promptRunWildPlacement();
    }

    meld.cards = orderRunCardsLowToHigh(combined, preferEdgeWild);
  } else {
    meld.cards = combined;
  }
  removeCardsFromHand(p, cards);
  state.selectedCardIds.clear();
  addLog(`${p.name} laid off ${cards.map(cardLabel).join(", ")} to Meld #${meld.id}.`);

  if (p.hand.length === 0) {
    handlePlayerWentOut(state.currentPlayer);
    return;
  }

  renderAll();
}

function discardSelected() {
  const p = currentPlayerObj();
  if (state.phase !== "mainAction") return;

  const cards = selectedCardsFromHand();
  if (cards.length !== 1) {
    alert("Select exactly one card to discard.");
    return;
  }
  const c = cards[0];

  removeCardsFromHand(p, [c]);
  state.discardPile.push(c);
  state.lastDiscarderIndex = state.currentPlayer;
  state.selectedCardIds.clear();
  state.draftMelds = [];

  addLog(`${p.name} discarded ${cardLabel(c)}.`);

  if (p.hand.length === 0) {
    handlePlayerWentOut(state.currentPlayer);
    return;
  }

  if (Number.isInteger(state.pendingRoundWinnerIndex) && allPlayersHaveTakenTurnThisRound()) {
    roundEnd(state.pendingRoundWinnerIndex);
    return;
  }

  state.currentPlayer = nextIndex(state.currentPlayer);
  beginTurnForPlayer(state.currentPlayer);
  addLog(`Turn passes to ${currentPlayerObj().name}.`);
  renderAll();
  syncGameStateToServer();
}

function sortHand(by) {
  const p = viewerPlayerObj();
  if (!p) return;
  if (by === "rank") {
    p.hand.sort((a, b) => {
      const rv = rankToValue(a.rank) - rankToValue(b.rank);
      return rv !== 0 ? rv : a.suit.localeCompare(b.suit);
    });
  } else {
    p.hand.sort((a, b) => {
      const sv = a.suit.localeCompare(b.suit);
      return sv !== 0 ? sv : rankToValue(a.rank) - rankToValue(b.rank);
    });
  }
  renderHand();
}

function renderStatus() {
  const req = ROUND_REQUIREMENTS[state.round];
  el("status").innerHTML = `
    <div class="round-banner">
      Round ${state.round}/7 | Requirement: ${req.sets} set(s), ${req.runs} run(s)
    </div>
  `;
}

function renderPlayersBoard() {
  const root = el("playersBoard");
  root.innerHTML = state.players.map((p, idx) => {
    const isDealer = idx === state.dealerIndex;
    const isCurrent = idx === state.currentPlayer;
    const isYou = idx === state.viewerIndex;
    const hasMetRound = !!p.hasMetRound;
    const css = `${isYou ? "you" : ""} ${isCurrent ? "current" : ""} ${hasMetRound && !isYou ? "met" : ""}`.trim();
    const icons = [
      isDealer ? `<span class="player-icon">D</span>` : "",
      isCurrent ? `<span class="player-icon">Turn</span>` : ""
    ].join("");
    return `
      <div class="player-figure ${css}">
        <div class="player-icons">${icons}</div>
        <div class="figure-head"></div>
        <div class="figure-body"></div>
        <div class="figure-legs"><span></span><span></span></div>
        <div class="player-name">${p.name}${isYou ? " (You)" : ` (${Array.isArray(p.hand) ? p.hand.length : 0})`}</div>
      </div>
    `;
  }).join("");
}

function renderPiles() {
  const lobby = activeLobby();
  const backStyle = lobby?.cardBackStyle || 1;
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  const topId = topDiscard ? cardId(topDiscard) : null;
  const isNewDiscard = !!topDiscard && state.lastDiscardRenderId && state.lastDiscardRenderId !== topId;
  state.lastDiscardRenderId = topId;
  el("pileArea").innerHTML = `
    <div class="pile-box">
      <div class="pile-title">Draw Pile (${state.drawPile.length})</div>
      <div class="card-back back-style-${backStyle}"></div>
    </div>
    <div class="pile-box">
      <div class="pile-title">Current Discard</div>
      ${topDiscard ? renderCardModel(topDiscard, { extraClass: isNewDiscard ? "discard-changed" : "" }) : `<div class="tiny muted">(empty)</div>`}
    </div>
  `;
}

function renderTurnControls() {
  const p = currentPlayerObj();
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  const root = el("turnControls");
  const canControlTurn = state.session.role !== "spectator";
  if (!p) {
    root.innerHTML = "";
    return;
  }

  if (state.phase === "offerDiscard") {
    if (!canControlTurn) {
      root.innerHTML = `<p class="tiny muted">Spectator view: waiting for ${p.name}.</p>`;
      return;
    }
    if (p.isAI) {
      root.innerHTML = `<p class="tiny">${p.name} (AI) is deciding whether to take discard...</p>`;
      return;
    }
    root.innerHTML = `
      <p class="tiny">${p.name}: pick up ${topDiscard ? cardLabel(topDiscard) : "(none)"} from discard?</p>
      <div class="row">
        <button class="ok" id="takeDiscardBtn">Take Discard</button>
        <button id="declineDiscardBtn">Decline (Go to Buying)</button>
      </div>
    `;
    el("takeDiscardBtn").onclick = () => offerDiscardDecision(true);
    el("declineDiscardBtn").onclick = () => offerDiscardDecision(false);
    return;
  }

  if (state.phase === "buying") {
    const buyerIdx = state.buyingOrder[state.buyingIndex];
    const buyer = state.players[buyerIdx];
    if (!buyer || buyer.hasMetRound) {
      root.innerHTML = `<p class="tiny muted">Buying phase: skipping ineligible buyers...</p>`;
      return;
    }
    if (!canControlTurn) {
      root.innerHTML = `<p class="tiny muted">Spectator view: buying phase in progress.</p>`;
      return;
    }
    if (buyer?.isAI) {
      root.innerHTML = `<p class="tiny">Buying phase: ${buyer.name} (AI) is deciding...</p>`;
      return;
    }
    root.innerHTML = `
      <p class="tiny">Buying phase: ${buyer.name}, buy ${cardLabel(topDiscard)} and take a penalty draw card?</p>
      <div class="row">
        <button class="ok" id="buyBtn">Buy</button>
        <button id="passBuyBtn">Pass</button>
      </div>
    `;
    el("buyBtn").onclick = () => buyerDecision(true);
    el("passBuyBtn").onclick = () => buyerDecision(false);
    return;
  }

  if (state.phase === "currentDraw") {
    if (!canControlTurn) {
      root.innerHTML = `<p class="tiny muted">Spectator view: waiting for ${p.name} to draw.</p>`;
      return;
    }
    if (p.isAI) {
      root.innerHTML = `<p class="tiny">${p.name} (AI) is choosing a draw source...</p>`;
      return;
    }
    const canTakeDiscard = state.discardPile.length > 0;
    root.innerHTML = `
      <p class="tiny">${p.name}: draw your card.</p>
      <div class="row">
        <button class="secondary" id="drawDeckBtn">Draw from Deck</button>
        <button id="drawDiscardBtn" ${canTakeDiscard ? "" : "disabled"}>Take Discard</button>
      </div>
    `;
    el("drawDeckBtn").onclick = () => currentDraw("deck");
    el("drawDiscardBtn").onclick = () => currentDraw("discard");
    return;
  }

  if (state.phase === "mainAction") {
    root.innerHTML = p.isAI
      ? `<p class="tiny">${p.name} (AI) is playing their turn...</p>`
      : `<p class="tiny">${p.name}: build melds, lay off (if already down), then discard one card to end turn.</p>`;
    return;
  }

  root.innerHTML = "";
}

function renderScores() {
  const playerRows = state.players
    .map((p, i) => {
      const marker = i === state.currentPlayer ? " <strong>(turn)</strong>" : "";
      const typeTag = p.isAI ? " <span class=\"tiny muted\">AI</span>" : "";
      return `<div class="score-chip"><span class="pill">${p.name}</span>${typeTag} ${p.score} point(s)${marker}</div>`;
    })
    .join("");
  const lobby = activeLobby();
  const spectators = lobby?.spectators || [];
  const spectatorText = spectators.length ? spectators.join(", ") : "(none)";
  el("scores").innerHTML = `
    <div class="scores-row">${playerRows}</div>
    <div class="spectators-row"><span class="pill">Spectators</span> ${spectatorText}</div>
  `;
}

function renderHand() {
  const p = viewerPlayerObj();
  const current = currentPlayerObj();
  const root = el("hand");
  root.innerHTML = "";
  if (!p) return;
  const canInteract = !!current && state.currentPlayer === state.viewerIndex && !current.isAI && state.phase === "mainAction";
  const draftCardIds = new Set(state.draftMelds.flatMap((m) => m.cards.map(cardId)));
  const lobby = activeLobby();
  const backStyle = lobby?.cardBackStyle || 1;
  const revealActive = Date.now() < state.roundRevealEndsAt;

  if (revealActive) {
    root.innerHTML = p.hand.map((c, i) => renderFlippingCardModel(c, backStyle, i * 55)).join("");
    setTimeout(() => {
      if (Date.now() >= state.roundRevealEndsAt) renderHand();
    }, 1750);
  } else {
    for (const c of p.hand) {
      const inDraftMeld = draftCardIds.has(cardId(c));
      const cardNode = document.createElement("div");
      cardNode.innerHTML = renderCardModel(c, {
        selectable: true,
        checked: state.selectedCardIds.has(cardId(c)),
        disabled: !canInteract,
        extraClass: inDraftMeld ? "in-draft-meld" : ""
      });
      root.appendChild(cardNode.firstElementChild);
    }
  }

  root.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      if (e.target.checked) state.selectedCardIds.add(id);
      else state.selectedCardIds.delete(id);
    });
  });

  renderHandActions();
}

function renderHandActions() {
  const p = currentPlayerObj();
  const viewer = viewerPlayerObj();
  const root = el("handActions");
  if (state.session.role === "spectator") {
    root.innerHTML = "<p class='muted tiny'>Spectator mode: hand actions disabled.</p>";
    return;
  }
  if (!p || state.phase !== "mainAction") {
    root.innerHTML = "<p class='muted tiny'>Hand actions unlock during main action phase.</p>";
    return;
  }
  if (!viewer) {
    root.innerHTML = "<p class='muted tiny'>No viewer hand configured.</p>";
    return;
  }
  if (state.currentPlayer !== state.viewerIndex) {
    root.innerHTML = "<p class='muted tiny'>Your hand is visible, but actions unlock only on your turn.</p>";
    return;
  }
  if (p.isAI) {
    root.innerHTML = "<p class='muted tiny'>AI controls this hand automatically.</p>";
    return;
  }

  if (!p.hasMetRound) {
    root.innerHTML = `
      <div class="row">
        <button id="makeSet" class="secondary">Create Set from Selected</button>
        <button id="makeRun" class="secondary">Create Run from Selected</button>
        <button id="submitMelds" class="ok">Submit Round Requirements</button>
      </div>
      <p class="tiny muted">After meeting round requirements, you can discard to end turn.</p>
      <div class="row" style="margin-top:6px;">
        <button id="discardBtn" class="warn">Discard Selected Card</button>
      </div>
    `;
    el("makeSet").onclick = () => addDraftMeld("set");
    el("makeRun").onclick = () => addDraftMeld("run");
    el("submitMelds").onclick = submitRoundMelds;
    el("discardBtn").onclick = discardSelected;
    return;
  }

  const meldOptions = state.tableMelds
    .map((m) => `<option value="${m.id}">#${m.id} ${meldDisplayLabel(m)} (${state.players[m.ownerIndex].name})</option>`)
    .join("");

  root.innerHTML = `
    <div class="row">
      <select id="targetMeld">
        <option value="">Select meld...</option>
        ${meldOptions}
      </select>
      <button id="layOffBtn" class="secondary">Lay Off Selected Cards</button>
      <button id="discardBtn" class="warn">Discard Selected Card</button>
    </div>
    <p class="tiny muted">You may lay off cards to your melds or other players' accepted melds.</p>
  `;

  el("layOffBtn").onclick = layOffToMeld;
  el("discardBtn").onclick = discardSelected;
}

function renderDraftMelds() {
  const root = el("draftMelds");
  if (!root) return;
  if (state.draftMelds.length === 0) {
    root.innerHTML = "<p class='tiny muted'>No draft melds yet.</p>";
    return;
  }

  root.innerHTML = state.draftMelds.map((m, i) => `
    <div class="draft-item">
      <div><strong>${m.type.toUpperCase()}</strong></div>
      <div class="meld-cards">${m.cards.map((c) => renderCardModel(c)).join("")}</div>
      <button data-idx="${i}" class="tiny">Remove</button>
    </div>
  `).join("");

  root.querySelectorAll("button[data-idx]").forEach((btn) => {
    btn.onclick = () => removeDraftMeld(Number(btn.getAttribute("data-idx")));
  });
}

function renderTableMelds() {
  const root = el("tableMelds");
  if (state.tableMelds.length === 0) {
    root.innerHTML = "<p class='tiny muted'>No melds on table yet.</p>";
    return;
  }

  root.innerHTML = state.tableMelds.map((m) => `
    <div class="meld-item">
      <div><strong>#${m.id} ${m.type.toUpperCase()}</strong> - Owner: ${state.players[m.ownerIndex].name}</div>
      <div class="meld-cards">${m.cards.map((c) => renderCardModel(c)).join("")}</div>
    </div>
  `).join("");
}

function renderLog() {
  el("log").innerHTML = state.log.map((entry) => `<p>${entry}</p>`).join("");
}

function renderChat() {
  const feed = el("chatFeed");
  if (!feed) return;
  const msgs = state.chatMessages.filter((m) => m.round === state.round);
  feed.innerHTML = msgs.length
    ? msgs.map((m) => `<p><strong>${m.sender}:</strong> ${m.text}</p>`).join("")
    : "<p class='tiny muted'>No chat messages this round.</p>";

  const meta = el("chatMeta");
  if (meta) {
    const used = state.chatRoundCount;
    const remainingRound = Math.max(0, 100 - used);
    meta.textContent = `Round chat: ${used}/100 used (${remainingRound} remaining). Rate limit: 5 messages per 10 seconds.`;
  }
}

function renderAll() {
  renderStatus();
  renderPlayersBoard();
  renderPiles();
  renderTurnControls();
  renderScores();
  renderHand();
  renderDraftMelds();
  renderTableMelds();
  renderLog();
  renderChat();
  renderLastRoundSummaryButton();
  renderRoundSummaryModal();
  scheduleAiAction();
}

function handleSendChat() {
  const input = el("chatInput");
  if (!input) return;
  const result = addChatMessage(input.value);
  if (!result.ok) {
    alert(result.reason);
    return;
  }
  input.value = "";
  renderChat();
}

el("createLobby").addEventListener("click", () => {
  createLobby();
  renderLobbyList();
});
el("cardBackPicker").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-back]");
  if (!btn) return;
  setCardBackChoice(Number(btn.getAttribute("data-back")));
});
el("lobbyList").addEventListener("click", handleLobbyListClick);
el("buildPlayers").addEventListener("click", () => {
  buildPlayerInputs();
  const lobby = activeLobby();
  if (
    state.socket && lobby && Array.isArray(lobby.slots) && lobby.slots.length > 0 &&
    state.session.role === "owner" && lobby.phase === "setup"
  ) {
    emitSocket(EVENTS.LOBBY_UPDATE_SETUP, { lobbyId: lobby.id, ...collectSetupPayloadFromInputs() });
  }
});
el("setupPlayerCount").addEventListener("change", () => {
  buildPlayerInputs();
  const lobby = activeLobby();
  if (
    state.socket && lobby && Array.isArray(lobby.slots) && lobby.slots.length > 0 &&
    state.session.role === "owner" && lobby.phase === "setup"
  ) {
    emitSocket(EVENTS.LOBBY_UPDATE_SETUP, { lobbyId: lobby.id, ...collectSetupPayloadFromInputs() });
  }
});
el("startGame").addEventListener("click", () => {
  startGame();
  renderLobbyList();
});
el("backToLobbies").addEventListener("click", showHome);
el("returnToLobbies").addEventListener("click", showHome);
el("rejoinLobby").addEventListener("click", rejoinLastLobby);
el("themeToggle").addEventListener("click", toggleTheme);
el("helpButton").addEventListener("click", openHelpModal);
el("closeHelpModal").addEventListener("click", closeHelpModal);
el("sortRank").addEventListener("click", () => sortHand("rank"));
el("sortSuit").addEventListener("click", () => sortHand("suit"));
el("sendChat").addEventListener("click", handleSendChat);
el("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSendChat();
  }
});
el("closeRoundSummary").addEventListener("click", closeRoundSummary);
el("viewLastRoundSummary").addEventListener("click", viewLastRoundSummary);

initTheme();
showHome();
renderCardBackPicker();
connectSocketIfAvailable();

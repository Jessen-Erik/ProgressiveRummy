const SUITS = ["C", "D", "H", "S"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(deckCount) {
  const out = [];
  let uid = 1;
  for (let d = 1; d <= deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        out.push({ rank, suit, deck: d, uid: uid++ });
      }
    }
  }
  return shuffle(out);
}

function dealCountForRound(round) {
  return round <= 4 ? 10 : 12;
}

export function buildInitialGameState(activePlayers) {
  const round = 1;
  const dealCount = dealCountForRound(round);
  const deckCount = activePlayers.length <= 5 ? 2 : 3;
  const drawPile = buildDeck(deckCount);

  const players = activePlayers.map((p) => ({
    name: p.name,
    isAI: !!p.isAI,
    score: 0,
    hand: [],
    hasMetRound: false,
    melds: []
  }));

  for (let i = 0; i < dealCount; i++) {
    for (const p of players) {
      p.hand.push(drawPile.pop());
    }
  }

  const discardPile = [drawPile.pop()];
  const dealerIndex = Math.floor(Math.random() * players.length);
  const currentPlayer = (dealerIndex + 1) % players.length;

  return {
    round,
    dealerIndex,
    currentPlayer,
    phase: "offerDiscard",
    drawPile,
    discardPile,
    tableMelds: [],
    nextMeldId: 1,
    draftMelds: [],
    turnDiscardDecisionMade: false,
    buyingOrder: [],
    buyingIndex: 0,
    discardBoughtBy: null,
    players
  };
}

export function scrubSnapshotForViewer(snapshot, viewerSessionId) {
  // Multiplayer gameplay sync currently shares full state with all joined clients.
  // Tight per-player hand privacy can be layered in once per-action server validation is complete.
  return snapshot;
}

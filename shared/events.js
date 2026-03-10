export const EVENTS = {
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
  GAME_SNAPSHOT: "game:snapshot",

  CHAT_SEND: "chat:send",
  CHAT_UPDATE: "chat:update",
  LEADERBOARD_UPDATE: "leaderboard:update",

  ERROR: "error:server"
};

export const GAME_ACTIONS = {
  SYNC_STATE: "sync_state",
  PICKUP_DISCARD_OFFER: "pickup_discard_offer",
  BUY_DECISION: "buy_decision",
  DRAW_SOURCE: "draw_source",
  SUBMIT_MELDS: "submit_melds",
  LAYOFF: "layoff",
  DISCARD: "discard"
};

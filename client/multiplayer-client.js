import { EVENTS, GAME_ACTIONS } from "../shared/events.js";

export class MultiplayerClient {
  constructor({ serverUrl, socketFactory }) {
    this.serverUrl = serverUrl;
    this.socketFactory = socketFactory || ((url) => window.io(url, { transports: ["websocket"] }));
    this.socket = null;
  }

  connect(playerName) {
    if (this.socket) return;
    this.socket = this.socketFactory(this.serverUrl);
    this.socket.on("connect", () => {
      this.socket.emit(EVENTS.SESSION_HELLO, { name: playerName });
      this.socket.emit(EVENTS.LOBBY_LIST);
    });
  }

  disconnect() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
  }

  on(eventName, handler) {
    this.socket?.on(eventName, handler);
  }

  createLobby(payload) {
    this.socket?.emit(EVENTS.LOBBY_CREATE, payload);
  }

  requestLobbyList() {
    this.socket?.emit(EVENTS.LOBBY_LIST);
  }

  openSetup(lobbyId) {
    this.socket?.emit(EVENTS.LOBBY_OPEN_SETUP, { lobbyId });
  }

  joinSeat(lobbyId, seatIndex, playerName) {
    this.socket?.emit(EVENTS.LOBBY_JOIN_SEAT, { lobbyId, seatIndex, playerName });
  }

  spectate(lobbyId, spectatorName) {
    this.socket?.emit(EVENTS.LOBBY_SPECTATE, { lobbyId, spectatorName });
  }

  updateSetup(lobbyId, maxPlayers, slots) {
    this.socket?.emit(EVENTS.LOBBY_UPDATE_SETUP, { lobbyId, maxPlayers, slots });
  }

  startGame(lobbyId) {
    this.socket?.emit(EVENTS.GAME_START, { lobbyId });
  }

  sendChat(lobbyId, text) {
    this.socket?.emit(EVENTS.CHAT_SEND, { lobbyId, text });
  }

  gameAction(action, payload = {}) {
    if (!Object.values(GAME_ACTIONS).includes(action)) {
      throw new Error(`Unsupported action: ${action}`);
    }
    this.socket?.emit(EVENTS.GAME_ACTION, { action, ...payload });
  }
}

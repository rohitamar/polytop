import {
  parseLobbyServerMessage,
  type LobbyClientMessage,
  type LobbyServerMessage,
} from "@reach/protocol";

export function connectLobby(
  onMessage: (message: LobbyServerMessage) => void,
  onDisconnect: (reason: string) => void,
) {
  const configured = import.meta.env.VITE_LOBBY_URL as string | undefined;
  const socket = new WebSocket(
    configured ??
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/lobby`,
  );
  let disposed = false;
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Lobby connection timed out."));
      socket.close();
    }, 8000);
    socket.addEventListener(
      "open",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not connect to the lobby server."));
      },
      { once: true },
    );
  });
  socket.addEventListener("message", (event) => {
    if (disposed) return;
    let message = null;
    try {
      message = parseLobbyServerMessage(JSON.parse(event.data));
    } catch {}
    if (message) onMessage(message);
    else {
      onDisconnect("The lobby server sent an invalid response.");
      socket.close();
    }
  });
  socket.addEventListener("close", () => {
    if (!disposed)
      onDisconnect(
        "Disconnected from the lobby. Create or join a room to reconnect.",
      );
  });
  return {
    send: async (message: LobbyClientMessage) => {
      await ready;
      if (disposed || socket.readyState !== WebSocket.OPEN)
        throw new Error("The lobby connection is closed.");
      socket.send(JSON.stringify(message));
    },
    dispose: () => {
      disposed = true;
      if (socket.readyState === WebSocket.CONNECTING)
        socket.addEventListener("open", () => socket.close(), { once: true });
      else socket.close();
    },
  };
}

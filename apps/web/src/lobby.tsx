import { setPlayerColors } from "./player-style";
import { useEffect, useRef, useState } from "react";
import {
  ROOM_CAPACITY,
  type LobbyClientMessage,
  type LobbyRoom,
  type LobbyServerMessage,
} from "@reach/protocol";
import { connectLobby } from "./lobby-client";

export function Lobby({ onMatch, onSession, onEnd }: {
  onMatch: (message: Extract<LobbyServerMessage, { type: "MATCH_STATE" }>) => void;
  onSession: (playerId: string, send: (message: LobbyClientMessage) => Promise<void>) => void;
  onEnd: (reason: string, ended?: boolean) => void;
}) {
  const callbacks = useRef({ onMatch, onSession, onEnd });
  callbacks.current = { onMatch, onSession, onEnd };
  const [inMatch, setInMatch] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<LobbyRoom | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const client = useRef<ReturnType<typeof connectLobby> | null>(null);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const requestTimer = useRef<number | undefined>(undefined);
  const finish = () => {
    window.clearTimeout(requestTimer.current);
    requestTimer.current = undefined;
    setPending(false);
  };
  useEffect(
    () => () => {
      window.clearTimeout(reconnectTimer.current);
      window.clearTimeout(requestTimer.current);
      client.current?.dispose();
    },
    [],
  );

  const request = async (message: LobbyClientMessage) => {
    setPending(true);
    setError("");
    setCopied(false);
    try {
      if (!client.current) {
        client.current = connectLobby(
          (response) => {
            finish();
            if (response.type === "MATCH_SESSION") sessionStorage.setItem("polytop-session", JSON.stringify({ code: response.code, token: response.token }));
            if (response.type === "LOBBY_UPDATE") {
              setRoom(response.room);
              setPlayerColors(response.room.players);
              setPlayerId(response.playerId);
              callbacks.current.onSession(response.playerId, message => client.current!.send(message));
            }
            if (response.type === "MATCH_STATE") {
              setInMatch(true);
              setOpen(false);
              callbacks.current.onMatch(response);
            }
            if (response.type === "ACTION_REJECTED") callbacks.current.onEnd(response.message);
            if (response.type === "MATCH_ENDED") {
              sessionStorage.removeItem("polytop-session");
              setInMatch(false);
              setRoom(null);
              callbacks.current.onEnd(response.message, true);
            }
            if (response.type === "LEFT_ROOM") {
              sessionStorage.removeItem("polytop-session");
              setRoom(null);
              setPlayerId("");
            }
            if (response.type === "LOBBY_ERROR") { setError(response.message); callbacks.current.onEnd(response.message); }
          },
          (reason) => {
            finish();
            setInMatch(false);
            setRoom(null);
            setPlayerId("");
            setError(reason);
            callbacks.current.onEnd(reason, true);
            client.current?.dispose();
            client.current = null;
            const saved = sessionStorage.getItem("polytop-session");
            if (saved) {
              const session = JSON.parse(saved) as { code: string; token: string };
              reconnectTimer.current = window.setTimeout(() => void request({ type: "RESUME_MATCH", ...session }), 1000);
            }
          },
        );
      }
      await client.current.send(message);
      requestTimer.current = window.setTimeout(() => {
        finish();
        setError("The lobby did not respond. Please reconnect.");
        setRoom(null);
        client.current?.dispose();
        client.current = null;
      }, 8000);
    } catch (failure) {
      finish();
      client.current?.dispose();
      client.current = null;
      setRoom(null);
      setPlayerId("");
      setError(
        failure instanceof Error ? failure.message : "Could not connect.",
      );
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("polytop-session");
    if (saved) void request({ type: "RESUME_MATCH", ...JSON.parse(saved) });
  }, []);

  return (
    <div className="lobby-shell">
      <button
        className="lobby-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {room ? `Room ${room.code}` : "Multiplayer lobby"}
      </button>
      {open && (
        <section className="lobby-panel" aria-label="Multiplayer lobby">
          <h2>Gather your company</h2>
          <p>
            Rooms for 2–8 players. The host starts a shared match.
          </p>
          {room ? (
            <>
              <label htmlFor="share-code">Room code</label>
              <div className="lobby-actions">
                <input
                  id="share-code"
                  readOnly
                  value={room.code}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(room.code);
                      setCopied(true);
                    } catch {
                      setError("Select the room code and copy it manually.");
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
              <p>
                {room.players.length} / {ROOM_CAPACITY} players
                {room.players.length < 2
                  ? " · Waiting for another player"
                  : " · Company assembled"}
              </p>
              <ul aria-label="Connected players">
                {room.players.map((player) => (
                  <li key={player.id}>
                    <span
                      className="lobby-color"
                      style={{ background: player.color }}
                    />
                    <strong>{player.name}</strong>
                    <span>
                      {player.id === playerId ? "You " : ""}
                      {player.id === room.hostId ? "Host" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {room.hostId === playerId && !inMatch && <button disabled={pending || room.players.length < 2} onClick={() => void request({ type: "START_MATCH" })}>Start game</button>}
              <button
                disabled={pending}
                onClick={() => void request({ type: "LEAVE_ROOM" })}
              >
                Leave room
              </button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void request({ type: "JOIN_ROOM", name, code });
              }}
            >
              <label htmlFor="lobby-name">Player name</label>
              <input
                id="lobby-name"
                value={name}
                maxLength={24}
                required
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
                autoComplete="nickname"
              />
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() => void request({ type: "CREATE_ROOM", name })}
              >
                Create room
              </button>
              <label htmlFor="lobby-code">Join with room code</label>
              <input
                id="lobby-code"
                value={code}
                maxLength={6}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                disabled={pending}
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={pending || !name.trim() || code.trim().length !== 6}
              >
                Join room
              </button>
            </form>
          )}
          {pending && <p role="status">Connecting…</p>}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}

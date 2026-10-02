import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyAction,
  getIncome,
  cityEconomy,
  getUpgradeCost,
  getAttackTargets,
  previewCombat,
  createGame,
  getReachableTiles,
  getTile,
  type GameState,
  type Position,
  type Tile,
} from "@reach/game-core";
import { createWorld, type World } from "./world";
import { playerStyle } from "./player-style";
import { Lobby } from "./lobby";
import "./debug";
import "./style.css";

function Icon({
  name,
}: {
  name: "compass" | "flag" | "arrow" | "reset" | "mountain";
}) {
  const paths = {
    compass:
      "M12 2 15 9 22 12 15 15 12 22 9 15 2 12 9 9Z M12 9 15 12 12 15 9 12Z",
    flag: "M5 22V3 M5 4Q10 0 15 4Q18 6 21 3V14Q17 17 13 13Q9 10 5 14",
    arrow: "M4 12H20 M14 6 20 12 14 18",
    reset: "M4 9A8 8 0 1 1 4 16 M4 3V9H10",
    mountain: "M2 20 10 5 15 13 18 9 23 20Z M7 11 10 13 12 9",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const stateRef = useRef(createGame());
  const selection = useRef<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const busy = useRef(false);
  const [state, setState] = useState<GameState>(stateRef.current);
  const city = state.cities.find((city) => city.id === selectedCityId);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [hovered, setHovered] = useState<Tile | null>(null);
  const [notice, setNotice] = useState(
    "Every expedition begins with a single step.",
  );
  const [failed, setFailed] = useState(false);
  const [help, setHelp] = useState(false);
  const [blockedOwner, setBlockedOwner] = useState<string | null>(null);
  const activePlayerIndex = state.players.findIndex(
    (player) => player.id === state.activePlayerId,
  );
  const activePlayer = state.players[activePlayerIndex];
  const activeUnits = state.units.filter(
    (unit) => unit.ownerId === state.activePlayerId,
  );
  const unit =
    state.units.find((unit) => unit.id === selected) ?? activeUnits[0];
  const owner = state.players.find((player) => player.id === unit?.ownerId);
  const availableMovement = activeUnits.reduce(
    (total, unit) => total + unit.movement,
    0,
  );
  const maximumMovement = activeUnits.reduce(
    (total, unit) => total + unit.maxMovement,
    0,
  );

  const combat =
    selected &&
    target &&
    !moving &&
    getAttackTargets(state, selected).some((unit) => unit.id === target)
      ? previewCombat(state, selected, target)
      : null;
  const clearTarget = () => {
    targetRef.current = null;
    setTarget(null);
  };
  const select = (value: string | null) => {
    if (
      value &&
      !stateRef.current.units.some(
        (unit) =>
          unit.id === value && unit.ownerId === stateRef.current.activePlayerId,
      )
    )
      return;
    clearTarget();
    setSelectedCityId(null);
    selection.current = value;
    setBlockedOwner(null);
    setSelected(value);
    world.current?.update(stateRef.current, value);
  };
  const reset = (seed = stateRef.current.seed) => {
    if (busy.current) return;
    stateRef.current = createGame(seed);
    setState(stateRef.current);
    select(null);
    world.current?.rebuild(stateRef.current);
    world.current?.update(stateRef.current, null);
    setNotice("A fresh beginning. Select your warrior to explore.");
  };
  const endTurn = () => {
    if (busy.current) return;
    const next = applyAction(stateRef.current, {
      type: "END_TURN",
      playerId: stateRef.current.activePlayerId,
    });
    stateRef.current = next;
    setState(next);
    select(null);
    const player = next.players.find(
      (player) => player.id === next.activePlayerId,
    )!;
    setNotice(`${player.name}'s turn. Select your warrior to move.`);
  };

  const attack = async () => {
    if (busy.current || !selection.current || !targetRef.current) return;
    const current = stateRef.current;
    const result = previewCombat(current, selection.current, targetRef.current);
    const next = applyAction(current, {
      type: "ATTACK_UNIT",
      playerId: current.activePlayerId,
      unitId: result.attackerId,
      targetId: result.defenderId,
    });
    busy.current = true;
    setMoving(true);
    clearTarget();
    stateRef.current = next;
    setState(next);
    world.current!.update(next, null);
    setNotice("Blades meet…");
    await world.current!.combat(current, next, result);
    if (!world.current) return;
    busy.current = false;
    setMoving(false);
    select(
      next.units.some((unit) => unit.id === result.attackerId)
        ? result.attackerId
        : null,
    );
    const survivingOwners = new Set(next.units.map((unit) => unit.ownerId));
    setNotice(
      survivingOwners.size === 1
        ? `${next.players.find((player) => survivingOwners.has(player.id))!.name} holds the island. Restart for another duel.`
        : "Attack complete. This warrior is done for the turn.",
    );
  };

  useEffect(() => {
    let alive = true;
    const click = async (position: Position) => {
      if (busy.current) return;
      const current = stateRef.current;
      const clickedCity = current.cities.find(
        (city) => city.x === position.x && city.y === position.y,
      );
      const clickedUnit = current.units.find(
        (unit) => unit.x === position.x && unit.y === position.y,
      );
      if (clickedUnit) {
        if (clickedUnit.ownerId !== current.activePlayerId) {
          if (
            selection.current &&
            getAttackTargets(current, selection.current).some(
              (unit) => unit.id === clickedUnit.id,
            )
          ) {
            targetRef.current = clickedUnit.id;
            setTarget(clickedUnit.id);
            setNotice("Review the combat preview, then confirm Attack.");
            return;
          }
          select(null);
          setSelectedCityId(clickedCity?.id ?? null);
          const owner = current.players.find(
            (player) => player.id === clickedUnit.ownerId,
          )!;
          setBlockedOwner(owner.name);
          setNotice(`${owner.name}'s warrior is waiting for its owner's turn.`);
          return;
        }
        select(clickedUnit.id);
        setSelectedCityId(clickedCity?.id ?? null);
        setNotice(
          clickedUnit.movement
            ? "Choose a highlighted tile to move."
            : "Movement spent. End your turn to continue.",
        );
        return;
      }
      clearTarget();
      const warrior = current.units.find(
        (unit) => unit.id === selection.current,
      );
      if (!warrior) {
        setSelectedCityId(clickedCity?.id ?? null);
        return;
      }
      const destination = getReachableTiles(current, warrior.id).find(
        (tile) => tile.x === position.x && tile.y === position.y,
      );
      if (!destination) {
        if (clickedCity) {
          select(null);
          setSelectedCityId(clickedCity.id);
          return;
        }
        setNotice("Beyond your reach. Choose a highlighted tile.");
        return;
      }
      const next = applyAction(current, {
        type: "move",
        playerId: current.activePlayerId,
        unitId: warrior.id,
        to: position,
      });
      busy.current = true;
      setMoving(true);
      stateRef.current = next;
      setState(next);
      world.current!.update(next, null);
      setNotice("On the move…");
      await world.current!.move(warrior.id, destination.path);
      if (!alive) return;
      busy.current = false;
      setMoving(false);
      world.current!.update(next, warrior.id);
      setSelectedCityId(clickedCity?.id ?? null);
      setNotice(
        next.units.find((unit) => unit.id === warrior.id)!.movement
          ? "New ground, new possibilities. One step remains."
          : "Movement spent. End your turn to continue.",
      );
    };
    try {
      const instance = createWorld(canvas.current!, click, setHovered);
      world.current = instance;
      instance.rebuild(stateRef.current);
      instance.update(stateRef.current, null);
      if (import.meta.env.DEV) {
        const debugUnit = (unitId?: string) => {
          const current = stateRef.current;
          const unit = unitId
            ? current.units.find((unit) => unit.id === unitId)
            : (current.units.find((unit) => unit.id === selection.current) ??
              current.units.find(
                (unit) => unit.ownerId === current.activePlayerId,
              ));
          if (!unit) throw new Error("Unknown unit");
          return unit;
        };
        window.__GAME_DEBUG__ = {
          getState: () => structuredClone(stateRef.current),
          getUnits: () => structuredClone(stateRef.current.units),
          getActivePlayer: () =>
            structuredClone(
              stateRef.current.players.find(
                (player) => player.id === stateRef.current.activePlayerId,
              )!,
            ),
          getTurnNumber: () => stateRef.current.turnNumber,
          getTile: (x, y) => structuredClone(getTile(stateRef.current, x, y)),
          setSeed: (seed) => {
            if (busy.current) throw new Error("Wait for movement to finish");
            reset(seed);
          },
          getReachableTiles: (unitId) =>
            structuredClone(
              getReachableTiles(stateRef.current, debugUnit(unitId).id),
            ),
          getSelectedUnitId: () => selection.current,
          getTileScreenPosition: (x, y) => instance.project({ x, y }),
          getUnitScreenPosition: (unitId) =>
            instance.project(debugUnit(unitId), 0.5),
          isAnimating: instance.isAnimating,
          getVisualPosition: (unitId) =>
            instance.getVisualPosition(debugUnit(unitId).id),
          getMarkerCount: instance.getMarkerCount,
          getHoveredTile: instance.getHoveredTile,
        };
      }
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current) select(null);
    };
    window.addEventListener("keydown", keydown);
    return () => {
      alive = false;
      window.removeEventListener("keydown", keydown);
      if (import.meta.env.DEV) delete window.__GAME_DEBUG__;
      world.current?.dispose();
      world.current = null;
    };
  }, []);

  return (
    <main>
      <canvas
        ref={canvas}
        aria-label="Interactive 3D expedition map. Click the warrior, then a highlighted tile to move."
      />
      <header className="topbar">
        <Lobby />
        <a className="brand" href="/" aria-label="react-polytop home">
          <span className="brand-mark">
            <Icon name="compass" />
          </span>
          <span>
            react-polytop
          </span>
        </a>
        <div className="chapter">
          <span className="live-dot" /> LOCAL EXPEDITION{" "}
          <span className="divider" /> TURN {state.turnNumber}
        </div>
        <button
          className="icon-button"
          aria-label="Show controls"
          onClick={() => setHelp(!help)}
        >
          ?
        </button>
      </header>
      <aside className="expedition-card">
        <div className="eyebrow">
          <Icon name="flag" /> CURRENT TURN{" "}
          <span data-testid="turn-number">{state.turnNumber}</span>
        </div>
        <div className="player-line">
          <span
            className="player-avatar"
            style={{ background: playerStyle(activePlayerIndex).accent }}
          >
            {activePlayer.name[0]}
          </span>
          <div>
            <strong data-testid="active-player">
              The {activePlayer.name} Company
            </strong>
            <small>Player {activePlayerIndex + 1} · Local pass-and-play</small>
          </div>
          <span className="player-dot" />
        </div>
        <div className="card-rule" />
        <div className="stat-row">
          <span>Stars</span>
          <b data-testid="stars">{activePlayer.stars}</b>
        </div>
        <div className="stat-row">
          <span>Income per turn</span>
          <b data-testid="income">+{getIncome(state, activePlayer.id)}</b>
        </div>
        {city && (
          <div className="city-info" aria-label="Selected city">
            <div className="card-rule" />
            <div className="eyebrow">
              CITY &middot;{" "}
              {state.players.find((player) => player.id === city.ownerId)
                ?.name ?? "Neutral"}
            </div>
            <div className="stat-row">
              <span>Level</span>
              <b>
                {city.level} / {cityEconomy.maxLevel}
              </b>
            </div>
            <div className="stat-row">
              <span>City income</span>
              <b>+{city.income} stars</b>
            </div>
            {getUpgradeCost(city) !== null ? (
              <div className="stat-row">
                <span>Upgrade cost</span>
                <b>{getUpgradeCost(city)} stars</b>
              </div>
            ) : (
              <p>Maximum level</p>
            )}
            {city.ownerId === activePlayer.id &&
              getUpgradeCost(city) !== null && (
                <button
                  disabled={
                    moving || activePlayer.stars < getUpgradeCost(city)!
                  }
                  onClick={() => {
                    if (busy.current) return;
                    const next = applyAction(stateRef.current, {
                      type: "UPGRADE_CITY",
                      playerId: stateRef.current.activePlayerId,
                      cityId: city.id,
                    });
                    stateRef.current = next;
                    setState(next);
                    world.current?.update(next, selection.current);
                    setNotice("City upgraded. More income arrives next turn.");
                  }}
                >
                  Upgrade City
                </button>
              )}
          </div>
        )}
        <div className="stat-row">
          <span>Warriors</span>
          <b>{activeUnits.length}</b>
        </div>
        <div className="stat-row">
          <span>Movement available</span>
          <b>
            {availableMovement}
            <i> / {maximumMovement}</i>
          </b>
        </div>
        <div className="movement-track">
          <span
            style={{
              width: `${maximumMovement ? (availableMovement / maximumMovement) * 100 : 0}%`,
            }}
          />
        </div>
      </aside>
      <div className={`map-tools ${city ? "city-open" : ""}`}>
        <span className="north">
          N<Icon name="compass" />
        </span>
        <button
          className="icon-button"
          aria-label="Reset camera"
          onClick={() => world.current?.resetCamera()}
        >
          <Icon name="reset" />
        </button>
      </div>
      <div className="terrain-readout">
        {hovered ? (
          <>
            <span className={`terrain-dot ${hovered.terrain}`} />
            <strong>{hovered.terrain}</strong>
            <span>
              {hovered.x + 1}, {hovered.y + 1}
            </span>
            <small>
              {hovered.terrain === "grass"
                ? "1 movement"
                : hovered.terrain === "forest"
                  ? "2 movement"
                  : "Impassable"}
            </small>
          </>
        ) : (
          <>
            <Icon name="mountain" />
            <span>Hover to inspect terrain</span>
          </>
        )}
      </div>
      {unit && owner && (
        <section className={`unit-card ${selected ? "selected" : ""}`}>
          <div
            className="unit-portrait"
            style={{
              background: playerStyle(
                state.players.findIndex((player) => player.id === unit.ownerId),
              ).accent,
            }}
          >
            <span className="portrait-crest">✦</span>
            <Icon name="flag" />
            <span className="portrait-level">I</span>
          </div>
          <div className="unit-info">
            <div className="eyebrow">
              {selected
                ? `OWNER · ${owner.name.toUpperCase()}`
                : "READY TO EXPLORE"}
            </div>
            <h2>{owner.name} warrior</h2>
            <p>
              {blockedOwner
                ? `${blockedOwner}'s warrior cannot act this turn.`
                : moving
                  ? "Crossing new ground…"
                  : selected
                    ? unit.hasAttacked
                      ? "Action spent. End your turn."
                      : unit.movement
                        ? "Choose a golden tile to move."
                        : getAttackTargets(state, unit.id).length
                          ? "Movement spent. Click a red target to attack."
                          : "Movement spent. End your turn."
                    : "Click your warrior on the island."}
            </p>
            <div className="unit-meta">
              <span className="health-line" />{" "}
              <span>
                {unit.hp} / {unit.maxHp} HP
              </span>
              <span className="meta-divider" />
              <span className="movement-pips">
                {Array.from({ length: unit.maxMovement }, (_, i) => (
                  <i key={i} className={unit.movement > i ? "filled" : ""} />
                ))}
              </span>
              <span>
                {unit.movement} / {unit.maxMovement} movement
              </span>
            </div>
          </div>
          <button
            className="select-button"
            disabled={moving}
            onClick={() => {
              if (busy.current) return;
              select(unit.id);
              setNotice(
                unit.movement
                  ? "Choose a highlighted tile to move."
                  : "Movement spent. End your turn to continue.",
              );
            }}
            aria-label="Select warrior"
          >
            <Icon name="arrow" />
          </button>
        </section>
      )}
      {combat && unit && (
        <section className="combat-preview" aria-label="Combat preview">
          <div className="eyebrow">MELEE · COMBAT PREVIEW</div>
          <p>
            You: {unit.hp} → {combat.attackerHp}
          </p>
          <p>
            Enemy: {state.units.find((unit) => unit.id === target)!.hp} →{" "}
            {combat.defenderHp}
          </p>
          <small>
            {combat.damage} damage · {combat.retaliation} retaliation
          </small>
          <button onClick={attack} disabled={moving}>
            Attack
          </button>
          <button onClick={clearTarget} disabled={moving}>
            Cancel
          </button>
        </section>
      )}
      {!unit && (
        <section className="combat-preview">
          <p>No warriors remain for {activePlayer.name}.</p>
          <p>Restart for another duel.</p>
        </section>
      )}
      <div className="bottom-status" role="status">
        <span />
        {notice}
      </div>
      <button
        className="restart"
        onClick={endTurn}
        disabled={moving || failed}
        aria-label="End Turn"
      >
        <Icon name="arrow" />
        <span>
          End Turn
          <small>
            {activePlayer.name.toUpperCase()} · TURN {state.turnNumber}
          </small>
        </span>
      </button>
      <button
        className="restart-expedition"
        onClick={() => reset()}
        disabled={moving}
      >
        Restart expedition
      </button>
      <footer>
        <span>
          EARLY EXPLORATION <b>v0.2</b>
        </span>
        <span>
          CLICK TO SELECT <i>·</i> RIGHT-DRAG TO ORBIT <i>·</i> SCROLL TO ZOOM
        </span>
        <span>
          SEED <b>{state.seed}</b>
        </span>
      </footer>
      {help && (
        <div className="help-panel">
          <h2>A small beginning</h2>
          <p>
            Select the active company's warrior and click a golden tile. Each
            warrior has two movement points per turn. End Turn passes control to
            the other company; your movement resets when your next turn begins.
          </p>
          <p>
            Click an adjacent enemy on a red tile to preview combat, then
            confirm Attack. Moving first is allowed; attacking ends that
            warrior's actions. Injured warriors deal less damage. Surviving
            defenders retaliate.
          </p>
          <p>
            Enter a city to claim it. Click a city to inspect or upgrade it.
            Owned cities pay stars at the start of your turn; upgrades increase
            future income.
          </p>
          <ul>
            <li>Grass costs 1 point.</li>
            <li>Forest costs 2 points.</li>
            <li>Water and mountains are impassable.</li>
            <li>Move north, south, east, or west.</li>
          </ul>
          <p>
            Right-drag to orbit, scroll to zoom, or press Escape to deselect.
            Restart to try another route.
          </p>
          <button onClick={() => setHelp(false)}>Back to the island</button>
        </div>
      )}
      {failed && (
        <div className="help-panel">
          <h2>The island could not load</h2>
          <p>
            This demo requires a browser with WebGL enabled. Check hardware
            acceleration and reload.
          </p>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

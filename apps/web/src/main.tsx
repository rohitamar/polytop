import type { LobbyClientMessage, LobbyServerMessage } from "@reach/protocol";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyAction,
  economy,
  getCityPopulation,
  getCityProduction,
  getProduction,
  positionKey,
  type GameAction,
  getUpgradeCost,
  getAttackTargets,
  previewCombat,
  createGame,
  getReachableTiles,
  getTile,
  getTerritory,
  getTileTerritory,
  type GameState,
  type Position,
  type Tile,
} from "@reach/game-core";
import { createWorld, type World } from "./world";
import { opportunityNames, developedNames } from "./resources";
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
  const renders = useRef(0);
  if (import.meta.env.DEV) renders.current++;
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const [state, setState] = useState<GameState>(() => createGame("fern-104", 2, { scenario: "demo" }));
  const stateRef = useRef(state);
  const network = useRef<{ playerId: string; send: (message: LobbyClientMessage) => Promise<void> } | null>(null);
  const networkMatch = useRef(false);
  const [networked, setNetworked] = useState(false);
  const connectionReady = useRef(true);
  const [connected, setConnected] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const canAct = !networked || connected && network.current?.playerId === state.activePlayerId;
  const submit = (action: GameAction) => {
    if (!network.current || !networkMatch.current) return false;
    if (busy.current || !connectionReady.current) return true;
    const { playerId: ignored, ...intent } = action;
    if (intent.type === "move") intent.to = { x: intent.to.x, y: intent.to.y };
    if (intent.type === "ASSIGN_WORKER" || intent.type === "UNASSIGN_WORKER") intent.tile = { x: intent.tile.x, y: intent.tile.y };
    busy.current = true;
    setWaiting(true);
    void network.current.send({ type: "GAME_ACTION", requestId: crypto.randomUUID(), expectedRevision: stateRef.current.revision, action: intent }).catch(error => {
      busy.current = false;
      setWaiting(false);
      setNotice(error.message);
    });
    return true;
  };
  const matchQueue = useRef(Promise.resolve());
  const receiveMatch = (message: Extract<LobbyServerMessage, { type: "MATCH_STATE" }>) => {
    networkMatch.current = true;
    setNetworked(true);
    connectionReady.current = true;
    setConnected(true);
    matchQueue.current = matchQueue.current.then(async () => {
      const previous = stateRef.current;
      const next = message.state;
      busy.current = true;
      setWaiting(false);
      setMoving(true);
      stateRef.current = next;
      setState(next);
      clearTarget();
      if (!message.action || ["END_TURN", "move", "ATTACK_UNIT"].includes(message.action.type)) {
        selection.current = null;
        setSelected(null);
        setCitySelection(null);
      }
      if (!message.action) world.current?.rebuild(next);
      world.current?.update(next, selection.current);
      if (message.action?.type === "move") {
        const action = message.action;
        const destination = getReachableTiles(previous, action.unitId).find(tile => tile.x === action.to.x && tile.y === action.to.y);
        if (destination) await world.current?.move(action.unitId, destination.path);
      } else if (message.action?.type === "ATTACK_UNIT") {
        await world.current?.combat(previous, next, previewCombat(previous, message.action.unitId, message.action.targetId));
      }
      world.current?.update(next, selection.current);
      busy.current = false;
      setMoving(false);
      setNotice(`${next.players.find(player => player.id === next.activePlayerId)!.name}'s turn.`);
    }).catch(error => {
      busy.current = false;
      setMoving(false);
      setNotice(String(error));
    });
  };
  const selection = useRef<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const citySelection = useRef<string | null>(null);
  const [resourceTile, setResourceTile] = useState<Position | null>(null);
  const setCitySelection = (id: string | null) => {
    citySelection.current = id;
    setSelectedCityId(id);
    setResourceTile(null);
  };
  const busy = useRef(false);
  useEffect(() => { world.current?.selectCity(selectedCityId); world.current?.selectResource(resourceTile); }, [selectedCityId, resourceTile, state]);
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
          unit.id === value && unit.ownerId === stateRef.current.activePlayerId && (!networkMatch.current || network.current?.playerId === unit.ownerId),
      )
    )
      return;
    clearTarget();
    setCitySelection(null);
    selection.current = value;
    setBlockedOwner(null);
    setSelected(value);
    world.current?.update(stateRef.current, value);
  };
  const reset = (seed = stateRef.current.seed) => {
    if (busy.current || networkMatch.current) return;
    stateRef.current = createGame(seed, 2, { scenario: "demo" });
    setState(stateRef.current);
    select(null);
    world.current?.rebuild(stateRef.current);
    world.current?.update(stateRef.current, null);
    setNotice("A fresh beginning. Select your warrior to explore.");
  };
  const endTurn = () => {
    if (busy.current) return;
    if (submit({ type: "END_TURN", playerId: stateRef.current.activePlayerId })) return;
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

  const cityAction = (action: GameAction) => {
    if (busy.current) return;
    if (submit(action)) return;
    try {
      const next = applyAction(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      world.current?.update(next, selection.current);
      setNotice("City economy updated. Production arrives at the start of your next turn.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action rejected");
    }
  };

  const attack = async () => {
    if (busy.current || !selection.current || !targetRef.current) return;
    const current = stateRef.current;
    const result = previewCombat(current, selection.current, targetRef.current);
    if (submit({ type: "ATTACK_UNIT", playerId: current.activePlayerId, unitId: result.attackerId, targetId: result.defenderId })) return;
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
      const resource = getTile(current, position.x, position.y);
      if (!selection.current && resource?.resource && !current.units.some(unit => positionKey(unit) === positionKey(position)) && !current.cities.some(city => positionKey(city) === positionKey(position))) {
        if (!citySelection.current) setCitySelection(getTileTerritory(current, position.x, position.y)?.cityId ?? null);
        setResourceTile({ x: position.x, y: position.y });
        clearTarget();
        return;
      }
      if (networkMatch.current && (!connectionReady.current || network.current?.playerId !== current.activePlayerId)) { setNotice("Wait for your turn."); return; }
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
          setCitySelection(clickedCity?.id ?? null);
          const owner = current.players.find(
            (player) => player.id === clickedUnit.ownerId,
          )!;
          setBlockedOwner(owner.name);
          setNotice(`${owner.name}'s warrior is waiting for its owner's turn.`);
          return;
        }
        select(clickedUnit.id);
        setCitySelection(clickedCity?.id ?? null);
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
        setCitySelection(clickedCity?.id ?? null);
        return;
      }
      const destination = getReachableTiles(current, warrior.id).find(
        (tile) => tile.x === position.x && tile.y === position.y,
      );
      if (!destination) {
        if (clickedCity) {
          select(null);
          setCitySelection(clickedCity.id);
          return;
        }
        setNotice("Beyond your reach. Choose a highlighted tile.");
        return;
      }
      if (submit({ type: "move", playerId: current.activePlayerId, unitId: warrior.id, to: position })) return;
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
      setCitySelection(clickedCity?.id ?? null);
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
          getProfile: () => ({ ...instance.getProfile(), reactRenders: renders.current }),
          resetProfile: instance.resetProfile,
          getTerritoryRenderStats: instance.getTerritoryRenderStats,
          getResourceRenderStats: instance.getResourceRenderStats,
          getSelectedResource: () => instance.getResourceRenderStats().selectedTile,
          getTerritory: () => getTerritory(stateRef.current),
          getTileTerritory: (x, y) => getTileTerritory(stateRef.current, x, y),
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
          setWorld: (seed, playerCount, dimensions) => {
            if (busy.current || networkMatch.current) throw new Error("Cannot replace an active match");
            stateRef.current = createGame(seed, playerCount, dimensions);
            setState(stateRef.current);
            select(null);
            world.current?.rebuild(stateRef.current);
            world.current?.update(stateRef.current, null);
          },
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

  const treasuryPlayer = state.players.find(player => player.id === network.current?.playerId) ?? activePlayer;
  const production = getProduction(state, treasuryPlayer.id);
  const population = city ? getCityPopulation(state, city) : null;
  const cityProduction = city ? getCityProduction(state, city.id) : null;
  const cityName = (cityId: string | null | undefined) => {
    const controlled = state.cities.find(city => city.id === cityId);
    if (!controlled) return "Unclaimed land";
    const player = state.players.find(player => player.id === controlled.ownerId);
    return player ? `${player.name} · ${controlled.id.startsWith("neutral-") ? "Village" : "City"} ${controlled.id.split("-").at(-1)}` : `Neutral village ${controlled.id.replace("neutral-", "")}`;
  };
  const resource = resourceTile ? getTile(state, resourceTile.x, resourceTile.y) : undefined;
  const claim = resource ? getTileTerritory(state, resource.x, resource.y) : undefined;
  const resourceCity = state.cities.find(city => city.id === claim?.cityId);
  const worked = !!resource && !!resourceCity?.workedTiles.includes(positionKey(resource));
  const yieldRule = resource?.resource ? economy.yields[resource.resource] : undefined;
  const canWork = !!resourceCity && resourceCity.id === city?.id && resourceCity.ownerId === activePlayer.id && canAct;
  const hoverClaim = hovered ? getTileTerritory(state, hovered.x, hovered.y) : undefined;
  const hoverCity = state.cities.find(city => city.id === hoverClaim?.cityId);
  const hoverWorked = !!hovered && !!hoverCity?.workedTiles.includes(positionKey(hovered));

  return (
    <main>
      <canvas
        ref={canvas}
        aria-label="Interactive 3D expedition map. Click the warrior, then a highlighted tile to move."
      />
      <header className="topbar">
        <Lobby onMatch={receiveMatch} onSession={(playerId, send) => { network.current = { playerId, send }; }} onEnd={(reason, ended) => {
          busy.current = false;
          setWaiting(false);
          setNotice(reason);
          if (ended) {
            connectionReady.current = false;
            setConnected(false);
            select(null);
          }
        }} />
        <a className="brand" href="/" aria-label="react-polytop home">
          <span>react-polytop</span>
        </a>
        <div className="chapter">
          <span className="live-dot" /> {networked ? "MULTIPLAYER MATCH" : "LOCAL EXPEDITION"}{" "}
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
      <section className="treasury-bar" aria-label="Civilization resources">
        <span className="treasury-name">{treasuryPlayer.name} treasury</span>
        {(["gold", "food", "wood", "steel"] as const).map(resource => (
          <div className="treasury-resource" key={resource}>
            <span>{resource[0].toUpperCase() + resource.slice(1)}</span>
            <b data-testid={resource}>{treasuryPlayer.resources[resource]} <small>+{production[resource]}/turn</small></b>
          </div>
        ))}
      </section>
      <aside className="expedition-card" aria-label="Current player">
        <div className="eyebrow"><Icon name="flag" /> CURRENT TURN <span data-testid="turn-number">{state.turnNumber}</span></div>
        <div className="player-line">
          <span className="player-avatar" style={{ background: playerStyle(activePlayerIndex).accent }}>{activePlayer.name[0]}</span>
          <div>
            <strong data-testid="active-player">The {activePlayer.name} Company</strong>
            <small>Player {activePlayerIndex + 1} · {networked ? canAct ? "Your turn" : "Waiting for your turn" : "Local pass-and-play"}</small>
          </div>
        </div>
        <div className="turn-summary">{activeUnits.length} warrior{activeUnits.length === 1 ? "" : "s"} · {availableMovement}/{maximumMovement} movement</div>
      </aside>
      {city && population && cityProduction && (
        <section className="city-panel" aria-label="Selected city">
          <div className="panel-heading"><span className="eyebrow">CITY TERRITORY</span><button aria-label="Close city" disabled={moving || waiting} onClick={() => select(null)}>×</button></div>
          <h2>{cityName(city.id)}</h2>
          <div className="city-stats">
            <div><span>Town Hall</span><b data-testid="town-hall">{city.townHallLevel} / {economy.maxLevel}</b></div>
            <div><span>Population</span><b data-testid="population">{population.total} / {population.cap}</b></div>
            <div><span>Civilians / military</span><b>{population.civilian} / {population.military}</b></div>
            <div><span>Available civilians</span><b data-testid="available-civilians">{population.available}</b></div>
          </div>
          <div className="city-income" aria-label="City production">
            {(["gold", "food", "wood", "steel"] as const).map(resource => <span key={resource}>+{cityProduction[resource]} {resource[0].toUpperCase() + resource.slice(1)}</span>)}
          </div>
          {city.ownerId === treasuryPlayer.id && <div className="city-actions">
            <button disabled={moving || waiting || !canAct || population.total >= population.cap || activePlayer.resources.food < economy.growthCost}
              onClick={() => cityAction({ type: "GROW_POPULATION", playerId: activePlayer.id, cityId: city.id })}>Grow Population · {economy.growthCost} Food</button>
            {getUpgradeCost(city) !== null ? <button disabled={moving || waiting || !canAct || activePlayer.resources.gold < getUpgradeCost(city)!}
              onClick={() => cityAction({ type: "UPGRADE_TOWN_HALL", playerId: activePlayer.id, cityId: city.id })}>Upgrade Town Hall · {getUpgradeCost(city)} Gold</button> : <p>Maximum Town Hall level</p>}
          </div>}
          {selected ? <button className="manage-resources" disabled={moving || waiting} onClick={() => { select(null); setCitySelection(city.id); setNotice("Click a resource inside this city's border to manage civilians."); }}>Manage resources</button> : <p className="city-hint">Click a marked resource inside this city's border. One civilian works one tile.</p>}
        </section>
      )}
      {resource?.resource && yieldRule && (
        <section className="resource-panel" aria-label="Resource tile">
          <div className="panel-heading"><span className="eyebrow">RESOURCE TILE</span><button aria-label="Close resource" disabled={moving || waiting} onClick={() => setResourceTile(null)}>×</button></div>
          <h2>{worked ? developedNames[resource.resource] : opportunityNames[resource.resource]}</h2>
          <span className={`resource-state ${worked ? "worked" : ""}`}>{worked ? "Worked" : "Unworked"}</span>
          <p className="resource-yield">+{yieldRule.amount} {yieldRule.resource[0].toUpperCase() + yieldRule.resource.slice(1)}/turn{worked ? "" : " when worked"}</p>
          <p className="resource-owner">{claim?.cityId ? `Controlled by ${cityName(claim.cityId)}` : "Unclaimed land"}</p>
          {canWork ? <>
            <button className="worker-action" disabled={moving || waiting || !worked && getCityPopulation(state, resourceCity!).available <= 0}
              onClick={() => cityAction({ type: worked ? "UNASSIGN_WORKER" : "ASSIGN_WORKER", playerId: activePlayer.id, cityId: resourceCity!.id, tile: resource })}>{worked ? "Unassign Civilian" : "Assign Civilian"}</button>
            {!worked && getCityPopulation(state, resourceCity!).available <= 0 && <small>No available civilians. Grow the city or unassign another tile.</small>}
          </> : <>
            <p className="resource-restriction">{!resourceCity?.ownerId ? "Capture this territory before assigning civilians." : resourceCity.ownerId !== treasuryPlayer.id ? "This territory belongs to another player." : resourceCity.id !== city?.id ? "Select the controlling city to manage this tile." : "Assignment is available on your turn."}</p>
            {resourceCity && resourceCity.id !== city?.id && <button className="worker-action" disabled={moving || waiting} onClick={() => { select(null); setCitySelection(resourceCity.id); setResourceTile(resource); }}>Select controlling city</button>}
          </>}
        </section>
      )}
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
            <strong>{hovered.resource ? hoverWorked ? developedNames[hovered.resource] : opportunityNames[hovered.resource] : hovered.terrain}</strong>
            <span>
              {hovered.x + 1}, {hovered.y + 1}
            </span>
            {hovered.resource && <><span>{hoverWorked ? "Worked" : "Unworked"}</span><small>+{economy.yields[hovered.resource].amount} {economy.yields[hovered.resource].resource}/turn{hoverWorked ? "" : " when worked"} · {cityName(hoverClaim?.cityId)}</small></>}
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
                {unit.hp} / {unit.maxHp} HP · {unit.populationCost} military population
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
            disabled={moving || waiting || !canAct}
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
          <button onClick={attack} disabled={moving || waiting || !canAct}>
            Attack
          </button>
          <button onClick={clearTarget} disabled={moving || waiting || !canAct}>
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
        disabled={moving || waiting || !canAct || failed}
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
        disabled={networked || moving}
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
            Town Halls generate Gold. Choose Manage resources in the city panel, then click a resource tile to assign a civilian. Spend Food to grow population or Gold to upgrade the Town Hall.
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

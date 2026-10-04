import type { LobbyClientMessage, LobbyServerMessage } from "@reach/protocol";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyAction,
  economy,
  resourceDefinitions,
  getRoadBuildingReason,
  hasTechnology,
  roadRules,
  portRules,
  getPortBuildingReason,
  unitDefinitions,
  getUnitDefinition,
  getRecruitmentReason,
  getTechnology,
  type TechnologyId,
  getPlayerPopulation,
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
} from "@reach/game-core";
import { createWorld, type World } from "./world";
import { opportunityNames } from "./resources";
import { playerStyle } from "./player-style";
import { Lobby } from "./lobby";
import { TechnologyPanel } from "./technology-panel";
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

function collectionNotice(previous: GameState, next: GameState) {
  const remaining = new Set(next.tiles.filter(tile => tile.resource).map(positionKey));
  const reward = previous.tiles.reduce((total, tile) => total + (tile.resource && !remaining.has(positionKey(tile)) ? resourceDefinitions[tile.resource].goldReward : 0), 0);
  return reward ? `+${reward} Gold - Resource collected` : "";
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
      if (!message.action || message.action.type === "END_TURN") stopRoadPlacement();
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
      const collected = collectionNotice(previous, next);
      setNotice(collected || (message.action?.type === "UNLOCK_TECHNOLOGY"
        ? `${next.players.find(player => player.id === message.action!.playerId)!.name} unlocked ${getTechnology(message.action.technologyId)!.name}.`
        : message.action?.type === "BUILD_PORT" ? `Port built for ${portRules.goldCost} Gold.` : message.action?.type === "BUILD_ROAD" ? `Road built for ${roadRules.goldCost} Gold.`
        : message.action?.type === "RECRUIT_UNIT" ? `${getUnitDefinition(message.action.unitType)!.name} recruited. Ready on your next turn.`
        : `${next.players.find(player => player.id === next.activePlayerId)!.name}'s turn.`));
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
  const portMode = useRef(false);
  const [placingPort, setPlacingPort] = useState(false);
  const [portTile, setPortTile] = useState<Position | null>(null);
  const roadMode = useRef(false);
  const [placingRoad, setPlacingRoad] = useState(false);
  const [roadTile, setRoadTile] = useState<Position | null>(null);
  const stopRoadPlacement = () => { roadMode.current = false; setPlacingRoad(false); setRoadTile(null); portMode.current = false; setPlacingPort(false); setPortTile(null); };
  useEffect(() => { world.current?.selectCity(selectedCityId); world.current?.selectResource(resourceTile); }, [selectedCityId, resourceTile, state]);
  const city = state.cities.find((city) => city.id === selectedCityId);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState(
    "Every expedition begins with a single step.",
  );
  const [failed, setFailed] = useState(false);
  const [help, setHelp] = useState(false);
  const [showTechnologies, setShowTechnologies] = useState(false);
  const [showRecruitment, setShowRecruitment] = useState(false);
  useEffect(() => setShowRecruitment(false), [selectedCityId]);
  const activePlayerIndex = state.players.findIndex(
    (player) => player.id === state.activePlayerId,
  );
  const activePlayer = state.players[activePlayerIndex];
  const activeUnits = state.units.filter(
    (unit) => unit.ownerId === state.activePlayerId,
  );
  const unit =
    state.units.find((unit) => unit.id === selected) ?? activeUnits[0];
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
    stopRoadPlacement();
    clearTarget();
    setCitySelection(null);
    selection.current = value;
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
    setNotice(`${player.name}'s turn. Select your unit to move.`);
  };

  const cityAction = (action: GameAction) => {
    if (busy.current) return;
    if (submit(action)) return;
    try {
      const next = applyAction(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      world.current?.update(next, selection.current);
      setNotice(action.type === "BUILD_PORT" ? `Port built for ${portRules.goldCost} Gold. Move a land unit onto it to embark.` : action.type === "BUILD_ROAD" ? `Road built for ${roadRules.goldCost} Gold.` : action.type === "RECRUIT_UNIT" ? `${getUnitDefinition(action.unitType)!.name} recruited. Ready on your next turn.` : "City economy updated. Production arrives at the start of your next turn.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action rejected");
    }
  };

  const unlockTechnology = (technologyId: TechnologyId) => {
    if (busy.current) return;
    const playerId = networkMatch.current ? network.current!.playerId : stateRef.current.activePlayerId;
    const action: GameAction = { type: "UNLOCK_TECHNOLOGY", playerId, technologyId };
    if (submit(action)) return;
    try {
      const previous = stateRef.current;
      const next = applyAction(previous, action);
      stateRef.current = next;
      setState(next);
      world.current?.update(next, selection.current);
      setNotice(collectionNotice(previous, next) || `${getTechnology(technologyId)!.name} unlocked.`);
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
      collectionNotice(current, next) || (survivingOwners.size === 1
        ? "Opposing army defeated. Cities can recruit reinforcements."
        : "Attack complete. This unit is done for the turn."),
    );
  };

  useEffect(() => {
    let alive = true;
    const click = async (position: Position) => {
      if (busy.current) return;
      const current = stateRef.current;
      if (portMode.current) { setPortTile({ x: position.x, y: position.y }); return; }
      if (roadMode.current) {
        setRoadTile({ x: position.x, y: position.y });
        setNotice(`Review the tile, then build a road for ${roadRules.goldCost} Gold.`);
        return;
      }
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
          setNotice(`${owner.name}'s ${getUnitDefinition(clickedUnit.unitType)!.name.toLowerCase()} is waiting for its owner's turn.`);
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
        collectionNotice(current, next) || (next.units.find((unit) => unit.id === warrior.id)!.movement
          ? "New ground, new possibilities. Movement remains."
          : "Movement spent. End your turn to continue."),
      );
    };
    try {
      const instance = createWorld(canvas.current!, click, () => {});
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
          getPortMarkerCount: instance.getPortMarkerCount,
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
  const population = city?.ownerId ? getPlayerPopulation(state, city.ownerId) : null;
  const playerPopulation = getPlayerPopulation(state, treasuryPlayer.id);
  const cityProduction = city ? getCityProduction(state, city.id) : null;
  const cityName = (cityId: string | null | undefined) => {
    const controlled = state.cities.find(city => city.id === cityId);
    if (!controlled) return "Unclaimed land";
    const player = state.players.find(player => player.id === controlled.ownerId);
    return player ? `${player.name} · Town Center ${controlled.id.split("-").at(-1)}` : `Neutral Town Center ${controlled.id.replace("neutral-", "")}`;
  };
  const resource = resourceTile ? getTile(state, resourceTile.x, resourceTile.y) : undefined;
  const claim = resource ? getTileTerritory(state, resource.x, resource.y) : undefined;
  const resourceCity = state.cities.find(city => city.id === claim?.cityId);
  const yieldRule = resource?.resource ? resourceDefinitions[resource.resource] : undefined;
  const portSites = placingPort ? state.tiles.filter(tile => getPortBuildingReason(state, treasuryPlayer.id, tile) === null) : [];
  useEffect(() => { world.current?.setPortPlacement(placingPort ? treasuryPlayer.id : null); }, [placingPort, treasuryPlayer.id, state]);
  const portReason = portTile ? getPortBuildingReason(state, treasuryPlayer.id, portTile) : "Select a tile";
  const roadReason = roadTile ? getRoadBuildingReason(state, treasuryPlayer.id, roadTile) : "Select a tile";

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
        <button
          className="icon-button"
          aria-label="Show controls"
          onClick={() => setHelp(!help)}
        >
          ?
        </button>
      </header>
      <section className="treasury-bar" aria-label="Civilization resources">
        <div className="treasury-resource"><span>Gold</span><b data-testid="gold">{treasuryPlayer.resources.gold}</b></div>
        <div className="treasury-resource"><span>Income</span><b data-testid="income">+{production.gold}/turn</b></div>
        <div className="treasury-resource"><span>Population</span><b data-testid="player-population">{playerPopulation.used} / {playerPopulation.capacity}</b></div>
        <button className="technology-toggle" aria-expanded={showTechnologies} onClick={() => { if (busy.current) return; stopRoadPlacement(); setShowTechnologies(!showTechnologies); }}>Technologies</button>
        {hasTechnology(state, treasuryPlayer.id, "roads") && <button className="technology-toggle" disabled={moving || waiting || !canAct} aria-pressed={placingRoad} onClick={() => {
          if (busy.current) return;
          if (roadMode.current) { stopRoadPlacement(); return; }
          stopRoadPlacement();
          select(null);
          setShowTechnologies(false);
          roadMode.current = true;
          setPlacingRoad(true);
          setNotice("Select friendly or neutral land to build a road.");
        }}>{placingRoad ? "Cancel roads" : "Build Roads"}</button>}
      {hasTechnology(state, treasuryPlayer.id, "fishing") && <button className="technology-toggle" disabled={moving || waiting || !canAct} aria-pressed={placingPort} onClick={() => {
        const wasPlacing = portMode.current;
        stopRoadPlacement();
        if (wasPlacing) return;
        select(null); setCitySelection(null); setShowTechnologies(false);
        portMode.current = true; setPlacingPort(true);
        setNotice("Select a golden Water tile to build a Port.");
      }}>{placingPort ? "Cancel ports" : "Build Ports"}</button>}
      </section>
      {placingPort && <section className="resource-panel road-panel" aria-label="Build Port">
        <div className="panel-heading"><span className="eyebrow">PORT CONSTRUCTION</span><button aria-label="Close ports" disabled={moving || waiting} onClick={stopRoadPlacement}>×</button></div>
        <h2>Build Port</h2><p>Cost: {portRules.goldCost} Gold</p>
        <p>{portSites.length ? `${portSites.length} valid ${portSites.length === 1 ? "location" : "locations"} highlighted in gold. Select one to build.` : treasuryPlayer.resources.gold < portRules.goldCost ? "Save 7 Gold to build a Port. Income arrives on your next turn." : "No available coastal Water in your territory. Capture a coastal city to gain access."}</p>
        <p>Choose Water beside land within your territory. Move a land unit onto the Port to embark. Embarking and landing end its turn; Rafts move 2 tiles and cannot attack.</p>
        <p>{portTile ? `Tile ${portTile.x + 1}, ${portTile.y + 1}` : "Select a tile on the map"}</p>
        <button className="worker-action" disabled={moving || waiting || !canAct || portReason !== null} onClick={() => portTile && cityAction({ type: "BUILD_PORT", playerId: treasuryPlayer.id, to: portTile })}>Build Port · {portRules.goldCost} Gold</button>
        {portReason && <small>{portReason}</small>}
      </section>}
      {placingRoad && <section className="resource-panel road-panel" aria-label="Build Road">
        <div className="panel-heading"><span className="eyebrow">ROAD CONSTRUCTION</span><button aria-label="Close roads" disabled={moving || waiting} onClick={stopRoadPlacement}>×</button></div>
        <h2>Build Road</h2><p>Cost: {roadRules.goldCost} Gold</p>
        <p>Friendly or neutral Grass and Forest. Connected roads and Town Centers cost 0.5 movement per edge.</p>
        <p>{roadTile ? `Tile ${roadTile.x + 1}, ${roadTile.y + 1}${getTile(state, roadTile.x, roadTile.y)?.road ? " · Road" : ""}` : "Select a tile on the map"}</p>
        <button className="worker-action" disabled={moving || waiting || !canAct || roadReason !== null} onClick={() => roadTile && cityAction({ type: "BUILD_ROAD", playerId: treasuryPlayer.id, to: roadTile })}>Build Road · {roadRules.goldCost} Gold</button>
        {roadReason && <small>{roadReason}</small>}
      </section>}
      {showTechnologies && <TechnologyPanel state={state} playerId={treasuryPlayer.id}
        blockedReason={!connected ? "Match disconnected" : waiting ? "Waiting for server" : moving ? "Action in progress" : null}
        onUnlock={unlockTechnology} onClose={() => setShowTechnologies(false)} />}
      <aside className="expedition-card" aria-label="Current player">
        <div className="eyebrow"><Icon name="flag" /> CURRENT TURN <span data-testid="turn-number">{state.turnNumber}</span></div>
        <div className="player-line">
          <span className="player-avatar" style={{ background: playerStyle(activePlayerIndex).accent }}>{activePlayer.name[0]}</span>
          <div>
            <strong data-testid="active-player">The {activePlayer.name} Company</strong>
            <small>Player {activePlayerIndex + 1} · {networked ? canAct ? "Your turn" : "Waiting for your turn" : "Local pass-and-play"}</small>
          </div>
        </div>
        <div className="turn-summary">{activeUnits.length} unit{activeUnits.length === 1 ? "" : "s"} · {availableMovement}/{maximumMovement} movement</div>
      </aside>
      {city && cityProduction && (
        <section className="city-panel" aria-label="Selected city">
          <div className="panel-heading"><span className="eyebrow">CITY TERRITORY</span>{city.ownerId === treasuryPlayer.id && <button className="recruitment-toggle" disabled={moving || waiting} aria-expanded={showRecruitment} onClick={() => setShowRecruitment(!showRecruitment)}>{showRecruitment ? "Close recruitment" : "Recruit units"}</button>}<button aria-label="Close city" disabled={moving || waiting} onClick={() => select(null)}>×</button></div>
          <h2>{cityName(city.id)}</h2>
          <div className="city-stats">
            <div><span>Town Center</span><b data-testid="town-hall">{city.townHallLevel} / {economy.maxLevel}</b></div>
            <div><span>Owner population</span><b data-testid="population">{population?.used ?? 0} / {population?.capacity ?? 0}</b></div>
            <div><span>Available population</span><b data-testid="available-population">{population?.available ?? 0}</b></div>
          </div>
          <div className="city-income" aria-label="City production">
            <span>+{cityProduction.gold} Gold/turn</span>
          </div>
          {city.ownerId === treasuryPlayer.id && <div className="city-actions">
            {getUpgradeCost(city) !== null ? <button disabled={moving || waiting || !canAct || activePlayer.resources.gold < getUpgradeCost(city)!}
              onClick={() => cityAction({ type: "UPGRADE_TOWN_HALL", playerId: activePlayer.id, cityId: city.id })}>Upgrade Town Center · {getUpgradeCost(city)} Gold</button> : <p>Maximum Town Center level</p>}
          </div>}
          {showRecruitment && city.ownerId === treasuryPlayer.id && <section className="recruitment-panel" aria-label="Recruit units">
            <h3>Recruit</h3>
            <p>Recruits wait until your next turn. Land units need an empty city tile. Move them onto a Port to embark as Rafts.</p>
            {unitDefinitions.filter(definition => definition.domain === "land").map(definition => {
              const reason = !connected ? "Match disconnected" : waiting ? "Waiting for server" : moving ? "Action in progress" : getRecruitmentReason(state, treasuryPlayer.id, city.id, definition.id);
              return <article key={definition.id} aria-label={definition.name}>
                <div><strong>{definition.name}</strong><span>{definition.goldCost} Gold · {definition.populationCost} Population</span>
                  {definition.requiredTechnology && <span>Requires {getTechnology(definition.requiredTechnology)!.name}</span>}
                  <small>{reason ?? "Available"}</small></div>
                <button disabled={reason !== null} onClick={() => cityAction({ type: "RECRUIT_UNIT", playerId: treasuryPlayer.id, cityId: city.id, unitType: definition.id })} aria-label={`Recruit ${definition.name}`}>Recruit</button>
              </article>;
            })}
          </section>}
          {selected ? <button className="manage-resources" disabled={moving || waiting} onClick={() => { select(null); setCitySelection(city.id); setNotice("Move onto resources to collect Gold."); }}>Inspect resources</button> : <p className="city-hint">Resource collection awards Gold once.</p>}
        </section>
      )}
      {resource?.resource && yieldRule && (
        <section className="resource-panel" aria-label="Resource tile">
          <div className="panel-heading"><span className="eyebrow">RESOURCE TILE</span><button aria-label="Close resource" disabled={moving || waiting} onClick={() => setResourceTile(null)}>×</button></div>
          <h2>{opportunityNames[resource.resource]}</h2>
          <span className="resource-state">Available - One-time collection</span>
          <p className="resource-yield">+{yieldRule.goldReward} Gold once</p>
          <p className="resource-owner">{claim?.cityId ? `Controlled by ${cityName(claim.cityId)}` : "Unclaimed land"}</p>
          <p className="resource-restriction">{yieldRule.requiredTechnology ? `Requires ${getTechnology(yieldRule.requiredTechnology)!.name}. Move an eligible unit here to collect.` : "Move an eligible unit here to collect automatically."}</p>
          {resourceCity && resourceCity.id !== city?.id && <button className="worker-action" disabled={moving || waiting} onClick={() => { select(null); setCitySelection(resourceCity.id); setResourceTile(resource); }}>Select controlling city</button>}
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
      {combat && unit && (
        <section className="combat-preview" aria-label="Combat preview">
          <div className="eyebrow">{unit.range > 1 ? "RANGED" : "MELEE"} · COMBAT PREVIEW</div>
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
          <p>No units remain for {activePlayer.name}.</p>
          <p>Select an owned city to recruit.</p>
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
            Select the active company's unit and click a golden tile. Movement
            depends on unit type. End Turn passes control to
            the next company; your movement resets when your next turn begins.
          </p>
          <p>
            Click an enemy in range on a red tile to preview combat, then
            confirm Attack. Moving first is allowed; attacking ends that
            unit's actions. Injured units deal less damage. Surviving
            defenders retaliate when the attacker is in range.
          </p>
          <p>
            Enter a city to claim it. Click a city to inspect or upgrade it.
            Town Centers generate Gold once at the beginning of your turn. Move onto resources to collect Gold once; mines require Mining. Town Centers provide population capacity. Spend Gold on technologies, existing recruitment, or Town Center upgrades.
            Recruit land units at an empty owned city using Gold and population capacity. Fishing unlocks Ports on owned coastal Water. Land units embark as Rafts at Ports and return to their original type when landing. Recruits become ready on your next turn.
          </p>
          <ul>
            <li>Grass costs 1 point.</li>
            <li>Forest and accessible Mountains cost 1 point.</li>
            <li>Roads cost 3 Gold on friendly or neutral land. Connected roads and city endpoints cost 0.5 movement.</li>
            <li>Climbing opens mountains to land units. Enter Water through Ports. Embarking and landing end the unit’s turn. Rafts move 2 tiles and cannot attack.</li>
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

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  applyAction,
  createGame,
  getReachableTiles,
  getTile,
  type GameState,
  type Position,
  type Tile,
} from "@reach/game-core";
import { createWorld, type World } from "./world";
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
  const selection = useRef(false);
  const busy = useRef(false);
  const [state, setState] = useState<GameState>(stateRef.current);
  const [selected, setSelected] = useState(false);
  const [moving, setMoving] = useState(false);
  const [hovered, setHovered] = useState<Tile | null>(null);
  const [notice, setNotice] = useState(
    "Every expedition begins with a single step.",
  );
  const [failed, setFailed] = useState(false);
  const [help, setHelp] = useState(false);
  const unit = state.units[0];

  const select = (value: boolean) => {
    selection.current = value;
    setSelected(value);
    world.current?.update(stateRef.current, value);
  };
  const reset = (seed = stateRef.current.seed) => {
    if (busy.current) return;
    stateRef.current = createGame(seed);
    setState(stateRef.current);
    select(false);
    world.current?.rebuild(stateRef.current);
    setNotice("A fresh beginning. Select your warrior to explore.");
  };

  useEffect(() => {
    let alive = true;
    const click = async (position: Position) => {
      if (busy.current) return;
      const current = stateRef.current;
      const warrior = current.units[0];
      if (warrior.x === position.x && warrior.y === position.y) {
        select(true);
        setNotice(
          warrior.movement
            ? "Choose a highlighted tile to move."
            : "Movement spent. Restart the expedition to explore again.",
        );
        return;
      }
      if (!selection.current) return;
      const destination = getReachableTiles(current, warrior.id).find(
        (tile) => tile.x === position.x && tile.y === position.y,
      );
      if (!destination) {
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
      world.current!.update(next, false);
      setNotice("On the move…");
      await world.current!.move(destination.path);
      if (!alive) return;
      busy.current = false;
      setMoving(false);
      world.current!.update(next, true);
      setNotice(
        next.units[0].movement
          ? "New ground, new possibilities. One step remains."
          : "A little farther into the unknown. Movement complete.",
      );
    };
    try {
      const instance = createWorld(canvas.current!, click, setHovered);
      world.current = instance;
      instance.rebuild(stateRef.current);
      instance.update(stateRef.current, false);
      if (import.meta.env.DEV) {
        window.__GAME_DEBUG__ = {
          getState: () => structuredClone(stateRef.current),
          getUnits: () => structuredClone(stateRef.current.units),
          getTile: (x, y) => structuredClone(getTile(stateRef.current, x, y)),
          setSeed: (seed) => {
            if (busy.current) throw new Error("Wait for movement to finish");
            reset(seed);
          },
          getReachableTiles: () =>
            structuredClone(
              getReachableTiles(stateRef.current, stateRef.current.units[0].id),
            ),
          getSelectedUnitId: () =>
            selection.current ? stateRef.current.units[0].id : null,
          getTileScreenPosition: (x, y) => instance.project({ x, y }),
          getUnitScreenPosition: () =>
            instance.project(stateRef.current.units[0], 0.5),
          isAnimating: instance.isAnimating,
          getVisualPosition: instance.getVisualPosition,
          getMarkerCount: instance.getMarkerCount,
          getHoveredTile: instance.getHoveredTile,
        };
      }
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy.current) select(false);
    };
    window.addEventListener("keydown", keydown);
    return () => {
      alive = false;
      window.removeEventListener("keydown", keydown);
      if (import.meta.env.DEV) delete window.__GAME_DEBUG__;
      world.current?.dispose();
    };
  }, []);

  return (
    <main>
      <canvas
        ref={canvas}
        aria-label="Interactive 3D expedition map. Click the warrior, then a highlighted tile to move."
      />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Verdant Reach home">
          <span className="brand-mark">
            <Icon name="compass" />
          </span>
          <span>
            VERDANT <b>REACH</b>
            <small>A WORLD WORTH EXPLORING</small>
          </span>
        </a>
        <div className="chapter">
          <span className="live-dot" /> LOCAL EXPEDITION{" "}
          <span className="divider" /> CHAPTER 01
        </div>
        <button
          className="icon-button"
          aria-label="Show controls"
          onClick={() => setHelp(!help)}
        >
          ?
        </button>
      </header>
      <section className="intro">
        <div className="eyebrow">THE FIRST FOOTSTEPS</div>
        <h1>
          Beyond the
          <br />
          <em>familiar.</em>
        </h1>
        <p>
          An untouched island.
          <br />A warrior. A world of possibility.
        </p>
        <div className="map-label">
          <span /> THE FERN ISLES <small>10 × 10</small>
        </div>
      </section>
      <aside className="expedition-card">
        <div className="eyebrow">
          <Icon name="flag" /> YOUR EXPEDITION <span>01</span>
        </div>
        <div className="player-line">
          <span className="player-avatar">S</span>
          <div>
            <strong>The Sunward Company</strong>
            <small>You · Local prototype</small>
          </div>
          <span className="player-dot" />
        </div>
        <div className="card-rule" />
        <div className="stat-row">
          <span>Warriors</span>
          <b>01</b>
        </div>
        <div className="stat-row">
          <span>Movement available</span>
          <b>
            {unit.movement}
            <i> / 2</i>
          </b>
        </div>
        <div className="movement-track">
          <span style={{ width: `${unit.movement * 50}%` }} />
        </div>
      </aside>
      <div className="map-tools">
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
      <section className={`unit-card ${selected ? "selected" : ""}`}>
        <div className="unit-portrait">
          <span className="portrait-crest">✦</span>
          <Icon name="flag" />
          <span className="portrait-level">I</span>
        </div>
        <div className="unit-info">
          <div className="eyebrow">
            {selected ? "WARRIOR SELECTED" : "READY TO EXPLORE"}
          </div>
          <h2>Sunward warrior</h2>
          <p>
            {moving
              ? "Crossing new ground…"
              : selected
                ? unit.movement
                  ? "Choose a golden tile to move."
                  : "Expedition movement complete."
                : "Click your warrior on the island."}
          </p>
          <div className="unit-meta">
            <span className="health-line" /> <span>10 / 10</span>
            <span className="meta-divider" />
            <span className="movement-pips">
              {[0, 1].map((i) => (
                <i key={i} className={unit.movement > i ? "filled" : ""} />
              ))}
            </span>
            <span>{unit.movement} movement</span>
          </div>
        </div>
        <button
          className="select-button"
          disabled={moving}
          onClick={() => {
            select(true);
            setNotice(
              unit.movement
                ? "Choose a highlighted tile to move."
                : "Movement spent. Restart to explore again.",
            );
          }}
          aria-label="Select warrior"
        >
          <Icon name="arrow" />
        </button>
      </section>
      <div className="bottom-status" role="status">
        <span />
        {notice}
      </div>
      <button className="restart" onClick={() => reset()} disabled={moving}>
        <Icon name="reset" />
        <span>
          Restart expedition<small>SAME ISLAND · FRESH FOOTSTEPS</small>
        </span>
      </button>
      <footer>
        <span>
          EARLY EXPLORATION <b>v0.1</b>
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
            Select the warrior and click a golden tile. Your warrior has two
            movement points for this expedition.
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

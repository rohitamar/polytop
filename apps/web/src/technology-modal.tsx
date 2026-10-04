import { useEffect, useRef, useState } from "react";
import { getTechnologyCost, getTechnology, getTechnologyUnlockReason, hasTechnology, type GameState, type TechnologyId } from "@reach/game-core";
import { technologyNodeSize, technologyTreeLayout } from "./technology-tree-layout";

export function TechnologyModal({ state, playerId, blockedReason, onUnlock, onClose }: {
  state: GameState;
  playerId: string;
  blockedReason: string | null;
  onUnlock: (technologyId: TechnologyId) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState<TechnologyId>("hunting");
  useEffect(() => {
    const previousFocus = document.activeElement;
    const modal = dialog.current!;
    modal.showModal();
    return () => {
      modal.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  const player = state.players.find(player => player.id === playerId)!;
  const selected = getTechnology(selectedId)!;
  const status = (id: TechnologyId) => {
    if (hasTechnology(state, playerId, id)) return "researched";
    if (!getTechnology(id)!.implemented) return "unimplemented";
    return getTechnologyUnlockReason(state, playerId, id) === null ? "available" : "locked";
  };
  const labels = { researched: "Researched", available: "Available", locked: "Locked", unimplemented: "Coming Soon" };
  const reason = getTechnologyUnlockReason(state, playerId, selectedId) ?? blockedReason;
  const selectedStatus = status(selectedId);
  const { nodes, edges, width, height } = technologyTreeLayout;
  return (
    <dialog ref={dialog} className="technology-modal" aria-labelledby="technology-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => event.stopPropagation()}>
      <header className="technology-heading">
        <div><span className="eyebrow">RESEARCH & DISCOVERY</span><h2 id="technology-title">Technologies</h2><p>{player.name} · {player.resources.gold} Gold</p></div>
        <button className="technology-close" aria-label="Close technologies" onClick={onClose} autoFocus>×</button>
      </header>
      <div className="technology-legend" aria-label="Technology states">
        {Object.entries(labels).map(([key, label]) => <span key={key} className={`technology-key ${key}`}>{label}</span>)}
      </div>
      <div className="technology-content">
        <div className="technology-scroll" role="region" aria-label="Technology tree" tabIndex={0}>
          <div className="technology-tree" style={{ width, height }}>
            <svg width={width} height={height} aria-hidden="true">
              {edges.map(({ parent, child }) => <line key={`${parent.technology.id}-${child.technology.id}`} x1={parent.x} y1={parent.y} x2={child.x} y2={child.y}
                className={hasTechnology(state, playerId, parent.technology.id) ? "researched" : ""} />)}
            </svg>
            {nodes.map(({ technology, x, y }) => {
              const nodeStatus = status(technology.id);
              return <button key={technology.id} className={`technology-node ${nodeStatus}`} aria-label={`${technology.name}: ${labels[nodeStatus]}`}
                aria-pressed={selectedId === technology.id} onClick={() => setSelectedId(technology.id)}
                style={{ left: x - technologyNodeSize / 2, top: y - technologyNodeSize / 2, width: technologyNodeSize, height: technologyNodeSize }}>
                <strong>{technology.name}</strong><small>{labels[nodeStatus]}</small>
              </button>;
            })}
          </div>
        </div>
        <section className="technology-detail" aria-label="Technology details" aria-live="polite">
          <span className="eyebrow">SELECTED TECHNOLOGY</span><h3>{selected.name}</h3>
          <p>Tier {selected.tier} · Cost: {getTechnologyCost(state, playerId, selectedId)} Gold</p>
          <h4>Requires</h4>
          <p>{selected.prerequisites.length ? selected.prerequisites.map(id => getTechnology(id)!.name).join(", ") : "None · Root technology"}</p>
          <h4>Unlocks / effects</h4>
          <ul>{selected.effects.map((effect, index) => <li key={index}>{effect.description}</li>)}</ul>
          <p className={`technology-key ${selectedStatus}`}>{labels[selectedStatus]}</p>
          {selected.implemented && selectedStatus !== "researched" && <button className="worker-action" disabled={reason !== null} onClick={() => onUnlock(selectedId)}>Research {selected.name}</button>}
          {reason && <p className="technology-reason">{reason}</p>}
          {!selected.implemented && !reason?.includes("not implemented") && <p>Technology not implemented yet.</p>}
        </section>
      </div>
    </dialog>
  );
}

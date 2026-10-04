import { getTechnologyCost, getTechnology, technologyPrerequisites, getTechnologyUnlockReason, hasTechnology, technologies, type GameState, type TechnologyId } from "@reach/game-core";

export function TechnologyPanel({ state, playerId, blockedReason, onUnlock, onClose }: {
  state: GameState;
  playerId: string;
  blockedReason: string | null;
  onUnlock: (technologyId: TechnologyId) => void;
  onClose: () => void;
}) {
  const player = state.players.find(player => player.id === playerId)!;
  return (
    <section className="technology-panel" aria-label="Technologies">
      <div className="panel-heading"><span className="eyebrow">TECHNOLOGIES</span><button aria-label="Close technologies" onClick={onClose}>×</button></div>
      <h2>{player.name} · {player.resources.gold} Gold</h2>
      {technologies.map(technology => {
        const unlocked = hasTechnology(state, playerId, technology.id);
        const reason = blockedReason ?? getTechnologyUnlockReason(state, playerId, technology.id);
        return (
          <article className="technology-entry" key={technology.id} aria-label={technology.name}>
            <div className="panel-heading"><strong>{technology.name}</strong><span>Tier {technology.tier} · {getTechnologyCost(state, playerId, technology.id)} Gold</span></div>
            <p>{technology.description}</p>
            {(technologyPrerequisites[technology.id] ?? []).map(id => <small key={id}>Requires {getTechnology(id)!.name}</small>)}
            <span className={`resource-state ${unlocked ? "worked" : ""}`}>{unlocked ? "Unlocked" : "Locked"}</span>
            {!unlocked && <>
              <button className="worker-action" disabled={reason !== null} onClick={() => onUnlock(technology.id)}>Unlock {technology.name}</button>
              {reason && <small>{reason}</small>}
            </>}
          </article>
        );
      })}
    </section>
  );
}

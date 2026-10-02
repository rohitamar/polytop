import type { LobbyPlayer } from "@reach/protocol";
let matchColors: string[] | null = null;
export const setPlayerColors = (players: LobbyPlayer[]) => { matchColors = players.map(player => player.color); };
export const playerStyle = (index: number) =>
  matchColors ? { accent: matchColors[index % matchColors.length], ring: matchColors[index % matchColors.length] } : [
    { accent: "#e78848", ring: "#efc373" },
    { accent: "#478faa", ring: "#85c9df" },
    { accent: "#65834e", ring: "#b0c685" },
    { accent: "#bbab4d", ring: "#e3d688" },
    { accent: "#b6584b", ring: "#e9a08a" },
    { accent: "#8664a5", ring: "#baa0d5" },
    { accent: "#b5698a", ring: "#e6a9c2" },
    { accent: "#767e86", ring: "#b9c2ca" },
  ][index % 8];

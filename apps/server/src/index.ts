import { createLobbyServer } from "./server";

const server = createLobbyServer();
const port = await server.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
);
console.log(`Lobby server listening on port ${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });

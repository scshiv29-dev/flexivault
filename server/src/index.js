import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);

app.server.listen(config.port, config.host, () => {
  const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  console.log(`FlexiVault server listening on ${url}`);
  console.log(`Data directory: ${config.dataDir}`);
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down…`);
  app
    .close()
    .catch((error) => console.error("Shutdown error", error))
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

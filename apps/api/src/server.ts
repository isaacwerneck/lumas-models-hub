import { buildApp } from "./app";
import { env } from "./config/env";

const app = buildApp();

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down gracefully");
  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error(error, "Graceful shutdown failed");
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

const start = async () => {
  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();

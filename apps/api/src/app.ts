import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "./config/env";
import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth";
import authRoutes from "./modules/auth/auth.routes";
import chatterRoutes from "./modules/chatter/chatter.routes";

export const buildApp = () => {
  const app = Fastify({
    logger: true
  });

  app.register(cors, {
    origin: env.APP_ORIGIN,
    credentials: true
  });

  app.register(cookie);
  app.register(prismaPlugin);
  app.register(authPlugin);

  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(chatterRoutes, { prefix: "/chatter" });

  return app;
};

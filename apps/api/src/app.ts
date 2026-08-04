import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "./config/env";
import prismaPlugin from "./plugins/prisma";
import authPlugin from "./plugins/auth";
import socketPlugin from "./plugins/socket";
import authRoutes from "./modules/auth/auth.routes";
import chatterRoutes from "./modules/chatter/chatter.routes";
import managerRoutes from "./modules/manager/manager.routes";
import chatRoutes from "./modules/chat/chat.routes";

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
  app.register(socketPlugin);

  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(chatterRoutes, { prefix: "/chatter" });
  app.register(managerRoutes, { prefix: "/manager" });
  app.register(chatRoutes, { prefix: "/chat" });

  return app;
};

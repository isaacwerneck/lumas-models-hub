import type { PrismaClient, Role } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "socket.io";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    io: Server;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: {
      sub: string;
      role: Role;
      username: string;
    };
    jwtVerify: () => Promise<void>;
  }
}

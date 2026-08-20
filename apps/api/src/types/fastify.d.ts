import type { PrismaClient, Role } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import type { EvidenceStorage } from "../services/storage";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    io: Server;
    evidenceStorage: EvidenceStorage;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: {
      sub: string;
      role: Role;
      username: string;
      authVersion: number;
    };
    jwtVerify: () => Promise<void>;
  }
}

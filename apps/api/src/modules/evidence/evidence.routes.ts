import path from "node:path";
import { EvidenceStatus, Role } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const paramsSchema = z.object({ evidenceId: z.string().min(1) });

const evidenceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/:evidenceId/content", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    const { evidenceId } = paramsSchema.parse(request.params);
    const evidence = await fastify.prisma.evidence.findUnique({
      where: { id: evidenceId },
      include: { startShift: { select: { chatterId: true } }, endShift: { select: { chatterId: true } } }
    });
    if (!evidence) return reply.code(404).send({ message: "Comprovante não encontrado." });
    const ownsEvidence = evidence.uploadedById === authUser.sub || evidence.startShift?.chatterId === authUser.sub || evidence.endShift?.chatterId === authUser.sub;
    if (authUser.role !== Role.MANAGER && !ownsEvidence) return reply.code(403).send({ message: "Sem acesso a este comprovante." });
    if (evidence.status !== EvidenceStatus.AVAILABLE || !evidence.storageKey) {
      return reply.code(410).send({ message: evidence.status === EvidenceStatus.MISSING_LEGACY ? "Comprovante legado indisponível." : "Comprovante removido após o pagamento." });
    }
    const stored = await fastify.evidenceStorage.get(evidence.storageKey);
    if (!stored) return reply.code(410).send({ message: "Arquivo do comprovante indisponível." });
    const fileName = path.basename(evidence.originalName).replace(/[\r\n"]/g, "_");
    return reply
      .type(stored.mimeType)
      .header("Cache-Control", "private, no-store")
      .header("Content-Disposition", `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(stored.buffer);
  });
};

export default evidenceRoutes;

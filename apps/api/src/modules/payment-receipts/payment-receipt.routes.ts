import path from "node:path";
import { AuditAction, Role } from "@prisma/client";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { newPaymentReceiptKey, validatePaymentReceipt } from "../../services/storage";

const paramsSchema = z.object({ receiptId: z.string().min(1) });

export const purgeOrphanPaymentReceipts = async (fastify: FastifyInstance) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const orphans = await fastify.prisma.paymentReceipt.findMany({
    where: { attachedAt: null, createdAt: { lt: cutoff }, payment: { is: null } },
    select: { id: true, storageKey: true }
  });
  let removed = 0;
  for (const receipt of orphans) {
    try {
      await fastify.evidenceStorage.delete(receipt.storageKey);
      await fastify.prisma.paymentReceipt.deleteMany({ where: { id: receipt.id, attachedAt: null, payment: { is: null } } });
      removed += 1;
    } catch (error) {
      fastify.log.warn({ err: error, receiptId: receipt.id }, "Failed to purge orphan payment receipt");
    }
  }
  return removed;
};

const paymentReceiptRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/manager/payment-receipts", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    if (authUser.role !== Role.MANAGER) return reply.code(403).send({ message: "Acesso restrito a gerentes." });
    if (!(request.headers["content-type"] ?? "").startsWith("multipart/form-data")) {
      return reply.code(400).send({ message: "Envie o comprovante no campo 'file'." });
    }

    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Envie o comprovante no campo 'file'." });
    const rawBuffer = await file.toBuffer();
    let validated;
    try {
      validated = await validatePaymentReceipt(rawBuffer, file.mimetype);
    } catch {
      return reply.code(400).send({ message: "Comprovante inválido. Envie PDF, PNG, JPEG ou WebP com até 10 MB." });
    }

    const storageKey = newPaymentReceiptKey(authUser.sub, validated.mimeType);
    await fastify.evidenceStorage.put(storageKey, validated.buffer, validated.mimeType);
    try {
      const receipt = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.paymentReceipt.create({ data: {
          uploadedById: authUser.sub,
          storageKey,
          originalName: path.basename(file.filename || "comprovante").slice(0, 255),
          mimeType: validated.mimeType,
          sizeBytes: validated.buffer.length,
          sha256: validated.sha256
        } });
        await tx.auditLog.create({ data: {
          actorId: authUser.sub,
          action: AuditAction.PAYMENT_RECEIPT_UPLOADED,
          targetType: "PaymentReceipt",
          targetId: created.id,
          metadata: { mimeType: created.mimeType, sizeBytes: created.sizeBytes, sha256: created.sha256 }
        } });
        return created;
      });
      return reply.code(201).send({ receipt: {
        id: receipt.id,
        originalName: receipt.originalName,
        mimeType: receipt.mimeType,
        sizeBytes: receipt.sizeBytes
      } });
    } catch (error) {
      await fastify.evidenceStorage.delete(storageKey);
      throw error;
    }
  });

  fastify.get("/payment-receipts/:receiptId/content", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string; role: Role };
    const { receiptId } = paramsSchema.parse(request.params);
    const receipt = await fastify.prisma.paymentReceipt.findUnique({
      where: { id: receiptId },
      include: { payment: { select: { chatterId: true, managerId: true } } }
    });
    if (!receipt) return reply.code(404).send({ message: "Comprovante de pagamento não encontrado." });
    const allowed = authUser.role === Role.MANAGER || receipt.payment?.chatterId === authUser.sub || receipt.uploadedById === authUser.sub;
    if (!allowed) return reply.code(403).send({ message: "Sem acesso a este comprovante." });
    if (!receipt.payment && receipt.uploadedById !== authUser.sub) return reply.code(403).send({ message: "Sem acesso a este comprovante." });
    const stored = await fastify.evidenceStorage.get(receipt.storageKey);
    if (!stored) return reply.code(410).send({ message: "Arquivo do comprovante indisponível." });
    const fileName = path.basename(receipt.originalName).replace(/[\r\n"]/g, "_");
    return reply
      .type(receipt.mimeType)
      .header("Cache-Control", "private, no-store")
      .header("Content-Disposition", `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(stored.buffer);
  });
};

export default paymentReceiptRoutes;

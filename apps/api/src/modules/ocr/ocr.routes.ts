import crypto from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { AuditAction, NotificationType } from "@prisma/client";
import { z } from "zod";
import Tesseract from "tesseract.js";
import { env } from "../../config/env";
import {
  brlStringToCents,
  extractCurrencyCandidatesFromText,
  extractFaturadoValueFromText
} from "../../utils/currency";
import { createNotifications } from "../notifications/notification.service";
import { newEvidenceKey, normalizeEvidenceImage } from "../../services/storage";

const querySchema = z.object({
  fallbackValue: z.string().optional()
});

const ocrRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/extract", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    const query = querySchema.parse(request.query);

    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      return reply.code(400).send({ message: "Envie uma imagem no campo 'image'." });
    }

    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ message: "Envie uma imagem no campo 'image'." });
    }

    const mime = file.mimetype.toLowerCase();
    if (!mime.startsWith("image/")) {
      return reply.code(400).send({ message: "Arquivo inválido: apenas imagem é permitida." });
    }

    const rawBuffer = await file.toBuffer();
    let normalized;
    try {
      normalized = await normalizeEvidenceImage(rawBuffer);
    } catch {
      return reply.code(400).send({ message: "Imagem inválida. Envie PNG, JPEG ou WebP com até 10 MB." });
    }
    const buffer = normalized.buffer;
    const evidenceKey = newEvidenceKey(authUser.sub);
    await fastify.evidenceStorage.put(evidenceKey, buffer, normalized.mimeType);

    let evidence;
    try {
      evidence = await fastify.prisma.$transaction(async (tx) => {
        const created = await tx.evidence.create({ data: {
          uploadedById: authUser.sub,
          storageKey: evidenceKey,
          originalName: path.basename(file.filename || "comprovante.webp").slice(0, 255),
          mimeType: normalized.mimeType,
          sizeBytes: buffer.length,
          sha256: normalized.sha256
        } });
        await tx.auditLog.create({ data: {
          actorId: authUser.sub, action: AuditAction.EVIDENCE_UPLOADED,
          targetType: "Evidence", targetId: created.id,
          metadata: { mimeType: created.mimeType, sizeBytes: created.sizeBytes, sha256: created.sha256 }
        } });
        return created;
      });
    } catch (error) {
      await fastify.evidenceStorage.delete(evidenceKey);
      throw error;
    }

    let rawText = "";
    let confidence: number | null = null;
    let ocrStatus: "READY" | "NO_VALUE" | "UNAVAILABLE" = "UNAVAILABLE";
    try {
      const result = await Tesseract.recognize(buffer, env.OCR_LANG);
      rawText = result.data.text ?? "";
      confidence = Number(((result.data.confidence ?? 0) / 100).toFixed(4));
      ocrStatus = "NO_VALUE";
    } catch (error) {
      request.log.warn({ err: error, evidenceId: evidence.id }, "OCR unavailable after evidence upload");
    }

    const candidates = extractCurrencyCandidatesFromText(rawText);
    const contextualDetectedValue = extractFaturadoValueFromText(rawText);

    let detectedValue: string | null = null;
    let detectedCents: number | null = null;

    if (contextualDetectedValue) {
      const contextualCents = brlStringToCents(contextualDetectedValue);
      if (contextualCents !== null) {
        detectedValue = contextualDetectedValue;
        detectedCents = contextualCents;
        ocrStatus = "READY";
      }
    }

    if (detectedCents === null) {
      for (const candidate of candidates) {
        const cents = brlStringToCents(candidate);
        if (cents === null) {
          continue;
        }

        if (detectedCents === null || cents > detectedCents) {
          detectedCents = cents;
          detectedValue = candidate;
          ocrStatus = "READY";
        }
      }
    }

    if (!detectedValue && query.fallbackValue) {
      const fallbackCents = brlStringToCents(query.fallbackValue);
      if (fallbackCents !== null) {
        detectedCents = fallbackCents;
        detectedValue = query.fallbackValue;
        ocrStatus = "READY";
      }
    }

    if (confidence !== null && confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD) {
      await createNotifications(fastify, {
        userIds: [authUser.sub],
        type: NotificationType.OCR_LOW_CONFIDENCE,
        title: "OCR com baixa confiança",
        message: "Confira manualmente o valor identificado antes de continuar.",
        sourceType: "OcrImage",
        sourceId: crypto.createHash("sha256").update(buffer).digest("hex"),
        metadata: { confidence, detectedValue }
      });
    }

    return {
      rawText,
      confidence,
      ocrStatus,
      candidates,
      detectedValue,
      detectedCents,
      requiresManualConfirmation: confidence === null || confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD
      ,evidence: {
        id: evidence.id,
        originalName: evidence.originalName,
        mimeType: evidence.mimeType,
        sizeBytes: evidence.sizeBytes,
        sha256: evidence.sha256,
        status: evidence.status
      }
    };
  });
};

export default ocrRoutes;

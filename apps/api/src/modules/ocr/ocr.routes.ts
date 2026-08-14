import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import Tesseract from "tesseract.js";
import { env } from "../../config/env";
import {
  brlStringToCents,
  extractCurrencyCandidatesFromText,
  extractFaturadoValueFromText
} from "../../utils/currency";

const querySchema = z.object({
  fallbackValue: z.string().optional()
});

const ocrRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/extract", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const query = querySchema.parse(request.query);
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ message: "Envie uma imagem no campo 'image'." });
    }

    const mime = file.mimetype.toLowerCase();
    if (!mime.startsWith("image/")) {
      return reply.code(400).send({ message: "Arquivo invalido: apenas imagem e permitida." });
    }

    const buffer = await file.toBuffer();

    const result = await Tesseract.recognize(buffer, env.OCR_LANG);
    const rawText = result.data.text ?? "";
    const confidence = Number(((result.data.confidence ?? 0) / 100).toFixed(4));

    const candidates = extractCurrencyCandidatesFromText(rawText);
    const contextualDetectedValue = extractFaturadoValueFromText(rawText);

    let detectedValue: string | null = null;
    let detectedCents: number | null = null;

    if (contextualDetectedValue) {
      const contextualCents = brlStringToCents(contextualDetectedValue);
      if (contextualCents !== null) {
        detectedValue = contextualDetectedValue;
        detectedCents = contextualCents;
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
        }
      }
    }

    if (!detectedValue && query.fallbackValue) {
      const fallbackCents = brlStringToCents(query.fallbackValue);
      if (fallbackCents !== null) {
        detectedCents = fallbackCents;
        detectedValue = query.fallbackValue;
      }
    }

    return {
      rawText,
      confidence,
      candidates,
      detectedValue,
      detectedCents,
      requiresManualConfirmation: confidence < env.OCR_LOW_CONFIDENCE_THRESHOLD
    };
  });
};

export default ocrRoutes;

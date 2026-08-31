import type { FastifyPluginAsync } from "fastify";

const USD_BRL_API_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL";
let cachedRate: { rate: number; providerUpdatedAt: string | null; quotedAt: string; expiresAt: number } | null = null;

const fxRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/usd-brl", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (cachedRate && cachedRate.expiresAt > Date.now()) {
      return { pair: "USD/BRL", rate: cachedRate.rate, updatedAt: cachedRate.providerUpdatedAt, quotedAt: cachedRate.quotedAt, provider: "awesomeapi", cached: true };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(USD_BRL_API_URL, {
        signal: controller.signal
      });

      if (!response.ok) {
        return reply.code(502).send({ message: "Falha ao obter cotação USD/BRL." });
      }

      const data = (await response.json()) as {
        USDBRL?: { bid?: string; create_date?: string };
      };

      const bid = Number(data.USDBRL?.bid ?? "");
      if (!Number.isFinite(bid) || bid <= 0) {
        return reply.code(502).send({ message: "Resposta de cotação inválida." });
      }

      const quotedAt = new Date().toISOString();
      cachedRate = { rate: bid, providerUpdatedAt: data.USDBRL?.create_date ?? null, quotedAt, expiresAt: Date.now() + 5 * 60_000 };
      return {
        pair: "USD/BRL",
        rate: bid,
        updatedAt: data.USDBRL?.create_date ?? null,
        quotedAt,
        provider: "awesomeapi",
        cached: false
      };
    } catch {
      return reply.code(502).send({ message: "Não foi possível consultar a cotação USD/BRL." });
    } finally {
      clearTimeout(timeout);
    }
  });
};

export default fxRoutes;

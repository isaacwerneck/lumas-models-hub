import fp from "fastify-plugin";
import { buildEvidenceStorage } from "../services/storage";
import { env } from "../config/env";
import { processStorageDeletionJobs, queueOrphanEvidence } from "../services/evidence-cleanup";

export default fp(async (fastify) => {
  const storage = buildEvidenceStorage();
  await storage.ready();
  fastify.decorate("evidenceStorage", storage);

  let timer: NodeJS.Timeout | undefined;
  fastify.addHook("onReady", async () => {
    if (env.NODE_ENV === "test") return;
    timer = setInterval(() => {
      void queueOrphanEvidence(fastify).then(() => processStorageDeletionJobs(fastify));
    }, env.STORAGE_DELETE_INTERVAL_MS);
    timer.unref();
  });
  fastify.addHook("onClose", async () => { if (timer) clearInterval(timer); });
});

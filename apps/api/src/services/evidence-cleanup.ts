import { AuditAction, EvidenceStatus, Prisma, StorageDeletionStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";

export const queueEvidencePurge = async (tx: Prisma.TransactionClient, evidenceIds: string[]) => {
  const uniqueIds = [...new Set(evidenceIds.filter(Boolean))];
  if (!uniqueIds.length) return 0;
  const evidence = await tx.evidence.findMany({
    where: { id: { in: uniqueIds }, status: EvidenceStatus.AVAILABLE, storageKey: { not: null } },
    select: { id: true, storageKey: true }
  });
  for (const item of evidence) {
    if (!item.storageKey) continue;
    await tx.storageDeletionJob.upsert({
      where: { evidenceId: item.id },
      create: { evidenceId: item.id, storageKey: item.storageKey },
      update: { status: StorageDeletionStatus.PENDING, nextAttemptAt: new Date(), lastError: null }
    });
  }
  await tx.evidence.updateMany({ where: { id: { in: evidence.map((item) => item.id) } }, data: { status: EvidenceStatus.PURGE_PENDING } });
  return evidence.length;
};

export const queueOrphanEvidence = async (app: FastifyInstance) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const orphans = await app.prisma.evidence.findMany({
    where: { status: EvidenceStatus.AVAILABLE, attachedAt: null, createdAt: { lt: cutoff }, startShift: null, endShift: null },
    select: { id: true }
  });
  if (!orphans.length) return 0;
  return app.prisma.$transaction((tx) => queueEvidencePurge(tx, orphans.map((item) => item.id)));
};

export const processStorageDeletionJobs = async (app: FastifyInstance, limit = 20) => {
  // Um processo pode cair depois de adquirir o job. Recoloca claims abandonados
  // na fila para que a limpeza permaneça reexecutável entre reinícios.
  await app.prisma.storageDeletionJob.updateMany({
    where: {
      status: StorageDeletionStatus.PROCESSING,
      updatedAt: { lt: new Date(Date.now() - 5 * 60_000) }
    },
    data: {
      status: StorageDeletionStatus.FAILED,
      lastError: "Claim expirado; reagendado automaticamente.",
      nextAttemptAt: new Date()
    }
  });
  const jobs = await app.prisma.storageDeletionJob.findMany({
    where: { status: { in: [StorageDeletionStatus.PENDING, StorageDeletionStatus.FAILED] }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" }, take: limit
  });
  let completed = 0;
  for (const job of jobs) {
    const claim = await app.prisma.storageDeletionJob.updateMany({
      where: { id: job.id, status: { in: [StorageDeletionStatus.PENDING, StorageDeletionStatus.FAILED] } },
      data: { status: StorageDeletionStatus.PROCESSING, attempts: { increment: 1 } }
    });
    if (!claim.count) continue;
    try {
      await app.evidenceStorage.delete(job.storageKey);
      await app.prisma.$transaction([
        app.prisma.evidence.update({ where: { id: job.evidenceId }, data: { status: EvidenceStatus.PURGED, purgedAt: new Date(), storageKey: null } }),
        app.prisma.storageDeletionJob.update({ where: { id: job.id }, data: { status: StorageDeletionStatus.COMPLETED, lastError: null } }),
        app.prisma.auditLog.create({ data: { actorId: null, action: AuditAction.EVIDENCE_PURGED, targetType: "Evidence", targetId: job.evidenceId, metadata: { attempts: job.attempts + 1 } } })
      ]);
      completed += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
      await app.prisma.storageDeletionJob.update({
        where: { id: job.id },
        data: { status: StorageDeletionStatus.FAILED, lastError: String(error).slice(0, 500), nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000) }
      });
    }
  }
  return completed;
};

import { AuditAction, Prisma } from '@prisma/client';

export interface AuditLogInput {
  companyId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  entityName?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function createAuditLog(
  tx: Prisma.TransactionClient,
  data: AuditLogInput,
): Promise<void> {
  const createData: Prisma.AuditLogUncheckedCreateInput = {
    companyId: data.companyId,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId,
    entityName: data.entityName,
    description: data.description,
    metadata: data.metadata as Prisma.InputJsonValue | undefined,
  };
  await tx.auditLog.create({ data: createData });
}

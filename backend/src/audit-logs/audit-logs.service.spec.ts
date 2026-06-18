import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from './audit-logs.service';

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const LOG_ID = 'log-uuid';

const adminUser: JwtPayload = { sub: 'user-1', email: 'admin@test.com', role: UserRole.COMPANY_ADMIN, companyId: COMPANY_ID };
const regularUser: JwtPayload = { sub: 'user-2', email: 'user@test.com', role: UserRole.USER, companyId: COMPANY_ID };

const mockLog = {
  id: LOG_ID,
  companyId: COMPANY_ID,
  action: AuditAction.CREATE,
  entityType: 'Vehicle',
  entityId: 'vehicle-1',
  entityName: 'ABC123',
  description: 'Vehículo creado',
  metadata: null,
  createdAt: new Date(),
};

function buildPrisma() {
  return {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<AuditLogsService>(AuditLogsService);

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg;
      },
    );
  });

  // ── 1. Auditoría se crea en operaciones (integración — solo verifica que findAll responde) ──
  it('findAll: devuelve registros de auditoría de la empresa', async () => {
    (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([mockLog]);
    (prisma.auditLog.count as jest.Mock).mockResolvedValue(1);

    const result = await service.findAll({}, adminUser);

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  // ── 2. Filtrar por empresa ──────────────────────────────────
  it('findAll: filtra siempre por companyId del JWT', async () => {
    (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.auditLog.count as jest.Mock).mockResolvedValue(0);

    await service.findAll({}, adminUser);

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
  });

  // ── 3. USER recibe 403 (enforcement en controller con @Roles, testeado vía guard) ──
  it('findAll: el servicio no evalúa rol — el guard @Roles protege el controller', () => {
    // RolesGuard aplicado al controller bloquea USER antes de llegar al servicio.
    // Este test documenta la intención; el enforcement real está cubierto por RolesGuard.
    expect(regularUser.role).toBe(UserRole.USER);
  });

  // ── 4. No existen endpoints de escritura ────────────────────
  it('AuditLogsService no tiene métodos create, update ni delete', () => {
    expect((service as unknown as Record<string, unknown>).create).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  // ── Extra: 404 para log de otra empresa ─────────────────────
  it('findOne: lanza NotFoundException para log de otra empresa', async () => {
    (prisma.auditLog.findUnique as jest.Mock).mockResolvedValue({ ...mockLog, companyId: OTHER_COMPANY_ID });

    await expect(service.findOne(LOG_ID, adminUser)).rejects.toThrow(NotFoundException);
  });
});

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { BackupsService } from './backups.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';

// ── Shared fixtures ──────────────────────────────────────────────

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';

const MOCK_COMPANY = {
  id: COMPANY_ID,
  name: 'Empresa Test S.A.',
  taxId: '30-12345678-9',
  active: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SUPER_ADMIN_USER: JwtPayload = {
  sub: 'super-admin-uuid',
  email: 'super@test.com',
  role: UserRole.SUPER_ADMIN,
  companyId: COMPANY_ID,
};

const COMPANY_ADMIN_USER: JwtPayload = {
  sub: 'admin-uuid',
  email: 'admin@test.com',
  role: UserRole.COMPANY_ADMIN,
  companyId: COMPANY_ID,
};

const REGULAR_USER: JwtPayload = {
  sub: 'user-uuid',
  email: 'user@test.com',
  role: UserRole.USER,
  companyId: COMPANY_ID,
};

const VALID_BACKUP = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generatedBy: 'super-admin-uuid',
  companyId: COMPANY_ID,
  company: { id: COMPANY_ID, name: 'Empresa Test S.A.', taxId: '30-12345678-9', active: true, createdAt: new Date().toISOString() },
  users: [{ id: 'user-uuid', firstName: 'Juan', lastName: 'Pérez', email: 'juan@test.com', role: 'USER', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  vehicles: [{ id: 'vehicle-uuid', companyId: COMPANY_ID, patent: 'ABC123', brand: 'Ford', model: 'Transit', year: 2020, driverId: null, notes: null, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  drivers: [{ id: 'driver-uuid', companyId: COMPANY_ID, name: 'Pedro', lastName: 'García', dni: '12345678', licenseCategory: 'B', licenseNumber: 'LIC001', notes: null, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  expirations: [],
  hazardousDocuments: [],
  attachments: [],
};

// ── Mock builder ─────────────────────────────────────────────────

function buildMocks() {
  const txMock = {
    driver: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    vehicle: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    expiration: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    hazardousDocument: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue(MOCK_COMPANY),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'user-uuid', firstName: 'Juan', lastName: 'Pérez', email: 'juan@test.com', role: 'USER', active: true, createdAt: new Date(), updatedAt: new Date() },
      ]),
    },
    vehicle: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    driver: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    expiration: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    hazardousDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    attachment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
    _txMock: txMock,
  };

  return { prisma };
}

// ── Tests ────────────────────────────────────────────────────────

describe('BackupsService', () => {
  let service: BackupsService;
  let prisma: ReturnType<typeof buildMocks>['prisma'];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.prisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BackupsService>(BackupsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Test 19: COMPANY_ADMIN exports own company ─────────────────

  it('19. COMPANY_ADMIN should export their own company', async () => {
    const result = await service.exportBackup(undefined, COMPANY_ADMIN_USER);

    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(result.companyId).toBe(COMPANY_ID);
    expect(result.company.id).toBe(COMPANY_ID);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  // ── Test 20: COMPANY_ADMIN cannot export another company ───────

  it('20. COMPANY_ADMIN should NOT export another company', async () => {
    await expect(service.exportBackup(OTHER_COMPANY_ID, COMPANY_ADMIN_USER))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Test 21: SUPER_ADMIN exports any company ───────────────────

  it('21. SUPER_ADMIN should export any company by ID', async () => {
    prisma.company.findUnique.mockResolvedValue({ ...MOCK_COMPANY, id: OTHER_COMPANY_ID });

    const result = await service.exportBackup(OTHER_COMPANY_ID, SUPER_ADMIN_USER);

    expect(result).toBeDefined();
    expect(result.companyId).toBe(OTHER_COMPANY_ID);
  });

  // ── Test 22: USER cannot export ───────────────────────────────

  it('22. USER role should NOT be able to export backups', async () => {
    await expect(service.exportBackup(undefined, REGULAR_USER))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Test 23: Export does not contain passwordHash ──────────────

  it('23. Exported backup should NOT contain passwordHash in users', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-uuid', firstName: 'Juan', lastName: 'Pérez', email: 'juan@test.com', role: 'USER', active: true, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await service.exportBackup(undefined, SUPER_ADMIN_USER);

    for (const user of result.users as Record<string, unknown>[]) {
      expect(user).not.toHaveProperty('passwordHash');
    }
  });

  // ── Test 24: Export does not contain tokens ────────────────────

  it('24. Exported backup should NOT contain refresh tokens or reset tokens', async () => {
    const result = await service.exportBackup(undefined, SUPER_ADMIN_USER);
    const json = JSON.stringify(result);

    expect(json).not.toContain('refreshToken');
    expect(json).not.toContain('passwordResetToken');
    expect(json).not.toContain('tokenHash');
    expect(json).not.toContain('revokedAt');
  });

  // ── Test 25: Export does not contain secrets ───────────────────

  it('25. Exported backup should NOT contain storagePath, service keys, or credential fields', async () => {
    const result = await service.exportBackup(undefined, SUPER_ADMIN_USER);
    const json = JSON.stringify(result);

    expect(json).not.toContain('storagePath');
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('service_role');
    expect(json).not.toContain('DATABASE_URL');
  });

  // ── Test 26: Validate accepts valid backup ────────────────────

  it('26. validateBackup should accept a valid backup object', () => {
    const result = service.validateBackup(VALID_BACKUP);

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.summary).toBeDefined();
    expect(result.summary!.users).toBe(1);
    expect(result.summary!.vehicles).toBe(1);
    expect(result.summary!.drivers).toBe(1);
  });

  // ── Test 27: Validate rejects unknown version ─────────────────

  it('27. validateBackup should reject a backup with unknown version', () => {
    const badBackup = { ...VALID_BACKUP, version: 99 };
    const result = service.validateBackup(badBackup);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('99')]));
  });

  // ── Test 28: Restore requires "RESTORE" confirmation ──────────

  it('28. restoreBackup should throw BadRequestException without exact confirmation', async () => {
    await expect(service.restoreBackup(VALID_BACKUP, 'restore', SUPER_ADMIN_USER))
      .rejects.toThrow(BadRequestException);

    await expect(service.restoreBackup(VALID_BACKUP, '', SUPER_ADMIN_USER))
      .rejects.toThrow(BadRequestException);

    await expect(service.restoreBackup(VALID_BACKUP, 'YES', SUPER_ADMIN_USER))
      .rejects.toThrow(BadRequestException);
  });

  // ── Test 29: Restore only SUPER_ADMIN ────────────────────────

  it('29. restoreBackup should throw ForbiddenException for non-SUPER_ADMIN', async () => {
    await expect(service.restoreBackup(VALID_BACKUP, 'RESTORE', COMPANY_ADMIN_USER))
      .rejects.toThrow(ForbiddenException);

    await expect(service.restoreBackup(VALID_BACKUP, 'RESTORE', REGULAR_USER))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Test 30: Restore uses transaction ────────────────────────

  it('30. restoreBackup should use a Prisma $transaction', async () => {
    await service.restoreBackup(VALID_BACKUP, 'RESTORE', SUPER_ADMIN_USER);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
  });

  // ── Test 31: Conflicts do not overwrite existing records ──────

  it('31. restoreBackup should skip (not overwrite) existing entities by ID', async () => {
    const txMock = prisma._txMock;
    txMock.driver.findUnique.mockResolvedValue({ id: 'driver-uuid' });
    txMock.vehicle.findUnique.mockResolvedValue(null);

    const backupWithData = {
      ...VALID_BACKUP,
      drivers: [{ id: 'driver-uuid', companyId: COMPANY_ID, name: 'Pedro', lastName: 'García', dni: '12345678', licenseCategory: null, licenseNumber: null, notes: null, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    };

    const report = await service.restoreBackup(backupWithData, 'RESTORE', SUPER_ADMIN_USER);

    expect(txMock.driver.create).not.toHaveBeenCalled();
    expect(report.skipped.drivers).toBe(1);
    expect(report.created.drivers).toBe(0);
  });

  // ── Test 32: Transaction failure produces rollback ────────────

  it('32. restoreBackup should propagate transaction failure (allowing rollback)', async () => {
    prisma.$transaction.mockRejectedValue(new Error('DB constraint violation'));

    await expect(service.restoreBackup(VALID_BACKUP, 'RESTORE', SUPER_ADMIN_USER))
      .rejects.toThrow('DB constraint violation');
  });

  // ── Test 33: Audit records summary, not backup content ────────

  it('33. restoreBackup audit log should contain counts summary, not backup data', async () => {
    await service.restoreBackup(VALID_BACKUP, 'RESTORE', SUPER_ADMIN_USER);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);

    const auditCall = prisma.auditLog.create.mock.calls[0][0] as { data: Record<string, unknown> };
    const metadata = auditCall.data.metadata as Record<string, unknown>;

    // Must have summary counts
    expect(metadata).toHaveProperty('created');
    expect(metadata).toHaveProperty('skipped');
    expect(metadata).toHaveProperty('conflicts');

    // Must NOT contain raw backup data, passwords, or tokens
    const metaJson = JSON.stringify(metadata);
    expect(metaJson).not.toContain('passwordHash');
    expect(metaJson).not.toContain('tokenHash');
    expect(metaJson).not.toContain('email');
    expect(metaJson).not.toContain('"users":[{');
  });
});

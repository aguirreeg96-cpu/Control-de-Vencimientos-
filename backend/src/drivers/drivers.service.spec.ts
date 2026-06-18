import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { DriversService } from './drivers.service';

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const DRIVER_ID = 'driver-uuid';

const adminUser: JwtPayload = { sub: 'user-1', email: 'admin@test.com', role: UserRole.COMPANY_ADMIN, companyId: COMPANY_ID };

const mockDriver = {
  id: DRIVER_ID,
  companyId: COMPANY_ID,
  name: 'Juan',
  lastName: 'Pérez',
  dni: '12345678',
  licenseCategory: 'D',
  licenseNumber: 'LIC-001',
  notes: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildPrisma() {
  return {
    driver: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

describe('DriversService', () => {
  let service: DriversService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DriversService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<DriversService>(DriversService);

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') return arg(prisma);
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg;
      },
    );
  });

  // ── 1. Crear chofer ─────────────────────────────────────────
  it('create: asigna companyId del JWT', async () => {
    (prisma.driver.create as jest.Mock).mockResolvedValue(mockDriver);

    const result = await service.create(
      { name: 'Juan', lastName: 'Pérez', dni: '12345678' },
      adminUser,
    );

    expect(prisma.driver.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
    expect(result.name).toBe('Juan');
  });

  // ── 2. Rechazar DNI duplicado ───────────────────────────────
  it('create: lanza ConflictException si el DNI ya existe en la empresa', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5',
    });
    (prisma.driver.create as jest.Mock).mockRejectedValue(p2002);

    await expect(
      service.create({ name: 'Juan', lastName: 'Pérez', dni: '12345678' }, adminUser),
    ).rejects.toThrow(ConflictException);
  });

  // ── 3. Listar solo choferes de la empresa ───────────────────
  it('findAll: filtra siempre por companyId del JWT', async () => {
    (prisma.driver.findMany as jest.Mock).mockResolvedValue([mockDriver]);
    (prisma.driver.count as jest.Mock).mockResolvedValue(1);

    await service.findAll({}, adminUser);

    expect(prisma.driver.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
  });

  // ── 4. Baja lógica ──────────────────────────────────────────
  it('softDelete: establece active=false', async () => {
    (prisma.driver.findUnique as jest.Mock).mockResolvedValue(mockDriver);
    (prisma.driver.update as jest.Mock).mockResolvedValue({ ...mockDriver, active: false });

    const result = await service.softDelete(DRIVER_ID, adminUser);

    expect(prisma.driver.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: false } }),
    );
    expect(result.active).toBe(false);
  });

  // ── 5. Restauración ─────────────────────────────────────────
  it('restore: establece active=true', async () => {
    (prisma.driver.findUnique as jest.Mock).mockResolvedValue({ ...mockDriver, active: false });
    (prisma.driver.update as jest.Mock).mockResolvedValue({ ...mockDriver, active: true });

    const result = await service.restore(DRIVER_ID, adminUser);

    expect(result.active).toBe(true);
  });

  // ── Extra: findOne 404 para otra empresa ────────────────────
  it('findOne: lanza NotFoundException para chofer de otra empresa', async () => {
    (prisma.driver.findUnique as jest.Mock).mockResolvedValue({ ...mockDriver, companyId: OTHER_COMPANY_ID });

    await expect(service.findOne(DRIVER_ID, adminUser)).rejects.toThrow(NotFoundException);
  });
});

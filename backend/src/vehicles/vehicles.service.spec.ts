import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from './vehicles.service';

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const VEHICLE_ID = 'vehicle-uuid';
const DRIVER_ID = 'driver-uuid';

const adminUser: JwtPayload = { sub: 'user-1', email: 'admin@test.com', role: UserRole.COMPANY_ADMIN, companyId: COMPANY_ID };
const regularUser: JwtPayload = { sub: 'user-2', email: 'user@test.com', role: UserRole.USER, companyId: COMPANY_ID };

const mockVehicle = {
  id: VEHICLE_ID,
  companyId: COMPANY_ID,
  patent: 'ABC123',
  brand: 'Ford',
  model: 'Ranger',
  year: 2022,
  driverId: null,
  notes: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

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
    vehicle: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    driver: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

describe('VehiclesService', () => {
  let service: VehiclesService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [VehiclesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<VehiclesService>(VehiclesService);

    // Default: $transaction calls callback with prisma itself as tx
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') return arg(prisma);
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg;
      },
    );
  });

  // ── 1. Crear vehículo dentro de la empresa ──────────────────
  it('create: crea vehículo con companyId del JWT', async () => {
    (prisma.driver.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.vehicle.create as jest.Mock).mockResolvedValue(mockVehicle);

    const result = await service.create(
      { patent: 'ABC123', brand: 'Ford', model: 'Ranger' },
      adminUser,
    );

    expect(prisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
    expect(result.patent).toBe('ABC123');
  });

  // ── 2. Rechazar patente duplicada ───────────────────────────
  it('create: lanza ConflictException si la patente ya existe', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5',
    });
    (prisma.vehicle.create as jest.Mock).mockRejectedValue(p2002);

    await expect(
      service.create({ patent: 'ABC123', brand: 'Ford', model: 'Ranger' }, adminUser),
    ).rejects.toThrow(ConflictException);
  });

  // ── 3. Rechazar chofer de otra empresa ──────────────────────
  it('create: lanza NotFoundException si el chofer es de otra empresa', async () => {
    (prisma.driver.findUnique as jest.Mock).mockResolvedValue({ ...mockDriver, companyId: OTHER_COMPANY_ID });

    await expect(
      service.create({ patent: 'XYZ999', brand: 'Ford', model: 'Ranger', driverId: DRIVER_ID }, adminUser),
    ).rejects.toThrow(NotFoundException);
  });

  // ── 4. Listar solo vehículos de la empresa ──────────────────
  it('findAll: filtra siempre por companyId del JWT', async () => {
    (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([mockVehicle]);
    (prisma.vehicle.count as jest.Mock).mockResolvedValue(1);

    await service.findAll({}, adminUser);

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
  });

  // ── 5. No devolver vehículo de otra empresa ─────────────────
  it('findOne: lanza NotFoundException para vehículo de otra empresa', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ ...mockVehicle, companyId: OTHER_COMPANY_ID });

    await expect(service.findOne(VEHICLE_ID, adminUser)).rejects.toThrow(NotFoundException);
  });

  // ── 6. Baja lógica ──────────────────────────────────────────
  it('softDelete: establece active=false', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue(mockVehicle);
    (prisma.vehicle.update as jest.Mock).mockResolvedValue({ ...mockVehicle, active: false });

    const result = await service.softDelete(VEHICLE_ID, adminUser);

    expect(prisma.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: false } }),
    );
    expect(result.active).toBe(false);
  });

  // ── 7. Restauración ─────────────────────────────────────────
  it('restore: establece active=true desde estado inactivo', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ ...mockVehicle, active: false });
    (prisma.vehicle.update as jest.Mock).mockResolvedValue({ ...mockVehicle, active: true });

    const result = await service.restore(VEHICLE_ID, adminUser);

    expect(prisma.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: true } }),
    );
    expect(result.active).toBe(true);
  });

  // ── 8. USER no puede dar de baja ────────────────────────────
  it('update: lanza ForbiddenException si USER intenta cambiar active', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue(mockVehicle);

    await expect(
      service.update(VEHICLE_ID, { active: false }, regularUser),
    ).rejects.toThrow(ForbiddenException);
  });
});

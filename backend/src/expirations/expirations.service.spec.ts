import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExpirationCategory, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { QueryExpirationDto } from './dto/query-expiration.dto';
import { ExpirationsService } from './expirations.service';

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const VEHICLE_ID = 'vehicle-uuid';
const DRIVER_ID = 'driver-uuid';
const EXPIRATION_ID = 'exp-uuid';

const adminUser: JwtPayload = { sub: 'user-1', email: 'admin@test.com', role: UserRole.COMPANY_ADMIN, companyId: COMPANY_ID };

function makeExpiration(overrides = {}) {
  return {
    id: EXPIRATION_ID,
    companyId: COMPANY_ID,
    type: 'Seguro RC',
    category: ExpirationCategory.VEHICLE,
    vehicleId: VEHICLE_ID,
    driverId: null,
    issueDate: null,
    expiryDate: new Date('2027-01-01'),
    description: null,
    observations: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    expiration: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    vehicle: { findUnique: jest.fn() },
    driver: { findUnique: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

describe('ExpirationsService', () => {
  let service: ExpirationsService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpirationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ExpirationsService>(ExpirationsService);

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') return arg(prisma);
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg;
      },
    );
  });

  // ── 1. Crear VEHICLE válido ─────────────────────────────────
  it('create: crea vencimiento VEHICLE con vehicleId válido', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: VEHICLE_ID, companyId: COMPANY_ID });
    (prisma.expiration.create as jest.Mock).mockResolvedValue(makeExpiration());

    const result = await service.create(
      { type: 'Seguro RC', category: ExpirationCategory.VEHICLE, vehicleId: VEHICLE_ID, expiryDate: new Date('2027-01-01') },
      adminUser,
    );
    expect(result.status).toBe('VALID');
    expect(result.vehicleId).toBe(VEHICLE_ID);
  });

  // ── 2. Rechazar VEHICLE sin vehicleId ───────────────────────
  it('create: lanza BadRequestException para VEHICLE sin vehicleId', async () => {
    await expect(
      service.create({ type: 'Seguro', category: ExpirationCategory.VEHICLE, expiryDate: new Date('2027-01-01') }, adminUser),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 3. Rechazar DRIVER sin driverId ─────────────────────────
  it('create: lanza BadRequestException para DRIVER sin driverId', async () => {
    await expect(
      service.create({ type: 'Licencia', category: ExpirationCategory.DRIVER, expiryDate: new Date('2027-01-01') }, adminUser),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 4. Rechazar COMPANY con vehicleId ───────────────────────
  it('create: lanza BadRequestException para COMPANY con vehicleId', async () => {
    await expect(
      service.create({ type: 'Habilitación', category: ExpirationCategory.COMPANY, vehicleId: VEHICLE_ID, expiryDate: new Date('2027-01-01') }, adminUser),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 5. Rechazar entidad de otra empresa ─────────────────────
  it('create: lanza NotFoundException si vehicleId es de otra empresa', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: VEHICLE_ID, companyId: OTHER_COMPANY_ID });

    await expect(
      service.create({ type: 'Seguro', category: ExpirationCategory.VEHICLE, vehicleId: VEHICLE_ID, expiryDate: new Date('2027-01-01') }, adminUser),
    ).rejects.toThrow(NotFoundException);
  });

  // ── 6. Calcular EXPIRED ─────────────────────────────────────
  it('findOne: devuelve status EXPIRED cuando expiryDate es pasada', async () => {
    const exp = makeExpiration({ expiryDate: new Date('2020-01-01') });
    (prisma.expiration.findUnique as jest.Mock).mockResolvedValue({ ...exp, vehicle: null, driver: null });

    const result = await service.findOne(EXPIRATION_ID, adminUser);
    expect(result.status).toBe('EXPIRED');
  });

  // ── 7. Calcular EXPIRING_SOON ───────────────────────────────
  it('findOne: devuelve status EXPIRING_SOON dentro de los próximos 30 días', async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const exp = makeExpiration({ expiryDate: soon });
    (prisma.expiration.findUnique as jest.Mock).mockResolvedValue({ ...exp, vehicle: null, driver: null });

    const result = await service.findOne(EXPIRATION_ID, adminUser);
    expect(result.status).toBe('EXPIRING_SOON');
  });

  // ── 8. Calcular VALID ───────────────────────────────────────
  it('findOne: devuelve status VALID para fecha futura mayor a 30 días', async () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 60);
    const exp = makeExpiration({ expiryDate: future });
    (prisma.expiration.findUnique as jest.Mock).mockResolvedValue({ ...exp, vehicle: null, driver: null });

    const result = await service.findOne(EXPIRATION_ID, adminUser);
    expect(result.status).toBe('VALID');
  });

  // ── 9. Summary correcto ─────────────────────────────────────
  it('summary: cuenta correctamente expired, expiringSoon y valid', async () => {
    const past = new Date('2020-01-01');
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 60);

    (prisma.expiration.findMany as jest.Mock).mockResolvedValue([
      { expiryDate: past, category: ExpirationCategory.VEHICLE },
      { expiryDate: soon, category: ExpirationCategory.DRIVER },
      { expiryDate: future, category: ExpirationCategory.COMPANY },
    ]);

    const result = await service.summary(adminUser);
    expect(result.total).toBe(3);
    expect(result.expired).toBe(1);
    expect(result.expiringSoon).toBe(1);
    expect(result.valid).toBe(1);
  });

  // ── 10. findAll con limit=100 y page=1 ─────────────────────
  it('findAll: acepta limit=100 y page=1 (máximo permitido)', async () => {
    (prisma.expiration.findMany as jest.Mock).mockResolvedValue([makeExpiration()]);
    (prisma.expiration.count as jest.Mock).mockResolvedValue(1);

    const result = await service.findAll({ limit: 100, page: 1 }, adminUser);
    expect(result.limit).toBe(100);
    expect(result.page).toBe(1);
    expect(result.data).toHaveLength(1);
  });

  // ── 11. findAll filtra por companyId ────────────────────────
  it('findAll: filtra siempre por companyId del JWT', async () => {
    (prisma.expiration.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.expiration.count as jest.Mock).mockResolvedValue(0);

    await service.findAll({ limit: 100 }, adminUser);

    expect(prisma.expiration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
  });
});

describe('QueryExpirationDto — paginación', () => {
  async function valid(plain: Record<string, unknown>) {
    const dto = plainToInstance(QueryExpirationDto, plain);
    const errors = await validate(dto);
    return errors;
  }

  it('limit=100 como número es válido', async () => {
    const errors = await valid({ limit: 100 });
    expect(errors).toHaveLength(0);
  });

  it('page=1 como número es válido', async () => {
    const errors = await valid({ page: 1 });
    expect(errors).toHaveLength(0);
  });

  it('limit="100" como string se transforma a número y es válido', async () => {
    const errors = await valid({ limit: '100' });
    expect(errors).toHaveLength(0);
  });

  it('page="1" como string se transforma a número y es válido', async () => {
    const errors = await valid({ page: '1' });
    expect(errors).toHaveLength(0);
  });

  it('limit=200 excede @Max(100) y es inválido', async () => {
    const errors = await valid({ limit: 200 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('limit=0 viola @Min(1) y es inválido', async () => {
    const errors = await valid({ limit: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('page=0 viola @Min(1) y es inválido', async () => {
    const errors = await valid({ page: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('min');
  });
});

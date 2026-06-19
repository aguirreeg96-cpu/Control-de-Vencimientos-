import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { QueryHazardousDocumentDto } from './dto/query-hazardous-document.dto';
import { HazardousDocumentsService } from './hazardous-documents.service';

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const DOC_ID = 'doc-uuid';

const adminUser: JwtPayload = { sub: 'user-1', email: 'admin@test.com', role: UserRole.COMPANY_ADMIN, companyId: COMPANY_ID };

function makeDoc(overrides = {}) {
  return {
    id: DOC_ID,
    companyId: COMPANY_ID,
    type: 'Habilitación Ambiental',
    entityName: 'Empresa SA',
    permitNumber: 'HA-001',
    issuingAuthority: 'Min. Ambiente',
    issueDate: null,
    expiryDate: new Date('2027-01-01'),
    observations: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    hazardousDocument: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    attachment: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

describe('HazardousDocumentsService', () => {
  let service: HazardousDocumentsService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HazardousDocumentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<HazardousDocumentsService>(HazardousDocumentsService);

    (prisma.$transaction as jest.Mock).mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') return arg(prisma);
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg;
      },
    );
  });

  // ── 1. Crear documento ──────────────────────────────────────
  it('create: asigna companyId del JWT y devuelve status calculado', async () => {
    (prisma.hazardousDocument.create as jest.Mock).mockResolvedValue(makeDoc());

    const result = await service.create(
      { type: 'Habilitación', entityName: 'Empresa SA', expiryDate: new Date('2027-01-01') },
      adminUser,
    );

    expect(prisma.hazardousDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
    expect(result.status).toBe('VALID');
  });

  // ── 2. Rechazar issueDate posterior a expiryDate ────────────
  it('create: lanza BadRequestException si issueDate > expiryDate', async () => {
    await expect(
      service.create(
        {
          type: 'Habilitación',
          entityName: 'Empresa SA',
          issueDate: new Date('2028-01-01'),
          expiryDate: new Date('2027-01-01'),
        },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 3. Filtrar por empresa ──────────────────────────────────
  it('findAll: filtra siempre por companyId del JWT', async () => {
    (prisma.hazardousDocument.findMany as jest.Mock).mockResolvedValue([makeDoc()]);
    (prisma.hazardousDocument.count as jest.Mock).mockResolvedValue(1);

    await service.findAll({}, adminUser);

    expect(prisma.hazardousDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) }),
    );
  });

  // ── 4. Calcular status ──────────────────────────────────────
  it('findOne: devuelve status EXPIRED para fecha pasada', async () => {
    (prisma.hazardousDocument.findUnique as jest.Mock).mockResolvedValue(makeDoc({ expiryDate: new Date('2020-01-01') }));

    const result = await service.findOne(DOC_ID, adminUser);
    expect(result.status).toBe('EXPIRED');
  });

  // ── 5. Solo ADMIN puede eliminar (verificado en controller, servicio devuelve resultado) ──
  it('remove: elimina físicamente y devuelve { id, deleted: true }', async () => {
    (prisma.hazardousDocument.findUnique as jest.Mock).mockResolvedValue(makeDoc());
    (prisma.hazardousDocument.delete as jest.Mock).mockResolvedValue(makeDoc());

    const result = await service.remove(DOC_ID, adminUser);
    expect(result).toEqual({ id: DOC_ID, deleted: true });
    expect(prisma.hazardousDocument.delete).toHaveBeenCalledWith({ where: { id: DOC_ID } });
  });

  // ── Extra: 404 para documento de otra empresa ───────────────
  it('findOne: lanza NotFoundException para documento de otra empresa', async () => {
    (prisma.hazardousDocument.findUnique as jest.Mock).mockResolvedValue(makeDoc({ companyId: OTHER_COMPANY_ID }));

    await expect(service.findOne(DOC_ID, adminUser)).rejects.toThrow(NotFoundException);
  });

  // ── Extra: findAll con limit=100 y page=1 ──────────────────
  it('findAll: acepta limit=100 y page=1 (máximo permitido)', async () => {
    (prisma.hazardousDocument.findMany as jest.Mock).mockResolvedValue([makeDoc()]);
    (prisma.hazardousDocument.count as jest.Mock).mockResolvedValue(1);

    const result = await service.findAll({ limit: 100, page: 1 }, adminUser);
    expect(result.limit).toBe(100);
    expect(result.page).toBe(1);
    expect(result.data).toHaveLength(1);
  });
});

describe('QueryHazardousDocumentDto — paginación', () => {
  async function valid(plain: Record<string, unknown>) {
    const dto = plainToInstance(QueryHazardousDocumentDto, plain);
    const errors = await validate(dto);
    return errors;
  }

  it('limit=100 como número es válido', async () => {
    expect(await valid({ limit: 100 })).toHaveLength(0);
  });

  it('page=1 como número es válido', async () => {
    expect(await valid({ page: 1 })).toHaveLength(0);
  });

  it('limit="100" como string se transforma y es válido', async () => {
    expect(await valid({ limit: '100' })).toHaveLength(0);
  });

  it('page="1" como string se transforma y es válido', async () => {
    expect(await valid({ page: '1' })).toHaveLength(0);
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

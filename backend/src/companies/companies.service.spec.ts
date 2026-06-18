import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from './companies.service';

const COMPANY_ID = 'company-uuid';

function makeCompany(overrides = {}) {
  return {
    id: COMPANY_ID,
    name: 'Empresa Test SA',
    taxId: '20-12345678-1',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPrisma() {
  return {
    company: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('CompaniesService', () => {
  let service: CompaniesService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompaniesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<CompaniesService>(CompaniesService);
  });

  // ── 1. findAll ─────────────────────────────────────────────────
  it('findAll: retorna todas las empresas ordenadas por fecha de creación', async () => {
    const companies = [makeCompany(), makeCompany({ id: 'other-uuid', name: 'Otra SA' })];
    (prisma.company.findMany as jest.Mock).mockResolvedValue(companies);

    const result = await service.findAll();

    expect(result).toHaveLength(2);
    expect(prisma.company.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
  });

  // ── 2. create — éxito ─────────────────────────────────────────
  it('create: crea empresa con nombre y taxId', async () => {
    (prisma.company.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.company.create as jest.Mock).mockResolvedValue(makeCompany());

    const result = await service.create({ name: 'Empresa Test SA', taxId: '20-12345678-1' });

    expect(result.name).toBe('Empresa Test SA');
    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Empresa Test SA', active: true }),
      }),
    );
  });

  // ── 3. create — taxId duplicado ────────────────────────────────
  it('create: lanza ConflictException si el taxId ya está registrado', async () => {
    (prisma.company.findFirst as jest.Mock).mockResolvedValue(makeCompany());

    await expect(
      service.create({ name: 'Otra SA', taxId: '20-12345678-1' }),
    ).rejects.toThrow(ConflictException);
  });

  // ── 4. update — empresa no encontrada ──────────────────────────
  it('update: lanza NotFoundException si la empresa no existe', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.update('non-existent', { name: 'Nueva SA' })).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── 5. update — éxito ──────────────────────────────────────────
  it('update: actualiza nombre de la empresa', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(makeCompany());
    (prisma.company.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.company.update as jest.Mock).mockResolvedValue(makeCompany({ name: 'Nueva SA' }));

    const result = await service.update(COMPANY_ID, { name: 'Nueva SA' });

    expect(result.name).toBe('Nueva SA');
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COMPANY_ID } }),
    );
  });

  // ── 6. updateStatus — desactiva empresa ────────────────────────
  it('updateStatus: desactiva una empresa activa', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(makeCompany());
    (prisma.company.update as jest.Mock).mockResolvedValue(makeCompany({ active: false }));

    const result = await service.updateStatus(COMPANY_ID, { active: false });

    expect(result.active).toBe(false);
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: false } }),
    );
  });
});

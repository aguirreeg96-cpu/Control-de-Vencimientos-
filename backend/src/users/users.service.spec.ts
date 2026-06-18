import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('argon2');
const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const USER_ID = 'user-uuid';

const adminUser: JwtPayload = {
  sub: 'admin-1',
  email: 'admin@test.com',
  role: UserRole.COMPANY_ADMIN,
  companyId: COMPANY_ID,
};

const superAdmin: JwtPayload = {
  sub: 'super-1',
  email: 'super@test.com',
  role: UserRole.SUPER_ADMIN,
  companyId: COMPANY_ID,
};

function makeUser(overrides = {}) {
  return {
    id: USER_ID,
    companyId: COMPANY_ID,
    firstName: 'Ana',
    lastName: 'García',
    email: 'ana@test.com',
    passwordHash: 'hashed-password',
    role: UserRole.USER,
    active: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Simulates what Prisma returns when select excludes passwordHash
function makeSafeUser(overrides = {}) {
  const { passwordHash: _ph, ...safe } = makeUser(overrides);
  void _ph;
  return safe;
}

function buildPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof buildPrisma>;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    mockedArgon2.hash.mockResolvedValue('hashed-value' as never);
    mockedArgon2.verify.mockResolvedValue(true as never);
  });

  // ── 1. create — COMPANY_ADMIN usa su propio companyId ──────────
  it('create: COMPANY_ADMIN asigna companyId desde JWT ignorando cuerpo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue(makeSafeUser());

    await service.create(
      { firstName: 'Ana', lastName: 'García', email: 'ana@test.com', password: 'password123' },
      adminUser,
    );

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: COMPANY_ID }),
      }),
    );
  });

  // ── 2. create — email duplicado ────────────────────────────────
  it('create: lanza ConflictException si el email ya está registrado', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeUser());

    await expect(
      service.create(
        { firstName: 'Ana', lastName: 'García', email: 'ana@test.com', password: 'password123' },
        adminUser,
      ),
    ).rejects.toThrow(ConflictException);
  });

  // ── 3. create — COMPANY_ADMIN no puede asignar SUPER_ADMIN ─────
  it('create: lanza ForbiddenException si COMPANY_ADMIN intenta asignar rol SUPER_ADMIN', async () => {
    await expect(
      service.create(
        {
          firstName: 'Ana',
          lastName: 'García',
          email: 'ana@test.com',
          password: 'password123',
          role: UserRole.SUPER_ADMIN,
        },
        adminUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── 4. create — SUPER_ADMIN requiere companyId ─────────────────
  it('create: lanza BadRequestException si SUPER_ADMIN no provee companyId', async () => {
    await expect(
      service.create(
        { firstName: 'Ana', lastName: 'García', email: 'ana@test.com', password: 'password123' },
        superAdmin,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 5. findById — éxito sin passwordHash ───────────────────────
  it('findById: retorna datos del usuario sin passwordHash', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());

    const result = await service.findById(USER_ID, adminUser);

    expect(result).not.toHaveProperty('passwordHash');
    expect(result.email).toBe('ana@test.com');
  });

  // ── 6. findById — COMPANY_ADMIN no accede a otra empresa ───────
  it('findById: lanza ForbiddenException si COMPANY_ADMIN accede a usuario de otra empresa', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser({ companyId: OTHER_COMPANY_ID }));

    await expect(service.findById(USER_ID, adminUser)).rejects.toThrow(ForbiddenException);
  });

  // ── 7. findById — usuario no encontrado ────────────────────────
  it('findById: lanza NotFoundException si el usuario no existe', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.findById('non-existent', adminUser)).rejects.toThrow(NotFoundException);
  });

  // ── 8. update — actualiza nombre ───────────────────────────────
  it('update: actualiza firstName del usuario', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());
    (prisma.user.update as jest.Mock).mockResolvedValue(makeSafeUser({ firstName: 'María' }));

    const result = await service.update(USER_ID, { firstName: 'María' }, adminUser);

    expect(result.firstName).toBe('María');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: 'María' }) }),
    );
  });

  // ── 9. update — email duplicado ────────────────────────────────
  it('update: lanza ConflictException si el email ya está en uso por otro usuario', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(makeUser({ id: 'other-user' }));

    await expect(
      service.update(USER_ID, { email: 'taken@test.com' }, adminUser),
    ).rejects.toThrow(ConflictException);
  });

  // ── 10. updateStatus — desactiva usuario ───────────────────────
  it('updateStatus: desactiva un usuario activo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());
    (prisma.user.update as jest.Mock).mockResolvedValue(makeSafeUser({ active: false }));

    const result = await service.updateStatus(USER_ID, { active: false }, adminUser);

    expect(result.active).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { active: false } }),
    );
  });

  // ── 11. updateRole — COMPANY_ADMIN no puede asignar SUPER_ADMIN
  it('updateRole: lanza ForbiddenException si COMPANY_ADMIN intenta asignar SUPER_ADMIN', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());

    await expect(
      service.updateRole(USER_ID, { role: UserRole.SUPER_ADMIN }, adminUser),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── 12. updateRole — SUPER_ADMIN puede asignar cualquier rol ───
  it('updateRole: SUPER_ADMIN puede asignar el rol COMPANY_ADMIN', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());
    (prisma.user.update as jest.Mock).mockResolvedValue(makeSafeUser({ role: UserRole.COMPANY_ADMIN }));

    const result = await service.updateRole(USER_ID, { role: UserRole.COMPANY_ADMIN }, superAdmin);

    expect(result.role).toBe(UserRole.COMPANY_ADMIN);
  });

  // ── 13. resetPassword — llama argon2.hash con nueva contraseña ─
  it('resetPassword: hashea la nueva contraseña y actualiza', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(makeSafeUser());
    (prisma.user.update as jest.Mock).mockResolvedValue(makeSafeUser());

    const result = await service.resetPassword(USER_ID, { newPassword: 'newPass123' }, adminUser);

    expect(result).toEqual({ id: USER_ID, passwordReset: true });
    expect(mockedArgon2.hash).toHaveBeenCalledWith('newPass123');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: 'hashed-value' }),
      }),
    );
  });

  // ── 14. changePassword — contraseña actual incorrecta ──────────
  it('changePassword: lanza UnauthorizedException si la contraseña actual es incorrecta', async () => {
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(makeUser());
    mockedArgon2.verify.mockResolvedValue(false as never);

    await expect(
      service.changePassword({ currentPassword: 'wrongPass', newPassword: 'newPass123' }, adminUser),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ── 15. changePassword — éxito ─────────────────────────────────
  it('changePassword: actualiza contraseña si la actual es correcta', async () => {
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(makeUser());
    mockedArgon2.verify.mockResolvedValue(true as never);
    (prisma.user.update as jest.Mock).mockResolvedValue(makeUser());

    const result = await service.changePassword(
      { currentPassword: 'currentPass', newPassword: 'newPass123' },
      adminUser,
    );

    expect(result).toEqual({ passwordChanged: true });
    expect(mockedArgon2.hash).toHaveBeenCalledWith('newPass123');
  });
});

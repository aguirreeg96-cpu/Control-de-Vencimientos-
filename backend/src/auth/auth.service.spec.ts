import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';

jest.mock('argon2');
const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;

const MOCK_USER = {
  id: 'user-uuid',
  companyId: 'company-uuid',
  firstName: 'Juan',
  lastName: 'Pérez',
  email: 'juan@test.com',
  passwordHash: 'hashed-password',
  role: 'SUPER_ADMIN' as const,
  active: true,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_REFRESH_TOKEN_RECORD = {
  id: 'token-record-uuid',
  userId: 'user-uuid',
  tokenHash: 'hashed-secret',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
};

function buildMocks() {
  const prisma = {
    user: {
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    company: { create: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const jwt = { signAsync: jest.fn().mockResolvedValue('mock-access-token') } as unknown as JwtService;

  const config = {
    get: jest.fn((key: string) => {
      const vals: Record<string, string> = {
        JWT_ACCESS_SECRET: 'test-secret',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return vals[key];
    }),
  } as unknown as ConfigService;

  return { prisma, jwt, config };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwt: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const { prisma: p, jwt: j, config: c } = buildMocks();
    prisma = p as unknown as jest.Mocked<PrismaService>;
    jwt = j as unknown as jest.Mocked<JwtService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: p },
        { provide: JwtService, useValue: j },
        { provide: ConfigService, useValue: c },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockedArgon2.hash.mockResolvedValue('hashed-value' as never);
    mockedArgon2.verify.mockResolvedValue(true as never);
  });

  // ── 1. register — primer usuario ──────────────────────────────
  it('register: crea empresa y usuario SUPER_ADMIN en una transacción', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        company: { create: jest.fn().mockResolvedValue({ id: 'company-uuid', name: 'Acme' }) },
        user: { create: jest.fn().mockResolvedValue(MOCK_USER) },
      };
      return fn(tx);
    });
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (jwt.signAsync as jest.Mock).mockResolvedValue('mock-access-token');

    const result = await service.register({
      companyName: 'Acme',
      firstName: 'Juan',
      lastName: 'Pérez',
      email: 'juan@test.com',
      password: 'password123',
    });

    expect(result.user).toBeDefined();
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.accessToken).toBe('mock-access-token');
    expect(result.refreshToken).toContain('.');
  });

  // ── 2. register — email ya existe ─────────────────────────────
  it('register: lanza ConflictException si el email ya existe', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);

    await expect(
      service.register({
        companyName: 'Acme',
        firstName: 'Juan',
        lastName: 'Pérez',
        email: 'juan@test.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // ── 3. register — bloqueado si ya hay usuarios ─────────────────
  it('register: lanza ForbiddenException si ya existe al menos un usuario', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(1);

    await expect(
      service.register({
        companyName: 'Acme',
        firstName: 'Juan',
        lastName: 'Pérez',
        email: 'otro@test.com',
        password: 'password123',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── 4. register — no expone passwordHash ──────────────────────
  it('register: la respuesta nunca incluye passwordHash', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        company: { create: jest.fn().mockResolvedValue({ id: 'company-uuid' }) },
        user: { create: jest.fn().mockResolvedValue(MOCK_USER) },
      };
      return fn(tx);
    });
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (jwt.signAsync as jest.Mock).mockResolvedValue('token');

    const result = await service.register({
      companyName: 'Acme',
      firstName: 'Juan',
      lastName: 'Pérez',
      email: 'juan@test.com',
      password: 'password123',
    });

    expect(result.user).not.toHaveProperty('passwordHash');
  });

  // ── 5. login — credenciales correctas ─────────────────────────
  it('login: retorna tokens y usuario sin passwordHash', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.user.update as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (jwt.signAsync as jest.Mock).mockResolvedValue('mock-access-token');
    mockedArgon2.verify.mockResolvedValue(true as never);

    const result = await service.login({ email: 'juan@test.com', password: 'password123' });

    expect(result.accessToken).toBe('mock-access-token');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  // ── 6. login — usuario no existe ──────────────────────────────
  it('login: lanza UnauthorizedException con mensaje genérico si usuario no existe', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.login({ email: 'noexiste@test.com', password: 'password123' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── 7. login — contraseña incorrecta ──────────────────────────
  it('login: lanza UnauthorizedException con mensaje genérico si la contraseña es incorrecta', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    mockedArgon2.verify.mockResolvedValue(false as never);

    await expect(service.login({ email: 'juan@test.com', password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── 8. refresh — token válido ──────────────────────────────────
  it('refresh: emite nuevos tokens al recibir un refresh token válido', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (prisma.refreshToken.update as jest.Mock).mockResolvedValue({ ...MOCK_REFRESH_TOKEN_RECORD, revokedAt: new Date() });
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (jwt.signAsync as jest.Mock).mockResolvedValue('new-access-token');
    mockedArgon2.verify.mockResolvedValue(true as never);

    const result = await service.refresh('token-record-uuid.rawsecret');

    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toContain('.');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
  });

  // ── 9. refresh — token revocado ───────────────────────────────
  it('refresh: lanza UnauthorizedException si el token ya fue revocado', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      ...MOCK_REFRESH_TOKEN_RECORD,
      revokedAt: new Date(),
    });

    await expect(service.refresh('token-record-uuid.rawsecret')).rejects.toThrow(UnauthorizedException);
  });

  // ── 10. refresh — token expirado ───────────────────────────────
  it('refresh: lanza UnauthorizedException si el token está expirado', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      ...MOCK_REFRESH_TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.refresh('token-record-uuid.rawsecret')).rejects.toThrow(UnauthorizedException);
  });

  // ── 11. refresh — token con formato inválido ───────────────────
  it('refresh: lanza UnauthorizedException si el formato del token es inválido', async () => {
    await expect(service.refresh('tokensinpunto')).rejects.toThrow(UnauthorizedException);
  });
});

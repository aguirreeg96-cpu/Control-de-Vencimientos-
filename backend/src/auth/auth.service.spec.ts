import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
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

const MOCK_COMPANY = { active: true };

const MOCK_REFRESH_TOKEN_RECORD = {
  id: 'token-record-uuid',
  userId: 'user-uuid',
  tokenHash: 'hashed-secret',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
};

const MOCK_RESET_TOKEN_RECORD = {
  id: 'reset-token-uuid',
  userId: 'user-uuid',
  tokenHash: 'sha256-hash-of-raw-token',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  usedAt: null,
  createdAt: new Date(),
  requestedIp: '127.0.0.1',
  requestedUserAgent: null,
  user: { id: 'user-uuid', companyId: 'company-uuid' },
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
    company: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const jwt = {
    signAsync: jest.fn().mockResolvedValue('mock-access-token'),
  } as unknown as JwtService;

  const config = {
    get: jest.fn((key: string) => {
      const vals: Record<string, string> = {
        JWT_ACCESS_SECRET: 'test-secret',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        FRONTEND_URL: 'http://localhost:5500',
      };
      return vals[key];
    }),
  } as unknown as ConfigService;

  const mail = {
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;

  return { prisma, jwt, config, mail };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let jwt: jest.Mocked<JwtService>;
  let mail: jest.Mocked<MailService>;

  beforeEach(async () => {
    const { prisma: p, jwt: j, config: c, mail: m } = buildMocks();
    prisma = p as unknown as jest.Mocked<PrismaService>;
    jwt = j as unknown as jest.Mocked<JwtService>;
    mail = m as unknown as jest.Mocked<MailService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: p },
        { provide: JwtService, useValue: j },
        { provide: ConfigService, useValue: c },
        { provide: MailService, useValue: m },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockedArgon2.hash.mockResolvedValue('hashed-value' as never);
    mockedArgon2.verify.mockResolvedValue(true as never);
    // Re-apply because clearAllMocks clears return values too
    (p.auditLog.create as jest.Mock).mockResolvedValue({});
    (p.passwordResetToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (m.sendPasswordReset as jest.Mock).mockResolvedValue(undefined);
  });

  // ── 1. register — primer usuario ──────────────────────────────
  it('register: crea empresa y usuario SUPER_ADMIN en una transacción', async () => {
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          company: { create: jest.fn().mockResolvedValue({ id: 'company-uuid', name: 'Acme' }) },
          user: { create: jest.fn().mockResolvedValue(MOCK_USER) },
        };
        return fn(tx);
      },
    );
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
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          company: { create: jest.fn().mockResolvedValue({ id: 'company-uuid' }) },
          user: { create: jest.fn().mockResolvedValue(MOCK_USER) },
        };
        return fn(tx);
      },
    );
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
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
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

    await expect(
      service.login({ email: 'noexiste@test.com', password: 'password123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ── 7. login — contraseña incorrecta ──────────────────────────
  it('login: lanza UnauthorizedException con mensaje genérico si la contraseña es incorrecta', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    mockedArgon2.verify.mockResolvedValue(false as never);

    await expect(
      service.login({ email: 'juan@test.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ── 8. refresh — token válido ──────────────────────────────────
  it('refresh: emite nuevos tokens al recibir un refresh token válido', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (prisma.refreshToken.update as jest.Mock).mockResolvedValue({
      ...MOCK_REFRESH_TOKEN_RECORD,
      revokedAt: new Date(),
    });
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
    (prisma.refreshToken.create as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (jwt.signAsync as jest.Mock).mockResolvedValue('new-access-token');
    mockedArgon2.verify.mockResolvedValue(true as never);

    const result = await service.refresh('token-record-uuid.rawsecret');

    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toContain('.');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });

  // ── 9. refresh — token revocado ───────────────────────────────
  it('refresh: lanza UnauthorizedException si el token ya fue revocado', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      ...MOCK_REFRESH_TOKEN_RECORD,
      revokedAt: new Date(),
    });

    await expect(service.refresh('token-record-uuid.rawsecret')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── 10. refresh — token expirado ───────────────────────────────
  it('refresh: lanza UnauthorizedException si el token está expirado', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      ...MOCK_REFRESH_TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.refresh('token-record-uuid.rawsecret')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── 11. refresh — token con formato inválido ───────────────────
  it('refresh: lanza UnauthorizedException si el formato del token es inválido', async () => {
    await expect(service.refresh('tokensinpunto')).rejects.toThrow(UnauthorizedException);
  });

  // ── 12. login — usuario inactivo ──────────────────────────────
  it('login: lanza UnauthorizedException si el usuario está inactivo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...MOCK_USER, active: false });
    mockedArgon2.verify.mockResolvedValue(true as never);

    await expect(
      service.login({ email: 'juan@test.com', password: 'password123' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ── 13. login — empresa inactiva ──────────────────────────────
  it('login: lanza ForbiddenException si la empresa está inactiva', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ active: false });
    mockedArgon2.verify.mockResolvedValue(true as never);

    await expect(
      service.login({ email: 'juan@test.com', password: 'password123' }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── 14. refresh — empresa inactiva ────────────────────────────
  it('refresh: lanza ForbiddenException si la empresa del usuario está inactiva', async () => {
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(MOCK_REFRESH_TOKEN_RECORD);
    (prisma.refreshToken.update as jest.Mock).mockResolvedValue({
      ...MOCK_REFRESH_TOKEN_RECORD,
      revokedAt: new Date(),
    });
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ active: false });
    mockedArgon2.verify.mockResolvedValue(true as never);

    await expect(service.refresh('token-record-uuid.rawsecret')).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ── 15. getMe — retorna usuario sin passwordHash ──────────────
  it('getMe: retorna datos del usuario desde la BD sin passwordHash', async () => {
    const { passwordHash: _ph, ...safeUser } = MOCK_USER;
    void _ph;
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(safeUser);

    const result = await service.getMe(MOCK_USER.id);

    expect(result).not.toHaveProperty('passwordHash');
    expect(result.email).toBe(MOCK_USER.email);
    expect(result.firstName).toBe('Juan');
  });

  // ── 16. getMe — usuario no encontrado ─────────────────────────
  it('getMe: lanza NotFoundException si el usuario no existe', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getMe('non-existent-id')).rejects.toThrow(NotFoundException);
  });

  // ═══ PASSWORD RESET ══════════════════════════════════════════

  // ── 17. forgotPassword — email existente responde genérico ────
  it('forgotPassword: responde sin errores (genérico) para email existente', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    await expect(service.forgotPassword('juan@test.com')).resolves.toBeUndefined();
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(mail.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  // ── 18. forgotPassword — email inexistente responde igual ──────
  it('forgotPassword: responde igual si el email no existe (no revela existencia)', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.forgotPassword('noexiste@test.com')).resolves.toBeUndefined();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  // ── 19. forgotPassword — usuario inactivo no recibe token ──────
  it('forgotPassword: no envía token si el usuario está inactivo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...MOCK_USER, active: false });

    await expect(service.forgotPassword('juan@test.com')).resolves.toBeUndefined();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  // ── 20. forgotPassword — empresa inactiva no recibe token ──────
  it('forgotPassword: no envía token si la empresa está inactiva', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ active: false });

    await expect(service.forgotPassword('juan@test.com')).resolves.toBeUndefined();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  // ── 21. forgotPassword — token se guarda hasheado ──────────────
  it('forgotPassword: guarda el tokenHash (SHA-256), nunca el token en texto plano', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    await service.forgotPassword('juan@test.com');

    const createCall = (prisma.passwordResetToken.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data).toHaveProperty('tokenHash');
    expect(createCall.data.tokenHash).toHaveLength(64); // SHA-256 hex = 64 chars
    // Verify the raw token is NOT stored
    expect(createCall.data).not.toHaveProperty('token');
    expect(createCall.data).not.toHaveProperty('rawToken');
  });

  // ── 22. forgotPassword — invalida tokens anteriores ───────────
  it('forgotPassword: invalida tokens de recuperación previos antes de crear uno nuevo', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    await service.forgotPassword('juan@test.com');

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: MOCK_USER.id, usedAt: null }),
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      }),
    );
  });

  // ── 23. forgotPassword — rate limit por email ──────────────────
  it('forgotPassword: no genera token al superar el límite de solicitudes por email', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    // 3 requests allowed — 4th should be silently dropped
    await service.forgotPassword('ratetest@test.com');
    await service.forgotPassword('ratetest@test.com');
    await service.forgotPassword('ratetest@test.com');
    await service.forgotPassword('ratetest@test.com'); // should be ignored

    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(3);
  });

  // ── 24. forgotPassword — fallo de email no expone usuario ──────
  it('forgotPassword: no lanza error si el envío de correo falla', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(MOCK_USER);
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(MOCK_COMPANY);
    (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);
    (mail.sendPasswordReset as jest.Mock).mockRejectedValue(new Error('SMTP error'));

    // Should resolve without throwing — email failure is silent
    await expect(service.forgotPassword('juan@test.com')).resolves.toBeUndefined();
  });

  // ── 25. validateResetToken — token válido ─────────────────────
  it('validateResetToken: devuelve { valid: true } para token válido', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    const result = await service.validateResetToken('valid-raw-token');

    expect(result).toEqual({ valid: true });
  });

  // ── 26. validateResetToken — token expirado ───────────────────
  it('validateResetToken: devuelve { valid: false } para token expirado', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
      ...MOCK_RESET_TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await service.validateResetToken('expired-token');

    expect(result).toEqual({ valid: false });
  });

  // ── 27. validateResetToken — token ya usado ───────────────────
  it('validateResetToken: devuelve { valid: false } para token ya usado', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
      ...MOCK_RESET_TOKEN_RECORD,
      usedAt: new Date(),
    });

    const result = await service.validateResetToken('used-token');

    expect(result).toEqual({ valid: false });
  });

  // ── 28. validateResetToken — token inexistente ────────────────
  it('validateResetToken: devuelve { valid: false } para token inexistente', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await service.validateResetToken('invalid-token');

    expect(result).toEqual({ valid: false });
    // No information about user is exposed
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('email');
  });

  // ── 29. resetPassword — contraseñas no coinciden ──────────────
  it('resetPassword: lanza UnauthorizedException si las contraseñas no coinciden', async () => {
    await expect(
      service.resetPassword('some-token', 'password123', 'different456'),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ── 30. resetPassword — token inválido ────────────────────────
  it('resetPassword: lanza UnauthorizedException para token inválido o expirado', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.resetPassword('invalid-token', 'newPassword1', 'newPassword1'),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ── 31. resetPassword — contraseña corta ──────────────────────
  it('resetPassword: lanza si el token existe pero la contraseña es demasiado corta (DTO valida)', async () => {
    // Password length validation happens at DTO level (controller); service only hashes
    // This test verifies the service calls argon2.hash when passwords match
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          passwordResetToken: { update: jest.fn().mockResolvedValue({}) },
          user: { update: jest.fn().mockResolvedValue(MOCK_USER) },
          refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      },
    );

    await service.resetPassword('valid-token', 'short', 'short');
    expect(mockedArgon2.hash).toHaveBeenCalledWith('short');
  });

  // ── 32. resetPassword — contraseña válida actualiza BD ─────────
  it('resetPassword: actualiza passwordHash y ejecuta transacción completa', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedTx: any;
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          passwordResetToken: { update: jest.fn().mockResolvedValue({}) },
          user: { update: jest.fn().mockResolvedValue(MOCK_USER) },
          refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        capturedTx = tx;
        return fn(tx);
      },
    );

    await service.resetPassword('valid-token', 'newPassword1', 'newPassword1');

    expect(mockedArgon2.hash).toHaveBeenCalledWith('newPassword1');
    expect(capturedTx!.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
    );
    expect(capturedTx!.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: 'hashed-value' }),
      }),
    );
  });

  // ── 33. resetPassword — invalida refresh tokens ────────────────
  it('resetPassword: invalida todos los refresh tokens activos del usuario', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    let capturedRefreshUpdateMany: jest.Mock;
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          passwordResetToken: { update: jest.fn().mockResolvedValue({}) },
          user: { update: jest.fn().mockResolvedValue(MOCK_USER) },
          refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        capturedRefreshUpdateMany = tx.refreshToken.updateMany;
        return fn(tx);
      },
    );

    await service.resetPassword('valid-token', 'newPassword1', 'newPassword1');

    expect(capturedRefreshUpdateMany!).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: MOCK_USER.id, revokedAt: null }),
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });

  // ── 34. resetPassword — auditoría sin datos sensibles ──────────
  it('resetPassword: la auditoría no contiene token, hash ni contraseña', async () => {
    (prisma.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(MOCK_RESET_TOKEN_RECORD);

    let capturedAuditCreate: jest.Mock;
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          passwordResetToken: { update: jest.fn().mockResolvedValue({}) },
          user: { update: jest.fn().mockResolvedValue(MOCK_USER) },
          refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          auditLog: { create: jest.fn().mockResolvedValue({}) },
        };
        capturedAuditCreate = tx.auditLog.create;
        return fn(tx);
      },
    );

    await service.resetPassword('valid-token', 'newPassword1', 'newPassword1');

    const auditCall = capturedAuditCreate!.mock.calls[0][0].data;
    const meta = auditCall.metadata as Record<string, unknown>;
    expect(meta).not.toHaveProperty('token');
    expect(meta).not.toHaveProperty('tokenHash');
    expect(meta).not.toHaveProperty('passwordHash');
    expect(meta).not.toHaveProperty('newPassword');
    expect(auditCall.action).toBe('PASSWORD_RESET_COMPLETED');
  });
});

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiter } from '../common/utils/rate-limiter.util';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './types/jwt-payload.type';

const USER_SAFE_SELECT = {
  id: true,
  companyId: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const RESET_EXPIRES_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Rate limits: 3 requests per 15 min per email; 10 per hour per IP
  private readonly emailRateLimiter = new RateLimiter(3, 15 * 60 * 1000);
  private readonly ipRateLimiter = new RateLimiter(10, 60 * 60 * 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw new ForbiddenException('El registro ya no está disponible');
    }

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('El email ya está registrado');

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: dto.companyName, active: true },
      });
      return tx.user.create({
        data: {
          companyId: company.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
          passwordHash,
          role: UserRole.SUPER_ADMIN,
          active: true,
        },
      });
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role, user.companyId);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.active) {
      throw new UnauthorizedException('Cuenta desactivada');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { active: true },
    });
    if (!company || !company.active) {
      throw new ForbiddenException('Empresa desactivada');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role, user.companyId);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async refresh(rawToken: string) {
    const parts = rawToken.split('.');
    if (parts.length !== 2) throw new UnauthorizedException('Token de refresco inválido');

    const [recordId, rawSecret] = parts;

    const record = await this.prisma.refreshToken.findUnique({ where: { id: recordId } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }

    const secretValid = await argon2.verify(record.tokenHash, rawSecret);
    if (!secretValid) throw new UnauthorizedException('Token de refresco inválido o expirado');

    await this.prisma.refreshToken.update({
      where: { id: recordId },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    if (!user.active) throw new UnauthorizedException('Cuenta desactivada');

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { active: true },
    });
    if (!company || !company.active) throw new ForbiddenException('Empresa desactivada');

    const tokens = await this.generateTokens(user.id, user.email, user.role, user.companyId);
    return tokens;
  }

  async logout(rawToken: string) {
    const parts = rawToken.split('.');
    if (parts.length !== 2) return;

    const [recordId] = parts;
    await this.prisma.refreshToken
      .update({
        where: { id: recordId },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SAFE_SELECT,
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // ── PASSWORD RECOVERY ──────────────────────────────────────────

  async forgotPassword(email: string, ip?: string, userAgent?: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    // Rate limiting — silently drop over-limit requests to avoid enumeration
    if (!this.emailRateLimiter.isAllowed(normalizedEmail)) return;
    if (ip && !this.ipRateLimiter.isAllowed(ip)) return;

    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    // Silent: never reveal whether user exists, is active, or company is active
    if (!user || !user.active) return;

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { active: true },
    });
    if (!company || !company.active) return;

    // Invalidate any previous active tokens for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    // Generate a cryptographically secure token — only the SHA-256 hash is stored
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_EXPIRES_MS);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        requestedIp: ip ?? null,
        requestedUserAgent: userAgent ?? null,
      },
    });

    const frontendUrl =
      this.config.get<string>('APP_FRONTEND_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      '';
    const resetLink = `${frontendUrl}/reset-password.html?token=${rawToken}`;

    // Email failure is logged but NEVER surfaces to the caller
    try {
      await this.mail.sendPasswordReset(
        user.email,
        `${user.firstName} ${user.lastName}`,
        resetLink,
      );
    } catch {
      this.logger.error('Error al enviar correo de recuperación', { userId: user.id });
    }

    // Audit — no token, no email body, no credentials
    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        action: AuditAction.PASSWORD_RESET_REQUESTED,
        entityType: 'User',
        entityId: user.id,
        entityName: 'User',
        description: 'Solicitud de recuperación de contraseña',
        metadata: { requestedIp: ip ?? null },
      },
    });
  }

  async validateResetToken(rawToken: string): Promise<{ valid: boolean }> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return { valid: false };
    }
    return { valid: true };
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<void> {
    if (newPassword !== confirmPassword) {
      throw new UnauthorizedException('Las contraseñas no coinciden');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, companyId: true } } },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('El enlace de recuperación es inválido o ha expirado');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      // Mark token as used — enforces single-use
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });

      // Update password
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      // Invalidate ALL active refresh tokens — close all existing sessions
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Audit — no token, no password, no hash
      await tx.auditLog.create({
        data: {
          companyId: record.user.companyId,
          action: AuditAction.PASSWORD_RESET_COMPLETED,
          entityType: 'User',
          entityId: record.userId,
          entityName: 'User',
          description: 'Contraseña restablecida exitosamente',
          metadata: { userId: record.userId },
        },
      });
    });
  }

  // ── INTERNAL ──────────────────────────────────────────────────

  private async generateTokens(
    userId: string,
    email: string,
    role: UserRole,
    companyId: string,
  ) {
    const payload: JwtPayload = { sub: userId, email, role, companyId };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    });

    const rawSecret = randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(rawSecret);

    const expiresInDays = parseInt(
      (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d').replace('d', ''),
      10,
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const record = await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    const refreshToken = `${record.id}.${rawSecret}`;
    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: {
    id: string;
    companyId: string;
    firstName: string;
    lastName: string;
    email: string;
    role: UserRole;
    active: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      companyId: user.companyId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      active: user.active,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

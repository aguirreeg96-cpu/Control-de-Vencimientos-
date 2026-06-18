import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

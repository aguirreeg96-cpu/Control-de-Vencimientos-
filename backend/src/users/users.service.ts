import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

const USER_SELECT = {
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
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(requestingUser: JwtPayload) {
    const where =
      requestingUser.role === UserRole.SUPER_ADMIN ? {} : { companyId: requestingUser.companyId };
    return this.prisma.user.findMany({
      where,
      select: { ...USER_SELECT, company: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string, requestingUser: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (
      requestingUser.role === UserRole.COMPANY_ADMIN &&
      user.companyId !== requestingUser.companyId
    ) {
      throw new ForbiddenException('No tenés permiso para realizar esta acción');
    }
    return user;
  }

  async create(dto: CreateUserDto, requestingUser: JwtPayload) {
    let companyId: string;
    if (requestingUser.role === UserRole.SUPER_ADMIN) {
      if (!dto.companyId) throw new BadRequestException('Se requiere companyId para SUPER_ADMIN');
      companyId = dto.companyId;
    } else {
      companyId = requestingUser.companyId;
    }

    if (
      requestingUser.role === UserRole.COMPANY_ADMIN &&
      dto.role === UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException('No podés asignar el rol SUPER_ADMIN');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('El email ya está registrado');

    const passwordHash = await argon2.hash(dto.password);

    return this.prisma.user.create({
      data: {
        companyId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email.toLowerCase(),
        passwordHash,
        role: dto.role ?? UserRole.USER,
        active: true,
      },
      select: USER_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto, requestingUser: JwtPayload) {
    await this.findById(id, requestingUser);

    const data: { firstName?: string; lastName?: string; email?: string } = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) {
      const emailLower = dto.email.toLowerCase();
      const taken = await this.prisma.user.findFirst({
        where: { email: emailLower, NOT: { id } },
      });
      if (taken) throw new ConflictException('El email ya está registrado');
      data.email = emailLower;
    }

    return this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, requestingUser: JwtPayload) {
    await this.findById(id, requestingUser);
    return this.prisma.user.update({
      where: { id },
      data: { active: dto.active },
      select: USER_SELECT,
    });
  }

  async updateRole(id: string, dto: UpdateUserRoleDto, requestingUser: JwtPayload) {
    await this.findById(id, requestingUser);
    if (
      dto.role === UserRole.SUPER_ADMIN &&
      requestingUser.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede asignar ese rol');
    }
    return this.prisma.user.update({
      where: { id },
      data: { role: dto.role },
      select: USER_SELECT,
    });
  }

  async resetPassword(id: string, dto: ResetPasswordDto, requestingUser: JwtPayload) {
    await this.findById(id, requestingUser);
    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { id, passwordReset: true };
  }

  async changePassword(dto: ChangePasswordDto, requestingUser: JwtPayload) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: requestingUser.sub } });
    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');
    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: requestingUser.sub }, data: { passwordHash } });
    return { passwordChanged: true };
  }
}

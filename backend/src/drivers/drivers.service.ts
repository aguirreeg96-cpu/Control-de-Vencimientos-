import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, UserRole } from '@prisma/client';
import { createAuditLog } from '../common/helpers/audit.helper';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { QueryDriverDto } from './dto/query-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDriverDto, user: JwtPayload) {
    return this.prisma.$transaction(async (tx) => {
      const driver = await tx.driver
        .create({
          data: {
            companyId: user.companyId,
            name: dto.name,
            lastName: dto.lastName,
            dni: dto.dni,
            licenseCategory: dto.licenseCategory ?? null,
            licenseNumber: dto.licenseNumber ?? null,
            notes: dto.notes ?? null,
          },
        })
        .catch((err: Prisma.PrismaClientKnownRequestError) => {
          if (err.code === 'P2002') throw new ConflictException('El DNI ya existe en esta empresa');
          throw err;
        });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.CREATE,
        entityType: 'Driver',
        entityId: driver.id,
        entityName: `${driver.name} ${driver.lastName}`,
        description: `Chofer ${driver.name} ${driver.lastName} creado`,
        metadata: { after: driver, userId: user.sub, userEmail: user.email },
      });
      return driver;
    });
  }

  async findAll(query: QueryDriverDto, user: JwtPayload) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.DriverWhereInput = { companyId: user.companyId };
    if (query.active !== undefined) where.active = query.active;
    if (query.licenseCategory) where.licenseCategory = query.licenseCategory;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { dni: { contains: s, mode: 'insensitive' } },
        { licenseNumber: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.driver.count({ where }),
    ]);

    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: JwtPayload) {
    const driver = await this.prisma.driver.findUnique({ where: { id } });
    if (!driver || driver.companyId !== user.companyId) throw new NotFoundException('Chofer no encontrado');
    return driver;
  }

  async update(id: string, dto: UpdateDriverDto, user: JwtPayload) {
    const existing = await this.prisma.driver.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Chofer no encontrado');

    if (dto.active !== undefined && user.role === UserRole.USER) {
      throw new ForbiddenException('No tenés permiso para cambiar el estado activo');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.driver
        .update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.lastName !== undefined && { lastName: dto.lastName }),
            ...(dto.dni !== undefined && { dni: dto.dni }),
            ...('licenseCategory' in dto && { licenseCategory: dto.licenseCategory }),
            ...('licenseNumber' in dto && { licenseNumber: dto.licenseNumber }),
            ...('notes' in dto && { notes: dto.notes }),
            ...(dto.active !== undefined && { active: dto.active }),
          },
        })
        .catch((err: Prisma.PrismaClientKnownRequestError) => {
          if (err.code === 'P2002') throw new ConflictException('El DNI ya existe en esta empresa');
          throw err;
        });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.UPDATE,
        entityType: 'Driver',
        entityId: updated.id,
        entityName: `${updated.name} ${updated.lastName}`,
        description: `Chofer ${updated.name} ${updated.lastName} actualizado`,
        metadata: { before: existing, after: updated, userId: user.sub, userEmail: user.email },
      });
      return updated;
    });
  }

  async softDelete(id: string, user: JwtPayload) {
    const existing = await this.prisma.driver.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Chofer no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.driver.update({ where: { id }, data: { active: false } });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.DELETE,
        entityType: 'Driver',
        entityId: updated.id,
        entityName: `${updated.name} ${updated.lastName}`,
        description: `Chofer ${updated.name} ${updated.lastName} dado de baja`,
        metadata: { userId: user.sub, userEmail: user.email },
      });
      return updated;
    });
  }

  async restore(id: string, user: JwtPayload) {
    const existing = await this.prisma.driver.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Chofer no encontrado');
    if (existing.active) throw new BadRequestException('El chofer ya está activo');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.driver.update({ where: { id }, data: { active: true } });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.UPDATE,
        entityType: 'Driver',
        entityId: updated.id,
        entityName: `${updated.name} ${updated.lastName}`,
        description: `Chofer ${updated.name} ${updated.lastName} restaurado`,
        metadata: { userId: user.sub, userEmail: user.email },
      });
      return updated;
    });
  }
}

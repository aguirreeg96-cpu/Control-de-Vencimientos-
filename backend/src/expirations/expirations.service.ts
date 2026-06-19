import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ExpirationCategory, Prisma } from '@prisma/client';
import { createAuditLog } from '../common/helpers/audit.helper';
import {
  computeExpirationStatus,
  ExpirationStatus,
} from '../common/utils/expiration-status.util';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpirationDto } from './dto/create-expiration.dto';
import { QueryExpirationDto } from './dto/query-expiration.dto';
import { UpdateExpirationDto } from './dto/update-expiration.dto';

type ExpirationWithStatus<T> = T & { status: ExpirationStatus };

function withStatus<T extends { expiryDate: Date }>(e: T): ExpirationWithStatus<T> {
  return { ...e, status: computeExpirationStatus(e.expiryDate) };
}

@Injectable()
export class ExpirationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExpirationDto, user: JwtPayload) {
    this.validateCategoryRules(dto.category, dto.vehicleId, dto.driverId);

    if (dto.issueDate && dto.expiryDate && dto.issueDate > dto.expiryDate) {
      throw new BadRequestException('issueDate no puede ser posterior a expiryDate');
    }

    if (dto.vehicleId) await this.validateVehicle(dto.vehicleId, user.companyId);
    if (dto.driverId) await this.validateDriver(dto.driverId, user.companyId);

    return this.prisma.$transaction(async (tx) => {
      const expiration = await tx.expiration.create({
        data: {
          companyId: user.companyId,
          type: dto.type,
          category: dto.category,
          vehicleId: dto.vehicleId ?? null,
          driverId: dto.driverId ?? null,
          issueDate: dto.issueDate ?? null,
          expiryDate: dto.expiryDate,
          description: dto.description ?? null,
          observations: dto.observations ?? null,
        },
      });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.CREATE,
        entityType: 'Expiration',
        entityId: expiration.id,
        entityName: expiration.type,
        description: `Vencimiento "${expiration.type}" creado`,
        metadata: { after: expiration, userId: user.sub, userEmail: user.email },
      });
      return withStatus(expiration);
    });
  }

  async findAll(query: QueryExpirationDto, user: JwtPayload) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.ExpirationWhereInput = { companyId: user.companyId };
    if (query.category) where.category = query.category;
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.driverId) where.driverId = query.driverId;
    if (query.expiryFrom || query.expiryTo) {
      where.expiryDate = {
        ...(query.expiryFrom && { gte: query.expiryFrom }),
        ...(query.expiryTo && { lte: query.expiryTo }),
      };
    }
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { type: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { observations: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [raw, total] = await this.prisma.$transaction([
      this.prisma.expiration.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          vehicle: { select: { id: true, patent: true, brand: true, model: true } },
          driver: { select: { id: true, name: true, lastName: true, dni: true } },
        },
      }),
      this.prisma.expiration.count({ where }),
    ]);

    let data = raw.map(withStatus);

    if (query.status) {
      data = data.filter((e) => e.status === query.status);
    }

    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: JwtPayload) {
    const expiration = await this.prisma.expiration.findUnique({
      where: { id },
      include: {
        vehicle: { select: { id: true, patent: true, brand: true, model: true } },
        driver: { select: { id: true, name: true, lastName: true, dni: true } },
      },
    });
    if (!expiration || expiration.companyId !== user.companyId) {
      throw new NotFoundException('Vencimiento no encontrado');
    }
    return withStatus(expiration);
  }

  async update(id: string, dto: UpdateExpirationDto, user: JwtPayload) {
    const existing = await this.prisma.expiration.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) {
      throw new NotFoundException('Vencimiento no encontrado');
    }

    const category = dto.category ?? existing.category;
    const vehicleId = 'vehicleId' in dto ? dto.vehicleId : existing.vehicleId;
    const driverId = 'driverId' in dto ? dto.driverId : existing.driverId;

    this.validateCategoryRules(category, vehicleId, driverId);

    const issueDate = 'issueDate' in dto ? dto.issueDate : existing.issueDate;
    const expiryDate = dto.expiryDate ?? existing.expiryDate;
    if (issueDate && expiryDate && issueDate > expiryDate) {
      throw new BadRequestException('issueDate no puede ser posterior a expiryDate');
    }

    if (dto.vehicleId !== undefined && dto.vehicleId !== null) {
      await this.validateVehicle(dto.vehicleId, user.companyId);
    }
    if (dto.driverId !== undefined && dto.driverId !== null) {
      await this.validateDriver(dto.driverId, user.companyId);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.expiration.update({
        where: { id },
        data: {
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.category !== undefined && { category: dto.category }),
          ...('vehicleId' in dto && { vehicleId: dto.vehicleId }),
          ...('driverId' in dto && { driverId: dto.driverId }),
          ...('issueDate' in dto && { issueDate: dto.issueDate }),
          ...(dto.expiryDate !== undefined && { expiryDate: dto.expiryDate }),
          ...('description' in dto && { description: dto.description }),
          ...('observations' in dto && { observations: dto.observations }),
        },
      });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.UPDATE,
        entityType: 'Expiration',
        entityId: updated.id,
        entityName: updated.type,
        description: `Vencimiento "${updated.type}" actualizado`,
        metadata: { before: existing, after: updated, userId: user.sub, userEmail: user.email },
      });
      return withStatus(updated);
    });
  }

  async remove(id: string, user: JwtPayload) {
    const existing = await this.prisma.expiration.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) {
      throw new NotFoundException('Vencimiento no encontrado');
    }

    const attachmentCount = await this.prisma.attachment.count({
      where: { entityType: 'EXPIRATION', entityId: id },
    });
    if (attachmentCount > 0) {
      throw new ConflictException('No se puede eliminar el vencimiento porque tiene archivos adjuntos. Eliminá los adjuntos primero.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.expiration.delete({ where: { id } });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.DELETE,
        entityType: 'Expiration',
        entityId: existing.id,
        entityName: existing.type,
        description: `Vencimiento "${existing.type}" eliminado`,
        metadata: { userId: user.sub, userEmail: user.email },
      });
      return { id: existing.id, deleted: true };
    });
  }

  async summary(user: JwtPayload) {
    const all = await this.prisma.expiration.findMany({
      where: { companyId: user.companyId },
      select: { expiryDate: true, category: true },
    });

    const statuses = all.map((e) => ({
      status: computeExpirationStatus(e.expiryDate),
      category: e.category,
    }));

    const total = statuses.length;
    const expired = statuses.filter((s) => s.status === 'EXPIRED').length;
    const expiringSoon = statuses.filter((s) => s.status === 'EXPIRING_SOON').length;
    const valid = statuses.filter((s) => s.status === 'VALID').length;

    const byCategory: Record<string, { total: number; expired: number; expiringSoon: number; valid: number }> = {};
    for (const cat of Object.values(ExpirationCategory)) {
      const catItems = statuses.filter((s) => s.category === cat);
      byCategory[cat] = {
        total: catItems.length,
        expired: catItems.filter((s) => s.status === 'EXPIRED').length,
        expiringSoon: catItems.filter((s) => s.status === 'EXPIRING_SOON').length,
        valid: catItems.filter((s) => s.status === 'VALID').length,
      };
    }

    return { total, expired, expiringSoon, valid, byCategory };
  }

  private validateCategoryRules(
    category: ExpirationCategory,
    vehicleId?: string | null,
    driverId?: string | null,
  ) {
    if (category === ExpirationCategory.VEHICLE) {
      if (!vehicleId) throw new BadRequestException('VEHICLE requiere vehicleId');
      if (driverId) throw new BadRequestException('VEHICLE no puede tener driverId');
    }
    if (category === ExpirationCategory.DRIVER) {
      if (!driverId) throw new BadRequestException('DRIVER requiere driverId');
      if (vehicleId) throw new BadRequestException('DRIVER no puede tener vehicleId');
    }
    if (category === ExpirationCategory.COMPANY) {
      if (vehicleId) throw new BadRequestException('COMPANY no puede tener vehicleId');
      if (driverId) throw new BadRequestException('COMPANY no puede tener driverId');
    }
  }

  private async validateVehicle(vehicleId: string, companyId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || vehicle.companyId !== companyId) throw new NotFoundException('Vehículo no encontrado');
  }

  private async validateDriver(driverId: string, companyId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver || driver.companyId !== companyId) throw new NotFoundException('Chofer no encontrado');
  }
}

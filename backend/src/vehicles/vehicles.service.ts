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
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { QueryVehicleDto } from './dto/query-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVehicleDto, user: JwtPayload) {
    if (dto.driverId) {
      await this.validateDriver(dto.driverId, user.companyId);
    }
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle
        .create({
          data: {
            companyId: user.companyId,
            patent: dto.patent,
            brand: dto.brand,
            model: dto.model,
            year: dto.year ?? null,
            driverId: dto.driverId ?? null,
            notes: dto.notes ?? null,
          },
        })
        .catch((err: Prisma.PrismaClientKnownRequestError) => {
          if (err.code === 'P2002') throw new ConflictException('La patente ya existe en esta empresa');
          throw err;
        });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.CREATE,
        entityType: 'Vehicle',
        entityId: vehicle.id,
        entityName: vehicle.patent,
        description: `Vehículo ${vehicle.patent} creado`,
        metadata: { after: vehicle, userId: user.sub, userEmail: user.email },
      });
      return vehicle;
    });
  }

  async findAll(query: QueryVehicleDto, user: JwtPayload) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.VehicleWhereInput = { companyId: user.companyId };
    if (query.active !== undefined) where.active = query.active;
    if (query.driverId) where.driverId = query.driverId;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { patent: { contains: s, mode: 'insensitive' } },
        { brand: { contains: s, mode: 'insensitive' } },
        { model: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: JwtPayload) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || vehicle.companyId !== user.companyId) throw new NotFoundException('Vehículo no encontrado');
    return vehicle;
  }

  async update(id: string, dto: UpdateVehicleDto, user: JwtPayload) {
    const existing = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Vehículo no encontrado');

    if (dto.active !== undefined && user.role === UserRole.USER) {
      throw new ForbiddenException('No tenés permiso para cambiar el estado activo');
    }

    if (dto.driverId !== undefined && dto.driverId !== null) {
      await this.validateDriver(dto.driverId, user.companyId);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle
        .update({
          where: { id },
          data: {
            ...(dto.patent !== undefined && { patent: dto.patent }),
            ...(dto.brand !== undefined && { brand: dto.brand }),
            ...(dto.model !== undefined && { model: dto.model }),
            ...(dto.year !== undefined && { year: dto.year }),
            ...('driverId' in dto && { driverId: dto.driverId }),
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.active !== undefined && { active: dto.active }),
          },
        })
        .catch((err: Prisma.PrismaClientKnownRequestError) => {
          if (err.code === 'P2002') throw new ConflictException('La patente ya existe en esta empresa');
          throw err;
        });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.UPDATE,
        entityType: 'Vehicle',
        entityId: updated.id,
        entityName: updated.patent,
        description: `Vehículo ${updated.patent} actualizado`,
        metadata: { before: existing, after: updated, userId: user.sub, userEmail: user.email },
      });
      return updated;
    });
  }

  async softDelete(id: string, user: JwtPayload) {
    const existing = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Vehículo no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({ where: { id }, data: { active: false } });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.DELETE,
        entityType: 'Vehicle',
        entityId: updated.id,
        entityName: updated.patent,
        description: `Vehículo ${updated.patent} dado de baja`,
        metadata: { userId: user.sub, userEmail: user.email },
      });
      return updated;
    });
  }

  async restore(id: string, user: JwtPayload) {
    const existing = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Vehículo no encontrado');
    if (existing.active) throw new BadRequestException('El vehículo ya está activo');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({ where: { id }, data: { active: true } });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.UPDATE,
        entityType: 'Vehicle',
        entityId: updated.id,
        entityName: updated.patent,
        description: `Vehículo ${updated.patent} restaurado`,
        metadata: { userId: user.sub, userEmail: user.email },
      });
      return updated;
    });
  }

  private async validateDriver(driverId: string, companyId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver || driver.companyId !== companyId) throw new NotFoundException('Chofer no encontrado');
    if (!driver.active) throw new BadRequestException('El chofer no está activo');
  }
}

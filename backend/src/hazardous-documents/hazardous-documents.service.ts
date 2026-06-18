import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { createAuditLog } from '../common/helpers/audit.helper';
import { computeExpirationStatus } from '../common/utils/expiration-status.util';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHazardousDocumentDto } from './dto/create-hazardous-document.dto';
import { QueryHazardousDocumentDto } from './dto/query-hazardous-document.dto';
import { UpdateHazardousDocumentDto } from './dto/update-hazardous-document.dto';

function withStatus<T extends { expiryDate: Date }>(doc: T) {
  return { ...doc, status: computeExpirationStatus(doc.expiryDate) };
}

@Injectable()
export class HazardousDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateHazardousDocumentDto, user: JwtPayload) {
    if (dto.issueDate && dto.expiryDate && dto.issueDate > dto.expiryDate) {
      throw new BadRequestException('issueDate no puede ser posterior a expiryDate');
    }

    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.hazardousDocument.create({
        data: {
          companyId: user.companyId,
          type: dto.type,
          entityName: dto.entityName,
          permitNumber: dto.permitNumber ?? null,
          issuingAuthority: dto.issuingAuthority ?? null,
          issueDate: dto.issueDate ?? null,
          expiryDate: dto.expiryDate,
          observations: dto.observations ?? null,
        },
      });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.CREATE,
        entityType: 'HazardousDocument',
        entityId: doc.id,
        entityName: doc.type,
        description: `Documento peligroso "${doc.type}" creado`,
        metadata: { after: doc, userId: user.sub, userEmail: user.email },
      });
      return withStatus(doc);
    });
  }

  async findAll(query: QueryHazardousDocumentDto, user: JwtPayload) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.HazardousDocumentWhereInput = { companyId: user.companyId };
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
        { entityName: { contains: s, mode: 'insensitive' } },
        { permitNumber: { contains: s, mode: 'insensitive' } },
        { issuingAuthority: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [raw, total] = await this.prisma.$transaction([
      this.prisma.hazardousDocument.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.hazardousDocument.count({ where }),
    ]);

    let data = raw.map(withStatus);
    if (query.status) data = data.filter((d) => d.status === query.status);

    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: JwtPayload) {
    const doc = await this.prisma.hazardousDocument.findUnique({ where: { id } });
    if (!doc || doc.companyId !== user.companyId) throw new NotFoundException('Documento no encontrado');
    return withStatus(doc);
  }

  async update(id: string, dto: UpdateHazardousDocumentDto, user: JwtPayload) {
    const existing = await this.prisma.hazardousDocument.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Documento no encontrado');

    const issueDate = 'issueDate' in dto ? dto.issueDate : existing.issueDate;
    const expiryDate = dto.expiryDate ?? existing.expiryDate;
    if (issueDate && expiryDate && issueDate > expiryDate) {
      throw new BadRequestException('issueDate no puede ser posterior a expiryDate');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.hazardousDocument.update({
        where: { id },
        data: {
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.entityName !== undefined && { entityName: dto.entityName }),
          ...('permitNumber' in dto && { permitNumber: dto.permitNumber }),
          ...('issuingAuthority' in dto && { issuingAuthority: dto.issuingAuthority }),
          ...('issueDate' in dto && { issueDate: dto.issueDate }),
          ...(dto.expiryDate !== undefined && { expiryDate: dto.expiryDate }),
          ...('observations' in dto && { observations: dto.observations }),
        },
      });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.UPDATE,
        entityType: 'HazardousDocument',
        entityId: updated.id,
        entityName: updated.type,
        description: `Documento peligroso "${updated.type}" actualizado`,
        metadata: { before: existing, after: updated, userId: user.sub, userEmail: user.email },
      });
      return withStatus(updated);
    });
  }

  // Physical delete: HazardousDocument has no `active` field so soft delete is not applicable.
  // Delete is restricted to ADMIN roles at the controller level.
  async remove(id: string, user: JwtPayload) {
    const existing = await this.prisma.hazardousDocument.findUnique({ where: { id } });
    if (!existing || existing.companyId !== user.companyId) throw new NotFoundException('Documento no encontrado');

    return this.prisma.$transaction(async (tx) => {
      await tx.hazardousDocument.delete({ where: { id } });
      await createAuditLog(tx, {
        companyId: user.companyId,
        action: AuditAction.DELETE,
        entityType: 'HazardousDocument',
        entityId: existing.id,
        entityName: existing.type,
        description: `Documento peligroso "${existing.type}" eliminado`,
        metadata: { userId: user.sub, userEmail: user.email },
      });
      return { id: existing.id, deleted: true };
    });
  }
}

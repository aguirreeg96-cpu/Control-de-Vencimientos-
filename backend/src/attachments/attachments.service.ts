import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AttachmentEntityType, UserRole } from '@prisma/client';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { createAuditLog } from '../common/helpers/audit.helper';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QueryAttachmentDto } from './dto/query-attachment.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES_PER_ENTITY = 10;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);
const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

const SAFE_SELECT = {
  id: true,
  companyId: true,
  entityType: true,
  entityId: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ── UPLOAD ────────────────────────────────────────────────────
  async upload(
    file: Express.Multer.File,
    dto: UploadAttachmentDto,
    user: JwtPayload,
  ) {
    this.validateFile(file);

    const companyId = await this.resolveEntityCompany(dto.entityType, dto.entityId, user);

    const count = await this.prisma.attachment.count({
      where: { entityType: dto.entityType, entityId: dto.entityId },
    });
    if (count >= MAX_FILES_PER_ENTITY) {
      throw new ConflictException(`Límite de ${MAX_FILES_PER_ENTITY} archivos por entidad alcanzado`);
    }

    const storagePath = this.buildStoragePath(companyId, dto.entityType, dto.entityId, file.originalname);

    await this.storage.upload(storagePath, file.buffer, file.mimetype);

    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        const record = await tx.attachment.create({
          data: {
            companyId,
            entityType: dto.entityType,
            entityId: dto.entityId,
            originalName: file.originalname,
            storagePath,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedById: user.sub,
          },
          select: SAFE_SELECT,
        });
        await createAuditLog(tx, {
          companyId,
          action: AuditAction.UPLOAD,
          entityType: 'Attachment',
          entityId: record.id,
          entityName: file.originalname,
          description: `Archivo "${file.originalname}" adjuntado a ${dto.entityType} ${dto.entityId}`,
          metadata: {
            entityType: dto.entityType,
            entityId: dto.entityId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            userId: user.sub,
            userEmail: user.email,
          },
        });
        return record;
      });
      return attachment;
    } catch (err) {
      // DB failed — clean up the already-uploaded file
      await this.storage.delete(storagePath).catch((cleanupErr: unknown) => {
        this.logger.error('Failed to clean up orphaned storage file after DB error', { storagePath, cleanupErr });
      });
      throw err;
    }
  }

  // ── LIST ─────────────────────────────────────────────────────
  async findAll(dto: QueryAttachmentDto, user: JwtPayload) {
    await this.resolveEntityCompany(dto.entityType, dto.entityId, user);

    const data = await this.prisma.attachment.findMany({
      where: { entityType: dto.entityType, entityId: dto.entityId },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return { data, total: data.length };
  }

  // ── SIGNED URL ────────────────────────────────────────────────
  async getSignedUrl(id: string, user: JwtPayload) {
    const attachment = await this.findAndVerifyAccess(id, user);
    const url = await this.storage.createSignedUrl(attachment.storagePath, 300);
    return { url, expiresIn: 300 };
  }

  // ── DELETE ────────────────────────────────────────────────────
  async remove(id: string, user: JwtPayload) {
    this.requireAdminRole(user);
    const attachment = await this.findAndVerifyAccess(id, user);

    // Delete DB record first — if Storage fails, at least metadata is gone (no dangling pointer)
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id } });
      await createAuditLog(tx, {
        companyId: attachment.companyId,
        action: AuditAction.DELETE,
        entityType: 'Attachment',
        entityId: id,
        entityName: attachment.originalName,
        description: `Archivo "${attachment.originalName}" eliminado`,
        metadata: {
          entityType: attachment.entityType,
          entityId: attachment.entityId,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          userId: user.sub,
          userEmail: user.email,
        },
      });
    });

    // Delete from Storage as best-effort after DB transaction committed
    await this.storage.delete(attachment.storagePath).catch((err: unknown) => {
      this.logger.error(`Orphaned storage file after DB delete: ${attachment.storagePath}`, err);
    });

    return { id, deleted: true };
  }

  // ── REPLACE ──────────────────────────────────────────────────
  async replace(id: string, file: Express.Multer.File, user: JwtPayload) {
    this.requireAdminRole(user);
    this.validateFile(file);

    const old = await this.findAndVerifyAccess(id, user);
    const newStoragePath = this.buildStoragePath(
      old.companyId,
      old.entityType,
      old.entityId,
      file.originalname,
    );

    // Upload new file first
    await this.storage.upload(newStoragePath, file.buffer, file.mimetype);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.attachment.update({
          where: { id },
          data: {
            originalName: file.originalname,
            storagePath: newStoragePath,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedById: user.sub,
          },
        });
        await createAuditLog(tx, {
          companyId: old.companyId,
          action: AuditAction.REPLACE,
          entityType: 'Attachment',
          entityId: id,
          entityName: file.originalname,
          description: `Archivo "${old.originalName}" reemplazado por "${file.originalname}"`,
          metadata: {
            entityType: old.entityType,
            entityId: old.entityId,
            previousName: old.originalName,
            newName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            userId: user.sub,
            userEmail: user.email,
          },
        });
      });
    } catch (err) {
      // DB failed — remove newly uploaded file to avoid orphan
      await this.storage.delete(newStoragePath).catch((cleanupErr: unknown) => {
        this.logger.error('Failed to clean up new file after replace DB error', { newStoragePath, cleanupErr });
      });
      throw err;
    }

    // Remove old file after successful DB update
    await this.storage.delete(old.storagePath).catch((err: unknown) => {
      this.logger.warn(`Could not delete old file after replace: ${old.storagePath}`, err);
    });

    return this.prisma.attachment.findUniqueOrThrow({
      where: { id },
      select: SAFE_SELECT,
    });
  }

  // ── HELPERS ──────────────────────────────────────────────────

  private validateFile(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Se requiere un archivo');
    if (!file.size || file.size === 0) throw new BadRequestException('El archivo está vacío');
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB`);
    }

    const ext = extname(file.originalname).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`Extensión no permitida: .${ext}. Permitidos: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Tipo de archivo no permitido: ${file.mimetype}`);
    }
  }

  private buildStoragePath(
    companyId: string,
    entityType: AttachmentEntityType,
    entityId: string,
    originalname: string,
  ): string {
    const safeFilename = this.sanitizeFilename(originalname);
    return `companies/${companyId}/${entityType.toLowerCase()}/${entityId}/${randomUUID()}-${safeFilename}`;
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/\.{2,}/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^[._-]+/, '')
      .substring(0, 100)
      .toLowerCase();
  }

  private async resolveEntityCompany(
    entityType: AttachmentEntityType,
    entityId: string,
    user: JwtPayload,
  ): Promise<string> {
    let companyId: string | null = null;

    switch (entityType) {
      case AttachmentEntityType.VEHICLE: {
        const e = await this.prisma.vehicle.findUnique({ where: { id: entityId }, select: { companyId: true } });
        companyId = e?.companyId ?? null;
        break;
      }
      case AttachmentEntityType.DRIVER: {
        const e = await this.prisma.driver.findUnique({ where: { id: entityId }, select: { companyId: true } });
        companyId = e?.companyId ?? null;
        break;
      }
      case AttachmentEntityType.EXPIRATION: {
        const e = await this.prisma.expiration.findUnique({ where: { id: entityId }, select: { companyId: true } });
        companyId = e?.companyId ?? null;
        break;
      }
      case AttachmentEntityType.HAZARDOUS_DOCUMENT: {
        const e = await this.prisma.hazardousDocument.findUnique({ where: { id: entityId }, select: { companyId: true } });
        companyId = e?.companyId ?? null;
        break;
      }
    }

    if (!companyId) throw new NotFoundException('Entidad no encontrada');
    if (user.role !== UserRole.SUPER_ADMIN && companyId !== user.companyId) {
      throw new ForbiddenException('No tenés permiso para acceder a esta entidad');
    }
    return companyId;
  }

  private async findAndVerifyAccess(id: string, user: JwtPayload) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id },
      select: {
        ...SAFE_SELECT,
        storagePath: true, // needed for storage operations (never returned to client)
      },
    });
    if (!attachment) throw new NotFoundException('Archivo no encontrado');
    if (user.role !== UserRole.SUPER_ADMIN && attachment.companyId !== user.companyId) {
      throw new ForbiddenException('No tenés permiso para acceder a este archivo');
    }
    return attachment;
  }

  private requireAdminRole(user: JwtPayload) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.COMPANY_ADMIN) {
      throw new ForbiddenException('Solo administradores pueden realizar esta acción');
    }
  }
}

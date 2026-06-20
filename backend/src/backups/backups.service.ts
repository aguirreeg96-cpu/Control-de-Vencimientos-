import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ExpirationCategory, Prisma, UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';

const BACKUP_VERSION = 1;

const USER_BACKUP_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ATTACHMENT_BACKUP_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

export interface BackupSummary {
  users: number;
  vehicles: number;
  drivers: number;
  expirations: number;
  hazardousDocuments: number;
  attachments: number;
}

export interface RestoreReport {
  success: boolean;
  created: BackupSummary;
  skipped: BackupSummary;
  conflicts: string[];
  warnings: string[];
}

@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── EXPORT ────────────────────────────────────────────────────

  async exportBackup(requestedCompanyId: string | undefined, requestingUser: JwtPayload) {
    if (requestingUser.role === UserRole.USER) {
      throw new ForbiddenException('No tenés permiso para exportar respaldos');
    }

    if (
      requestingUser.role === UserRole.COMPANY_ADMIN &&
      requestedCompanyId !== undefined &&
      requestedCompanyId !== requestingUser.companyId
    ) {
      throw new ForbiddenException('Solo podés exportar tu propia empresa');
    }

    const companyId =
      requestingUser.role === UserRole.SUPER_ADMIN
        ? (requestedCompanyId ?? requestingUser.companyId)
        : requestingUser.companyId;

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    const [users, vehicles, drivers, expirations, hazardousDocuments, attachments] =
      await Promise.all([
        this.prisma.user.findMany({ where: { companyId }, select: USER_BACKUP_SELECT }),
        this.prisma.vehicle.findMany({ where: { companyId } }),
        this.prisma.driver.findMany({ where: { companyId } }),
        this.prisma.expiration.findMany({ where: { companyId } }),
        this.prisma.hazardousDocument.findMany({ where: { companyId } }),
        this.prisma.attachment.findMany({
          where: { companyId },
          select: ATTACHMENT_BACKUP_SELECT,
        }),
      ]);

    // Audit — record counts, not content
    await this.prisma.auditLog.create({
      data: {
        companyId,
        action: AuditAction.BACKUP_EXPORT,
        entityType: 'Company',
        entityId: companyId,
        entityName: company.name,
        description: `Respaldo exportado por ${requestingUser.email}`,
        metadata: {
          userId: requestingUser.sub,
          version: BACKUP_VERSION,
          counts: {
            users: users.length,
            vehicles: vehicles.length,
            drivers: drivers.length,
            expirations: expirations.length,
            hazardousDocuments: hazardousDocuments.length,
            attachments: attachments.length,
          },
        },
      },
    });

    return {
      version: BACKUP_VERSION,
      generatedAt: new Date().toISOString(),
      generatedBy: requestingUser.sub,
      companyId,
      company: {
        id: company.id,
        name: company.name,
        taxId: company.taxId,
        active: company.active,
        createdAt: company.createdAt,
      },
      users,
      vehicles,
      drivers,
      expirations,
      hazardousDocuments,
      attachments,
    };
  }

  // ── VALIDATE ──────────────────────────────────────────────────

  validateBackup(backup: unknown): {
    valid: boolean;
    summary?: BackupSummary;
    warnings?: string[];
    errors?: string[];
  } {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
      return { valid: false, errors: ['El backup no es un objeto JSON válido'] };
    }

    const b = backup as Record<string, unknown>;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (b.version !== BACKUP_VERSION) {
      errors.push(
        `Versión de backup desconocida: ${String(b.version)}. Se esperaba: ${BACKUP_VERSION}`,
      );
    }
    if (!b.company || typeof b.company !== 'object') errors.push('Falta el campo "company"');
    if (!Array.isArray(b.users)) errors.push('El campo "users" debe ser un array');
    if (!Array.isArray(b.vehicles)) errors.push('El campo "vehicles" debe ser un array');
    if (!Array.isArray(b.drivers)) errors.push('El campo "drivers" debe ser un array');
    if (!Array.isArray(b.expirations)) errors.push('El campo "expirations" debe ser un array');
    if (!Array.isArray(b.hazardousDocuments))
      errors.push('El campo "hazardousDocuments" debe ser un array');
    if (!Array.isArray(b.attachments)) errors.push('El campo "attachments" debe ser un array');

    if (errors.length > 0) return { valid: false, errors, warnings };

    // Warn if users contain passwordHash (should not happen with this backup format)
    const usersWithHash = (b.users as Record<string, unknown>[]).filter(
      (u) => 'passwordHash' in u,
    );
    if (usersWithHash.length > 0) {
      warnings.push(
        `${usersWithHash.length} usuario(s) contienen passwordHash — no se restaurarán credenciales`,
      );
    }

    // Warn about attachments (not restored automatically)
    const attachmentCount = (b.attachments as unknown[]).length;
    if (attachmentCount > 0) {
      warnings.push(
        `${attachmentCount} adjunto(s) detectados. Los metadatos no se restauran automáticamente — los binarios permanecen en Supabase Storage`,
      );
    }

    const summary: BackupSummary = {
      users: (b.users as unknown[]).length,
      vehicles: (b.vehicles as unknown[]).length,
      drivers: (b.drivers as unknown[]).length,
      expirations: (b.expirations as unknown[]).length,
      hazardousDocuments: (b.hazardousDocuments as unknown[]).length,
      attachments: attachmentCount,
    };

    return { valid: true, summary, warnings };
  }

  // ── RESTORE ───────────────────────────────────────────────────
  // Restores operational data only: vehicles, drivers, expirations, hazardousDocuments.
  // Users are NOT restored — they must be created manually with secure passwords.
  // Attachments are NOT restored — binaries remain in Supabase Storage.
  // Existing records (by ID) are skipped, never overwritten.

  async restoreBackup(
    backup: unknown,
    confirmation: string,
    requestingUser: JwtPayload,
  ): Promise<RestoreReport> {
    if (requestingUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Solo SUPER_ADMIN puede ejecutar restauraciones');
    }

    if (confirmation !== 'RESTORE') {
      throw new BadRequestException(
        'Se requiere confirmación escrita exacta: RESTORE',
      );
    }

    const validation = this.validateBackup(backup);
    if (!validation.valid) {
      throw new BadRequestException(
        `Backup inválido: ${(validation.errors ?? []).join(', ')}`,
      );
    }

    const b = backup as Record<string, unknown>;
    const companyData = b.company as Record<string, unknown>;
    const companyId = (companyData.id ?? b.companyId) as string;
    if (!companyId) {
      throw new BadRequestException('El backup no contiene un companyId válido');
    }

    const vehicles = (b.vehicles as Record<string, unknown>[]) ?? [];
    const drivers = (b.drivers as Record<string, unknown>[]) ?? [];
    const expirations = (b.expirations as Record<string, unknown>[]) ?? [];
    const hazardousDocuments = (b.hazardousDocuments as Record<string, unknown>[]) ?? [];

    const created: BackupSummary = {
      users: 0,
      vehicles: 0,
      drivers: 0,
      expirations: 0,
      hazardousDocuments: 0,
      attachments: 0,
    };
    const skipped: BackupSummary = {
      users: (b.users as unknown[]).length, // users always skipped
      vehicles: 0,
      drivers: 0,
      expirations: 0,
      hazardousDocuments: 0,
      attachments: (b.attachments as unknown[]).length, // attachments always skipped
    };
    const conflicts: string[] = [];
    const warnings: string[] = [
      `Usuarios omitidos (${skipped.users}): deben crearse manualmente con contraseñas seguras`,
      `Adjuntos omitidos (${skipped.attachments}): los binarios permanecen en Supabase Storage`,
    ];

    await this.prisma.$transaction(async (tx) => {
      // 1. Drivers first (vehicles may reference them)
      for (const d of drivers) {
        const id = d.id as string;
        const existing = await tx.driver.findUnique({ where: { id } });
        if (existing) {
          skipped.drivers++;
          continue;
        }
        try {
          await tx.driver.create({
            data: {
              id,
              companyId,
              name: d.name as string,
              lastName: d.lastName as string,
              dni: d.dni as string,
              licenseCategory: (d.licenseCategory as string | null) ?? null,
              licenseNumber: (d.licenseNumber as string | null) ?? null,
              notes: (d.notes as string | null) ?? null,
              active: typeof d.active === 'boolean' ? d.active : true,
              createdAt: new Date(d.createdAt as string),
              updatedAt: new Date(d.updatedAt as string),
            },
          });
          created.drivers++;
        } catch (e) {
          conflicts.push(`Driver ${id}: ${(e as Error).message}`);
          skipped.drivers++;
        }
      }

      // 2. Vehicles
      for (const v of vehicles) {
        const id = v.id as string;
        const existing = await tx.vehicle.findUnique({ where: { id } });
        if (existing) {
          skipped.vehicles++;
          continue;
        }
        try {
          const driverId = v.driverId
            ? ((await tx.driver.findUnique({ where: { id: v.driverId as string } }))?.id ??
              null)
            : null;
          await tx.vehicle.create({
            data: {
              id,
              companyId,
              patent: v.patent as string,
              brand: v.brand as string,
              model: v.model as string,
              year: (v.year as number | null) ?? null,
              driverId,
              notes: (v.notes as string | null) ?? null,
              active: typeof v.active === 'boolean' ? v.active : true,
              createdAt: new Date(v.createdAt as string),
              updatedAt: new Date(v.updatedAt as string),
            },
          });
          created.vehicles++;
        } catch (e) {
          conflicts.push(`Vehicle ${id}: ${(e as Error).message}`);
          skipped.vehicles++;
        }
      }

      // 3. Expirations
      for (const e of expirations) {
        const id = e.id as string;
        const existing = await tx.expiration.findUnique({ where: { id } });
        if (existing) {
          skipped.expirations++;
          continue;
        }
        try {
          const vehicleId = e.vehicleId
            ? ((await tx.vehicle.findUnique({ where: { id: e.vehicleId as string } }))?.id ??
              null)
            : null;
          const driverId = e.driverId
            ? ((await tx.driver.findUnique({ where: { id: e.driverId as string } }))?.id ??
              null)
            : null;
          await tx.expiration.create({
            data: {
              id,
              companyId,
              type: e.type as string,
              category: e.category as ExpirationCategory,
              vehicleId,
              driverId,
              issueDate: e.issueDate ? new Date(e.issueDate as string) : null,
              expiryDate: new Date(e.expiryDate as string),
              description: (e.description as string | null) ?? null,
              observations: (e.observations as string | null) ?? null,
              createdAt: new Date(e.createdAt as string),
              updatedAt: new Date(e.updatedAt as string),
            },
          });
          created.expirations++;
        } catch (err) {
          conflicts.push(`Expiration ${id}: ${(err as Error).message}`);
          skipped.expirations++;
        }
      }

      // 4. Hazardous documents
      for (const h of hazardousDocuments) {
        const id = h.id as string;
        const existing = await tx.hazardousDocument.findUnique({ where: { id } });
        if (existing) {
          skipped.hazardousDocuments++;
          continue;
        }
        try {
          await tx.hazardousDocument.create({
            data: {
              id,
              companyId,
              type: h.type as string,
              entityName: h.entityName as string,
              permitNumber: (h.permitNumber as string | null) ?? null,
              issuingAuthority: (h.issuingAuthority as string | null) ?? null,
              issueDate: h.issueDate ? new Date(h.issueDate as string) : null,
              expiryDate: new Date(h.expiryDate as string),
              observations: (h.observations as string | null) ?? null,
              createdAt: new Date(h.createdAt as string),
              updatedAt: new Date(h.updatedAt as string),
            },
          });
          created.hazardousDocuments++;
        } catch (err) {
          conflicts.push(`HazardousDocument ${id}: ${(err as Error).message}`);
          skipped.hazardousDocuments++;
        }
      }
    });

    // Audit — summary only, not the backup content
    await this.prisma.auditLog.create({
      data: {
        companyId: requestingUser.companyId,
        action: AuditAction.BACKUP_RESTORE,
        entityType: 'Company',
        entityId: companyId,
        entityName: (companyData.name as string) ?? 'Desconocida',
        description: `Restauración ejecutada por ${requestingUser.email}`,
        metadata: {
          userId: requestingUser.sub,
          targetCompanyId: companyId,
          created: { ...created },
          skipped: { ...skipped },
          conflicts: conflicts.length,
        } as Prisma.InputJsonValue,
      },
    });

    return { success: true, created, skipped, conflicts, warnings };
  }

  // ── VALIDATE AUDIT ────────────────────────────────────────────

  async auditValidate(backup: unknown, requestingUser: JwtPayload) {
    const result = this.validateBackup(backup);

    await this.prisma.auditLog.create({
      data: {
        companyId: requestingUser.companyId,
        action: AuditAction.BACKUP_VALIDATE,
        entityType: 'Backup',
        entityId: null,
        entityName: null,
        description: `Backup validado — resultado: ${result.valid ? 'válido' : 'inválido'}`,
        metadata: {
          userId: requestingUser.sub,
          valid: result.valid,
          summary: result.summary ? { ...result.summary } : null,
        } as Prisma.InputJsonValue,
      },
    });

    return result;
  }
}

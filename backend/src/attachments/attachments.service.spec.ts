import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AttachmentEntityType, UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AttachmentsService } from './attachments.service';

const COMPANY_ID = 'company-uuid';
const OTHER_COMPANY_ID = 'other-company-uuid';
const VEHICLE_ID = 'vehicle-uuid';
const ATTACHMENT_ID = 'attachment-uuid';
const STORAGE_PATH = `companies/${COMPANY_ID}/vehicle/${VEHICLE_ID}/uuid-test.pdf`;

const adminUser: JwtPayload = {
  sub: 'user-1',
  email: 'admin@test.com',
  role: UserRole.COMPANY_ADMIN,
  companyId: COMPANY_ID,
};

const regularUser: JwtPayload = {
  sub: 'user-2',
  email: 'user@test.com',
  role: UserRole.USER,
  companyId: COMPANY_ID,
};

const superAdmin: JwtPayload = {
  sub: 'super-1',
  email: 'super@test.com',
  role: UserRole.SUPER_ADMIN,
  companyId: COMPANY_ID,
};

function makeMockFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'documento.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('mock pdf content'),
    size: 1024,
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
    ...overrides,
  };
}

function makeAttachment(overrides = {}) {
  return {
    id: ATTACHMENT_ID,
    companyId: COMPANY_ID,
    entityType: AttachmentEntityType.VEHICLE,
    entityId: VEHICLE_ID,
    originalName: 'documento.pdf',
    storagePath: STORAGE_PATH,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    uploadedById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadedBy: { id: 'user-1', firstName: 'Juan', lastName: 'Pérez', email: 'admin@test.com' },
    ...overrides,
  };
}

// Simulates what Prisma returns when SAFE_SELECT is applied (no storagePath)
function makeSafeAttachment(overrides = {}) {
  const { storagePath: _sp, uploadedById: _uid, ...safe } = makeAttachment(overrides);
  void _sp; void _uid;
  return safe;
}

function buildPrisma() {
  return {
    vehicle: { findUnique: jest.fn() },
    driver: { findUnique: jest.fn() },
    expiration: { findUnique: jest.fn() },
    hazardousDocument: { findUnique: jest.fn() },
    attachment: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
}

function buildStorageMock() {
  return {
    upload: jest.fn().mockResolvedValue(undefined),
    createSignedUrl: jest.fn().mockResolvedValue('https://supabase.co/storage/signed?token=xxx'),
    delete: jest.fn().mockResolvedValue(undefined),
    replace: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let prisma: ReturnType<typeof buildPrisma>;
  let storageMock: ReturnType<typeof buildStorageMock>;

  beforeEach(async () => {
    prisma = buildPrisma();
    storageMock = buildStorageMock();

    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (typeof fn === 'function') return fn(prisma);
      if (Array.isArray(fn)) return Promise.all(fn);
      return fn;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storageMock },
      ],
    }).compile();

    service = module.get<AttachmentsService>(AttachmentsService);
  });

  // ── 1. Subir PDF válido ───────────────────────────────────────
  it('upload: sube un PDF válido y devuelve metadatos sin storagePath', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(0);
    (prisma.attachment.create as jest.Mock).mockResolvedValue(makeSafeAttachment());

    const result = await service.upload(
      makeMockFile(),
      { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
      adminUser,
    );

    expect(storageMock.upload).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('storagePath');
    expect(result.originalName).toBe('documento.pdf');
  });

  // ── 2. Subir JPG válido ───────────────────────────────────────
  it('upload: sube una imagen JPG válida', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(0);
    (prisma.attachment.create as jest.Mock).mockResolvedValue(
      makeSafeAttachment({ originalName: 'foto.jpg', mimeType: 'image/jpeg' }),
    );

    const result = await service.upload(
      makeMockFile({ originalname: 'foto.jpg', mimetype: 'image/jpeg' }),
      { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
      adminUser,
    );

    expect(result.mimeType).toBe('image/jpeg');
  });

  // ── 3. Rechazar MIME no permitido ─────────────────────────────
  it('upload: lanza BadRequestException para MIME no permitido', async () => {
    await expect(
      service.upload(
        makeMockFile({ originalname: 'script.js', mimetype: 'application/javascript' }),
        { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 4. Rechazar archivo mayor a 10 MB ─────────────────────────
  it('upload: lanza BadRequestException si el archivo supera 10 MB', async () => {
    await expect(
      service.upload(
        makeMockFile({ size: 11 * 1024 * 1024 }),
        { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 5. Rechazar archivo vacío ─────────────────────────────────
  it('upload: lanza BadRequestException si el archivo está vacío', async () => {
    await expect(
      service.upload(
        makeMockFile({ size: 0, buffer: Buffer.alloc(0) }),
        { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 6. Rechazar entidad inexistente ───────────────────────────
  it('upload: lanza NotFoundException si la entidad no existe', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.upload(
        makeMockFile(),
        { entityType: AttachmentEntityType.VEHICLE, entityId: 'nonexistent' },
        adminUser,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // ── 7. Rechazar acceso cruzado entre empresas ─────────────────
  it('upload: COMPANY_ADMIN no puede subir a entidad de otra empresa', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: OTHER_COMPANY_ID });

    await expect(
      service.upload(
        makeMockFile(),
        { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
        adminUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── 8. SUPER_ADMIN accede a otra empresa ──────────────────────
  it('upload: SUPER_ADMIN puede subir a entidad de otra empresa', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: OTHER_COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(0);
    (prisma.attachment.create as jest.Mock).mockResolvedValue(
      makeSafeAttachment({ companyId: OTHER_COMPANY_ID }),
    );

    const result = await service.upload(
      makeMockFile(),
      { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
      superAdmin,
    );

    expect(storageMock.upload).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  // ── 9. COMPANY_ADMIN solo su empresa (findAll) ────────────────
  it('findAll: COMPANY_ADMIN solo puede listar archivos de su empresa', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: OTHER_COMPANY_ID });

    await expect(
      service.findAll(
        { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
        adminUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── 10. USER puede listar y descargar ─────────────────────────
  it('findAll: USER puede listar archivos de su empresa', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.findMany as jest.Mock).mockResolvedValue([makeSafeAttachment()]);

    const result = await service.findAll(
      { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
      regularUser,
    );

    expect(result.data).toHaveLength(1);
  });

  // ── 11. USER no puede eliminar ────────────────────────────────
  it('remove: USER lanza ForbiddenException al intentar eliminar', async () => {
    await expect(service.remove(ATTACHMENT_ID, regularUser)).rejects.toThrow(ForbiddenException);
  });

  // ── 12. Admin elimina correctamente ───────────────────────────
  it('remove: COMPANY_ADMIN puede eliminar un adjunto', async () => {
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue(makeAttachment());
    (prisma.attachment.delete as jest.Mock).mockResolvedValue(makeAttachment());

    const result = await service.remove(ATTACHMENT_ID, adminUser);

    expect(result).toEqual({ id: ATTACHMENT_ID, deleted: true });
    expect(storageMock.delete).toHaveBeenCalledWith(STORAGE_PATH);
  });

  // ── 13. Signed URL se genera ──────────────────────────────────
  it('getSignedUrl: genera una URL firmada para un adjunto válido', async () => {
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue(makeAttachment());

    const result = await service.getSignedUrl(ATTACHMENT_ID, adminUser);

    expect(result.url).toContain('supabase');
    expect(result.expiresIn).toBe(300);
    expect(storageMock.createSignedUrl).toHaveBeenCalledWith(STORAGE_PATH, 300);
  });

  // ── 14. Archivo inexistente devuelve 404 ──────────────────────
  it('getSignedUrl: lanza NotFoundException si el adjunto no existe', async () => {
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getSignedUrl('nonexistent', adminUser)).rejects.toThrow(NotFoundException);
  });

  // ── 15. Reemplazo mantiene consistencia ───────────────────────
  it('replace: actualiza metadatos y elimina archivo anterior', async () => {
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue(makeAttachment());
    (prisma.attachment.update as jest.Mock).mockResolvedValue(makeSafeAttachment({ originalName: 'nuevo.pdf' }));
    (prisma.attachment.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      makeSafeAttachment({ originalName: 'nuevo.pdf' }),
    );

    await service.replace(ATTACHMENT_ID, makeMockFile({ originalname: 'nuevo.pdf' }), adminUser);

    expect(storageMock.upload).toHaveBeenCalledTimes(1);
    expect(storageMock.delete).toHaveBeenCalledWith(STORAGE_PATH);
    expect(prisma.attachment.update).toHaveBeenCalled();
  });

  // ── 16. Fallo de Storage no crea metadata ─────────────────────
  it('upload: si Storage falla, no se crea registro en DB', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(0);
    storageMock.upload.mockRejectedValue(new Error('Storage unavailable'));

    await expect(
      service.upload(makeMockFile(), { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID }, adminUser),
    ).rejects.toThrow('Storage unavailable');

    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  // ── 17. Fallo de DB después de upload limpia Storage ──────────
  it('upload: si DB falla tras subir, intenta eliminar el archivo de Storage', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(0);

    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB error'));

    await expect(
      service.upload(makeMockFile(), { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID }, adminUser),
    ).rejects.toThrow('DB error');

    expect(storageMock.upload).toHaveBeenCalled();
    expect(storageMock.delete).toHaveBeenCalled();
  });

  // ── 18. storagePath no se expone en findAll ───────────────────
  it('findAll: la respuesta no incluye storagePath', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.findMany as jest.Mock).mockResolvedValue([makeSafeAttachment()]);

    const result = await service.findAll(
      { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID },
      adminUser,
    );

    result.data.forEach((item) => {
      expect(item).not.toHaveProperty('storagePath');
    });
  });

  // ── 19. Límite de 10 archivos por entidad ─────────────────────
  it('upload: lanza ConflictException si se alcanzan 10 archivos por entidad', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(10);

    await expect(
      service.upload(makeMockFile(), { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID }, adminUser),
    ).rejects.toThrow(ConflictException);
  });

  // ── 20. Auditoría se registra sin datos sensibles ─────────────
  it('upload: crea auditoría con entityType, entityId, nombre y tamaño', async () => {
    (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ companyId: COMPANY_ID });
    (prisma.attachment.count as jest.Mock).mockResolvedValue(0);
    (prisma.attachment.create as jest.Mock).mockResolvedValue(makeSafeAttachment());

    await service.upload(makeMockFile(), { entityType: AttachmentEntityType.VEHICLE, entityId: VEHICLE_ID }, adminUser);

    const auditCreate = (prisma.auditLog.create as jest.Mock);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'UPLOAD',
          entityType: 'Attachment',
        }),
      }),
    );
    const callArg = auditCreate.mock.calls[0][0].data;
    const meta = callArg.metadata;
    expect(meta).not.toHaveProperty('storagePath');
    expect(meta).not.toHaveProperty('buffer');
    expect(meta.originalName).toBe('documento.pdf');
    expect(meta.sizeBytes).toBe(1024);
  });
});

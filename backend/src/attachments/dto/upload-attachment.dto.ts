import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { AttachmentEntityType } from '@prisma/client';

export class UploadAttachmentDto {
  @IsEnum(AttachmentEntityType)
  entityType: AttachmentEntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;
}

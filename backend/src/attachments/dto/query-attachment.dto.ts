import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { AttachmentEntityType } from '@prisma/client';

export class QueryAttachmentDto {
  @IsEnum(AttachmentEntityType)
  entityType: AttachmentEntityType;

  @IsString()
  @IsNotEmpty()
  entityId: string;
}

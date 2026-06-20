import { IsObject } from 'class-validator';

export class ValidateBackupDto {
  @IsObject()
  backup: Record<string, unknown>;
}

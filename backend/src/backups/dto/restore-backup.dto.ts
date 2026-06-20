import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class RestoreBackupDto {
  @IsObject()
  backup: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  confirmation: string;
}

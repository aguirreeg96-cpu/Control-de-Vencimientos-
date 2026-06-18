import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateHazardousDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  entityName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  permitNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuingAuthority?: string | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observations?: string | null;
}

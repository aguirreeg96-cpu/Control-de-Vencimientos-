import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateHazardousDocumentDto {
  @IsString()
  @MaxLength(200)
  type: string;

  @IsString()
  @MaxLength(200)
  entityName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  permitNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issuingAuthority?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date | null;

  @Type(() => Date)
  @IsDate()
  expiryDate: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observations?: string;
}

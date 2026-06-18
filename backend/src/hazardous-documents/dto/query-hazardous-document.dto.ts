import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryHazardousDocumentDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['EXPIRED', 'EXPIRING_SOON', 'VALID'])
  status?: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryTo?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['type', 'entityName', 'expiryDate', 'createdAt'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

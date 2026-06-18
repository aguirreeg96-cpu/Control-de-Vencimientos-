import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ExpirationCategory } from '@prisma/client';

export class QueryExpirationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ExpirationCategory)
  category?: ExpirationCategory;

  @IsOptional()
  @IsIn(['EXPIRED', 'EXPIRING_SOON', 'VALID'])
  status?: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

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
  @IsIn(['type', 'category', 'expiryDate', 'createdAt'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

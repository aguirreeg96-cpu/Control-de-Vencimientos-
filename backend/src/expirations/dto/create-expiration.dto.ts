import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ExpirationCategory } from '@prisma/client';

export class CreateExpirationDto {
  @IsString()
  @MaxLength(200)
  type: string;

  @IsEnum(ExpirationCategory)
  category: ExpirationCategory;

  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @IsOptional()
  @IsUUID()
  driverId?: string | null;

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
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observations?: string;
}

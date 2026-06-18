import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: string }) => value?.toString().toUpperCase().trim())
  patent: string;

  @IsString()
  @MaxLength(100)
  brand: string;

  @IsString()
  @MaxLength(100)
  model: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

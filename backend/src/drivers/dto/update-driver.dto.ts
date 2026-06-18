import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.toString().trim())
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.toString().trim())
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: string }) => value?.toString().trim())
  dni?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  licenseCategory?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  licenseNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

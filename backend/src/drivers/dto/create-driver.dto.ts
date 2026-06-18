import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDriverDto {
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.toString().trim())
  name: string;

  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.toString().trim())
  lastName: string;

  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: string }) => value?.toString().trim())
  dni: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  licenseCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

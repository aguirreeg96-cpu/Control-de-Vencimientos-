import { IsString, IsNotEmpty, IsEmail, IsOptional, IsEnum, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  // Only used by SUPER_ADMIN to create users in other companies
  @IsOptional()
  @IsString()
  companyId?: string;
}

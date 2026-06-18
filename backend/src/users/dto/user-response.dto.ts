import { UserRole } from '@prisma/client';

export class UserResponseDto {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

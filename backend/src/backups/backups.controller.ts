import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { BackupsService } from './backups.service';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { ValidateBackupDto } from './dto/validate-backup.dto';

@Controller('backups')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @Get('export')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.SUPER_ADMIN)
  async exportBackup(
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const backup = await this.backupsService.exportBackup(companyId, user);

    const safeName = (backup.company.name ?? 'empresa')
      .replace(/[^a-zA-Z0-9À-ſ]/g, '_')
      .substring(0, 40)
      .toLowerCase();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `backup-${safeName}-${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.COMPANY_ADMIN, UserRole.SUPER_ADMIN)
  validateBackup(@Body() dto: ValidateBackupDto, @CurrentUser() user: JwtPayload) {
    return this.backupsService.auditValidate(dto.backup, user);
  }

  @Post('restore')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  restoreBackup(@Body() dto: RestoreBackupDto, @CurrentUser() user: JwtPayload) {
    return this.backupsService.restoreBackup(dto.backup, dto.confirmation, user);
  }
}

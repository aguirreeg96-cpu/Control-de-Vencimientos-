import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateHazardousDocumentDto } from './dto/create-hazardous-document.dto';
import { QueryHazardousDocumentDto } from './dto/query-hazardous-document.dto';
import { UpdateHazardousDocumentDto } from './dto/update-hazardous-document.dto';
import { HazardousDocumentsService } from './hazardous-documents.service';

@Controller('hazardous-documents')
export class HazardousDocumentsController {
  constructor(private readonly hazardousDocumentsService: HazardousDocumentsService) {}

  @Post()
  create(@Body() dto: CreateHazardousDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.hazardousDocumentsService.create(dto, user);
  }

  @Get()
  findAll(@Query() query: QueryHazardousDocumentDto, @CurrentUser() user: JwtPayload) {
    return this.hazardousDocumentsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.hazardousDocumentsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHazardousDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hazardousDocumentsService.update(id, dto, user);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.COMPANY_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.hazardousDocumentsService.remove(id, user);
  }
}

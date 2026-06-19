import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { AttachmentsService } from './attachments.service';
import { QueryAttachmentDto } from './dto/query-attachment.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';

const FILE_INTERCEPTOR = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @UseInterceptors(FILE_INTERCEPTOR)
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachmentsService.upload(file, dto, user);
  }

  @Get()
  findAll(@Query() dto: QueryAttachmentDto, @CurrentUser() user: JwtPayload) {
    return this.attachmentsService.findAll(dto, user);
  }

  @Get(':id/url')
  getSignedUrl(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.attachmentsService.getSignedUrl(id, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.attachmentsService.remove(id, user);
  }

  @Post(':id/replace')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FILE_INTERCEPTOR)
  replace(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachmentsService.replace(id, file, user);
  }
}

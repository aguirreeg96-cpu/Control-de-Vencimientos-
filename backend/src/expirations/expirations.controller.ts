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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateExpirationDto } from './dto/create-expiration.dto';
import { QueryExpirationDto } from './dto/query-expiration.dto';
import { UpdateExpirationDto } from './dto/update-expiration.dto';
import { ExpirationsService } from './expirations.service';

@Controller('expirations')
export class ExpirationsController {
  constructor(private readonly expirationsService: ExpirationsService) {}

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.expirationsService.summary(user);
  }

  @Post()
  create(@Body() dto: CreateExpirationDto, @CurrentUser() user: JwtPayload) {
    return this.expirationsService.create(dto, user);
  }

  @Get()
  findAll(@Query() query: QueryExpirationDto, @CurrentUser() user: JwtPayload) {
    return this.expirationsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.expirationsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpirationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.expirationsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.expirationsService.remove(id, user);
  }
}

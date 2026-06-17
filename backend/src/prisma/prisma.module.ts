import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global hace que PrismaService esté disponible en todos los módulos
// sin necesidad de importar PrismaModule en cada uno
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

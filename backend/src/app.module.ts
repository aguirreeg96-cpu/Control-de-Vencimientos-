import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ConfigModule global — lee el archivo .env automáticamente
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // PrismaModule global — el servicio estará disponible en todos los módulos
    PrismaModule,
    // Módulos de la API
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

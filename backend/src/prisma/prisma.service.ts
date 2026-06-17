import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';

/**
 * Etapa 1 — PrismaService sin modelos todavía.
 * En la Etapa 2 se definen los modelos en schema.prisma,
 * se ejecuta `prisma generate` y esta clase pasa a
 * extender PrismaClient para tener acceso tipado a la BD.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    this.logger.log('PrismaService listo — Etapa 2 configurará los modelos y la conexión');
  }

  async onModuleDestroy() {
    // En Etapa 2: await this.$disconnect()
  }
}

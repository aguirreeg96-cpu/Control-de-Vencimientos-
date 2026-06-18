import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  // Validate required env vars before the app starts
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `[LOGICONTROL PRO] Faltan variables de entorno obligatorias: ${missing.join(', ')}`,
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const frontendUrl = configService.get<string>('FRONTEND_URL')!;
  const isProd = nodeEnv === 'production';

  app.setGlobalPrefix('api');

  // CORS — en producción solo FRONTEND_URL; en desarrollo también localhost
  const allowedOrigins = isProd
    ? [frontendUrl]
    : [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        frontendUrl,
      ];

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Graceful shutdown — Prisma se desconecta en onModuleDestroy
  app.enableShutdownHooks();

  // Escuchar en 0.0.0.0 para que Render pueda acceder al proceso
  await app.listen(port, '0.0.0.0');

  console.log(`\n[LOGICONTROL PRO] Servidor iniciado`);
  console.log(`  ENV:    ${nodeEnv}`);
  console.log(`  PORT:   ${port}`);
  console.log(`  CORS:   ${allowedOrigins.join(', ')}`);
  console.log(`  Health: http://0.0.0.0:${port}/api/health\n`);
}

bootstrap();

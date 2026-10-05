import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestLogger, ShutdownSignal } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  const httpHost = process.env.HTTP_HOST ?? '0.0.0.0';
  const httpPort = Number(process.env.HTTP_PORT ?? 8084);

  app.enableShutdownHooks([ShutdownSignal.SIGINT, ShutdownSignal.SIGTERM]);
  await app.listen(httpPort, httpHost);

  const logger = new NestLogger('bootstrap');
  logger.log(`HTTP (health) listening on ${httpHost}:${httpPort}`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});

import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Env } from '../config/env.validation';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger('Mongoose');
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        return {
          uri: config.get('MONGO_URI', { infer: true }),
          autoIndex: nodeEnv !== 'production',
          onConnectionCreate: (connection) => {
            connection.on('connected', () => logger.log('Mongoose connected'));
            connection.on('disconnected', () => logger.warn('Mongoose disconnected'));
            connection.on('error', (err) => logger.error(`Mongoose error: ${err.message}`));
            return connection;
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { GRPC_LOADER_OPTIONS, PROTO_FILES } from '@us-man-qa-sim/ecom-contracts';
import { ECOM_USER_V1_PACKAGE_NAME } from '@us-man-qa-sim/ecom-contracts/generated/user';
import { USER_GRPC_PACKAGE } from './grpc-tokens';
import { UserGrpcClient } from './user.client';
import { GrpcCallTimeouts } from './grpc-call.util';

@Module({
  imports: [
    ClientsModule.registerAsync({
      isGlobal: false,
      clients: [
        {
          name: USER_GRPC_PACKAGE,
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            transport: Transport.GRPC,
            options: {
              url: config.getOrThrow<string>('USER_SERVICE_URL'),
              package: [ECOM_USER_V1_PACKAGE_NAME],
              protoPath: [PROTO_FILES.user, PROTO_FILES.common],
              loader: GRPC_LOADER_OPTIONS,
            },
          }),
        },
      ],
    }),
  ],
  providers: [UserGrpcClient, GrpcCallTimeouts],
  exports: [UserGrpcClient, GrpcCallTimeouts],
})
export class GrpcModule {}

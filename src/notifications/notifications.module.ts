import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notification, NotificationSchema } from './notification.schema';
import { NotificationsService } from './notifications.service';
import { RetryJob } from './retry.job';
import { UserRegisteredHandler } from './handlers/user-registered.handler';
import { OrderConfirmedHandler } from './handlers/order-confirmed.handler';
import { OrderCancelledHandler } from './handlers/order-cancelled.handler';
import { OrderShippedHandler } from './handlers/order-shipped.handler';
import { OrderDeliveredHandler } from './handlers/order-delivered.handler';
import { MailerModule } from '../mailer/mailer.module';
import { GrpcModule } from '../grpc/grpc.module';

const HANDLERS = [
  UserRegisteredHandler,
  OrderConfirmedHandler,
  OrderCancelledHandler,
  OrderShippedHandler,
  OrderDeliveredHandler,
];

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    MailerModule,
    GrpcModule,
  ],
  providers: [NotificationsService, RetryJob, ...HANDLERS],
  exports: [NotificationsService],
})
export class NotificationsModule {}

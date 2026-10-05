import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notification, NotificationSchema } from './notification.schema';
import { NotificationsService } from './notifications.service';
import { UserRegisteredHandler } from './handlers/user-registered.handler';
import { OrderConfirmedHandler } from './handlers/order-confirmed.handler';
import { OrderCancelledHandler } from './handlers/order-cancelled.handler';
import { OrderShippedHandler } from './handlers/order-shipped.handler';
import { OrderDeliveredHandler } from './handlers/order-delivered.handler';

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
  ],
  providers: [NotificationsService, ...HANDLERS],
  exports: [NotificationsService],
})
export class NotificationsModule {}

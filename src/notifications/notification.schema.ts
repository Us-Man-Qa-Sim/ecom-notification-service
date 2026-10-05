import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
}

export enum NotificationType {
  WELCOME = 'WELCOME',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_SHIPPED = 'ORDER_SHIPPED',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
}

/**
 * Notification record. `eventId` is the Kafka event id carried in the message
 * envelope and doubles as the inbox deduplication key (NTF-6): the unique index
 * prevents a second insert for a replayed event, so the consumer can treat an
 * `E11000` duplicate-key error as a safe no-op rather than a real failure.
 *
 * `attempts` / `lastError` support the retry job (NTF-7): the job claims FAILED
 * rows below the max-attempts limit (and PENDING rows abandoned by a crash),
 * tries again, and either flips to SENT or records the new `lastError`.
 */
@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ type: String, default: null })
  orderId!: string | null; // null for WELCOME

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, enum: NotificationType })
  type!: NotificationType;

  @Prop({
    type: String,
    required: true,
    enum: NotificationChannel,
    default: NotificationChannel.EMAIL,
  })
  channel!: NotificationChannel;

  @Prop({
    type: String,
    required: true,
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status!: NotificationStatus;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  attempts!: number;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  // Template context that is not re-fetchable at retry time (the cancellation
  // reason only exists on the `order.cancelled` event).
  @Prop({ type: String, default: null })
  reason!: string | null;

  // createdAt, updatedAt — from timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Retry-job index (NTF-7): find FAILED rows still below the attempt limit and
// PENDING rows whose `updatedAt` is stale, without a collection scan.
NotificationSchema.index({ status: 1, attempts: 1, updatedAt: 1 });

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

/**
 * Notification record. `eventId` is the Kafka event id carried in the message
 * envelope and doubles as the inbox deduplication key (NTF-6): the unique index
 * prevents a second insert for a replayed event, so the consumer can treat an
 * `E11000` duplicate-key error as a safe no-op rather than a real failure.
 *
 * `attempts` / `lastError` support the retry job (NTF-7): the job finds
 * FAILED rows below `MAX_ATTEMPTS`, increments `attempts`, tries again, and
 * either flips to SENT or records the new `lastError`.
 */
@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ type: String, default: null })
  orderId!: string | null;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  type!: string; // e.g. "user.registered", "order.confirmed"

  @Prop({ required: true, enum: NotificationChannel })
  channel!: NotificationChannel;

  @Prop({ required: true, enum: NotificationStatus, default: NotificationStatus.PENDING })
  status!: NotificationStatus;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  attempts!: number;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  // createdAt, updatedAt — from timestamps: true
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Retry-job index (NTF-7): quickly find FAILED rows still eligible for a
// retry without scanning the full collection.
NotificationSchema.index({ status: 1, attempts: 1 });

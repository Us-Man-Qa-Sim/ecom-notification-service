import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Notification,
  NotificationChannel,
  NotificationDocument,
  NotificationStatus,
} from './notification.schema';
import { MailerService } from '../mailer/mailer.service';
import { UserGrpcClient } from '../grpc/user.client';
import { GrpcCallTimeouts, callGrpc } from '../grpc/grpc-call.util';
import { renderTemplate } from '../mailer/templates';

export interface SendNotificationInput {
  eventId: string;
  userId: string;
  orderId: string | null;
  type: string;
  /** Pre-resolved from the event payload — skips the gRPC GetUser call. */
  email?: string;
  firstName?: string;
  /** Extra context for specific templates (e.g. cancellation reason). */
  reason?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    private readonly mailer: MailerService,
    private readonly userClient: UserGrpcClient,
    private readonly timeouts: GrpcCallTimeouts,
  ) {}

  /**
   * Inserts a PENDING record (dedup via unique `eventId` index), resolves the
   * recipient's email address, renders the appropriate template, sends the
   * email via SMTP, and updates the record to SENT or FAILED.
   *
   * Only throws for hard storage errors on the initial insert — everything
   * after that (gRPC lookup failures, SMTP errors) is absorbed so that the
   * Kafka offset still commits. The FAILED status and `lastError` field let
   * the retry job (NTF-7) pick up the pieces later.
   */
  async createAndSend(input: SendNotificationInput): Promise<void> {
    const doc = await this.insertPending(input);
    if (!doc) return; // duplicate event — already handled

    let email: string;
    let firstName: string;

    if (input.email) {
      email = input.email;
      firstName = input.firstName ?? '';
    } else {
      try {
        const res = await callGrpc(
          this.userClient.service.getUser({ userId: input.userId }),
          this.timeouts.standard,
          'user-service',
        );
        if (!res.user) throw new Error(`GetUser returned no user for userId ${input.userId}`);
        email = res.user.email;
        firstName = res.user.firstName;
      } catch (err: unknown) {
        this.logger.warn({ err, userId: input.userId }, 'Failed to resolve recipient email');
        await this.markFailed(doc, toMessage(err));
        return;
      }
    }

    const { subject, html } = renderTemplate(input.type, {
      firstName,
      orderId: input.orderId,
      reason: input.reason,
    });

    try {
      await this.mailer.send({ to: email, subject, html });
      await this.markSent(doc);
    } catch (err: unknown) {
      this.logger.warn({ err, to: email }, 'Failed to send email');
      await this.markFailed(doc, toMessage(err));
    }
  }

  /**
   * Retry a single FAILED notification. Resolves the recipient email via gRPC,
   * re-renders the template, and attempts delivery. Whether it succeeds or
   * fails, `attempts` is incremented and the status is updated accordingly.
   *
   * Called exclusively by the retry job (NTF-7) — callers must ensure
   * `doc.attempts < maxAttempts` before calling.
   */
  async retryOne(doc: NotificationDocument): Promise<void> {
    let email: string;
    let firstName: string;

    try {
      const res = await callGrpc(
        this.userClient.service.getUser({ userId: doc.userId }),
        this.timeouts.standard,
        'user-service',
      );
      if (!res.user) throw new Error(`GetUser returned no user for userId ${doc.userId}`);
      email = res.user.email;
      firstName = res.user.firstName;
    } catch (err: unknown) {
      this.logger.warn({ err, userId: doc.userId, id: String(doc._id) }, 'Retry: failed to resolve recipient email');
      await this.markFailed(doc, toMessage(err));
      return;
    }

    const { subject, html } = renderTemplate(doc.type, {
      firstName,
      orderId: doc.orderId,
      reason: undefined,
    });

    try {
      await this.mailer.send({ to: email, subject, html });
      await this.markSent(doc);
    } catch (err: unknown) {
      this.logger.warn({ err, to: email, id: String(doc._id) }, 'Retry: failed to send email');
      await this.markFailed(doc, toMessage(err));
    }
  }

  /** Find FAILED notifications still eligible for a retry attempt. */
  async findEligibleForRetry(maxAttempts: number): Promise<NotificationDocument[]> {
    return this.model
      .find({ status: NotificationStatus.FAILED, attempts: { $lt: maxAttempts } })
      .limit(100)
      .lean<NotificationDocument[]>()
      .exec();
  }

  private async insertPending(input: SendNotificationInput): Promise<NotificationDocument | null> {
    try {
      return await this.model.create({
        eventId: input.eventId,
        userId: input.userId,
        orderId: input.orderId,
        type: input.type,
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.PENDING,
        attempts: 0,
        lastError: null,
        sentAt: null,
      });
    } catch (err: unknown) {
      if (isDuplicateKey(err)) {
        this.logger.log({ eventId: input.eventId }, 'Duplicate event — notification already handled');
        return null;
      }
      throw err;
    }
  }

  private async markSent(doc: NotificationDocument): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: doc._id },
        {
          $set: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
          $inc: { attempts: 1 },
        },
      );
    } catch (err: unknown) {
      this.logger.error({ err, id: String(doc._id) }, 'Failed to mark notification SENT');
    }
  }

  private async markFailed(doc: NotificationDocument, error: string): Promise<void> {
    try {
      await this.model.updateOne(
        { _id: doc._id },
        {
          $set: { status: NotificationStatus.FAILED, lastError: error },
          $inc: { attempts: 1 },
        },
      );
    } catch (err: unknown) {
      this.logger.error({ err, id: String(doc._id) }, 'Failed to mark notification FAILED');
    }
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Metadata } from '@grpc/grpc-js';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationChannel,
  NotificationDocument,
  NotificationStatus,
  NotificationType,
} from './notification.schema';
import { MailerService } from '../mailer/mailer.service';
import { UserGrpcClient } from '../grpc/user.client';
import { GrpcCallTimeouts, callGrpc } from '../grpc/grpc-call.util';
import { renderTemplate } from '../mailer/templates';
import { CorrelationService } from '../correlation/correlation.service';

const HEADER_USER_ID = 'x-user-id';
const HEADER_USER_ROLE = 'x-user-role';
const HEADER_REQUEST_ID = 'x-request-id';

/** Max FAILED/stale rows the retry job claims per tick. */
export const RETRY_BATCH_SIZE = 100;

/** Upper bound for the per-row retry backoff. */
export const RETRY_MAX_DELAY_MS = 3_600_000;

export interface RetryPolicy {
  /** Total attempts (the first send counts as 1) after which a row stays FAILED. */
  maxAttempts: number;
  /** Wait after the first failure; doubles after each further failure. */
  baseDelayMs: number;
  /** PENDING rows last touched before this are treated as abandoned. */
  staleBefore: Date;
}

/** Backoff before the retry that follows the `attempts`-th failed attempt. */
export function retryDelayMs(attempts: number, baseDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** (attempts - 1), RETRY_MAX_DELAY_MS);
}

export interface SendNotificationInput {
  eventId: string;
  userId: string;
  orderId: string | null;
  type: NotificationType;
  /** Pre-resolved from the event payload — skips the gRPC GetUser call. */
  recipient?: Recipient;
  /** Extra context for specific templates (e.g. cancellation reason). */
  reason?: string;
}

export interface Recipient {
  email: string;
  firstName: string;
}

type NotificationRow = Pick<
  Notification,
  'userId' | 'orderId' | 'type' | 'reason' | 'status' | 'updatedAt'
> & {
  _id: Types.ObjectId;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    private readonly mailer: MailerService,
    private readonly userClient: UserGrpcClient,
    private readonly timeouts: GrpcCallTimeouts,
    private readonly correlation: CorrelationService,
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

    await this.deliver(doc, input.recipient);
  }

  /**
   * Retry a single FAILED (or stale PENDING) notification. The row is claimed
   * first with a compare-and-set on `status` + `updatedAt`, so two retry ticks
   * (or two service instances) never send the same email twice. The recipient
   * is always re-resolved via gRPC — the email may have changed since.
   *
   * Called exclusively by the retry job (NTF-7) with rows from
   * `findEligibleForRetry`.
   */
  async retryOne(doc: NotificationRow): Promise<void> {
    const claimed = await this.model
      .findOneAndUpdate(
        { _id: doc._id, status: doc.status, updatedAt: doc.updatedAt },
        { $set: { status: NotificationStatus.PENDING, updatedAt: new Date() } },
        { returnDocument: 'after', timestamps: false },
      )
      .lean<NotificationRow>()
      .exec();
    if (!claimed) {
      this.logger.debug({ id: String(doc._id) }, 'Retry: row already claimed elsewhere');
      return;
    }
    await this.deliver(claimed);
  }

  /**
   * Find notifications eligible for a retry attempt:
   *
   * - FAILED rows below the attempt limit whose backoff has elapsed — after the
   *   n-th failed attempt a row waits `baseDelayMs * 2^(n-1)` (capped), so a
   *   longer SMTP / user-service outage does not burn every attempt in minutes.
   * - PENDING rows not touched since `staleBefore` — abandoned by a crash
   *   between insert and send. A redelivered Kafka message would hit the unique
   *   index and skip them, so nothing else would ever send them.
   */
  async findEligibleForRetry(policy: RetryPolicy, now = new Date()): Promise<NotificationRow[]> {
    const failedBranches = [];
    for (let attempts = 1; attempts < policy.maxAttempts; attempts++) {
      failedBranches.push({
        status: NotificationStatus.FAILED,
        attempts,
        updatedAt: { $lte: new Date(now.getTime() - retryDelayMs(attempts, policy.baseDelayMs)) },
      });
    }

    return this.model
      .find({
        $or: [
          ...failedBranches,
          {
            status: NotificationStatus.PENDING,
            attempts: { $lt: policy.maxAttempts },
            updatedAt: { $lt: policy.staleBefore },
          },
        ],
      })
      .sort({ updatedAt: 1 })
      .limit(RETRY_BATCH_SIZE)
      .lean<NotificationRow[]>()
      .exec();
  }

  private async deliver(doc: NotificationRow, recipient?: Recipient): Promise<void> {
    let to: Recipient;
    try {
      to = recipient ?? (await this.resolveRecipient(doc.userId));
    } catch (err: unknown) {
      this.logger.warn(
        { err, userId: doc.userId, id: String(doc._id) },
        'Failed to resolve recipient email',
      );
      await this.markFailed(doc, toMessage(err));
      return;
    }

    const { subject, html } = renderTemplate(doc.type, {
      firstName: to.firstName,
      orderId: doc.orderId,
      reason: doc.reason ?? undefined,
    });

    try {
      await this.mailer.send({ to: to.email, subject, html });
    } catch (err: unknown) {
      this.logger.warn({ err, to: to.email, id: String(doc._id) }, 'Failed to send email');
      await this.markFailed(doc, toMessage(err));
      return;
    }
    await this.markSent(doc);
  }

  /**
   * GetUser authorises on identity metadata (caller must be the user or an
   * admin). Like order-service's GetAddress call, this service acts on behalf
   * of the user the notification is for — the private Docker network is the
   * trust boundary (no mTLS), so there is no separate service identity.
   */
  private async resolveRecipient(userId: string): Promise<Recipient> {
    const metadata = new Metadata();
    metadata.set(HEADER_USER_ID, userId);
    metadata.set(HEADER_USER_ROLE, 'CUSTOMER');
    const correlationId = this.correlation.getCorrelationId();
    if (correlationId) metadata.set(HEADER_REQUEST_ID, correlationId);

    const res = await callGrpc(
      this.userClient.service.getUser({ userId }, metadata),
      this.timeouts.standard,
      'user-service',
    );
    if (!res.user) throw new Error(`GetUser returned no user for userId ${userId}`);
    return { email: res.user.email, firstName: res.user.firstName };
  }

  private async insertPending(input: SendNotificationInput): Promise<NotificationRow | null> {
    try {
      const doc = await this.model.create({
        eventId: input.eventId,
        userId: input.userId,
        orderId: input.orderId,
        type: input.type,
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.PENDING,
        attempts: 0,
        lastError: null,
        sentAt: null,
        reason: input.reason ?? null,
      });
      return doc;
    } catch (err: unknown) {
      if (isDuplicateKey(err)) {
        this.logger.log(
          { eventId: input.eventId },
          'Duplicate event — notification already handled',
        );
        return null;
      }
      throw err;
    }
  }

  private async markSent(doc: NotificationRow): Promise<void> {
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

  private async markFailed(doc: NotificationRow, error: string): Promise<void> {
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
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

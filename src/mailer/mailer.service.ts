import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Env } from '../config/env.validation';

const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const SMTP_GREETING_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 30_000;

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: ReturnType<typeof createTransport>;
  private from!: string;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.from = this.config.get('SMTP_FROM', { infer: true });
    this.transporter = createTransport({
      host: this.config.get('SMTP_HOST', { infer: true }),
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      // nodemailer defaults (2 min connect, 10 min socket) would stall a Kafka
      // partition and outlive NOTIFICATION_PENDING_STALE_MS, letting the retry
      // job re-send a message that is still in flight.
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
  }

  async send(opts: SendMailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    this.logger.log({ to: opts.to, subject: opts.subject }, 'Email sent');
  }
}

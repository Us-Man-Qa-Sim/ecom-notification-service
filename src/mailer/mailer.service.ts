import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Env } from '../config/env.validation';

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

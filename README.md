# notification-service

Email notification microservice for the ecom platform. Consumes Kafka events and sends emails via SMTP (Mailpit in development). Stores data in MongoDB via Mongoose. Exposes only an HTTP `/health` endpoint (`:8084`) — no gRPC server, no public API.

## Responsibilities

- Consumes `user.registered`, `order.confirmed`, `order.cancelled`, `order.shipped`, `order.delivered` (consumer group `notification-service`, manual offset commit, retry with backoff, poison messages logged and skipped)
- Resolves the recipient's email via gRPC `GetUser` on user-service (`user.registered` carries the email, so no lookup there). The call carries `x-user-id` = the notified user and `x-user-role` = `CUSTOMER`, because user-service only serves `GetUser` to the user themself or an admin.
- Sends templated HTML emails via nodemailer (Mailpit SMTP); every interpolated value is HTML-escaped
- Idempotent processing: the unique `eventId` index on `notifications` is the inbox — a redelivered event hits `E11000` and is skipped
- Retry job: every `NOTIFICATION_RETRY_INTERVAL_MS`, re-sends `FAILED` notifications below `NOTIFICATION_RETRY_MAX_ATTEMPTS` and recovers `PENDING` rows left behind by a crash (untouched for `NOTIFICATION_PENDING_STALE_MS`). Rows are claimed with a compare-and-set, so concurrent ticks or instances never double-send.

## Delivery guarantee

At-least-once. A crash after the SMTP send but before the row is marked `SENT` leaves it `PENDING`, and the retry job sends it again once it goes stale.

## Development

```bash
npm install
cp .env.example .env
npm run sync-indexes:dev   # build Mongo indexes (incl. the unique eventId inbox index)
npm run start:dev
```

Emails land in Mailpit: <http://localhost:8025>.

## Indexes

Production runs with Mongoose `autoIndex: false`. The Docker entrypoint runs `node dist/scripts/sync-indexes.js` before every start. Without it the unique `eventId` index would not exist, and replayed events would send duplicate emails.

## Environment

See `.env.example` for all configuration with comments.

## Scripts

| Script                                      | Purpose                                            |
| ------------------------------------------- | -------------------------------------------------- |
| `npm run build`                             | Compile to `dist/`                                 |
| `npm run start:dev`                         | Run from source                                    |
| `npm run sync-indexes` / `sync-indexes:dev` | Create/sync Mongo indexes (compiled / from source) |
| `npm test`                                  | Unit tests (Jest + SWC)                            |
| `npm run lint` / `format:check`             | ESLint / Prettier                                  |

# notification-service

Email notification microservice for the ecom platform. Consumes Kafka events and sends emails via SMTP (Mailpit in development). Stores data in MongoDB via Mongoose.

## Responsibilities

- Consumes `user.registered`, `order.confirmed`, `order.cancelled`, `order.shipped`, `order.delivered`
- Fetches user email via gRPC call to user-service
- Sends templated emails via nodemailer (Mailpit SMTP)
- Idempotent processing (eventId unique index)
- Retry logic for failed email sends

## Development

```bash
npm install
npm run start:dev
```

## Environment

See `.env.example` for required configuration.

#!/bin/sh
# Build/update MongoDB indexes before the service starts. Production runs with
# `autoIndex: false`, so the unique `eventId` inbox index (NTF-6) only exists
# because of this step. `syncIndexes()` is idempotent — a fresh DB gets the full
# index set, a warm DB is a no-op — and we fail fast rather than consume events
# without deduplication.
# `exec` replaces the shell so Node becomes PID 1 and receives SIGTERM directly
# for graceful shutdown.
set -e

echo "[entrypoint] syncing MongoDB indexes..."
node dist/scripts/sync-indexes.js

echo "[entrypoint] starting notification-service..."
exec node dist/main.js

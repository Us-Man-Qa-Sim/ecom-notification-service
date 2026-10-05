#!/bin/sh
# exec replaces the shell so Node becomes PID 1 and receives SIGTERM directly
# for graceful shutdown.
set -e

echo "[entrypoint] starting notification-service..."
exec node dist/main.js

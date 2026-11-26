#!/bin/sh
set -e
# Fix volume permissions if needed
chmod 777 /data 2>/dev/null || true
# First run: copy the default model allow-list into the persistent volume so admins can edit it.
if [ ! -f "$MODELS_FILE" ]; then
  cp /app/models.json "$MODELS_FILE"
fi
exec "$@"

#!/bin/sh
set -e
# First run: copy the default model allow-list into the persistent volume so admins can edit it.
if [ ! -f "$MODELS_FILE" ]; then
  cp /app/models.json "$MODELS_FILE"
fi
exec "$@"

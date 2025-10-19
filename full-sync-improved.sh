#!/bin/bash
# Full Sync Migration Script
# Truncates target tables and reloads all data from source

set -e

# Load environment variables
source .env

echo "=== Full Sync Migration ==="
echo "WARNING: This will DELETE all data in target tables!"
echo "Target: ${TARGET_DB_HOST}:${TARGET_DB_PORT}/${TARGET_DB_NAME}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi
echo ""
echo "Step 1: Truncating target tables..."
PGPASSWORD="$TARGET_DB_PASSWORD" psql -h "$TARGET_DB_HOST" -p "$TARGET_DB_PORT" -U "$TARGET_DB_USER" -d "$TARGET_DB_NAME" -f truncate-all-tables.sql
echo "Tables truncated successfully!"
echo ""
echo "Step 2: Running full migration..."
npm run migrate:all
echo ""
echo "=== Full sync completed successfully ==="

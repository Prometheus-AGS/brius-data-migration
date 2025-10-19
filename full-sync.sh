#!/bin/bash
# Full Sync Migration Script
# Truncates target tables and reloads all data from source

set -e

echo "=== Full Sync Migration ===" 
echo "WARNING: This will DELETE all data in target tables!"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "Step 1: Truncating target tables..."
psql "$TARGET_DB_CONNECTION_STRING" -f truncate-all-tables.sql
echo "Tables truncated successfully!"
echo ""
echo "Step 2: Running full migration..."
npm run migrate:all
echo ""
echo "Full sync completed successfully!"

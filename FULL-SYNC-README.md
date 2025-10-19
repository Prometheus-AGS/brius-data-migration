# Full Sync Migration

This solution provides a complete data synchronization between source and target databases by:
1. Truncating all target tables in the correct dependency order
2. Reloading all data fresh from the source database

## Files Created

- `truncate-all-tables.sql` - SQL script that safely deletes all data from target tables
- `full-sync-improved.sh` - Bash script that orchestrates the full sync process

## Usage

```bash
./full-sync-improved.sh
```

The script will:
- Load environment variables from .env file
- Show a warning and ask for confirmation
- Truncate all tables in the correct order
- Run the complete migration using npm run migrate:all

## Safety Features

- Confirmation prompt before destructive operations
- Transaction-based deletion (all-or-nothing)
- Verification query to check tables are empty
- Dependency-aware deletion order
- Script exits on any error (set -e)

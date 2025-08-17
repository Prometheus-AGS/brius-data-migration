# Migration Scripts Guide

This project contains TypeScript-based data migration scripts for migrating data between databases with optimized performance.

## Available Scripts

### Individual Migration Scripts

#### Office Migration
- `npm run migrate:offices` - Migrate office data
- `npm run validate:offices` - Validate office migration results
- `npm run rollback:offices` - Rollback office migration

#### Profile Migration  
- `npm run migrate:profiles` - Migrate profile data
- `npm run validate:profiles` - Validate profile migration results
- `npm run rollback:profiles` - Rollback profile migration

#### Doctor Migration
- `npm run migrate:doctors` - Migrate doctor data
- `npm run validate:doctors` - Validate doctor migration results  
- `npm run rollback:doctors` - Rollback doctor migration

#### Patient Migration
- `npm run migrate:patients` - Migrate patient data
- `npm run validate:patients` - Validate patient migration results  
- `npm run rollback:patients` - Rollback patient migration

#### Orders Migration ⚡ (High-Performance)
- `npm run migrate:orders` - Migrate order data using optimized batch processing
- `npm run validate:orders` - Validate order migration results with comprehensive checks
- `npm run rollback:orders` - Rollback order migration

### Compound Migration Scripts

#### Core Entities (Foundation)
- `npm run migrate:core` - Migrate core entities (offices → profiles → doctors)
- `npm run validate:core` - Validate core entity migrations
- `npm run rollback:core` - Rollback core entities (reverse order)

#### Core + Patients
- `npm run migrate:core-with-patients` - Migrate core entities + patients
- `npm run validate:core-with-patients` - Validate core + patient migrations
- `npm run rollback:core-with-patients` - Rollback core + patients

#### Dependency-Aware Migrations
- `npm run migrate:doctors-with-offices` - Migrate offices first, then doctors
- `npm run migrate:patients-with-deps` - Migrate offices → doctors → patients
- `npm run migrate:orders-with-deps` - Migrate offices → doctors → patients → orders
  - **High-performance orders migration** with comprehensive dependency resolution

#### Complete Migration
- `npm run migrate:all` - Migrate all entities (offices → profiles → doctors → patients → orders)
- `npm run validate:all` - Validate all migrations
- `npm run rollback:all` - Rollback all migrations (reverse order: orders → patients → doctors → profiles → offices)

### Development Scripts
- `npm run dev` - Run office migration in development mode
- `npm run dev:doctors` - Run doctor migration in development mode
- `npm run dev:profiles` - Run profile migration in development mode
- `npm run dev:patients` - Run patient migration in development mode
- `npm run dev:orders` - Run orders migration in development mode

### Utility Scripts
- `npm run build` - Compile TypeScript to JavaScript
- `npm run typecheck` - Type check all files without compilation

## Migration Dependency Chain

The scripts respect the proper migration order based on data dependencies:

1. **Offices** (foundational - no dependencies)
2. **Profiles** (may reference offices)
3. **Doctors** (depends on offices for doctor-office relationships)
4. **Patients** (depends on both offices and doctors for patient-doctor-office relationships)
5. **Orders** (depends on offices, doctors, and patients - most complex relationships)

### Rollback Order

When rolling back, use reverse dependency order to avoid foreign key constraints:

1. **Orders** (rollback first - has most dependencies)
2. **Patients** 
3. **Doctors**
4. **Profiles**
5. **Offices** (rollback last - foundational)

## Orders Migration - High-Performance Features ⚡

The orders migration includes several performance optimizations:

- **Optimized Batch Size**: 5,000 records per batch for optimal throughput
- **Fallback Recovery**: Automatic individual insert fallback for problematic batches
- **Progress Tracking**: Real-time batch progress and throughput reporting
- **Smart Validation**: 1% tolerance for minor count differences
- **Comprehensive Reporting**: Detailed status and course type distribution analysis

### Expected Performance
- **Target**: ~23,272 orders
- **Expected Throughput**: 2,000-5,000 records/second
- **Fallback Support**: Individual insert recovery for edge cases

## Environment Configuration

Make sure to set up your `.env` file with the appropriate database configurations:

```env
# Source Database (Legacy)
SOURCE_DB_HOST=localhost
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=brius_legacy
SOURCE_DB_USER=postgres
SOURCE_DB_PASSWORD=password

# Target Database (New)
TARGET_DB_HOST=localhost
TARGET_DB_PORT=5432
TARGET_DB_NAME=brius_target
TARGET_DB_USER=postgres
TARGET_DB_PASSWORD=password
```

## Migration Strategies

### Option 1: Complete Migration (Recommended)
Migrate everything in optimal order:
```bash
npm run migrate:all
npm run validate:all
```

### Option 2: Core First, Then Data
Build foundation, then add transactional data:
```bash
npm run migrate:core-with-patients
npm run validate:core-with-patients
npm run migrate:orders
npm run validate:orders
```

### Option 3: Orders-Focused Migration
If you only need orders and their dependencies:
```bash
npm run migrate:orders-with-deps
npm run validate:all
```

### Option 4: Incremental Migration
Migrate and validate one entity type at a time:
```bash
# Foundation
npm run migrate:offices
npm run validate:offices

# Core entities
npm run migrate:profiles  
npm run validate:profiles

npm run migrate:doctors
npm run validate:doctors

# Data entities
npm run migrate:patients
npm run validate:patients

# Transactional data (high-performance)
npm run migrate:orders
npm run validate:orders
```

## Performance Expectations

| Migration | Expected Records | Throughput | Duration |
|-----------|------------------|------------|----------|
| Offices | ~100-500 | Fast | < 5s |
| Profiles | ~1,000-5,000 | Fast | < 10s |
| Doctors | ~500-2,000 | Fast | < 5s |
| Patients | ~10,000-50,000 | Medium | 30-60s |
| **Orders** | **~23,272** | **High** | **10-30s** |

## Examples

```bash
# Complete migration with performance monitoring
npm run migrate:all

# Orders-only migration (with dependencies)
npm run migrate:orders-with-deps

# High-performance orders migration only
npm run migrate:orders

# Core entities only (no transactional data)
npm run migrate:core-with-patients

# Validate everything
npm run validate:all

# Development mode for orders (with detailed logging)
npm run dev:orders

# Safe rollback of everything
npm run rollback:all

# Rollback just orders (preserves base data)
npm run rollback:orders

# Run specific command on orders migration
npm run migrate:orders migrate
npm run migrate:orders validate
npm run migrate:orders rollback
```

## Troubleshooting

### Common Issues
- **Foreign Key Constraints**: Ensure proper migration order (dependencies first)
- **Memory Issues**: Orders migration uses batching to prevent memory problems
- **Performance**: Orders migration includes fallback for problematic records
- **Validation Failures**: Use individual validation scripts to identify issues

### Performance Issues
- **Slow Orders Migration**: Check database connection and increase batch size if needed
- **Memory Usage**: Orders migration automatically batches to prevent memory issues
- **Network Latency**: Consider running migrations close to database servers

### Tools
- `npm run typecheck` - Verify all TypeScript files compile correctly
- Check your `.env` file for correct database configurations
- Use individual validation scripts to identify which migration step failed
- Monitor logs for throughput and performance metrics

## Script Categories Summary

| Category | Purpose | Scripts |
|----------|---------|---------|
| **Individual** | Single entity migrations | `migrate:*`, `validate:*`, `rollback:*` |
| **Core** | Foundation entities | `migrate:core`, `validate:core`, `rollback:core` |
| **Core + Patients** | Foundation + patient data | `migrate:core-with-patients`, etc. |
| **Dependency-Aware** | Multi-entity with dependencies | `migrate:*-with-deps` |
| **Complete** | All entities | `migrate:all`, `validate:all`, `rollback:all` |
| **Development** | Testing and debugging | `dev:*` |
| **Utility** | Build and type checking | `build`, `typecheck` |

## Migration Performance Tips

1. **Run migrations close to the database** to minimize network latency
2. **Use complete migrations** (`migrate:all`) for optimal dependency handling
3. **Monitor throughput** during orders migration for performance insights
4. **Validate incrementally** if you suspect issues with specific entities
5. **Use development mode** (`dev:*`) for detailed logging during troubleshooting

The migration system is designed for high performance and reliability, with the orders migration specifically optimized for handling large datasets efficiently.

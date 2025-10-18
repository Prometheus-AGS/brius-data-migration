# Research: Final Database Migration Phase - Remaining Tables

**Date**: 2025-10-18 | **Phase**: 0 - Research & Analysis

## Migration Status Analysis

### Completed Migrations (Available Patterns)

Based on analysis of existing codebase, the following migrations have been successfully completed and provide reusable patterns:

✅ **Core Entity Migrations**:
- `offices` (foundational)
- `profiles` (user accounts)
- `doctors` (with office relationships)
- `patients` (with doctor relationships)
- `orders` (with patient dependencies)
- `cases` (from patients)

✅ **Advanced Migrations**:
- `messages` (70,021 records from dispatch_record)
- `order_states` (5,242 state transitions)
- `order_files` (161,274+ file relationships)
- `case_messages` (5,472 treatment discussions)

### Migration Pattern Analysis

**Successful Pattern Identified**:
```typescript
// Standard migration script structure
interface MigrationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
}

// Common elements:
1. Environment config with source/target connections
2. Lookup mapping builders for foreign keys
3. Batch processing with configurable BATCH_SIZE
4. Error handling with resume capability
5. Progress tracking and reporting
6. Legacy ID preservation in metadata
7. ON CONFLICT handling for idempotency
```

## Remaining Tables Research

### Priority 1 Tables (Critical)

#### 1. Message Attachments
- **Source**: `dispatch_file` table (attachment relationships)
- **Target**: `message_attachments` table
- **Complexity**: Medium - requires message UUID lookups
- **Dependencies**: Existing `messages` and `files` tables
- **Estimated Records**: ~25,000 based on file analysis
- **Pattern**: Similar to `order_files` migration

#### 2. Technicians
- **Source**: `dispatch_technician` or similar table
- **Target**: `technicians` table
- **Complexity**: Medium - requires profile creation/linking
- **Dependencies**: `profiles` table integration
- **Estimated Records**: ~100-500 technician records
- **Pattern**: Similar to `doctors` migration

#### 3. Technician Roles
- **Source**: `dispatch_technician_role` or role assignment table
- **Target**: `technician_roles` table
- **Complexity**: Low-Medium - role mappings
- **Dependencies**: `technicians` table
- **Estimated Records**: ~200-1000 role assignments
- **Pattern**: Simple mapping with foreign key relationships

### Priority 2 Tables (Important)

#### 4. Brackets
- **Source**: `dispatch_bracket` or product specification table
- **Target**: `brackets` table
- **Complexity**: Low-Medium - product specifications
- **Dependencies**: Possible `products` table integration
- **Estimated Records**: ~500-2000 bracket specifications
- **Pattern**: Standard entity migration

#### 5. Order Cases
- **Source**: Relationship table linking orders to cases
- **Target**: `order_cases` table
- **Complexity**: Medium - requires both order and case UUID lookups
- **Dependencies**: `orders` and `cases` tables
- **Estimated Records**: ~10,000-25,000 relationships
- **Pattern**: Junction table migration

#### 6. Purchases
- **Source**: `dispatch_purchase` or financial transaction table
- **Target**: `purchases` table
- **Complexity**: High - financial data integrity critical
- **Dependencies**: Multiple entity relationships (orders, patients, etc.)
- **Estimated Records**: ~5,000-15,000 purchase records
- **Pattern**: Financial data migration with audit trails

#### 7. Treatment Discussions
- **Source**: Discussion or communication table
- **Target**: `treatment_discussions` table
- **Complexity**: Medium - threaded discussions
- **Dependencies**: `cases` and `profiles` tables
- **Estimated Records**: ~2,000-8,000 discussion threads
- **Pattern**: Communication/thread migration

#### 8. Template View Groups
- **Source**: Template access group definitions
- **Target**: `template_view_groups` table
- **Complexity**: Low - group definitions
- **Dependencies**: None or minimal
- **Estimated Records**: ~50-200 groups
- **Pattern**: Simple entity migration

#### 9. Template View Roles
- **Source**: Role-based template access permissions
- **Target**: `template_view_roles` table
- **Complexity**: Low-Medium - permission mappings
- **Dependencies**: `template_view_groups` table
- **Estimated Records**: ~100-500 role mappings
- **Pattern**: Permission/role migration

## Technical Findings

### Existing Script Patterns to Reuse

1. **Database Connection Pattern**: From `migrate-messages-final.ts`
   - Environment variable configuration
   - Source and target client setup
   - Connection management

2. **Lookup Mapping Pattern**: From `migrate-order-files-updated.ts`
   - UUID mapping builders
   - Foreign key resolution
   - Efficient batch lookups

3. **Batch Processing Pattern**: From multiple scripts
   - Configurable BATCH_SIZE
   - Progress tracking
   - Error recovery

4. **Validation Pattern**: From existing validation scripts
   - Pre/post migration checks
   - Data integrity verification
   - Report generation

### Performance Considerations

- **Total Estimated Records**: 50,000-75,000 across all 9 tables
- **Estimated Execution Time**: 2-4 hours based on existing performance
- **Memory Usage**: <512MB based on current patterns
- **Concurrency**: Sequential table migration for dependency management

### Risk Assessment

**Low Risk**:
- Template view groups/roles (simple structures)
- Brackets (product specifications)

**Medium Risk**:
- Message attachments (file relationships)
- Technicians/roles (authentication integration)
- Treatment discussions (threading complexity)

**High Risk**:
- Purchases (financial data integrity)
- Order cases (complex relationship mapping)

## Recommendations

### Migration Order
1. **Phase 1**: Template view groups → Template view roles
2. **Phase 2**: Technicians → Technician roles
3. **Phase 3**: Brackets
4. **Phase 4**: Treatment discussions
5. **Phase 5**: Order cases
6. **Phase 6**: Message attachments
7. **Phase 7**: Purchases (most complex)
8. **Phase 8**: Final validation and reporting

### Script Development Strategy
1. **Reuse Existing Patterns**: Adapt successful migration scripts
2. **Incremental Development**: One table at a time with validation
3. **Comprehensive Testing**: Each script validated before next
4. **Resume Capability**: All scripts support interruption/resume
5. **Audit Trail**: Complete logging and legacy ID preservation

## Next Steps for Phase 1

- Design detailed table schemas and relationships
- Create migration script contracts/interfaces
- Develop quickstart execution guide
- Plan comprehensive validation strategy
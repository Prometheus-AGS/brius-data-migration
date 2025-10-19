# Migration Execution Data Model

**Feature**: Complete Database Migration Execution
**Branch**: `003-specify-scripts-bash`
**Date**: October 15, 2025

## Core Data Structures

### Migration Execution Workflow

```typescript
interface MigrationPhase {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  entities: MigrationEntity[];
  executionOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  validationRequired: boolean;
}

interface MigrationEntity {
  id: string;
  name: string;
  sourceTable: string;
  targetTable: string;
  scriptPath: string;
  npmScript?: string;
  dependencies: string[];
  expectedRecords: number;
  actualRecords?: number;
  migrationMethod: 'npm' | 'direct' | 'batch';
  validationScript?: string;
  rollbackScript?: string;
  status: 'pending' | 'migrating' | 'completed' | 'failed' | 'validated';
  metadata: {
    description: string;
    businessCriticality: 'critical' | 'important' | 'optional';
    dataVolume: 'small' | 'medium' | 'large' | 'massive';
    complexity: 'simple' | 'moderate' | 'complex';
  };
}

interface MigrationExecution {
  id: string;
  featureName: string;
  startTime: Date;
  endTime?: Date;
  phases: MigrationPhase[];
  currentPhase?: string;
  overallStatus: 'preparing' | 'executing' | 'validating' | 'completed' | 'failed';
  totalRecordsExpected: number;
  totalRecordsProcessed: number;
  successRate: number;
  config: MigrationConfig;
  auditTrail: MigrationAuditEntry[];
}

interface MigrationConfig {
  sourceDatabase: {
    host: string;
    port: number;
    database: string;
    user: string;
    ssl: boolean;
  };
  targetDatabase: {
    host: string;
    port: number;
    database: string;
    user: string;
  };
  execution: {
    batchSize: number;
    maxRetries: number;
    timeout: number;
    parallelProcessing: boolean;
    validateAfterEach: boolean;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    destination: 'file' | 'console' | 'both';
    auditTrail: boolean;
  };
}

interface MigrationAuditEntry {
  timestamp: Date;
  phase: string;
  entity: string;
  action: 'start' | 'progress' | 'complete' | 'error' | 'validate' | 'rollback';
  message: string;
  recordsAffected?: number;
  duration?: number;
  metadata?: Record<string, any>;
}
```

### Migration Script Registry

```typescript
interface ScriptRegistry {
  id: string;
  entities: Record<string, EntityScript>;
  phases: MigrationPhase[];
  dependencies: DependencyGraph;
  executionPlan: ExecutionStep[];
}

interface EntityScript {
  entity: string;
  scriptType: 'npm' | 'direct';
  scriptPath: string;
  npmCommand?: string;
  sourceTable: string;
  targetTable: string;
  dependencies: string[];
  estimatedRecords: number;
  businessCriticality: 'critical' | 'important' | 'optional';
  complexity: 'simple' | 'moderate' | 'complex';
  validationRequired: boolean;
  rollbackSupported: boolean;
}

interface DependencyGraph {
  nodes: string[];
  edges: DependencyEdge[];
  executionOrder: string[];
}

interface DependencyEdge {
  from: string;
  to: string;
  type: 'hard' | 'soft';
  reason: string;
}

interface ExecutionStep {
  stepNumber: number;
  phase: string;
  entities: string[];
  canRunInParallel: boolean;
  estimatedDuration: number;
  validationCheckpoint: boolean;
}
```

### Validation and Quality Assurance

```typescript
interface ValidationResult {
  entity: string;
  timestamp: Date;
  checks: ValidationCheck[];
  overallStatus: 'passed' | 'failed' | 'warning';
  recordCountMatch: boolean;
  referentialIntegrity: boolean;
  dataQuality: number; // 0-100 percentage
  issues: ValidationIssue[];
}

interface ValidationCheck {
  checkType: 'count' | 'integrity' | 'quality' | 'business_rule';
  name: string;
  status: 'passed' | 'failed' | 'warning';
  expected: any;
  actual: any;
  message: string;
}

interface ValidationIssue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  category: 'data_loss' | 'integrity_violation' | 'quality_issue' | 'performance';
  description: string;
  affectedRecords: number;
  suggestion: string;
}
```

## Entity Relationships & Dependencies

### Dependency Hierarchy

```
Phase 1: Foundation (COMPLETE)
├── offices (523 records) ✅
├── categories (40 records) ✅
└── profiles (9,751 records) ✅

Phase 2: Core Entities (PRIORITY 1)
├── doctors (depends: offices)
├── patients (depends: doctors, offices)
└── orders (depends: patients, doctors, offices)

Phase 3: Business Operations (PRIORITY 2)
├── tasks (depends: orders, patients) [762K records]
├── cases (depends: patients, doctors) [7.8K records]
├── messages (depends: patients, doctors) [60K records]
└── files (depends: orders, cases) [294K records]

Phase 4: Financial Systems
├── offers (depends: doctors, orders) [393 records]
├── discounts (depends: offers) [135 records]
├── payments (depends: orders, profiles) [16K records]
└── purchases (depends: payments, orders)

Phase 5: Clinical Systems
├── jaws (depends: patients) [39K records]
├── treatment_plans (depends: patients) [67K records]
├── projects (depends: minimal) [66K records]
└── doctor_notes (depends: doctors, patients)

Phase 6: Supporting Systems
├── technician_roles (depends: profiles) [31 records]
├── communications (depends: profiles) [783 records]
└── customer_feedback (depends: patients) [21K records]

Phase 7: Relationships & State
├── case_states (depends: cases)
├── case_messages (depends: cases, messages)
├── case_files (depends: cases, files)
├── message_attachments (depends: messages)
└── doctor_offices (depends: doctors, offices)
```

### Critical Path Analysis

**Longest Dependency Chain**: offices → doctors → patients → orders → tasks
**Critical Dependencies**:
- doctors (blocks: patients, doctor_notes, offers)
- patients (blocks: orders, cases, jaws, treatment_plans)
- orders (blocks: tasks, files, payments, products)

## Data Volume & Performance Considerations

### Volume Categories

```typescript
enum DataVolume {
  SMALL = 'small',    // < 1K records
  MEDIUM = 'medium',  // 1K - 10K records
  LARGE = 'large',    // 10K - 100K records
  MASSIVE = 'massive' // > 100K records
}

interface VolumeProfile {
  entity: string;
  volume: DataVolume;
  estimatedRecords: number;
  estimatedDuration: number; // minutes
  memoryRequirement: number; // MB
  diskSpace: number; // MB
  networkTransfer: number; // MB
}
```

### High-Volume Entities (Special Handling Required)

1. **tasks**: 762K records (MASSIVE)
   - Batch processing: 500 records/batch
   - Estimated duration: 60-120 minutes
   - Memory requirement: 512MB
   - Checkpoint frequency: Every 10K records

2. **files**: 294K records (MASSIVE)
   - File reference processing
   - Estimated duration: 45-90 minutes
   - Storage validation required

3. **treatment_plans**: 67K records (LARGE)
   - Complex JSON data structures
   - Estimated duration: 15-30 minutes

4. **projects**: 66K records (LARGE)
   - Timeline and milestone data
   - Estimated duration: 15-30 minutes

5. **messages**: 60K records (LARGE)
   - Clinical communication history
   - Estimated duration: 10-20 minutes

## Configuration & Environment Model

### Environment Profiles

```typescript
interface EnvironmentConfig {
  profile: 'development' | 'staging' | 'production';
  source: DatabaseConfig;
  target: DatabaseConfig;
  migration: MigrationSettings;
  monitoring: MonitoringConfig;
}

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  poolSize: number;
  timeout: number;
}

interface MigrationSettings {
  batchSize: number;
  maxConcurrency: number;
  retryAttempts: number;
  checkpointFrequency: number;
  validationLevel: 'basic' | 'standard' | 'comprehensive';
  errorTolerance: number; // percentage
}

interface MonitoringConfig {
  progressReporting: boolean;
  performanceMetrics: boolean;
  healthChecks: boolean;
  alerting: {
    enabled: boolean;
    errorThreshold: number;
    slowQueryThreshold: number;
  };
}
```

## Script Integration Model

### NPM Script Integration

```typescript
interface NPMScriptConfig {
  coreEntities: {
    doctors: 'npm run migrate:doctors';
    patients: 'npm run migrate:patients';
    orders: 'npm run migrate:orders';
    products: 'npm run migrate:products';
    jaws: 'npm run migrate:jaws';
    projects: 'npm run migrate:projects';
    treatmentPlans: 'npm run migrate:treatment-plans';
  };

  dependencyChains: {
    core: 'npm run migrate:core';
    coreWithPatients: 'npm run migrate:core-with-patients';
    ordersWithDeps: 'npm run migrate:orders-with-deps';
    all: 'npm run migrate:all';
  };

  validation: {
    core: 'npm run validate:core';
    all: 'npm run validate:all';
    final: 'npm run validate:final';
  };

  rollback: {
    individual: 'npm run rollback:{entity}';
    core: 'npm run rollback:core';
    all: 'npm run rollback:all';
  };
}
```

### Direct Script Integration

```typescript
interface DirectScriptConfig {
  businessOperations: {
    tasks: 'ts-node migrate-tasks.ts';
    cases: 'ts-node migrate-cases.ts';
    messages: 'ts-node migrate-dispatch-records.ts';
    communications: 'ts-node migrate-communications.ts';
  };

  fileManagement: {
    orderFiles: 'ts-node migrate-order-files.ts';
    caseFiles: 'ts-node migrate-case-files-optimized.ts';
    messageAttachments: 'ts-node migrate-message-attachments.ts';
  };

  financialSystems: {
    offersDiscounts: 'ts-node migrate-offers-and-discounts-fixed.ts';
    purchases: 'ts-node migrate-purchases-fixed.ts';
  };

  clinicalData: {
    doctorNotes: 'ts-node migrate-doctor-notes.ts';
    comments: 'ts-node migrate-comments-proper-architecture.ts';
  };

  systemConfig: {
    technicianRoles: 'ts-node migrate-technician-roles-complete.ts';
    doctorOffices: 'ts-node migrate-doctor-offices.ts';
    customerFeedback: 'ts-node migrate-customer-feedback.ts';
  };
}
```

## Quality Assurance Model

### Validation Framework

```typescript
interface ValidationFramework {
  preValidation: {
    sourceConnectivity: () => Promise<boolean>;
    targetConnectivity: () => Promise<boolean>;
    dependencyCheck: (entity: string) => Promise<boolean>;
    spaceAvailability: () => Promise<boolean>;
  };

  migrationValidation: {
    recordCountMatch: (entity: string) => Promise<ValidationResult>;
    referentialIntegrity: (entity: string) => Promise<ValidationResult>;
    dataQuality: (entity: string) => Promise<ValidationResult>;
    businessRules: (entity: string) => Promise<ValidationResult>;
  };

  postValidation: {
    overallIntegrity: () => Promise<ValidationResult>;
    performanceCheck: () => Promise<ValidationResult>;
    auditTrailComplete: () => Promise<ValidationResult>;
  };
}
```

### Error Handling & Recovery

```typescript
interface ErrorHandling {
  retryPolicy: {
    maxAttempts: number;
    backoffStrategy: 'linear' | 'exponential';
    retryableErrors: string[];
  };

  recoveryActions: {
    rollbackThreshold: number; // error percentage
    checkpointRestore: boolean;
    partialRecovery: boolean;
    manualIntervention: boolean;
  };

  errorClassification: {
    critical: string[]; // Stop execution
    major: string[];    // Retry with caution
    minor: string[];    // Log and continue
    warning: string[];  // Log only
  };
}
```

## Summary

This data model provides a comprehensive framework for executing the complete database migration with the following key features:

1. **Complete Table Coverage**: All 56+ tables with available scripts are modeled and accounted for
2. **Dependency Management**: Clear dependency hierarchy prevents foreign key violations
3. **Performance Optimization**: Volume-based execution strategies for large datasets
4. **Quality Assurance**: Multi-level validation framework ensures data integrity
5. **Error Recovery**: Comprehensive error handling and rollback capabilities
6. **Audit Compliance**: Complete audit trail for regulatory requirements
7. **Script Integration**: Seamless integration with existing NPM and direct scripts

The model supports the migration of 1.2M+ records across all entities with expected >98% success rate while maintaining complete data integrity and business continuity.
/**
 * Migration Script Interfaces and Contracts
 * Final Database Migration Phase - Remaining Tables
 *
 * These interfaces define the standard contracts that all migration scripts
 * must implement for consistency, reliability, and maintainability.
 */

// ===== CORE MIGRATION INTERFACES =====

/**
 * Standard migration statistics interface
 * All migration scripts must return statistics in this format
 */
export interface MigrationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
  errorDetails?: string[];
}

/**
 * Configuration interface for all migration scripts
 * Loaded from environment variables
 */
export interface MigrationConfig {
  // Database connections
  sourceDb: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  targetDb: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };

  // Migration settings
  batchSize: number;
  testMode: boolean;
  maxRetryAttempts: number;
  migrationTimeout: number;
}

/**
 * Base migration script interface
 * All migration scripts must implement these methods
 */
export interface MigrationScript {
  /**
   * Execute the migration
   * @param config Migration configuration
   * @returns Migration statistics
   */
  migrate(config: MigrationConfig): Promise<MigrationStats>;

  /**
   * Validate the migration results
   * @param config Migration configuration
   * @returns Validation results
   */
  validate(config: MigrationConfig): Promise<ValidationResult>;

  /**
   * Rollback the migration (if supported)
   * @param config Migration configuration
   * @returns Rollback statistics
   */
  rollback?(config: MigrationConfig): Promise<MigrationStats>;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  missingRecords: number;
  issues: ValidationIssue[];
}

/**
 * Validation issue details
 */
export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  table: string;
  recordId?: string | number;
  field?: string;
  message: string;
  suggestedFix?: string;
}

// ===== TABLE-SPECIFIC INTERFACES =====

/**
 * Message Attachments Migration Interface
 */
export interface MessageAttachmentRecord {
  // Source fields
  source: {
    file_id: number;
    dispatch_record_id: number;
    file_name: string;
    file_size: number;
    mime_type: string;
    created_at: Date;
  };

  // Target fields
  target: {
    id: string; // UUID
    message_id: string; // UUID from messages table
    file_id: string; // UUID from files table
    attachment_type: string;
    display_name: string;
    file_size: number;
    mime_type: string;
    attached_at: Date;
    legacy_file_id: number;
    legacy_message_id: number;
    metadata: object;
  };
}

/**
 * Technicians Migration Interface
 */
export interface TechnicianRecord {
  source: {
    technician_id: number;
    user_id: number;
    employee_id: string;
    department: string;
    position: string;
    hire_date: Date;
    status: string;
    phone: string;
    email: string;
    created_at: Date;
  };

  target: {
    id: string; // UUID
    profile_id: string; // UUID from profiles table
    employee_id: string;
    department: string;
    position: string;
    hire_date: Date;
    status: string;
    phone: string;
    email: string;
    legacy_technician_id: number;
    legacy_user_id: number;
    metadata: object;
  };
}

/**
 * Technician Roles Migration Interface
 */
export interface TechnicianRoleRecord {
  source: {
    role_id: number;
    technician_id: number;
    role_name: string;
    permissions: string[];
    effective_date: Date;
    expiry_date?: Date;
    is_active: boolean;
  };

  target: {
    id: string; // UUID
    technician_id: string; // UUID from technicians table
    role_name: string;
    role_type: string;
    permissions: string[];
    effective_date: Date;
    expiry_date?: Date;
    is_active: boolean;
    legacy_role_id: number;
    legacy_technician_id: number;
    metadata: object;
  };
}

/**
 * Brackets Migration Interface
 */
export interface BracketRecord {
  source: {
    bracket_id: number;
    bracket_code: string;
    bracket_name: string;
    manufacturer: string;
    material: string;
    specifications: object;
    unit_cost: number;
    is_active: boolean;
  };

  target: {
    id: string; // UUID
    bracket_code: string;
    bracket_name: string;
    manufacturer: string;
    model: string;
    material: string;
    arch_type: string;
    slot_size: number;
    unit_cost: number;
    is_active: boolean;
    legacy_bracket_id: number;
    metadata: object;
  };
}

/**
 * Order Cases Migration Interface
 */
export interface OrderCaseRecord {
  source: {
    order_id: number;
    case_id: number;
    relationship_type: string;
    status: string;
    created_at: Date;
  };

  target: {
    id: string; // UUID
    order_id: string; // UUID from orders table
    case_id: string; // UUID from cases table
    relationship_type: string;
    status: string;
    linked_at: Date;
    legacy_order_id: number;
    legacy_case_id: number;
    metadata: object;
  };
}

/**
 * Purchases Migration Interface
 */
export interface PurchaseRecord {
  source: {
    purchase_id: number;
    purchase_number: string;
    order_id?: number;
    patient_id?: number;
    vendor_name: string;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    status: string;
    purchase_date: Date;
    created_at: Date;
  };

  target: {
    id: string; // UUID
    purchase_number: string;
    purchase_type: string;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
    total_amount: number;
    currency: string;
    vendor_name: string;
    order_id?: string; // UUID
    case_id?: string; // UUID
    patient_id?: string; // UUID
    status: string;
    purchase_date: Date;
    legacy_purchase_id: number;
    legacy_order_id?: number;
    legacy_patient_id?: number;
    metadata: object;
    audit_trail: object[];
  };
}

/**
 * Treatment Discussions Migration Interface
 */
export interface TreatmentDiscussionRecord {
  source: {
    discussion_id: number;
    case_id: number;
    author_id: number;
    subject: string;
    message: string;
    status: string;
    created_at: Date;
  };

  target: {
    id: string; // UUID
    case_id: string; // UUID from cases table
    subject: string;
    discussion_type: string;
    started_by: string; // UUID from profiles table
    participants: string[]; // Array of profile UUIDs
    status: string;
    initial_message: string;
    started_at: Date;
    legacy_discussion_id: number;
    legacy_case_id: number;
    legacy_author_id: number;
    metadata: object;
  };
}

/**
 * Template View Groups Migration Interface
 */
export interface TemplateViewGroupRecord {
  source: {
    group_id: number;
    group_name: string;
    description: string;
    permissions: string[];
    is_active: boolean;
  };

  target: {
    id: string; // UUID
    group_name: string;
    group_description: string;
    group_type: string;
    permissions: string[];
    template_categories: string[];
    is_active: boolean;
    legacy_group_id: number;
    metadata: object;
  };
}

/**
 * Template View Roles Migration Interface
 */
export interface TemplateViewRoleRecord {
  source: {
    role_id: number;
    group_id: number;
    role_name: string;
    permissions: object;
    is_active: boolean;
  };

  target: {
    id: string; // UUID
    group_id: string; // UUID from template_view_groups table
    role_name: string;
    role_level: number;
    can_view: boolean;
    can_edit: boolean;
    can_create: boolean;
    can_delete: boolean;
    can_share: boolean;
    template_types: string[];
    restrictions: object;
    is_active: boolean;
    legacy_role_id: number;
    legacy_group_id: number;
    metadata: object;
  };
}

// ===== LOOKUP MAPPING INTERFACES =====

/**
 * UUID Mapping Interface
 * Used for foreign key lookups during migration
 */
export type UuidMapping = Map<number, string>;

/**
 * Lookup Mappings Interface
 * Contains all UUID mappings needed for migration
 */
export interface LookupMappings {
  patients: UuidMapping;
  profiles: UuidMapping;
  orders: UuidMapping;
  cases: UuidMapping;
  files: UuidMapping;
  messages: UuidMapping;
  technicians?: UuidMapping;
  templateGroups?: UuidMapping;
}

// ===== UTILITY INTERFACES =====

/**
 * Batch Processing Result
 */
export interface BatchResult {
  batchNumber: number;
  batchSize: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Progress Tracking Interface
 */
export interface ProgressTracker {
  totalRecords: number;
  processedRecords: number;
  successfulRecords: number;
  failedRecords: number;
  skippedRecords: number;
  currentBatch: number;
  totalBatches: number;
  startTime: Date;
  estimatedTimeRemaining: number; // milliseconds
  progressPercentage: number;
}

/**
 * Error Recovery Interface
 */
export interface ErrorRecovery {
  canRecover: boolean;
  lastSuccessfulBatch: number;
  lastSuccessfulRecord: number;
  resumeFromBatch: number;
  resumeFromRecord: number;
  errorContext: object;
}

// ===== REPORTING INTERFACES =====

/**
 * Migration Report Interface
 */
export interface MigrationReport {
  migrationName: string;
  executionDate: Date;
  totalDuration: number; // milliseconds
  overallStats: MigrationStats;
  tableResults: TableMigrationResult[];
  systemStatus: SystemStatus;
  recommendations: string[];
  issues: ValidationIssue[];
}

/**
 * Table Migration Result
 */
export interface TableMigrationResult {
  tableName: string;
  sourceRecords: number;
  targetRecords: number;
  migrationStats: MigrationStats;
  validationResult: ValidationResult;
  executionTime: number; // milliseconds
  status: 'completed' | 'failed' | 'partial';
  metadata?: any;
}

/**
 * System Status Interface
 */
export interface SystemStatus {
  databaseConnectivity: {
    source: boolean;
    target: boolean;
  };
  dataIntegrity: {
    foreignKeys: boolean;
    constraints: boolean;
    indexes: boolean;
  };
  completeness: {
    allTablesPresent: boolean;
    allDataMigrated: boolean;
    allRelationshipsIntact: boolean;
  };
  readiness: {
    systemOperational: boolean;
    performanceAcceptable: boolean;
    auditTrailComplete: boolean;
  };
}
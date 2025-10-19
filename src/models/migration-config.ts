/**
 * Migration Configuration Model
 * Centralized configuration management for database migrations
 */

export interface MigrationConfig {
  id: string;
  name: string;
  version: string;
  sourceDatabase: DatabaseConfig;
  targetDatabase: DatabaseConfig;
  execution: ExecutionConfig;
  logging: LoggingConfig;
  validation: ValidationConfig;
  rollback: RollbackConfig;
  performance: PerformanceConfig;
  security: SecurityConfig;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schema?: string;
  connectionLimit?: number;
  queryTimeout?: number;
  connectionTimeout?: number;
}

export interface ExecutionConfig {
  batchSize: number;
  maxRetries: number;
  timeout: number; // milliseconds
  parallelProcessing: boolean;
  validateAfterEach: boolean;
  checkpointInterval: number; // number of batches
  resumeFromCheckpoint: boolean;
  dryRun: boolean;
  maxConcurrentJobs: number;
  retryDelay: number; // milliseconds
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  destination: 'file' | 'console' | 'both';
  auditTrail: boolean;
  logDirectory: string;
  logRotation: boolean;
  maxLogFileSize: number; // MB
  maxLogFiles: number;
  structuredLogging: boolean;
}

export interface ValidationConfig {
  enabled: boolean;
  referentialIntegrity: boolean;
  dataTypes: boolean;
  recordCounts: boolean;
  customValidation: boolean;
  tolerancePercentage: number; // acceptable difference in record counts
  validationTimeout: number; // milliseconds
  skipValidationOnError: boolean;
}

export interface RollbackConfig {
  enabled: boolean;
  createBackups: boolean;
  backupLocation: string;
  maxRollbackAttempts: number;
  rollbackTimeout: number; // milliseconds
  preserveOriginalData: boolean;
  rollbackStrategy: 'complete' | 'partial' | 'checkpoint';
}

export interface PerformanceConfig {
  memoryLimit: number; // MB
  cpuLimit: number; // percentage
  diskSpaceLimit: number; // GB
  networkTimeout: number; // milliseconds
  compressionEnabled: boolean;
  indexingStrategy: 'before' | 'after' | 'none';
  vacuumAnalyze: boolean;
}

export interface SecurityConfig {
  encryptionAtRest: boolean;
  encryptionInTransit: boolean;
  auditLogging: boolean;
  accessControl: boolean;
  dataAnonymization: boolean;
  complianceMode: 'HIPAA' | 'GDPR' | 'CCPA' | 'none';
  sensitiveDataHandling: boolean;
}

export class MigrationConfigBuilder {
  private config: Partial<MigrationConfig> = {};

  static create(id: string, name: string, version: string = '1.0.0'): MigrationConfigBuilder {
    const builder = new MigrationConfigBuilder();
    builder.config = {
      id,
      name,
      version,
      execution: {
        batchSize: 500,
        maxRetries: 3,
        timeout: 300000,
        parallelProcessing: false,
        validateAfterEach: true,
        checkpointInterval: 10,
        resumeFromCheckpoint: true,
        dryRun: false,
        maxConcurrentJobs: 1,
        retryDelay: 1000
      },
      logging: {
        level: 'info',
        destination: 'both',
        auditTrail: true,
        logDirectory: './logs',
        logRotation: true,
        maxLogFileSize: 100,
        maxLogFiles: 10,
        structuredLogging: true
      },
      validation: {
        enabled: true,
        referentialIntegrity: true,
        dataTypes: true,
        recordCounts: true,
        customValidation: true,
        tolerancePercentage: 1,
        validationTimeout: 60000,
        skipValidationOnError: false
      },
      rollback: {
        enabled: true,
        createBackups: true,
        backupLocation: './backups',
        maxRollbackAttempts: 3,
        rollbackTimeout: 600000,
        preserveOriginalData: true,
        rollbackStrategy: 'checkpoint'
      },
      performance: {
        memoryLimit: 2048,
        cpuLimit: 80,
        diskSpaceLimit: 10,
        networkTimeout: 30000,
        compressionEnabled: false,
        indexingStrategy: 'after',
        vacuumAnalyze: true
      },
      security: {
        encryptionAtRest: false,
        encryptionInTransit: true,
        auditLogging: true,
        accessControl: true,
        dataAnonymization: false,
        complianceMode: 'none',
        sensitiveDataHandling: false
      }
    };
    return builder;
  }

  sourceDatabase(config: DatabaseConfig): MigrationConfigBuilder {
    this.config.sourceDatabase = config;
    return this;
  }

  targetDatabase(config: DatabaseConfig): MigrationConfigBuilder {
    this.config.targetDatabase = config;
    return this;
  }

  execution(config: Partial<ExecutionConfig>): MigrationConfigBuilder {
    this.config.execution = { ...this.config.execution!, ...config };
    return this;
  }

  logging(config: Partial<LoggingConfig>): MigrationConfigBuilder {
    this.config.logging = { ...this.config.logging!, ...config };
    return this;
  }

  validation(config: Partial<ValidationConfig>): MigrationConfigBuilder {
    this.config.validation = { ...this.config.validation!, ...config };
    return this;
  }

  rollback(config: Partial<RollbackConfig>): MigrationConfigBuilder {
    this.config.rollback = { ...this.config.rollback!, ...config };
    return this;
  }

  performance(config: Partial<PerformanceConfig>): MigrationConfigBuilder {
    this.config.performance = { ...this.config.performance!, ...config };
    return this;
  }

  security(config: Partial<SecurityConfig>): MigrationConfigBuilder {
    this.config.security = { ...this.config.security!, ...config };
    return this;
  }

  build(): MigrationConfig {
    if (!this.config.id || !this.config.name || !this.config.sourceDatabase || !this.config.targetDatabase) {
      throw new Error('Migration config must have id, name, sourceDatabase, and targetDatabase');
    }
    return this.config as MigrationConfig;
  }
}

// Configuration factory for common migration setups
export class MigrationConfigFactory {
  static fromEnvironment(): MigrationConfig {
    return MigrationConfigBuilder
      .create(
        process.env.MIGRATION_ID || 'default-migration',
        process.env.MIGRATION_NAME || 'Database Migration',
        process.env.MIGRATION_VERSION || '1.0.0'
      )
      .sourceDatabase({
        host: process.env.SOURCE_DB_HOST || '',
        port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
        database: process.env.SOURCE_DB_NAME || '',
        user: process.env.SOURCE_DB_USER || '',
        password: process.env.SOURCE_DB_PASSWORD || '',
        ssl: process.env.SOURCE_DB_SSL === 'true',
        schema: process.env.SOURCE_DB_SCHEMA,
        connectionLimit: parseInt(process.env.SOURCE_DB_CONNECTION_LIMIT || '10'),
        queryTimeout: parseInt(process.env.SOURCE_DB_QUERY_TIMEOUT || '30000'),
        connectionTimeout: parseInt(process.env.SOURCE_DB_CONNECTION_TIMEOUT || '10000')
      })
      .targetDatabase({
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '54322'),
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'supabase_admin',
        password: process.env.TARGET_DB_PASSWORD || 'postgres',
        ssl: process.env.TARGET_DB_SSL === 'true',
        schema: process.env.TARGET_DB_SCHEMA,
        connectionLimit: parseInt(process.env.TARGET_DB_CONNECTION_LIMIT || '10'),
        queryTimeout: parseInt(process.env.TARGET_DB_QUERY_TIMEOUT || '30000'),
        connectionTimeout: parseInt(process.env.TARGET_DB_CONNECTION_TIMEOUT || '10000')
      })
      .execution({
        batchSize: parseInt(process.env.BATCH_SIZE || '500'),
        maxRetries: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
        timeout: parseInt(process.env.MIGRATION_TIMEOUT || '300000'),
        parallelProcessing: process.env.PARALLEL_PROCESSING === 'true',
        validateAfterEach: process.env.VALIDATE_AFTER_EACH !== 'false',
        checkpointInterval: parseInt(process.env.CHECKPOINT_INTERVAL || '10'),
        maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '1'),
        retryDelay: parseInt(process.env.RETRY_DELAY || '1000')
      })
      .logging({
        level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
        destination: (process.env.LOG_DESTINATION as 'file' | 'console' | 'both') || 'both',
        auditTrail: process.env.AUDIT_TRAIL !== 'false',
        logDirectory: process.env.LOG_DIRECTORY || './logs',
        maxLogFileSize: parseInt(process.env.MAX_LOG_FILE_SIZE || '100'),
        maxLogFiles: parseInt(process.env.MAX_LOG_FILES || '10')
      })
      .validation({
        tolerancePercentage: parseFloat(process.env.TOLERANCE_PERCENTAGE || '1'),
        validationTimeout: parseInt(process.env.VALIDATION_TIMEOUT || '60000')
      })
      .performance({
        memoryLimit: parseInt(process.env.MEMORY_LIMIT || '2048'),
        cpuLimit: parseInt(process.env.CPU_LIMIT || '80'),
        diskSpaceLimit: parseInt(process.env.DISK_SPACE_LIMIT || '10'),
        compressionEnabled: process.env.COMPRESSION_ENABLED === 'true'
      })
      .security({
        complianceMode: (process.env.COMPLIANCE_MODE as 'HIPAA' | 'GDPR' | 'CCPA' | 'none') || 'none',
        sensitiveDataHandling: process.env.SENSITIVE_DATA_HANDLING === 'true'
      })
      .build();
  }

  static createOptimizedConfig(): MigrationConfig {
    const base = this.fromEnvironment();
    return MigrationConfigBuilder
      .create(base.id, base.name, base.version)
      .sourceDatabase(base.sourceDatabase)
      .targetDatabase(base.targetDatabase)
      .execution({
        ...base.execution,
        batchSize: 1000, // Larger batches for performance
        parallelProcessing: true, // Enable for independent entities
        validateAfterEach: false, // Validate only at phase boundaries
        maxConcurrentJobs: 4 // Allow parallel processing
      })
      .logging({
        ...base.logging,
        level: 'warn', // Reduce verbosity for performance
        structuredLogging: false // Reduce overhead
      })
      .performance({
        ...base.performance,
        memoryLimit: 4096, // Increase memory for larger batches
        compressionEnabled: true, // Enable compression for large datasets
        indexingStrategy: 'none' // Skip indexing during migration
      })
      .build();
  }

  static createHighVolumeConfig(): MigrationConfig {
    const base = this.fromEnvironment();
    return MigrationConfigBuilder
      .create(base.id, base.name, base.version)
      .sourceDatabase(base.sourceDatabase)
      .targetDatabase(base.targetDatabase)
      .execution({
        ...base.execution,
        batchSize: 250, // Smaller batches for stability
        parallelProcessing: false, // Sequential for safety
        validateAfterEach: false, // Skip intermediate validation
        checkpointInterval: 5, // More frequent checkpoints
        maxRetries: 5, // More retry attempts
        retryDelay: 2000 // Longer delay between retries
      })
      .logging({
        ...base.logging,
        maxLogFileSize: 500, // Larger log files
        maxLogFiles: 50 // Keep more logs
      })
      .validation({
        ...base.validation,
        tolerancePercentage: 0.1, // Stricter tolerance
        validationTimeout: 120000 // Longer validation timeout
      })
      .performance({
        ...base.performance,
        memoryLimit: 1024, // Conservative memory usage
        indexingStrategy: 'after', // Index after migration completes
        vacuumAnalyze: true // Optimize database after migration
      })
      .build();
  }

  static createDevelopmentConfig(): MigrationConfig {
    const base = this.fromEnvironment();
    return MigrationConfigBuilder
      .create(base.id, base.name, base.version)
      .sourceDatabase(base.sourceDatabase)
      .targetDatabase(base.targetDatabase)
      .execution({
        ...base.execution,
        batchSize: 100, // Small batches for testing
        dryRun: true, // Enable dry run by default
        validateAfterEach: true, // Validate everything
        maxConcurrentJobs: 1 // Single threaded for debugging
      })
      .logging({
        ...base.logging,
        level: 'debug', // Verbose logging
        destination: 'console' // Console only for development
      })
      .validation({
        ...base.validation,
        skipValidationOnError: false // Never skip validation
      })
      .rollback({
        ...base.rollback,
        createBackups: true, // Always create backups
        preserveOriginalData: true // Keep original data
      })
      .build();
  }
}

// Configuration validation utilities
export const ConfigValidator = {
  validate: (config: MigrationConfig): string[] => {
    const errors: string[] = [];

    // Required fields validation
    if (!config.sourceDatabase.host) errors.push('Source database host is required');
    if (!config.sourceDatabase.database) errors.push('Source database name is required');
    if (!config.targetDatabase.host) errors.push('Target database host is required');
    if (!config.targetDatabase.database) errors.push('Target database name is required');

    // Logical validation
    if (config.execution.batchSize <= 0) errors.push('Batch size must be greater than 0');
    if (config.execution.maxRetries < 0) errors.push('Max retries cannot be negative');
    if (config.validation.tolerancePercentage < 0 || config.validation.tolerancePercentage > 100) {
      errors.push('Tolerance percentage must be between 0 and 100');
    }
    if (config.performance.memoryLimit <= 0) errors.push('Memory limit must be greater than 0');

    // Security validation
    if (config.security.complianceMode !== 'none' && !config.security.auditLogging) {
      errors.push('Audit logging is required for compliance modes');
    }

    return errors;
  },

  isValid: (config: MigrationConfig): boolean => {
    return ConfigValidator.validate(config).length === 0;
  }
};
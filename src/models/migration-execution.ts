/**
 * Migration Execution Model
 * Represents a complete migration execution workflow across all phases
 */

import { MigrationPhase } from './migration-phase';

export interface MigrationExecution {
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

export interface MigrationConfig {
  sourceDatabase: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  targetDatabase: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
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

export interface MigrationAuditEntry {
  timestamp: Date;
  phase: string;
  entity: string;
  action: 'start' | 'progress' | 'complete' | 'error' | 'validate' | 'rollback';
  message: string;
  recordsAffected?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export class MigrationExecutionBuilder {
  private execution: Partial<MigrationExecution> = {};

  static create(id: string, featureName: string): MigrationExecutionBuilder {
    const builder = new MigrationExecutionBuilder();
    builder.execution = {
      id,
      featureName,
      startTime: new Date(),
      phases: [],
      overallStatus: 'preparing',
      totalRecordsExpected: 0,
      totalRecordsProcessed: 0,
      successRate: 0,
      auditTrail: []
    };
    return builder;
  }

  config(cfg: MigrationConfig): MigrationExecutionBuilder {
    this.execution.config = cfg;
    return this;
  }

  addPhase(phase: MigrationPhase): MigrationExecutionBuilder {
    this.execution.phases!.push(phase);
    return this;
  }

  currentPhase(phaseId: string): MigrationExecutionBuilder {
    this.execution.currentPhase = phaseId;
    return this;
  }

  totalRecordsExpected(count: number): MigrationExecutionBuilder {
    this.execution.totalRecordsExpected = count;
    return this;
  }

  updateStatus(status: 'preparing' | 'executing' | 'validating' | 'completed' | 'failed'): MigrationExecutionBuilder {
    this.execution.overallStatus = status;
    return this;
  }

  addAuditEntry(entry: MigrationAuditEntry): MigrationExecutionBuilder {
    this.execution.auditTrail!.push(entry);
    return this;
  }

  updateProgress(processed: number, successful: number): MigrationExecutionBuilder {
    this.execution.totalRecordsProcessed = processed;
    if (this.execution.totalRecordsExpected! > 0) {
      this.execution.successRate = (successful / this.execution.totalRecordsExpected!) * 100;
    }
    return this;
  }

  complete(): MigrationExecutionBuilder {
    this.execution.endTime = new Date();
    this.execution.overallStatus = 'completed';
    return this;
  }

  build(): MigrationExecution {
    if (!this.execution.id || !this.execution.featureName || !this.execution.config) {
      throw new Error('Migration execution must have id, featureName, and config');
    }
    return this.execution as MigrationExecution;
  }
}

// Helper functions for common audit entry patterns
export const AuditEntryHelpers = {
  createStartEntry: (phase: string, entity: string, message: string): MigrationAuditEntry => ({
    timestamp: new Date(),
    phase,
    entity,
    action: 'start',
    message
  }),

  createProgressEntry: (phase: string, entity: string, message: string, recordsAffected: number, duration?: number): MigrationAuditEntry => ({
    timestamp: new Date(),
    phase,
    entity,
    action: 'progress',
    message,
    recordsAffected,
    duration
  }),

  createCompleteEntry: (phase: string, entity: string, message: string, recordsAffected: number, duration: number): MigrationAuditEntry => ({
    timestamp: new Date(),
    phase,
    entity,
    action: 'complete',
    message,
    recordsAffected,
    duration
  }),

  createErrorEntry: (phase: string, entity: string, message: string, metadata?: Record<string, any>): MigrationAuditEntry => ({
    timestamp: new Date(),
    phase,
    entity,
    action: 'error',
    message,
    metadata
  }),

  createValidateEntry: (phase: string, entity: string, message: string, recordsAffected?: number): MigrationAuditEntry => ({
    timestamp: new Date(),
    phase,
    entity,
    action: 'validate',
    message,
    recordsAffected
  })
};

// Configuration factory for common migration setups
export class MigrationConfigFactory {
  static fromEnvironment(): MigrationConfig {
    return {
      sourceDatabase: {
        host: process.env.SOURCE_DB_HOST || '',
        port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
        database: process.env.SOURCE_DB_NAME || '',
        user: process.env.SOURCE_DB_USER || '',
        password: process.env.SOURCE_DB_PASSWORD || '',
        ssl: true
      },
      targetDatabase: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '54322'),
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'supabase_admin',
        password: process.env.TARGET_DB_PASSWORD || 'postgres'
      },
      execution: {
        batchSize: parseInt(process.env.BATCH_SIZE || '500'),
        maxRetries: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
        timeout: parseInt(process.env.MIGRATION_TIMEOUT || '300000'),
        parallelProcessing: false, // Safety first for complex dependencies
        validateAfterEach: true
      },
      logging: {
        level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
        destination: 'both',
        auditTrail: true
      }
    };
  }

  static createOptimizedConfig(): MigrationConfig {
    const base = this.fromEnvironment();
    return {
      ...base,
      execution: {
        ...base.execution,
        batchSize: 1000, // Larger batches for performance
        parallelProcessing: true, // Enable for independent entities
        validateAfterEach: false // Validate only at phase boundaries
      },
      logging: {
        ...base.logging,
        level: 'warn' // Reduce verbosity for performance
      }
    };
  }
}
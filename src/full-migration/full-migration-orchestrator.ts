/**
 * Full Migration Orchestrator Service
 *
 * Central coordination service for comprehensive database migration operations.
 * Manages the complete migration lifecycle including dependency resolution,
 * progress tracking, error recovery, and validation across all entities.
 */

import { Pool, PoolClient } from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  MigrationOrchestration,
  EntityMigrationStatus,
  MigrationCheckpoint,
  MigrationMapping,
  BatchProcessingStatus,
  MigrationError,
  CreateMigrationOrchestrationData,
  CreateEntityMigrationStatusData,
  CreateMigrationCheckpointData,
  CreateMigrationMappingData,
  CreateBatchProcessingStatusData,
  CreateMigrationErrorData,
  MigrationStatus,
  EntityStatus,
  CheckpointType,
  BatchStatus,
  ErrorType,
  MigrationSummaryStats,
  EntitySummaryStats
} from '../models/migration-models';
import { MigrationOrchestrationModel } from '../models/migration-orchestration';
import { EntityMigrationStatusModel } from '../models/entity-migration-status';
import { MigrationCheckpointModel } from '../models/migration-checkpoint';
import { MigrationMappingModel } from '../models/migration-mapping';
import { BatchProcessingStatusModel } from '../models/batch-processing-status';
import { MigrationErrorModel } from '../models/migration-error';
import { AppConfig, getConfig } from '../lib/environment-config';
import { dbConnections } from '../lib/database-connections';
import {
  getLogger,
  Logger,
  DatabaseError,
  ValidationError,
  MigrationBaseError,
  generateCorrelationId
} from '../lib/error-handler';
import { getEventPublisher } from '../lib/event-publisher';
import { MigrationScriptExecutor } from './migration-script-executor';

export interface MigrationEntity {
  name: string;
  sourceTable: string;
  targetTable: string;
  dependencyOrder: number;
  batchSize: number;
  estimatedRecords: number;
  migrationScript?: string;
  validationScript?: string;
}

export interface MigrationPlan {
  entities: MigrationEntity[];
  globalSettings: {
    batchSize: number;
    maxConcurrency: number;
    checkpointFrequency: number;
    timeoutMinutes: number;
  };
  schemaCleanup: {
    enabled: boolean;
    phase: 1 | 2 | 3 | 4;
    columnsToRemove: Record<string, string[]>;
  };
}

export interface MigrationProgress {
  migrationId: string;
  overallStatus: MigrationStatus;
  totalEntities: number;
  completedEntities: number;
  failedEntities: number;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  progressPercentage: number;
  estimatedCompletionTime?: Date;
  currentEntity?: string;
  elapsedTimeMs: number;
  averageThroughput: number;
  errors: MigrationError[];
  checkpoints: MigrationCheckpoint[];
}

export interface MigrationResult {
  migrationId: string;
  success: boolean;
  completedEntities: string[];
  failedEntities: string[];
  totalRecordsProcessed: number;
  totalRecordsFailed: number;
  executionTimeMs: number;
  checkpointsCreated: number;
  errorsEncountered: number;
  rollbackRequired: boolean;
  finalReport: string;
}

export class FullMigrationOrchestrator {
  private sourceDb: Pool;
  private targetDb: Pool;
  private supabase: SupabaseClient;
  private logger: Logger;
  private eventPublisher: EventPublisher;
  private config: AppConfig;

  // Model instances
  private migrationModel: MigrationOrchestrationModel;
  private entityModel: EntityMigrationStatusModel;
  private checkpointModel: MigrationCheckpointModel;
  private mappingModel: MigrationMappingModel;
  private batchModel: BatchProcessingStatusModel;
  private errorModel: MigrationErrorModel;
  private scriptExecutor: MigrationScriptExecutor;

  constructor() {
    this.config = getConfig();
    this.sourceDb = dbConnections.getSourcePool();
    this.targetDb = dbConnections.getDestinationPool();
    this.supabase = dbConnections.getSupabaseClient();
    this.logger = getLogger();
    this.eventPublisher = getEventPublisher();

    // Initialize models
    this.migrationModel = new MigrationOrchestrationModel(this.targetDb);
    this.entityModel = new EntityMigrationStatusModel(this.targetDb);
    this.checkpointModel = new MigrationCheckpointModel(this.targetDb);
    this.mappingModel = new MigrationMappingModel(this.targetDb);
    this.batchModel = new BatchProcessingStatusModel(this.targetDb);
    this.errorModel = new MigrationErrorModel(this.targetDb);
    this.scriptExecutor = new MigrationScriptExecutor();
  }

  /**
   * Initialize the migration orchestrator and ensure all required tables exist
   */
  async initialize(): Promise<void> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Initializing Full Migration Orchestrator', { correlation_id: correlationId });

      // Ensure all model tables exist
      await Promise.all([
        this.migrationModel.ensureTableExists(),
        this.entityModel.ensureTableExists(),
        this.checkpointModel.ensureTableExists(),
        this.mappingModel.ensureTableExists(),
        this.batchModel.ensureTableExists(),
        this.errorModel.ensureTableExists()
      ]);

      // Test database connections
      await dbConnections.testConnections();

      // Validate migration scripts are available
      await this.validateMigrationEnvironment();

      this.logger.info('Full Migration Orchestrator initialized successfully', { correlation_id: correlationId });

      await this.eventPublisher.publishEvent('migration.orchestrator.initialized', {
        correlation_id: correlationId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.logger.error('Failed to initialize Full Migration Orchestrator', error);
      throw new DatabaseError(
        `Orchestrator initialization failed: ${(error as Error).message}`,
        'ORCHESTRATOR_INIT_ERROR',
        { correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Validate migration environment and available scripts
   */
  private async validateMigrationEnvironment(): Promise<void> {
    this.logger.info('Validating migration environment');

    try {
      // Get all available migration scripts
      const availableScripts = await this.scriptExecutor.getAvailableMigrationScripts();

      const scriptSummary = Object.entries(availableScripts)
        .map(([entity, scripts]) => ({
          entity,
          migrate: scripts.migrate,
          validate: scripts.validate,
          rollback: scripts.rollback
        }));

      this.logger.info('Migration scripts availability', {
        scripts: scriptSummary
      });

      // Check for critical missing scripts
      const criticalEntities = ['offices', 'profiles', 'doctors', 'patients'];
      const missingCriticalScripts = criticalEntities.filter(entity =>
        !availableScripts[entity]?.migrate
      );

      if (missingCriticalScripts.length > 0) {
        this.logger.warn('Missing critical migration scripts', {
          missing_entities: missingCriticalScripts
        });
      }

    } catch (error) {
      this.logger.error('Failed to validate migration environment', error as Error);
      // Don't throw here - let initialization continue but log the issue
    }
  }

  /**
   * Validate that required migration scripts exist for the planned entities
   */
  async validateMigrationPlan(plan: MigrationPlan): Promise<{
    valid: boolean;
    missingScripts: string[];
    warnings: string[];
  }> {
    const entityNames = plan.entities.map(e => e.name);
    const validation = await this.scriptExecutor.validateMigrationScripts(entityNames);

    const warnings: string[] = [];

    // Check for entities without validation scripts
    const availableScripts = await this.scriptExecutor.getAvailableMigrationScripts();
    for (const entityName of entityNames) {
      const scripts = availableScripts[entityName];
      if (scripts && !scripts.validate) {
        warnings.push(`No validation script found for ${entityName}`);
      }
      if (scripts && !scripts.rollback) {
        warnings.push(`No rollback script found for ${entityName}`);
      }
    }

    this.logger.info('Migration plan validation completed', {
      valid: validation.valid,
      missing_scripts: validation.missingScripts,
      warnings
    });

    return {
      valid: validation.valid,
      missingScripts: validation.missingScripts,
      warnings
    };
  }

  /**
   * Execute a complete migration based on the provided plan
   */
  async executeMigration(plan: MigrationPlan, resumeFromMigrationId?: string): Promise<MigrationResult> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    let migration: MigrationOrchestration;
    const startTime = Date.now();

    try {
      this.logger.info('Starting full database migration', {
        entities_count: plan.entities.length,
        resume_from: resumeFromMigrationId,
        correlation_id: correlationId
      });

      // Validate migration plan if not resuming
      if (!resumeFromMigrationId) {
        const planValidation = await this.validateMigrationPlan(plan);

        if (!planValidation.valid) {
          throw new ValidationError(
            `Migration plan validation failed. Missing scripts: ${planValidation.missingScripts.join(', ')}`,
            'MIGRATION_PLAN_INVALID',
            { missing_scripts: planValidation.missingScripts }
          );
        }

        if (planValidation.warnings.length > 0) {
          this.logger.warn('Migration plan validation warnings', {
            warnings: planValidation.warnings
          });
        }
      }

      // Create or resume migration orchestration
      if (resumeFromMigrationId) {
        migration = await this.resumeMigration(resumeFromMigrationId);
      } else {
        migration = await this.createMigration(plan);
      }

      await this.eventPublisher.publishEvent('migration.started', {
        migration_id: migration.id,
        entities_count: plan.entities.length,
        correlation_id: correlationId
      });

      // Execute migration phases
      const result = await this.executeMigrationPhases(migration, plan);

      // Final validation and completion
      await this.completeMigration(migration, result);

      const executionTime = Date.now() - startTime;

      this.logger.info('Full database migration completed successfully', {
        migration_id: migration.id,
        execution_time_ms: executionTime,
        entities_processed: result.completedEntities.length,
        correlation_id: correlationId
      });

      await this.eventPublisher.publishEvent('migration.completed', {
        migration_id: migration.id,
        success: result.success,
        execution_time_ms: executionTime,
        correlation_id: correlationId
      });

      return result;

    } catch (error) {
      this.logger.error('Full database migration failed', error);

      if (migration!) {
        await this.handleMigrationFailure(migration, error as Error);
      }

      await this.eventPublisher.publishEvent('migration.failed', {
        migration_id: migration?.id,
        error: (error as Error).message,
        correlation_id: correlationId
      });

      throw error;

    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Create a new migration orchestration
   */
  private async createMigration(plan: MigrationPlan): Promise<MigrationOrchestration> {
    const migrationData: CreateMigrationOrchestrationData = {
      migration_name: `Full Database Migration - ${new Date().toISOString()}`,
      source_database: this.config.source.database,
      target_database: this.config.destination.database,
      total_entities: plan.entities.length,
      migration_config: {
        batchSize: plan.globalSettings.batchSize,
        maxConcurrency: plan.globalSettings.maxConcurrency,
        checkpointFrequency: plan.globalSettings.checkpointFrequency,
        timeoutMinutes: plan.globalSettings.timeoutMinutes,
        schemaCleanup: plan.schemaCleanup
      }
    };

    const migration = await this.migrationModel.create(migrationData);

    // Create entity migration statuses
    const entityPromises = plan.entities.map(entity => {
      const entityData: CreateEntityMigrationStatusData = {
        migration_id: migration.id,
        entity_name: entity.name,
        target_entity: entity.targetTable,
        dependency_order: entity.dependencyOrder,
        records_total: entity.estimatedRecords,
        batch_size: entity.batchSize || plan.globalSettings.batchSize
      };
      return this.entityModel.create(entityData);
    });

    await Promise.all(entityPromises);

    return migration;
  }

  /**
   * Resume an existing migration from checkpoint
   */
  private async resumeMigration(migrationId: string): Promise<MigrationOrchestration> {
    const migration = await this.migrationModel.findById(migrationId);
    if (!migration) {
      throw new ValidationError(
        `Migration ${migrationId} not found`,
        'MIGRATION_NOT_FOUND',
        { migration_id: migrationId }
      );
    }

    if (migration.status === MigrationStatus.COMPLETED) {
      throw new ValidationError(
        `Migration ${migrationId} is already completed`,
        'MIGRATION_ALREADY_COMPLETED',
        { migration_id: migrationId }
      );
    }

    // Update status to running
    return await this.migrationModel.update(migrationId, {
      status: MigrationStatus.RUNNING,
      resumed_at: new Date()
    });
  }

  /**
   * Execute migration phases with dependency management
   */
  private async executeMigrationPhases(
    migration: MigrationOrchestration,
    plan: MigrationPlan
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      migrationId: migration.id,
      success: true,
      completedEntities: [],
      failedEntities: [],
      totalRecordsProcessed: 0,
      totalRecordsFailed: 0,
      executionTimeMs: 0,
      checkpointsCreated: 0,
      errorsEncountered: 0,
      rollbackRequired: false,
      finalReport: ''
    };

    const startTime = Date.now();

    try {
      // Update migration status to running
      await this.migrationModel.update(migration.id, {
        status: MigrationStatus.RUNNING,
        started_at: new Date()
      });

      // Process entities in dependency order
      const entityStatuses = await this.entityModel.list({ migration_id: migration.id });
      const sortedEntities = entityStatuses.sort((a, b) => a.dependency_order - b.dependency_order);

      for (const entityStatus of sortedEntities) {
        try {
          // Check if entity can be processed (dependencies met)
          const canProcess = await this.checkEntityDependencies(migration.id, entityStatus);

          if (!canProcess) {
            this.logger.warn('Entity dependencies not met, skipping', {
              entity_name: entityStatus.entity_name,
              migration_id: migration.id
            });
            continue;
          }

          // Execute entity migration
          const entityResult = await this.executeEntityMigration(entityStatus, plan);

          result.totalRecordsProcessed += entityResult.recordsProcessed;
          result.totalRecordsFailed += entityResult.recordsFailed;
          result.checkpointsCreated += entityResult.checkpointsCreated;

          if (entityResult.success) {
            result.completedEntities.push(entityStatus.entity_name);
          } else {
            result.failedEntities.push(entityStatus.entity_name);
            result.success = false;
          }

          // Run post-migration validation if available
          if (entityResult.success) {
            await this.runPostMigrationValidation(entityStatus, plan);
          }

          // Create checkpoint after each entity
          await this.createEntityCheckpoint(migration.id, entityStatus, entityResult);

        } catch (error) {
          this.logger.error(`Entity migration failed: ${entityStatus.entity_name}`, error);

          await this.recordMigrationError(migration.id, entityStatus.id, error as Error);

          result.failedEntities.push(entityStatus.entity_name);
          result.success = false;
          result.errorsEncountered++;

          // Decide whether to continue or abort
          if (this.shouldAbortMigration(error as Error)) {
            result.rollbackRequired = true;
            break;
          }
        }
      }

      result.executionTimeMs = Date.now() - startTime;
      return result;

    } catch (error) {
      result.success = false;
      result.rollbackRequired = true;
      result.executionTimeMs = Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Check if entity dependencies are satisfied
   */
  private async checkEntityDependencies(migrationId: string, entityStatus: EntityMigrationStatus): Promise<boolean> {
    // Get all entities with lower dependency order
    const dependencies = await this.entityModel.list({
      migration_id: migrationId
    });

    const dependentEntities = dependencies.filter(e =>
      e.dependency_order < entityStatus.dependency_order
    );

    // Check if all dependencies are completed
    const allDependenciesComplete = dependentEntities.every(dep =>
      dep.status === EntityStatus.COMPLETED || dep.status === EntityStatus.SKIPPED
    );

    return allDependenciesComplete;
  }

  /**
   * Execute migration for a single entity
   */
  private async executeEntityMigration(
    entityStatus: EntityMigrationStatus,
    plan: MigrationPlan
  ): Promise<{
    success: boolean;
    recordsProcessed: number;
    recordsFailed: number;
    checkpointsCreated: number;
  }> {
    const entityConfig = plan.entities.find(e => e.name === entityStatus.entity_name);
    if (!entityConfig) {
      throw new ValidationError(
        `Entity configuration not found: ${entityStatus.entity_name}`,
        'ENTITY_CONFIG_NOT_FOUND'
      );
    }

    // Update entity status to running
    await this.entityModel.update(entityStatus.id, {
      status: EntityStatus.RUNNING,
      started_at: new Date()
    });

    let totalProcessed = 0;
    let totalFailed = 0;
    let checkpointsCreated = 0;

    try {
      // Check for existing checkpoint to resume from
      const lastCheckpoint = await this.checkpointModel.findLatestResumableCheckpoint(
        entityStatus.migration_id,
        entityStatus.entity_name
      );

      let lastProcessedId = lastCheckpoint?.last_source_id;
      let batchNumber = lastCheckpoint ? lastCheckpoint.batch_number + 1 : 0;

      // Execute batch processing
      while (true) {
        const batchResult = await this.executeBatch(
          entityStatus,
          entityConfig,
          batchNumber,
          lastProcessedId
        );

        totalProcessed += batchResult.recordsProcessed;
        totalFailed += batchResult.recordsFailed;

        // Update entity progress
        await this.entityModel.update(entityStatus.id, {
          records_processed: totalProcessed,
          records_failed: totalFailed,
          last_processed_id: batchResult.lastProcessedId
        });

        // Create checkpoint if needed
        if (batchNumber % plan.globalSettings.checkpointFrequency === 0) {
          await this.createBatchCheckpoint(entityStatus, batchNumber, totalProcessed);
          checkpointsCreated++;
        }

        // Check if batch processing is complete
        if (batchResult.recordsProcessed === 0) {
          break;
        }

        lastProcessedId = batchResult.lastProcessedId;
        batchNumber++;
      }

      // Mark entity as completed
      await this.entityModel.update(entityStatus.id, {
        status: EntityStatus.COMPLETED,
        completed_at: new Date()
      });

      return {
        success: true,
        recordsProcessed: totalProcessed,
        recordsFailed: totalFailed,
        checkpointsCreated
      };

    } catch (error) {
      // Mark entity as failed
      await this.entityModel.update(entityStatus.id, {
        status: EntityStatus.FAILED,
        completed_at: new Date()
      });

      throw error;
    }
  }

  /**
   * Execute a single batch for an entity
   */
  private async executeBatch(
    entityStatus: EntityMigrationStatus,
    entityConfig: MigrationEntity,
    batchNumber: number,
    lastProcessedId?: string
  ): Promise<{
    recordsProcessed: number;
    recordsFailed: number;
    lastProcessedId?: string;
  }> {
    // Create batch processing status
    const batchStatus = await this.batchModel.create({
      entity_status_id: entityStatus.id,
      batch_number: batchNumber,
      batch_size: entityStatus.batch_size,
      status: BatchStatus.PROCESSING
    });

    const startTime = Date.now();

    try {
      // Execute the actual migration logic
      // This would typically call existing migration scripts or implement batch logic
      const batchResult = await this.executeMigrationBatch(
        entityConfig,
        entityStatus.batch_size,
        lastProcessedId
      );

      const processingTime = Date.now() - startTime;

      // Update batch status
      await this.batchModel.update(batchStatus.id, {
        status: BatchStatus.COMPLETED,
        records_successful: batchResult.recordsProcessed,
        records_failed: batchResult.recordsFailed,
        completed_at: new Date(),
        processing_duration_ms: processingTime
      });

      return batchResult;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      // Update batch status as failed
      await this.batchModel.update(batchStatus.id, {
        status: BatchStatus.FAILED,
        completed_at: new Date(),
        processing_duration_ms: processingTime,
        error_summary: (error as Error).message
      });

      throw error;
    }
  }

  /**
   * Execute the actual migration batch logic using existing migration scripts
   */
  private async executeMigrationBatch(
    entityConfig: MigrationEntity,
    batchSize: number,
    lastProcessedId?: string
  ): Promise<{
    recordsProcessed: number;
    recordsFailed: number;
    lastProcessedId?: string;
  }> {
    this.logger.info('Executing migration batch', {
      entity: entityConfig.name,
      batch_size: batchSize,
      last_processed_id: lastProcessedId
    });

    try {
      // Execute the migration script with batch processing options
      const result = await this.scriptExecutor.executeMigrationScript(entityConfig, {
        batchSize,
        lastProcessedId,
        timeout: 600000, // 10 minutes per batch
        additionalArgs: []
      });

      if (!result.success) {
        this.logger.error(`Migration batch failed for ${entityConfig.name}`, {
          error_message: result.errorMessage,
          stderr: result.stderr
        });

        throw new DatabaseError(
          `Migration batch failed: ${result.errorMessage}`,
          'MIGRATION_BATCH_ERROR',
          {
            entity: entityConfig.name,
            batch_size: batchSize,
            stderr: result.stderr,
            exit_code: result.exitCode
          }
        );
      }

      this.logger.info('Migration batch completed successfully', {
        entity: entityConfig.name,
        records_processed: result.recordsProcessed,
        records_failed: result.recordsFailed,
        last_processed_id: result.lastProcessedId
      });

      return {
        recordsProcessed: result.recordsProcessed,
        recordsFailed: result.recordsFailed,
        lastProcessedId: result.lastProcessedId
      };

    } catch (error) {
      this.logger.error(`Migration batch execution failed for ${entityConfig.name}`, error as Error);

      // Return failed result instead of throwing to allow graceful handling
      return {
        recordsProcessed: 0,
        recordsFailed: batchSize, // Assume all records in batch failed
        lastProcessedId
      };
    }
  }

  /**
   * Run post-migration validation for an entity
   */
  private async runPostMigrationValidation(
    entityStatus: EntityMigrationStatus,
    plan: MigrationPlan
  ): Promise<void> {
    const entityConfig = plan.entities.find(e => e.name === entityStatus.entity_name);
    if (!entityConfig) {
      return;
    }

    try {
      this.logger.info('Running post-migration validation', {
        entity: entityStatus.entity_name,
        migration_id: entityStatus.migration_id
      });

      const validationResult = await this.scriptExecutor.executeValidationScript(
        entityConfig,
        entityStatus.migration_id
      );

      if (!validationResult.success) {
        this.logger.warn('Post-migration validation failed', {
          entity: entityStatus.entity_name,
          message: validationResult.message,
          details: validationResult.details
        });

        // Record validation error but don't fail the migration
        await this.recordMigrationError(
          entityStatus.migration_id,
          entityStatus.id,
          new ValidationError(
            `Post-migration validation failed: ${validationResult.message}`,
            'VALIDATION_FAILED',
            { entity: entityStatus.entity_name, details: validationResult.details }
          )
        );
      } else {
        this.logger.info('Post-migration validation passed', {
          entity: entityStatus.entity_name,
          message: validationResult.message
        });
      }

    } catch (error) {
      this.logger.error(`Post-migration validation error for ${entityStatus.entity_name}`, error as Error);

      // Record validation error but don't fail the migration
      await this.recordMigrationError(
        entityStatus.migration_id,
        entityStatus.id,
        error as Error
      );
    }
  }

  /**
   * Create a batch checkpoint
   */
  private async createBatchCheckpoint(
    entityStatus: EntityMigrationStatus,
    batchNumber: number,
    recordsProcessed: number
  ): Promise<void> {
    const checkpointData: CreateMigrationCheckpointData = {
      migration_id: entityStatus.migration_id,
      entity_name: entityStatus.entity_name,
      checkpoint_type: CheckpointType.BATCH_COMPLETION,
      batch_number: batchNumber,
      records_processed: recordsProcessed,
      system_state: {
        entity_status_id: entityStatus.id,
        timestamp: new Date().toISOString(),
        batch_size: entityStatus.batch_size
      }
    };

    await this.checkpointModel.create(checkpointData);
  }

  /**
   * Create an entity completion checkpoint
   */
  private async createEntityCheckpoint(
    migrationId: string,
    entityStatus: EntityMigrationStatus,
    result: any
  ): Promise<void> {
    const checkpointData: CreateMigrationCheckpointData = {
      migration_id: migrationId,
      entity_name: entityStatus.entity_name,
      checkpoint_type: CheckpointType.ENTITY_COMPLETION,
      batch_number: 0,
      records_processed: result.recordsProcessed,
      system_state: {
        entity_status_id: entityStatus.id,
        completion_timestamp: new Date().toISOString(),
        success: result.success,
        records_failed: result.recordsFailed
      }
    };

    await this.checkpointModel.create(checkpointData);
  }

  /**
   * Record a migration error
   */
  private async recordMigrationError(
    migrationId: string,
    entityStatusId: string,
    error: Error
  ): Promise<void> {
    const errorData: CreateMigrationErrorData = {
      migration_id: migrationId,
      entity_status_id: entityStatusId,
      error_type: this.categorizeError(error),
      error_code: error.name || 'UNKNOWN_ERROR',
      error_message: error.message,
      source_data: {},
      context: {
        timestamp: new Date().toISOString(),
        error_stack: error.stack
      },
      stack_trace: error.stack
    };

    await this.errorModel.create(errorData);
  }

  /**
   * Categorize error type
   */
  private categorizeError(error: Error): ErrorType {
    if (error instanceof DatabaseError) {
      return ErrorType.CONNECTION_ERROR;
    }
    if (error instanceof ValidationError) {
      return ErrorType.DATA_VALIDATION;
    }
    if (error.message.includes('timeout')) {
      return ErrorType.TIMEOUT;
    }
    if (error.message.includes('constraint')) {
      return ErrorType.CONSTRAINT_VIOLATION;
    }
    return ErrorType.UNKNOWN;
  }

  /**
   * Determine if migration should be aborted
   */
  private shouldAbortMigration(error: Error): boolean {
    // Abort on critical system errors, continue on data validation errors
    return error instanceof DatabaseError ||
           error.message.includes('connection') ||
           error.message.includes('timeout');
  }

  /**
   * Complete the migration process
   */
  private async completeMigration(
    migration: MigrationOrchestration,
    result: MigrationResult
  ): Promise<void> {
    const finalStatus = result.success ? MigrationStatus.COMPLETED : MigrationStatus.FAILED;

    await this.migrationModel.update(migration.id, {
      status: finalStatus,
      completed_at: new Date(),
      completion_summary: {
        total_entities_processed: result.completedEntities.length,
        total_entities_failed: result.failedEntities.length,
        total_records_processed: result.totalRecordsProcessed,
        total_records_failed: result.totalRecordsFailed,
        execution_time_ms: result.executionTimeMs,
        checkpoints_created: result.checkpointsCreated,
        errors_encountered: result.errorsEncountered
      }
    });

    // Generate final report
    result.finalReport = await this.generateMigrationReport(migration.id);
  }

  /**
   * Handle migration failure
   */
  private async handleMigrationFailure(migration: MigrationOrchestration, error: Error): Promise<void> {
    await this.migrationModel.update(migration.id, {
      status: MigrationStatus.FAILED,
      completed_at: new Date(),
      failure_reason: error.message
    });

    // Create error recovery checkpoint
    await this.checkpointModel.create({
      migration_id: migration.id,
      entity_name: 'SYSTEM',
      checkpoint_type: CheckpointType.ERROR_RECOVERY,
      batch_number: 0,
      records_processed: 0,
      system_state: {
        error_message: error.message,
        error_stack: error.stack,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get migration progress
   */
  async getMigrationProgress(migrationId: string): Promise<MigrationProgress> {
    const migration = await this.migrationModel.findById(migrationId);
    if (!migration) {
      throw new ValidationError(`Migration ${migrationId} not found`, 'MIGRATION_NOT_FOUND');
    }

    const summary = await this.entityModel.getMigrationProgressSummary(migrationId);
    const errors = await this.errorModel.list({ migration_id: migrationId, limit: 10 });
    const checkpoints = await this.checkpointModel.list({ migration_id: migrationId, limit: 5 });

    const elapsedTime = migration.started_at ?
      Date.now() - migration.started_at.getTime() : 0;

    return {
      migrationId: migration.id,
      overallStatus: migration.status,
      totalEntities: summary.total_entities,
      completedEntities: summary.completed_entities,
      failedEntities: summary.failed_entities,
      totalRecords: summary.total_records,
      processedRecords: summary.processed_records,
      failedRecords: summary.failed_records,
      progressPercentage: summary.overall_progress_percentage,
      estimatedCompletionTime: summary.estimated_completion_time,
      elapsedTimeMs: elapsedTime,
      averageThroughput: summary.average_throughput,
      errors,
      checkpoints
    };
  }

  /**
   * Generate comprehensive migration report
   */
  async generateMigrationReport(migrationId: string): Promise<string> {
    const migration = await this.migrationModel.findById(migrationId);
    const summary = await this.entityModel.getMigrationProgressSummary(migrationId);
    const errorStats = await this.errorModel.getStatistics(migrationId);
    const checkpointStats = await this.checkpointModel.getStatistics(migrationId);

    const report = `
# Migration Report
**Migration ID:** ${migrationId}
**Status:** ${migration?.status}
**Started:** ${migration?.started_at?.toISOString()}
**Completed:** ${migration?.completed_at?.toISOString()}

## Summary
- **Total Entities:** ${summary.total_entities}
- **Completed Entities:** ${summary.completed_entities}
- **Failed Entities:** ${summary.failed_entities}
- **Total Records:** ${summary.total_records}
- **Processed Records:** ${summary.processed_records}
- **Failed Records:** ${summary.failed_records}
- **Success Rate:** ${((summary.processed_records / summary.total_records) * 100).toFixed(2)}%

## Performance
- **Average Throughput:** ${summary.average_throughput.toFixed(2)} records/second
- **Checkpoints Created:** ${checkpointStats.total_checkpoints}
- **Errors Encountered:** ${errorStats.total_errors}

## Error Analysis
${errorStats.most_common_errors.map(error =>
  `- **${error.error_code}:** ${error.count} occurrences (${error.percentage}%)`
).join('\n')}
    `.trim();

    return report;
  }

  /**
   * Rollback migration using existing rollback scripts
   */
  async rollbackMigration(migrationId: string): Promise<boolean> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Starting migration rollback', { migration_id: migrationId });

      // Get migration and entity statuses
      const migration = await this.migrationModel.findById(migrationId);
      if (!migration) {
        throw new ValidationError(`Migration ${migrationId} not found`, 'MIGRATION_NOT_FOUND');
      }

      const entities = await this.entityModel.findByMigrationId(migrationId);
      const completedEntities = entities
        .filter(e => e.status === EntityStatus.COMPLETED)
        .sort((a, b) => b.dependency_order - a.dependency_order); // Reverse order for rollback

      let rollbackSuccess = true;
      const rollbackResults: { entity: string; success: boolean; error?: string }[] = [];

      // Update migration status
      await this.migrationModel.update(migrationId, {
        status: MigrationStatus.ROLLING_BACK
      });

      // Execute rollback for each completed entity in reverse dependency order
      for (const entityStatus of completedEntities) {
        try {
          this.logger.info('Rolling back entity', {
            entity: entityStatus.entity_name,
            migration_id: migrationId
          });

          // Create basic entity config for rollback
          const entityConfig: MigrationEntity = {
            name: entityStatus.entity_name,
            sourceTable: `dispatch_${entityStatus.entity_name}`,
            targetTable: entityStatus.target_entity,
            dependencyOrder: entityStatus.dependency_order,
            batchSize: entityStatus.batch_size,
            estimatedRecords: entityStatus.records_total
          };

          // Check if rollback is supported
          const supportsRollback = await this.scriptExecutor.supportsRollback(entityConfig);

          if (!supportsRollback) {
            this.logger.warn('Rollback not supported for entity', {
              entity: entityStatus.entity_name
            });
            rollbackResults.push({
              entity: entityStatus.entity_name,
              success: false,
              error: 'Rollback script not available'
            });
            continue;
          }

          // Execute rollback
          const rollbackResult = await this.scriptExecutor.executeRollback(entityConfig);

          if (rollbackResult.success) {
            // Update entity status
            await this.entityModel.update(entityStatus.id, {
              status: EntityStatus.PENDING,
              records_processed: 0,
              records_failed: 0
            });

            rollbackResults.push({
              entity: entityStatus.entity_name,
              success: true
            });

            this.logger.info('Entity rollback completed', {
              entity: entityStatus.entity_name
            });
          } else {
            rollbackSuccess = false;
            rollbackResults.push({
              entity: entityStatus.entity_name,
              success: false,
              error: rollbackResult.errorMessage
            });

            this.logger.error('Entity rollback failed', {
              entity: entityStatus.entity_name,
              error: rollbackResult.errorMessage
            });
          }

        } catch (error) {
          rollbackSuccess = false;
          rollbackResults.push({
            entity: entityStatus.entity_name,
            success: false,
            error: (error as Error).message
          });

          this.logger.error(`Rollback failed for entity ${entityStatus.entity_name}`, error as Error);
        }
      }

      // Update migration status based on rollback results
      const finalStatus = rollbackSuccess ? MigrationStatus.PENDING : MigrationStatus.FAILED;
      await this.migrationModel.update(migrationId, {
        status: finalStatus,
        rollback_completed: rollbackSuccess,
        rollback_summary: {
          total_entities_rolled_back: rollbackResults.filter(r => r.success).length,
          failed_rollbacks: rollbackResults.filter(r => !r.success).length,
          rollback_results: rollbackResults
        }
      });

      await this.eventPublisher.publishEvent('migration.rollback.completed', {
        migration_id: migrationId,
        success: rollbackSuccess,
        results: rollbackResults,
        correlation_id: correlationId
      });

      this.logger.info('Migration rollback completed', {
        migration_id: migrationId,
        success: rollbackSuccess,
        successful_rollbacks: rollbackResults.filter(r => r.success).length,
        failed_rollbacks: rollbackResults.filter(r => !r.success).length
      });

      return rollbackSuccess;

    } catch (error) {
      this.logger.error('Migration rollback failed', error as Error);

      await this.eventPublisher.publishEvent('migration.rollback.failed', {
        migration_id: migrationId,
        error: (error as Error).message,
        correlation_id: correlationId
      });

      throw error;

    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up Full Migration Orchestrator resources');
    // Cleanup would be handled by DatabaseConnections
  }
}
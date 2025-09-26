// Differential Migration Service
// Coordinates the differential migration process using various specialized services

import { Pool } from 'pg';
import { MigrationAnalyzerService } from './migration-analyzer';
import { DataComparatorService } from './data-comparator';
import { ConflictResolverService } from './conflict-resolver';
import { SyncLoggerService, OperationLogger } from './sync-logger';
import {
  DifferentialMigrationOptions,
  DifferentialMigrationResponse,
  OperationType,
  ConflictResolution,
  MigrationCheckpoint,
  MigrationStats,
  MigrationError
} from '../types/migration-types';

export interface DifferentialMigrationPlan {
  operationId: string;
  entities: string[];
  estimatedRecords: number;
  analysisResults: any;
  comparisonResults: any;
  executionSteps: string[];
  riskAssessment: string;
}

export interface ExecutionContext {
  operationId: string;
  logger: OperationLogger;
  startTime: Date;
  checkpoints: Map<string, MigrationCheckpoint>;
  stats: MigrationStats;
  errors: MigrationError[];
}

export class DifferentialMigrationService {
  private migrationAnalyzer: MigrationAnalyzerService;
  private dataComparator: DataComparatorService;
  private conflictResolver: ConflictResolverService;
  private logger: SyncLoggerService;

  constructor(
    private sourceDb: Pool,
    private targetDb: Pool,
    private projectRoot: string = process.cwd()
  ) {
    this.migrationAnalyzer = new MigrationAnalyzerService(targetDb, projectRoot);
    this.dataComparator = new DataComparatorService(sourceDb, targetDb, projectRoot);
    this.conflictResolver = new ConflictResolverService(sourceDb, targetDb, projectRoot);
    this.logger = new SyncLoggerService({
      logDir: `${projectRoot}/logs`,
      enableConsole: true,
      structuredFormat: true
    });
  }

  /**
   * Execute differential migration with full workflow
   */
  async executeDifferentialMigration(
    options: DifferentialMigrationOptions
  ): Promise<DifferentialMigrationResponse> {
    const operationId = this.generateOperationId();
    const operationLogger = this.logger.startOperation(
      OperationType.DIFFERENTIAL_MIGRATION,
      options.entities.join(','),
      operationId
    );

    const context: ExecutionContext = {
      operationId,
      logger: operationLogger,
      startTime: new Date(),
      checkpoints: new Map(),
      stats: { totalProcessed: 0, successful: 0, failed: 0, skipped: 0 },
      errors: []
    };

    try {
      operationLogger.info('Starting differential migration', {
        entities: options.entities,
        batch_size: options.batchSize,
        dry_run: options.dryRun,
        conflict_resolution: options.conflictResolution
      });

      // Step 1: Analyze existing migration scripts
      operationLogger.info('Step 1: Analyzing existing migration scripts');
      const analysisResults = await this.analyzeMigrationScripts(context);

      // Step 2: Compare data between source and target
      operationLogger.info('Step 2: Comparing source and target data');
      const comparisonResults = await this.compareData(options, context);

      // Step 3: Resolve conflicts if any found
      if (comparisonResults.missing_records > 0 || comparisonResults.conflicted_records > 0) {
        operationLogger.info('Step 3: Resolving data conflicts');
        await this.resolveConflicts(options, context);
      } else {
        operationLogger.info('Step 3: No conflicts found, skipping resolution');
        context.stats.skipped = comparisonResults.identical_records;
      }

      // Step 4: Validate results if not dry run
      if (!options.dryRun && !options.skipValidation) {
        operationLogger.info('Step 4: Validating migration results');
        await this.validateResults(options, context);
      }

      // Complete operation
      const duration = Date.now() - context.startTime.getTime();
      operationLogger.complete(
        context.stats.totalProcessed,
        context.stats.successful,
        context.stats.failed
      );

      return {
        operationId,
        totalProcessed: context.stats.totalProcessed,
        successful: context.stats.successful,
        failed: context.stats.failed,
        skipped: context.stats.skipped,
        duration,
        checkpoints: Array.from(context.checkpoints.values()),
        errors: context.errors
      };

    } catch (error) {
      operationLogger.fail(error as Error, context.stats.totalProcessed);
      throw new MigrationError(
        `Differential migration failed: ${error.message}`,
        options.entities.join(','),
        operationId
      );
    }
  }

  /**
   * Create migration plan without executing
   */
  async createMigrationPlan(
    options: DifferentialMigrationOptions
  ): Promise<DifferentialMigrationPlan> {
    const operationId = this.generateOperationId();
    const operationLogger = this.logger.startOperation(
      OperationType.DIFFERENTIAL_MIGRATION,
      'planning',
      operationId
    );

    try {
      operationLogger.info('Creating differential migration plan', {
        entities: options.entities
      });

      // Analyze existing scripts
      const analysisResults = await this.migrationAnalyzer.analyzeExistingScripts();

      // Compare data to understand scope
      const comparisonResults = await this.dataComparator.compareAllEntities({
        entityTypes: options.entities,
        batchSize: 1000 // Small batch for planning
      });

      // Estimate work
      const estimatedRecords = comparisonResults.missing_records + comparisonResults.conflicted_records;

      // Create execution plan
      const executionSteps = this.generateExecutionSteps(analysisResults, comparisonResults, options);

      // Assess risks
      const riskAssessment = this.assessRisks(analysisResults, comparisonResults, options);

      operationLogger.info('Migration plan created', {
        estimated_records: estimatedRecords,
        execution_steps: executionSteps.length,
        risk_level: riskAssessment
      });

      return {
        operationId,
        entities: options.entities,
        estimatedRecords,
        analysisResults,
        comparisonResults,
        executionSteps,
        riskAssessment
      };

    } catch (error) {
      operationLogger.error('Failed to create migration plan', error as Error);
      throw new MigrationError(`Migration planning failed: ${error.message}`);
    }
  }

  /**
   * Resume differential migration from checkpoint
   */
  async resumeDifferentialMigration(
    checkpointId: string,
    options: DifferentialMigrationOptions
  ): Promise<DifferentialMigrationResponse> {
    const operationLogger = this.logger.startOperation(
      OperationType.DIFFERENTIAL_MIGRATION,
      'resume',
      checkpointId
    );

    try {
      operationLogger.info('Resuming differential migration', {
        checkpoint_id: checkpointId,
        entities: options.entities
      });

      // Get checkpoint status
      const checkpointInfo = await this.migrationAnalyzer.getCheckpointStatus();
      const resumableCheckpoints = checkpointInfo.filter(c => c.can_resume);

      if (resumableCheckpoints.length === 0) {
        throw new MigrationError('No resumable checkpoints found');
      }

      // Resume from the most recent checkpoint
      const latestCheckpoint = resumableCheckpoints[0];
      operationLogger.info('Resuming from checkpoint', {
        entity_type: latestCheckpoint.entity_type,
        progress: latestCheckpoint.progress_percentage
      });

      // Continue migration from checkpoint
      const context: ExecutionContext = {
        operationId: checkpointId,
        logger: operationLogger,
        startTime: new Date(),
        checkpoints: new Map(),
        stats: { totalProcessed: 0, successful: 0, failed: 0, skipped: 0 },
        errors: []
      };

      // Skip comparison step and go directly to conflict resolution
      await this.resolveConflicts(options, context);

      // Validate if needed
      if (!options.skipValidation) {
        await this.validateResults(options, context);
      }

      const duration = Date.now() - context.startTime.getTime();
      operationLogger.complete(
        context.stats.totalProcessed,
        context.stats.successful,
        context.stats.failed
      );

      return {
        operationId: checkpointId,
        totalProcessed: context.stats.totalProcessed,
        successful: context.stats.successful,
        failed: context.stats.failed,
        skipped: context.stats.skipped,
        duration,
        checkpoints: Array.from(context.checkpoints.values()),
        errors: context.errors
      };

    } catch (error) {
      operationLogger.fail(error as Error);
      throw new MigrationError(`Migration resume failed: ${error.message}`);
    }
  }

  /**
   * Get migration status and progress
   */
  async getMigrationStatus(operationId?: string): Promise<any> {
    try {
      // Get system status
      const systemStatus = await this.migrationAnalyzer.getSystemStatus();

      // Get checkpoint status
      const checkpointStatus = await this.migrationAnalyzer.getCheckpointStatus();

      // Get comparison summary
      const comparisonSummary = await this.dataComparator.getComparisonSummary();

      // Get recent log entries
      const recentLogs = await this.logger.searchLogs('', undefined, undefined, operationId, 50);

      return {
        system_status: systemStatus,
        checkpoint_status: checkpointStatus,
        comparison_summary: comparisonSummary,
        recent_activity: recentLogs,
        operation_id: operationId,
        timestamp: new Date()
      };

    } catch (error) {
      throw new MigrationError(`Failed to get migration status: ${error.message}`);
    }
  }

  /**
   * Analyze existing migration scripts
   */
  private async analyzeMigrationScripts(context: ExecutionContext): Promise<any> {
    try {
      const results = await this.migrationAnalyzer.analyzeExistingScripts();

      context.logger.info('Script analysis completed', {
        total_scripts: results.total_scripts,
        reusable_scripts: results.reusable_scripts,
        scripts_needing_modification: results.scripts_needing_modification,
        recommendations: results.recommendations.length
      });

      return results;
    } catch (error) {
      context.logger.error('Script analysis failed', error as Error);
      throw error;
    }
  }

  /**
   * Compare data between source and target
   */
  private async compareData(
    options: DifferentialMigrationOptions,
    context: ExecutionContext
  ): Promise<any> {
    try {
      const results = await this.dataComparator.compareAllEntities({
        entityTypes: options.entities,
        batchSize: options.batchSize || 1000
      });

      context.stats.totalProcessed += results.total_source_records;

      context.logger.info('Data comparison completed', {
        missing_records: results.missing_records,
        conflicted_records: results.conflicted_records,
        deleted_records: results.deleted_records,
        identical_records: results.identical_records,
        total_source: results.total_source_records,
        total_target: results.total_target_records
      });

      return results;
    } catch (error) {
      context.logger.error('Data comparison failed', error as Error);
      throw error;
    }
  }

  /**
   * Resolve conflicts using the configured strategy
   */
  private async resolveConflicts(
    options: DifferentialMigrationOptions,
    context: ExecutionContext
  ): Promise<any> {
    try {
      const results = await this.conflictResolver.resolveAllConflicts({
        batchSize: options.batchSize || 500,
        dryRun: options.dryRun,
        createBackup: true,
        validateAfterResolution: !options.skipValidation
      });

      context.stats.successful += results.conflicts_resolved;
      context.stats.failed += results.failed_resolutions;

      context.logger.info('Conflict resolution completed', {
        conflicts_detected: results.conflicts_detected,
        conflicts_resolved: results.conflicts_resolved,
        failed_resolutions: results.failed_resolutions,
        resolution_strategy: results.resolution_strategy
      });

      return results;
    } catch (error) {
      context.logger.error('Conflict resolution failed', error as Error);
      context.stats.failed += 1;
      throw error;
    }
  }

  /**
   * Validate migration results
   */
  private async validateResults(
    options: DifferentialMigrationOptions,
    context: ExecutionContext
  ): Promise<any> {
    try {
      const validationStart = Date.now();

      // Re-run comparison to validate changes
      const postResults = await this.dataComparator.compareAllEntities({
        entityTypes: options.entities,
        batchSize: 1000
      });

      const validationTime = Date.now() - validationStart;
      const validationPassed = postResults.missing_records === 0 && postResults.conflicted_records === 0;

      context.logger.logValidation(
        context.operationId,
        options.entities.join(','),
        postResults.total_target_records,
        validationPassed,
        postResults.missing_records + postResults.conflicted_records,
        validationTime
      );

      if (!validationPassed) {
        const error = new MigrationError(
          `Validation failed: ${postResults.missing_records} missing, ${postResults.conflicted_records} conflicted`
        );
        context.errors.push({
          entityType: options.entities.join(','),
          legacyId: 'validation',
          errorCode: 'VALIDATION_FAILED',
          errorMessage: error.message,
          timestamp: new Date()
        });
      }

      return postResults;
    } catch (error) {
      context.logger.error('Validation failed', error as Error);
      throw error;
    }
  }

  /**
   * Generate execution steps for migration plan
   */
  private generateExecutionSteps(
    analysisResults: any,
    comparisonResults: any,
    options: DifferentialMigrationOptions
  ): string[] {
    const steps: string[] = [];

    steps.push('1. Initialize migration context and logging');

    if (analysisResults.scripts_needing_modification > 0) {
      steps.push('2. Modify existing migration scripts for differential operations');
    }

    if (comparisonResults.missing_records > 0) {
      steps.push(`3. Insert ${comparisonResults.missing_records} missing records from source`);
    }

    if (comparisonResults.conflicted_records > 0) {
      steps.push(`4. Resolve ${comparisonResults.conflicted_records} conflicted records using source-wins strategy`);
    }

    if (comparisonResults.deleted_records > 0) {
      steps.push(`5. Handle ${comparisonResults.deleted_records} deleted records based on sync policy`);
    }

    if (!options.skipValidation) {
      steps.push('6. Validate migration results and data integrity');
    }

    steps.push('7. Update migration mappings and control records');
    steps.push('8. Generate migration report and cleanup');

    return steps;
  }

  /**
   * Assess migration risks
   */
  private assessRisks(
    analysisResults: any,
    comparisonResults: any,
    options: DifferentialMigrationOptions
  ): string {
    const risks: string[] = [];

    if (comparisonResults.missing_records > 10000) {
      risks.push('HIGH: Large number of missing records may impact performance');
    }

    if (comparisonResults.conflicted_records > 1000) {
      risks.push('MEDIUM: Significant conflicts requiring resolution');
    }

    if (analysisResults.unsupported_scripts > 0) {
      risks.push('HIGH: Some existing scripts cannot be reused');
    }

    if (options.dryRun === false && !options.skipValidation) {
      risks.push('LOW: Production migration with validation enabled');
    } else if (options.dryRun === false) {
      risks.push('MEDIUM: Production migration without validation');
    }

    if (risks.length === 0) {
      return 'LOW: Minimal risks identified';
    }

    return risks.join('; ');
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `diff_migration_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  }

  /**
   * Get migration statistics
   */
  async getMigrationStatistics(): Promise<any> {
    try {
      const [systemStats, logStats, comparisonStats, resolutionStats] = await Promise.all([
        this.migrationAnalyzer.getMigrationStatistics(),
        this.logger.getLogStats(),
        this.dataComparator.getComparisonSummary(),
        this.conflictResolver.getResolutionStatistics()
      ]);

      return {
        system_statistics: systemStats,
        log_statistics: logStats,
        comparison_statistics: comparisonStats,
        resolution_statistics: resolutionStats,
        generated_at: new Date()
      };
    } catch (error) {
      throw new MigrationError(`Failed to get migration statistics: ${error.message}`);
    }
  }

  /**
   * Clean up migration artifacts
   */
  async cleanup(olderThanDays: number = 7): Promise<any> {
    try {
      const results = {
        archived_logs: await this.logger.archiveLogs(olderThanDays),
        cleanup_timestamp: new Date()
      };

      this.logger.info('Migration cleanup completed', results);
      return results;
    } catch (error) {
      throw new MigrationError(`Cleanup failed: ${error.message}`);
    }
  }
}
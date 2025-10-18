/**
 * T003: Base migration service class
 * Provides common functionality for all migration scripts
 */

import { Client } from 'pg';
import {
  MigrationService,
  MigrationConfig,
  MigrationStats,
  ValidationResult,
  PreparationResult,
  LookupMappings,
  ProgressTracker,
  ErrorRecovery,
  MigrationServiceMetadata
} from '../interfaces/migration-types';

export abstract class BaseMigrationService implements MigrationService {
  protected sourceClient!: Client;
  protected targetClient!: Client;
  protected config!: MigrationConfig;
  protected progress: ProgressTracker | null = null;

  constructor() {
    // Abstract class - concrete implementations provide specifics
  }

  /**
   * Abstract methods that concrete classes must implement
   */
  abstract getMetadata(): MigrationServiceMetadata;

  /**
   * Initialize database connections
   */
  protected async initializeConnections(config: MigrationConfig): Promise<void> {
    this.config = config;

    // Source database connection
    this.sourceClient = new Client({
      host: config.sourceDb.host,
      port: config.sourceDb.port,
      database: config.sourceDb.database,
      user: config.sourceDb.user,
      password: config.sourceDb.password,
    });

    // Target database connection
    this.targetClient = new Client({
      host: config.targetDb.host,
      port: config.targetDb.port,
      database: config.targetDb.database,
      user: config.targetDb.user,
      password: config.targetDb.password,
    });

    await this.sourceClient.connect();
    await this.targetClient.connect();

    console.log('✅ Database connections established');
  }

  /**
   * Default preparation implementation
   * Subclasses can override for specific needs
   */
  async prepare(config: MigrationConfig): Promise<PreparationResult> {
    await this.initializeConnections(config);

    const metadata = this.getMetadata();

    // Get source record count
    const sourceCountResult = await this.sourceClient.query(
      `SELECT COUNT(*) as count FROM ${metadata.sourceTable}`
    );
    const sourceRecordCount = parseInt(sourceCountResult.rows[0].count);

    // Get target record count (existing records)
    let targetRecordCount = 0;
    try {
      const targetCountResult = await this.targetClient.query(
        `SELECT COUNT(*) as count FROM ${metadata.targetTable}`
      );
      targetRecordCount = parseInt(targetCountResult.rows[0].count);
    } catch (error) {
      // Table might not exist yet
      console.log(`Target table ${metadata.targetTable} not found - will be created during migration`);
    }

    return {
      success: true,
      lookupMappings: {} as LookupMappings, // Will be built by specific implementation
      sourceRecordCount,
      targetRecordCount,
      prerequisites: [],
      warnings: [],
      errors: []
    };
  }

  /**
   * Abstract execute method - must be implemented by subclasses
   */
  abstract execute(
    config: MigrationConfig,
    progressCallback?: (progress: ProgressTracker) => void
  ): Promise<MigrationStats>;

  /**
   * Default validation implementation
   */
  async validate(config: MigrationConfig): Promise<ValidationResult> {
    if (!this.targetClient) {
      await this.initializeConnections(config);
    }

    const metadata = this.getMetadata();

    try {
      // Basic validation - check if target table has expected records
      const countResult = await this.targetClient.query(
        `SELECT COUNT(*) as count FROM ${metadata.targetTable}`
      );

      const totalRecords = parseInt(countResult.rows[0].count);

      return {
        isValid: totalRecords > 0,
        totalRecords,
        validRecords: totalRecords,
        invalidRecords: 0,
        missingRecords: 0,
        issues: []
      };
    } catch (error) {
      return {
        isValid: false,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        missingRecords: 0,
        issues: [{
          severity: 'error',
          table: metadata.targetTable,
          message: `Validation failed: ${error}`
        }]
      };
    }
  }

  /**
   * Get current progress status
   */
  getProgress(): ProgressTracker | null {
    return this.progress;
  }

  /**
   * Update progress tracking
   */
  protected updateProgress(update: Partial<ProgressTracker>): void {
    if (!this.progress) {
      this.progress = {
        totalRecords: 0,
        processedRecords: 0,
        successfulRecords: 0,
        failedRecords: 0,
        skippedRecords: 0,
        currentBatch: 0,
        totalBatches: 0,
        startTime: new Date(),
        estimatedTimeRemaining: 0,
        progressPercentage: 0
      };
    }

    Object.assign(this.progress, update);

    // Calculate progress percentage
    if (this.progress.totalRecords > 0) {
      this.progress.progressPercentage =
        (this.progress.processedRecords / this.progress.totalRecords) * 100;
    }

    // Calculate estimated time remaining (simple linear projection)
    if (this.progress.processedRecords > 0 && this.progress.startTime) {
      const elapsed = Date.now() - this.progress.startTime.getTime();
      const rate = this.progress.processedRecords / elapsed; // records per millisecond
      const remaining = this.progress.totalRecords - this.progress.processedRecords;
      this.progress.estimatedTimeRemaining = remaining / rate;
    }
  }

  /**
   * Default error recovery implementation
   */
  async recover(config: MigrationConfig, lastKnownState?: ErrorRecovery): Promise<boolean> {
    console.log('🔄 Attempting error recovery...');

    if (lastKnownState?.canRecover) {
      console.log(`Resuming from batch ${lastKnownState.resumeFromBatch}, record ${lastKnownState.resumeFromRecord}`);
      return true;
    }

    console.log('No recovery state available - migration must restart from beginning');
    return false;
  }

  /**
   * Clean up database connections and resources
   */
  async cleanup(): Promise<void> {
    try {
      if (this.sourceClient) {
        await this.sourceClient.end();
      }
      if (this.targetClient) {
        await this.targetClient.end();
      }
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Utility method to log migration progress
   */
  protected logProgress(
    batchNumber: number,
    totalBatches: number,
    processed: number,
    total: number,
    successful: number,
    skipped: number,
    errors: number
  ): void {
    const progressPercent = ((processed / total) * 100).toFixed(1);
    console.log(
      `Progress: ${progressPercent}% (${processed}/${total}) - ` +
      `Success: ${successful}, Skipped: ${skipped}, Errors: ${errors}`
    );
  }

  /**
   * Utility method to handle common database errors
   */
  protected handleDatabaseError(error: any, context: string): void {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Database connection refused during ${context}. Check database server and credentials.`);
    } else if (error.code === '42P01') {
      throw new Error(`Table does not exist during ${context}. Check database schema.`);
    } else if (error.code === '23505') {
      console.warn(`Duplicate key constraint during ${context} - continuing with next record`);
    } else {
      throw new Error(`Database error during ${context}: ${error.message}`);
    }
  }
}
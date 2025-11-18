/**
 * CheckpointManager Library
 * Implements checkpoint persistence, state management, and recovery logic
 */

import { Pool, PoolClient } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, createGzip, createGunzip } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
export interface CheckpointConfig {
  pool: Pool;
  checkpointDir?: string;
  enableFileBackup?: boolean;
  enableDatabaseBackup?: boolean;
  maxCheckpoints?: number;
  compressionEnabled?: boolean;
  encryptionEnabled?: boolean;
  retentionDays?: number;
  validationEnabled?: boolean;
}

export interface CheckpointData {
  sessionId: string;
  entityType: string;
  migrationRunId: string;
  batchPosition: number;
  recordsProcessed: number;
  recordsRemaining: number;
  lastProcessedId: string;
  processingState?: {
    currentBatch: number;
    batchSize: number;
    startTime: Date;
    totalBatches: number;
    errorCount: number;
    retryCount: number;
    failedRecords?: string[];
    skippedRecords?: string[];
    performanceMetrics?: {
      averageBatchTimeMs: number;
      recordsPerSecond: number;
      memoryUsageMb: number;
      peakMemoryMb?: number;
      cpuUsagePercent?: number;
    };
    validationResults?: {
      totalValidated: number;
      successfulValidations: number;
      failedValidations: number;
      validationErrors?: string[];
    };
  };
  metadata?: {
    sourceTable: string;
    destinationTable: string;
    migrationStrategy: string;
    dependencies?: string[];
    configuration?: object;
  };
  checksum?: string;
}

export interface CheckpointCreateResult {
  success: boolean;
  checkpointId?: string;
  backupLocations: string[];
  compressed?: boolean;
  compressionRatio?: number;
  validationErrors?: string[];
  warnings?: string[];
}

export interface CheckpointLoadResult {
  success: boolean;
  data?: CheckpointData;
  source: 'database' | 'file';
  fallbackUsed?: boolean;
  validationErrors?: string[];
  metadata?: CheckpointMetadata;
}

export interface CheckpointMetadata {
  checkpointId: string;
  entityType: string;
  createdAt: Date;
  size: number;
  checksumValid: boolean;
  isResumable: boolean;
  progressPercentage: number;
  estimatedTimeRemaining: number;
  version: string;
}

export interface RecoveryInfo {
  hasRecoverableState: boolean;
  availableCheckpoints: Array<{
    checkpointId: string;
    createdAt: Date;
    progressPercentage: number;
    isValid: boolean;
    source: 'database' | 'file';
  }>;
  recommendedCheckpoint?: string;
  estimatedRecoveryTime: number;
}

export interface SerializationResult {
  success: boolean;
  serializedData: string;
  checksum: string;
  size: number;
  compressed: boolean;
  warnings?: string[];
}

export interface DeserializationResult {
  success: boolean;
  data?: CheckpointData;
  validationErrors?: string[];
}

export interface CheckpointValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CleanupResult {
  success: boolean;
  checkpointsRemoved: number;
  spaceReclaimed: number;
  errors?: string[];
}

export interface StorageStatistics {
  totalCheckpoints: number;
  databaseSize: string;
  fileBackupSize: string;
  averageCheckpointSize: string;
  oldestCheckpoint?: Date;
  newestCheckpoint?: Date;
}

/**
 * CheckpointManager Implementation
 *
 * Provides comprehensive checkpoint management functionality with dual backup strategies,
 * state serialization, recovery operations, and automatic cleanup capabilities.
 */
export class CheckpointManager {
  private config: CheckpointConfig;
  private defaultConfig: Partial<CheckpointConfig> = {
    checkpointDir: './checkpoints',
    enableFileBackup: true,
    enableDatabaseBackup: true,
    maxCheckpoints: 10,
    compressionEnabled: false,
    encryptionEnabled: false,
    retentionDays: 30,
    validationEnabled: true
  };

  constructor(config: CheckpointConfig) {
    // Validate and merge configuration
    const validation = CheckpointManager.validateConfig(config);
    if (!validation.isValid) {
      throw new Error(`Invalid checkpoint config: ${validation.errors.join(', ')}`);
    }

    this.config = { ...this.defaultConfig, ...config };

    // Ensure checkpoint directory exists if file backup is enabled
    if (this.config.enableFileBackup && this.config.checkpointDir) {
      this.ensureCheckpointDirectory();
    }
  }

  /**
   * Validates checkpoint manager configuration
   */
  static validateConfig(config: CheckpointConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.pool) {
      errors.push('pool is required');
    }

    if (config.enableFileBackup && !config.checkpointDir) {
      errors.push('checkpointDir is required when file backup is enabled');
    }

    if (!config.enableFileBackup && !config.enableDatabaseBackup) {
      errors.push('At least one backup method must be enabled');
    }

    if (config.maxCheckpoints && config.maxCheckpoints <= 0) {
      errors.push('maxCheckpoints must be greater than 0');
    }

    if (config.retentionDays && config.retentionDays <= 0) {
      errors.push('retentionDays must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Creates a new checkpoint with comprehensive state data
   */
  async createCheckpoint(data: CheckpointData): Promise<CheckpointCreateResult> {
    const result: CheckpointCreateResult = {
      success: false,
      backupLocations: [],
      validationErrors: [],
      warnings: []
    };

    try {
      // Validate checkpoint data
      if (this.config.validationEnabled) {
        const validation = this.validateCheckpointData(data);
        if (!validation.isValid) {
          result.validationErrors = validation.errors;
          return result;
        }
      }

      // Generate checkpoint ID and metadata
      const checkpointId = uuidv4();
      const metadata = await this.generateCheckpointMetadata(data);

      // Serialize state data
      const serialization = await this.serializeState(data);
      if (!serialization.success) {
        result.validationErrors = ['Failed to serialize checkpoint data'];
        return result;
      }

      // Attempt database backup
      if (this.config.enableDatabaseBackup) {
        try {
          await this.saveToDatabaseBackup(checkpointId, data, serialization.serializedData);
          result.backupLocations.push('database');
        } catch (error) {
          result.warnings?.push('Database backup failed, using file backup only');
        }
      }

      // Attempt file backup
      if (this.config.enableFileBackup) {
        try {
          await this.saveToFileBackup(checkpointId, data, serialization.serializedData);
          result.backupLocations.push('file');
        } catch (error) {
          result.warnings?.push('File backup failed, using database backup only');
        }
      }

      // Check if at least one backup succeeded
      if (result.backupLocations.length === 0) {
        result.validationErrors = ['All backup methods failed'];
        return result;
      }

      result.success = true;
      result.checkpointId = checkpointId;
      result.compressed = serialization.compressed;
      result.compressionRatio = this.calculateCompressionRatio(data, serialization.serializedData);

      return result;

    } catch (error) {
      result.validationErrors = [error instanceof Error ? error.message : 'Unknown error'];
      return result;
    }
  }

  /**
   * Loads a checkpoint from available backup sources
   */
  async loadCheckpoint(checkpointId: string): Promise<CheckpointLoadResult> {
    const result: CheckpointLoadResult = {
      success: false,
      source: 'database',
      validationErrors: []
    };

    try {
      // Try database first
      if (this.config.enableDatabaseBackup) {
        try {
          const dbResult = await this.loadFromDatabaseBackup(checkpointId);
          if (dbResult.success && dbResult.data) {
            result.success = true;
            result.data = dbResult.data;
            result.source = 'database';
            result.metadata = await this.generateCheckpointMetadata(dbResult.data);
            return result;
          }
        } catch (error) {
          // Database load failed, try file backup
        }
      }

      // Try file backup as fallback
      if (this.config.enableFileBackup) {
        try {
          const fileResult = await this.loadFromFileBackup(checkpointId);
          if (fileResult.success && fileResult.data) {
            result.success = true;
            result.data = fileResult.data;
            result.source = 'file';
            result.fallbackUsed = this.config.enableDatabaseBackup;
            result.metadata = await this.generateCheckpointMetadata(fileResult.data);
            return result;
          }
        } catch (error) {
          result.validationErrors = [error instanceof Error ? error.message : 'File backup load failed'];
        }
      }

      result.validationErrors = ['Checkpoint not found in any backup source'];
      return result;

    } catch (error) {
      result.validationErrors = [error instanceof Error ? error.message : 'Unknown error'];
      return result;
    }
  }

  /**
   * Gets recovery information for a session and entity
   */
  async getRecoveryInfo(sessionId: string, entityType?: string): Promise<RecoveryInfo> {
    const availableCheckpoints: RecoveryInfo['availableCheckpoints'] = [];

    try {
      // Query database for checkpoints
      if (this.config.enableDatabaseBackup) {
        const query = `
          SELECT id, entity_type, created_at, records_processed, records_remaining, checkpoint_data
          FROM migration_checkpoints
          WHERE checkpoint_data::jsonb ->> 'sessionId' = $1
          ${entityType ? 'AND entity_type = $2' : ''}
          ORDER BY created_at DESC
        `;

        const params = entityType ? [sessionId, entityType] : [sessionId];
        const result = await this.config.pool.query(query, params);

        for (const row of result.rows) {
          const totalRecords = row.records_processed + row.records_remaining;
          const progressPercentage = totalRecords > 0
            ? Math.round((row.records_processed / totalRecords) * 100)
            : 0;

          availableCheckpoints.push({
            checkpointId: row.id,
            createdAt: new Date(row.created_at),
            progressPercentage,
            isValid: true, // Assume database checkpoints are valid
            source: 'database'
          });
        }
      }

      // Check file backups if no database checkpoints found
      if (availableCheckpoints.length === 0 && this.config.enableFileBackup) {
        await this.discoverFileCheckpoints(sessionId, entityType, availableCheckpoints);
      }

      // Determine recommended checkpoint (latest with highest progress)
      let recommendedCheckpoint: string | undefined;
      if (availableCheckpoints.length > 0) {
        const sortedCheckpoints = availableCheckpoints
          .filter(c => c.isValid)
          .sort((a, b) => {
            // Primary sort: progress percentage (desc)
            if (b.progressPercentage !== a.progressPercentage) {
              return b.progressPercentage - a.progressPercentage;
            }
            // Secondary sort: creation time (desc)
            return b.createdAt.getTime() - a.createdAt.getTime();
          });

        recommendedCheckpoint = sortedCheckpoints[0]?.checkpointId;
      }

      // Estimate recovery time based on progress
      const estimatedRecoveryTime = this.calculateRecoveryTime(availableCheckpoints);

      return {
        hasRecoverableState: availableCheckpoints.length > 0,
        availableCheckpoints,
        recommendedCheckpoint,
        estimatedRecoveryTime
      };

    } catch (error) {
      return {
        hasRecoverableState: false,
        availableCheckpoints: [],
        estimatedRecoveryTime: 0
      };
    }
  }

  /**
   * Serializes checkpoint state with optional compression
   */
  async serializeState(data: CheckpointData): Promise<SerializationResult> {
    try {
      // Handle circular references safely
      const safeData = this.sanitizeForSerialization(data);
      let serializedData = JSON.stringify(safeData, null, 2);

      let compressed = false;
      const originalSize = Buffer.byteLength(serializedData, 'utf8');

      // Apply compression if enabled and data is large enough
      if (this.config.compressionEnabled && originalSize > 1024) {
        try {
          serializedData = await this.compressData(serializedData);
          compressed = true;
        } catch (error) {
          // Compression failed, use uncompressed data
        }
      }

      // Generate checksum
      const checksum = this.generateChecksum(serializedData);
      const finalSize = Buffer.byteLength(serializedData, 'utf8');

      return {
        success: true,
        serializedData,
        checksum,
        size: finalSize,
        compressed,
        warnings: compressed ? undefined : ['Compression skipped or failed']
      };

    } catch (error) {
      return {
        success: false,
        serializedData: '',
        checksum: '',
        size: 0,
        compressed: false,
        warnings: [error instanceof Error ? error.message : 'Serialization failed']
      };
    }
  }

  /**
   * Deserializes checkpoint state with validation
   */
  async deserializeState(serializedData: string, expectedChecksum?: string): Promise<DeserializationResult> {
    try {
      // Validate checksum if provided
      if (expectedChecksum && this.config.validationEnabled) {
        const actualChecksum = this.generateChecksum(serializedData);
        if (actualChecksum !== expectedChecksum) {
          return {
            success: false,
            validationErrors: ['Data integrity check failed']
          };
        }
      }

      // Attempt decompression if data appears compressed
      let dataToDeserialize = serializedData;
      if (this.config.compressionEnabled && this.isCompressedData(serializedData)) {
        try {
          dataToDeserialize = await this.decompressData(serializedData);
        } catch (error) {
          return {
            success: false,
            validationErrors: ['Decompression failed']
          };
        }
      }

      // Parse JSON data
      const data = JSON.parse(dataToDeserialize);

      // Validate deserialized data structure
      if (this.config.validationEnabled) {
        const validation = this.validateCheckpointData(data);
        if (!validation.isValid) {
          return {
            success: false,
            validationErrors: validation.errors
          };
        }
      }

      return {
        success: true,
        data
      };

    } catch (error) {
      return {
        success: false,
        validationErrors: [error instanceof Error ? error.message : 'Deserialization failed']
      };
    }
  }

  /**
   * Generates checkpoint metadata for progress tracking
   */
  async generateCheckpointMetadata(data: CheckpointData): Promise<CheckpointMetadata> {
    const totalRecords = data.recordsProcessed + data.recordsRemaining;
    const progressPercentage = totalRecords > 0
      ? Math.round((data.recordsProcessed / totalRecords) * 100)
      : 0;

    // Estimate time remaining based on processing rate
    let estimatedTimeRemaining = 0;
    if (data.processingState?.recordsPerSecond && data.recordsRemaining > 0) {
      estimatedTimeRemaining = Math.round(data.recordsRemaining / data.processingState.recordsPerSecond);
    }

    // Calculate approximate size
    const serializedSize = Buffer.byteLength(JSON.stringify(data), 'utf8');

    return {
      checkpointId: data.sessionId + '_' + data.entityType,
      entityType: data.entityType,
      createdAt: new Date(),
      size: serializedSize,
      checksumValid: true,
      isResumable: data.recordsRemaining > 0,
      progressPercentage,
      estimatedTimeRemaining,
      version: '1.0'
    };
  }

  /**
   * Lists all checkpoints for a session
   */
  async listCheckpoints(sessionId: string): Promise<CheckpointMetadata[]> {
    const checkpoints: CheckpointMetadata[] = [];

    try {
      // Query database checkpoints
      if (this.config.enableDatabaseBackup) {
        const query = `
          SELECT id, entity_type, created_at, records_processed, records_remaining, checkpoint_data
          FROM migration_checkpoints
          WHERE checkpoint_data::jsonb ->> 'sessionId' = $1
          ORDER BY created_at DESC
        `;

        const result = await this.config.pool.query(query, [sessionId]);

        for (const row of result.rows) {
          const data = JSON.parse(row.checkpoint_data);
          const metadata = await this.generateCheckpointMetadata(data);
          metadata.checkpointId = row.id;
          metadata.createdAt = new Date(row.created_at);
          checkpoints.push(metadata);
        }
      }

    } catch (error) {
      // Continue with empty list if query fails
    }

    return checkpoints;
  }

  /**
   * Cleans up old checkpoints based on retention policy
   */
  async cleanupOldCheckpoints(): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: false,
      checkpointsRemoved: 0,
      spaceReclaimed: 0,
      errors: []
    };

    try {
      const cutoffDate = new Date(Date.now() - this.config.retentionDays! * 24 * 60 * 60 * 1000);

      // Clean database checkpoints
      if (this.config.enableDatabaseBackup) {
        const deleteQuery = `
          DELETE FROM migration_checkpoints
          WHERE created_at < $1
          RETURNING id
        `;

        const deleteResult = await this.config.pool.query(deleteQuery, [cutoffDate]);
        result.checkpointsRemoved += deleteResult.rowCount || 0;
      }

      // Clean file checkpoints
      if (this.config.enableFileBackup && this.config.checkpointDir) {
        const fileCleanup = await this.cleanupFileCheckpoints(cutoffDate);
        result.checkpointsRemoved += fileCleanup.filesRemoved;
        result.spaceReclaimed += fileCleanup.spaceReclaimed;
      }

      result.success = true;
      return result;

    } catch (error) {
      result.errors = [error instanceof Error ? error.message : 'Cleanup failed'];
      return result;
    }
  }

  /**
   * Enforces maximum checkpoint limit
   */
  async enforceCheckpointLimit(sessionId: string): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: false,
      checkpointsRemoved: 0,
      spaceReclaimed: 0
    };

    try {
      // Get current checkpoint count for session
      const countQuery = `
        SELECT COUNT(*) as count
        FROM migration_checkpoints
        WHERE checkpoint_data::jsonb ->> 'sessionId' = $1
      `;

      const countResult = await this.config.pool.query(countQuery, [sessionId]);
      const currentCount = parseInt(countResult.rows[0].count);

      if (currentCount > this.config.maxCheckpoints!) {
        const excessCount = currentCount - this.config.maxCheckpoints!;

        // Delete oldest checkpoints
        const deleteQuery = `
          DELETE FROM migration_checkpoints
          WHERE id IN (
            SELECT id FROM migration_checkpoints
            WHERE checkpoint_data::jsonb ->> 'sessionId' = $1
            ORDER BY created_at ASC
            LIMIT $2
          )
        `;

        const deleteResult = await this.config.pool.query(deleteQuery, [sessionId, excessCount]);
        result.checkpointsRemoved = deleteResult.rowCount || 0;
      }

      result.success = true;
      return result;

    } catch (error) {
      return {
        success: false,
        checkpointsRemoved: 0,
        spaceReclaimed: 0,
        errors: [error instanceof Error ? error.message : 'Limit enforcement failed']
      };
    }
  }

  /**
   * Gets storage statistics
   */
  async getStorageStatistics(): Promise<StorageStatistics> {
    const stats: StorageStatistics = {
      totalCheckpoints: 0,
      databaseSize: '0 MB',
      fileBackupSize: '0 MB',
      averageCheckpointSize: '0 KB'
    };

    try {
      // Database statistics
      if (this.config.enableDatabaseBackup) {
        const dbQuery = `
          SELECT
            COUNT(*) as checkpoint_count,
            pg_size_pretty(SUM(octet_length(checkpoint_data::text))) as total_size,
            pg_size_pretty(AVG(octet_length(checkpoint_data::text))) as avg_size,
            MIN(created_at) as oldest,
            MAX(created_at) as newest
          FROM migration_checkpoints
        `;

        const dbResult = await this.config.pool.query(dbQuery);
        if (dbResult.rows.length > 0) {
          const row = dbResult.rows[0];
          stats.totalCheckpoints = parseInt(row.checkpoint_count);
          stats.databaseSize = row.total_size || '0 MB';
          stats.averageCheckpointSize = row.avg_size || '0 KB';
          stats.oldestCheckpoint = row.oldest ? new Date(row.oldest) : undefined;
          stats.newestCheckpoint = row.newest ? new Date(row.newest) : undefined;
        }
      }

      // File backup statistics
      if (this.config.enableFileBackup && this.config.checkpointDir) {
        const fileStats = await this.calculateFileBackupSize();
        stats.fileBackupSize = fileStats.totalSize;
      }

    } catch (error) {
      // Return default stats if calculation fails
    }

    return stats;
  }

  /**
   * Gets the resolved configuration
   */
  getConfiguration(): CheckpointConfig {
    return { ...this.config };
  }

  /**
   * Private helper methods
   */

  private async ensureCheckpointDirectory(): Promise<void> {
    try {
      if (this.config.checkpointDir) {
        await fs.mkdir(this.config.checkpointDir, { recursive: true });
      }
    } catch (error) {
      // Directory creation failed, file backup will fail
    }
  }

  private validateCheckpointData(data: CheckpointData): CheckpointValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.sessionId || data.sessionId.trim().length === 0) {
      errors.push('sessionId is required');
    }

    if (!data.entityType || data.entityType.trim().length === 0) {
      errors.push('entityType is required');
    }

    if (data.batchPosition < 0) {
      errors.push('batchPosition must be non-negative');
    }

    if (data.recordsProcessed < 0) {
      errors.push('recordsProcessed must be non-negative');
    }

    if (data.recordsRemaining < 0) {
      errors.push('recordsRemaining must be non-negative');
    }

    if (!data.lastProcessedId) {
      warnings.push('lastProcessedId is recommended for recovery');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async saveToDatabaseBackup(
    checkpointId: string,
    data: CheckpointData,
    serializedData: string
  ): Promise<void> {
    const query = `
      INSERT INTO migration_checkpoints (
        id, entity_type, migration_run_id, last_processed_id,
        batch_position, records_processed, records_remaining, checkpoint_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    const params = [
      checkpointId,
      data.entityType,
      data.migrationRunId,
      data.lastProcessedId,
      data.batchPosition,
      data.recordsProcessed,
      data.recordsRemaining,
      serializedData
    ];

    await this.config.pool.query(query, params);
  }

  private async saveToFileBackup(
    checkpointId: string,
    data: CheckpointData,
    serializedData: string
  ): Promise<void> {
    if (!this.config.checkpointDir) {
      throw new Error('Checkpoint directory not configured');
    }

    const filePath = path.join(this.config.checkpointDir, `${checkpointId}.json`);
    await fs.writeFile(filePath, serializedData, 'utf8');
  }

  private async loadFromDatabaseBackup(checkpointId: string): Promise<CheckpointLoadResult> {
    const query = `
      SELECT checkpoint_data
      FROM migration_checkpoints
      WHERE id = $1
    `;

    const result = await this.config.pool.query(query, [checkpointId]);

    if (result.rows.length === 0) {
      return {
        success: false,
        source: 'database',
        validationErrors: ['Checkpoint not found in database']
      };
    }

    const serializedData = result.rows[0].checkpoint_data;
    const deserialization = await this.deserializeState(serializedData);

    return {
      success: deserialization.success,
      data: deserialization.data,
      source: 'database',
      validationErrors: deserialization.validationErrors
    };
  }

  private async loadFromFileBackup(checkpointId: string): Promise<CheckpointLoadResult> {
    if (!this.config.checkpointDir) {
      return {
        success: false,
        source: 'file',
        validationErrors: ['File backup not configured']
      };
    }

    const filePath = path.join(this.config.checkpointDir, `${checkpointId}.json`);

    try {
      const serializedData = await fs.readFile(filePath, 'utf8');
      const deserialization = await this.deserializeState(serializedData);

      return {
        success: deserialization.success,
        data: deserialization.data,
        source: 'file',
        validationErrors: deserialization.validationErrors
      };
    } catch (error) {
      return {
        success: false,
        source: 'file',
        validationErrors: [error instanceof Error ? error.message : 'File read failed']
      };
    }
  }

  private async discoverFileCheckpoints(
    sessionId: string,
    entityType: string | undefined,
    checkpoints: RecoveryInfo['availableCheckpoints']
  ): Promise<void> {
    if (!this.config.checkpointDir) return;

    try {
      const files = await fs.readdir(this.config.checkpointDir);
      const checkpointFiles = files.filter(f => f.endsWith('.json'));

      for (const file of checkpointFiles) {
        try {
          const filePath = path.join(this.config.checkpointDir, file);
          const data = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(data);

          if (parsed.sessionId === sessionId &&
              (!entityType || parsed.entityType === entityType)) {
            const stats = await fs.stat(filePath);
            const totalRecords = parsed.recordsProcessed + parsed.recordsRemaining;
            const progressPercentage = totalRecords > 0
              ? Math.round((parsed.recordsProcessed / totalRecords) * 100)
              : 0;

            checkpoints.push({
              checkpointId: path.basename(file, '.json'),
              createdAt: stats.mtime,
              progressPercentage,
              isValid: true,
              source: 'file'
            });
          }
        } catch (error) {
          // Skip invalid checkpoint files
        }
      }
    } catch (error) {
      // Directory read failed
    }
  }

  private calculateRecoveryTime(checkpoints: RecoveryInfo['availableCheckpoints']): number {
    if (checkpoints.length === 0) return 0;

    // Base recovery time + time based on progress
    const bestCheckpoint = checkpoints.reduce((best, current) =>
      current.progressPercentage > best.progressPercentage ? current : best
    );

    const baseRecoveryTime = 60; // 1 minute base time
    const progressFactor = (100 - bestCheckpoint.progressPercentage) / 100;
    const estimatedTime = baseRecoveryTime + (progressFactor * 300); // Up to 5 minutes additional

    return Math.round(estimatedTime);
  }

  private sanitizeForSerialization(data: any): any {
    const seen = new WeakSet();

    const sanitize = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      if (seen.has(obj)) {
        return '[Circular Reference]';
      }

      seen.add(obj);

      if (obj instanceof Date) {
        return obj.toISOString();
      }

      if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item));
      }

      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }

      return sanitized;
    };

    return sanitize(data);
  }

  private calculateCompressionRatio(originalData: CheckpointData, compressedData: string): number {
    const originalSize = Buffer.byteLength(JSON.stringify(originalData), 'utf8');
    const compressedSize = Buffer.byteLength(compressedData, 'utf8');

    return originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) / 100 : 0;
  }

  private async compressData(data: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gzip = createGzip();

      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      gzip.on('error', reject);

      gzip.write(data);
      gzip.end();
    });
  }

  private async decompressData(compressedData: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = createGunzip();

      gunzip.on('data', chunk => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      gunzip.on('error', reject);

      gunzip.write(Buffer.from(compressedData, 'base64'));
      gunzip.end();
    });
  }

  private isCompressedData(data: string): boolean {
    // Simple heuristic: compressed data is base64 encoded
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    return base64Regex.test(data) && data.length > 100;
  }

  private generateChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private async cleanupFileCheckpoints(cutoffDate: Date): Promise<{ filesRemoved: number; spaceReclaimed: number }> {
    let filesRemoved = 0;
    let spaceReclaimed = 0;

    if (!this.config.checkpointDir) {
      return { filesRemoved, spaceReclaimed };
    }

    try {
      const files = await fs.readdir(this.config.checkpointDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.config.checkpointDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          spaceReclaimed += stats.size;
          await fs.unlink(filePath);
          filesRemoved++;
        }
      }
    } catch (error) {
      // Cleanup failed for some files
    }

    return { filesRemoved, spaceReclaimed };
  }

  private async calculateFileBackupSize(): Promise<{ totalSize: string }> {
    let totalBytes = 0;

    if (!this.config.checkpointDir) {
      return { totalSize: '0 MB' };
    }

    try {
      const files = await fs.readdir(this.config.checkpointDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.config.checkpointDir, file);
          const stats = await fs.stat(filePath);
          totalBytes += stats.size;
        }
      }
    } catch (error) {
      // Size calculation failed
    }

    // Convert to human readable format
    if (totalBytes < 1024) {
      return { totalSize: `${totalBytes} B` };
    } else if (totalBytes < 1024 * 1024) {
      return { totalSize: `${Math.round(totalBytes / 1024)} KB` };
    } else {
      return { totalSize: `${Math.round(totalBytes / (1024 * 1024))} MB` };
    }
  }
}
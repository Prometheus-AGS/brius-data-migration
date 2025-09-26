// Batch Processor Utility
// Extends existing migration patterns for efficient batch processing operations

import { Pool, PoolClient } from 'pg';

export interface BatchProcessorConfig {
  batchSize: number;
  maxRetries: number;
  retryDelay: number; // milliseconds
  parallelism: number;
  progressReportingInterval?: number; // report every N batches
  continueOnError?: boolean;
  enableCheckpointing?: boolean;
}

export interface BatchProcessorStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: BatchError[];
  startTime: Date;
  endTime?: Date;
  avgBatchTime?: number;
  lastProcessedIndex?: number;
}

export interface BatchError {
  batchIndex: number;
  itemIndex: number;
  item: any;
  error: string;
  timestamp: Date;
  retryCount: number;
}

export interface BatchResult<T> {
  batchIndex: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  results: T[];
  errors: BatchError[];
  duration: number;
}

export interface CheckpointData {
  lastProcessedIndex: number;
  stats: BatchProcessorStats;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export type BatchProcessor<TInput, TOutput> = (
  batch: TInput[],
  batchIndex: number,
  totalBatches: number
) => Promise<TOutput[]>;

export type ItemProcessor<TInput, TOutput> = (
  item: TInput,
  index: number,
  batch: TInput[]
) => Promise<TOutput | null>;

export type ProgressReporter = (
  processed: number,
  total: number,
  batchIndex: number,
  stats: BatchProcessorStats
) => void;

export type CheckpointSaver = (
  checkpointData: CheckpointData
) => Promise<void>;

export type CheckpointLoader = () => Promise<CheckpointData | null>;

export class BatchProcessorService<TInput, TOutput> {
  private config: Required<BatchProcessorConfig>;
  private stats: BatchProcessorStats;
  private progressReporter?: ProgressReporter;
  private checkpointSaver?: CheckpointSaver;
  private checkpointLoader?: CheckpointLoader;

  constructor(
    config: Partial<BatchProcessorConfig> = {},
    progressReporter?: ProgressReporter,
    checkpointSaver?: CheckpointSaver,
    checkpointLoader?: CheckpointLoader
  ) {
    this.config = {
      batchSize: config.batchSize || 500,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      parallelism: config.parallelism || 1,
      progressReportingInterval: config.progressReportingInterval || 10,
      continueOnError: config.continueOnError ?? true,
      enableCheckpointing: config.enableCheckpointing ?? false
    };

    this.progressReporter = progressReporter;
    this.checkpointSaver = checkpointSaver;
    this.checkpointLoader = checkpointLoader;

    this.stats = this.initializeStats();
  }

  /**
   * Process items in batches using a batch processor function
   */
  async processBatches(
    items: TInput[],
    batchProcessor: BatchProcessor<TInput, TOutput>
  ): Promise<BatchProcessorStats> {
    console.log(`🚀 Starting batch processing: ${items.length} items, ${this.config.batchSize} per batch`);

    this.stats = this.initializeStats();
    const totalBatches = Math.ceil(items.length / this.config.batchSize);
    let startIndex = 0;

    // Load checkpoint if available
    if (this.config.enableCheckpointing && this.checkpointLoader) {
      const checkpoint = await this.checkpointLoader();
      if (checkpoint && checkpoint.lastProcessedIndex >= 0) {
        startIndex = checkpoint.lastProcessedIndex + 1;
        this.stats = { ...checkpoint.stats };
        console.log(`📍 Resuming from checkpoint: index ${startIndex}`);
      }
    }

    // Process batches
    for (let i = startIndex; i < items.length; i += this.config.batchSize) {
      const batchIndex = Math.floor(i / this.config.batchSize);
      const batch = items.slice(i, Math.min(i + this.config.batchSize, items.length));

      try {
        const batchResult = await this.processSingleBatch(
          batch,
          batchIndex,
          totalBatches,
          batchProcessor
        );

        this.updateStatsFromBatch(batchResult);

        // Report progress
        if (this.progressReporter && batchIndex % this.config.progressReportingInterval === 0) {
          this.progressReporter(this.stats.totalProcessed, items.length, batchIndex, this.stats);
        }

        // Save checkpoint
        if (this.config.enableCheckpointing && this.checkpointSaver) {
          const checkpointData: CheckpointData = {
            lastProcessedIndex: i + batch.length - 1,
            stats: { ...this.stats },
            timestamp: new Date()
          };
          await this.checkpointSaver(checkpointData);
        }

      } catch (error) {
        this.stats.failed++;
        const batchError: BatchError = {
          batchIndex,
          itemIndex: i,
          item: batch[0], // Representative item from failed batch
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
          retryCount: 0
        };
        this.stats.errors.push(batchError);

        if (!this.config.continueOnError) {
          console.error(`❌ Batch processing failed at batch ${batchIndex}. Stopping.`);
          break;
        }

        console.error(`❌ Batch ${batchIndex} failed, continuing with next batch:`, error);
      }
    }

    this.stats.endTime = new Date();
    this.calculateAverageBatchTime();

    console.log('\n📋 Batch Processing Summary:');
    this.displayFinalStats();

    return this.stats;
  }

  /**
   * Process items individually with item-level error handling
   */
  async processItems(
    items: TInput[],
    itemProcessor: ItemProcessor<TInput, TOutput>
  ): Promise<BatchProcessorStats> {
    console.log(`🚀 Starting item processing: ${items.length} items`);

    this.stats = this.initializeStats();
    let startIndex = 0;

    // Load checkpoint if available
    if (this.config.enableCheckpointing && this.checkpointLoader) {
      const checkpoint = await this.checkpointLoader();
      if (checkpoint && checkpoint.lastProcessedIndex >= 0) {
        startIndex = checkpoint.lastProcessedIndex + 1;
        this.stats = { ...checkpoint.stats };
        console.log(`📍 Resuming from checkpoint: index ${startIndex}`);
      }
    }

    // Process items in batches for better performance
    for (let i = startIndex; i < items.length; i += this.config.batchSize) {
      const batch = items.slice(i, Math.min(i + this.config.batchSize, items.length));

      // Process items in current batch
      for (let j = 0; j < batch.length; j++) {
        const itemIndex = i + j;
        const item = batch[j];
        let retryCount = 0;
        let processed = false;

        while (!processed && retryCount <= this.config.maxRetries) {
          try {
            const result = await itemProcessor(item, itemIndex, batch);

            if (result !== null && result !== undefined) {
              this.stats.successful++;
            } else {
              this.stats.skipped++;
            }

            this.stats.totalProcessed++;
            processed = true;

          } catch (error) {
            retryCount++;

            if (retryCount > this.config.maxRetries) {
              this.stats.failed++;
              this.stats.totalProcessed++;

              const itemError: BatchError = {
                batchIndex: Math.floor(i / this.config.batchSize),
                itemIndex,
                item,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
                retryCount: retryCount - 1
              };
              this.stats.errors.push(itemError);

              if (!this.config.continueOnError) {
                console.error(`❌ Item processing failed at index ${itemIndex}. Stopping.`);
                this.stats.endTime = new Date();
                return this.stats;
              }

              processed = true; // Mark as processed even though it failed
            } else {
              // Wait before retry
              await this.delay(this.config.retryDelay * retryCount);
              console.warn(`🔄 Retrying item ${itemIndex} (attempt ${retryCount}/${this.config.maxRetries})`);
            }
          }
        }
      }

      // Report progress
      if (this.progressReporter && (i / this.config.batchSize) % this.config.progressReportingInterval === 0) {
        this.progressReporter(this.stats.totalProcessed, items.length, Math.floor(i / this.config.batchSize), this.stats);
      }

      // Save checkpoint
      if (this.config.enableCheckpointing && this.checkpointSaver) {
        const checkpointData: CheckpointData = {
          lastProcessedIndex: i + batch.length - 1,
          stats: { ...this.stats },
          timestamp: new Date()
        };
        await this.checkpointSaver(checkpointData);
      }
    }

    this.stats.endTime = new Date();
    console.log('\n📋 Item Processing Summary:');
    this.displayFinalStats();

    return this.stats;
  }

  /**
   * Process a single batch with retry logic
   */
  private async processSingleBatch(
    batch: TInput[],
    batchIndex: number,
    totalBatches: number,
    batchProcessor: BatchProcessor<TInput, TOutput>
  ): Promise<BatchResult<TOutput>> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= this.config.maxRetries) {
      try {
        const results = await batchProcessor(batch, batchIndex, totalBatches);
        const duration = Date.now() - startTime;

        return {
          batchIndex,
          processedItems: batch.length,
          successfulItems: results.length,
          failedItems: batch.length - results.length,
          skippedItems: 0,
          results,
          errors: [],
          duration
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        retryCount++;

        if (retryCount <= this.config.maxRetries) {
          const delay = this.config.retryDelay * retryCount;
          console.warn(`🔄 Batch ${batchIndex} failed, retrying in ${delay}ms (attempt ${retryCount}/${this.config.maxRetries})`);
          await this.delay(delay);
        }
      }
    }

    // All retries exhausted
    const duration = Date.now() - startTime;
    const batchError: BatchError = {
      batchIndex,
      itemIndex: batchIndex * this.config.batchSize,
      item: batch[0],
      error: lastError?.message || 'Unknown error',
      timestamp: new Date(),
      retryCount: this.config.maxRetries
    };

    return {
      batchIndex,
      processedItems: batch.length,
      successfulItems: 0,
      failedItems: batch.length,
      skippedItems: 0,
      results: [],
      errors: [batchError],
      duration
    };
  }

  /**
   * Update stats from batch result
   */
  private updateStatsFromBatch(batchResult: BatchResult<TOutput>): void {
    this.stats.totalProcessed += batchResult.processedItems;
    this.stats.successful += batchResult.successfulItems;
    this.stats.failed += batchResult.failedItems;
    this.stats.skipped += batchResult.skippedItems;
    this.stats.errors.push(...batchResult.errors);
  }

  /**
   * Initialize stats object
   */
  private initializeStats(): BatchProcessorStats {
    return {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      startTime: new Date()
    };
  }

  /**
   * Calculate average batch processing time
   */
  private calculateAverageBatchTime(): void {
    if (this.stats.endTime && this.stats.totalProcessed > 0) {
      const totalTime = this.stats.endTime.getTime() - this.stats.startTime.getTime();
      const totalBatches = Math.ceil(this.stats.totalProcessed / this.config.batchSize);
      this.stats.avgBatchTime = totalBatches > 0 ? totalTime / totalBatches : 0;
    }
  }

  /**
   * Display final processing statistics
   */
  private displayFinalStats(): void {
    const duration = this.stats.endTime
      ? this.stats.endTime.getTime() - this.stats.startTime.getTime()
      : Date.now() - this.stats.startTime.getTime();

    console.log(`⏱️  Duration: ${this.formatDuration(duration)}`);
    console.log(`📊 Total Processed: ${this.stats.totalProcessed.toLocaleString()}`);
    console.log(`✅ Successful: ${this.stats.successful.toLocaleString()}`);
    console.log(`❌ Failed: ${this.stats.failed.toLocaleString()}`);
    console.log(`⏭️  Skipped: ${this.stats.skipped.toLocaleString()}`);

    if (this.stats.totalProcessed > 0) {
      const successRate = (this.stats.successful / this.stats.totalProcessed) * 100;
      console.log(`📈 Success Rate: ${successRate.toFixed(1)}%`);
    }

    if (this.stats.avgBatchTime) {
      console.log(`⚡ Avg Batch Time: ${this.formatDuration(this.stats.avgBatchTime)}`);
    }

    if (this.stats.errors.length > 0) {
      console.log(`⚠️  Errors: ${this.stats.errors.length}`);
    }
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  /**
   * Delay execution for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current statistics
   */
  getStats(): BatchProcessorStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = this.initializeStats();
  }

  /**
   * Set progress reporter
   */
  setProgressReporter(reporter: ProgressReporter): void {
    this.progressReporter = reporter;
  }

  /**
   * Set checkpoint handlers
   */
  setCheckpointHandlers(saver: CheckpointSaver, loader: CheckpointLoader): void {
    this.checkpointSaver = saver;
    this.checkpointLoader = loader;
    this.config.enableCheckpointing = true;
  }
}

/**
 * Default progress reporter implementation
 */
export function defaultProgressReporter(
  processed: number,
  total: number,
  batchIndex: number,
  stats: BatchProcessorStats
): void {
  const progress = Math.round((processed / total) * 100);
  const successRate = processed > 0 ? (stats.successful / processed) * 100 : 0;

  console.log(
    `📈 Progress: ${progress}% (${processed.toLocaleString()}/${total.toLocaleString()}) | ` +
    `Success: ${successRate.toFixed(1)}% | Batch: ${batchIndex}`
  );
}

/**
 * Migration-specific batch processor factory
 * Following existing migration patterns from office-migration.ts
 */
export class MigrationBatchProcessor {
  /**
   * Create a batch processor for database migration operations
   */
  static createMigrationProcessor<TInput, TOutput>(
    config: {
      batchSize?: number;
      maxRetries?: number;
      enableCheckpointing?: boolean;
      progressReporting?: boolean;
    } = {}
  ): BatchProcessorService<TInput, TOutput> {
    const processorConfig: Partial<BatchProcessorConfig> = {
      batchSize: config.batchSize || 500, // Following existing pattern
      maxRetries: config.maxRetries || 3,
      retryDelay: 1000,
      parallelism: 1, // Sequential processing for data consistency
      progressReportingInterval: 1, // Report every batch for migration visibility
      continueOnError: true, // Continue processing other items if one fails
      enableCheckpointing: config.enableCheckpointing ?? false
    };

    const progressReporter = config.progressReporting !== false ? defaultProgressReporter : undefined;

    return new BatchProcessorService<TInput, TOutput>(
      processorConfig,
      progressReporter
    );
  }

  /**
   * Create item processor from existing migration patterns
   */
  static createItemProcessor<TInput, TOutput>(
    transformFunction: (item: TInput) => TOutput,
    insertFunction: (transformed: TOutput, original: TInput) => Promise<{ success: boolean; id?: string; error?: string }>,
    duplicateCheckFunction?: (item: TInput) => Promise<string | null>,
    lineageFunction?: (legacyId: any, newId: string, item: TInput) => Promise<void>
  ): ItemProcessor<TInput, TOutput> {
    return async (item: TInput, index: number): Promise<TOutput | null> => {
      try {
        // Check for duplicates (following existing pattern)
        if (duplicateCheckFunction) {
          const existingId = await duplicateCheckFunction(item);
          if (existingId) {
            // Record lineage for duplicate
            if (lineageFunction && (item as any).legacy_id) {
              await lineageFunction((item as any).legacy_id, existingId, item);
            }
            console.log(`⏭️  Skipped duplicate at index ${index}`);
            return null; // Skipped
          }
        }

        // Transform item (following existing pattern)
        const transformed = transformFunction(item);

        // Insert transformed item
        const insertResult = await insertFunction(transformed, item);

        if (insertResult.success) {
          // Record lineage mapping (following existing pattern)
          if (lineageFunction && insertResult.id && (item as any).legacy_id) {
            await lineageFunction((item as any).legacy_id, insertResult.id, item);
          }
          console.log(`✅ Processed item at index ${index}`);
          return transformed;
        } else {
          console.error(`❌ Failed to insert item at index ${index}: ${insertResult.error}`);
          throw new Error(`Insert failed: ${insertResult.error}`);
        }

      } catch (error) {
        console.error(`❌ Error processing item at index ${index}:`, error);
        throw error;
      }
    };
  }

  /**
   * Create a simple batch processor for database operations
   */
  static createDatabaseBatchProcessor<TInput, TOutput>(
    pool: Pool,
    batchOperation: (batch: TInput[], client: PoolClient) => Promise<TOutput[]>
  ): BatchProcessor<TInput, TOutput> {
    return async (batch: TInput[], batchIndex: number): Promise<TOutput[]> => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const results = await batchOperation(batch, client);
        await client.query('COMMIT');

        console.log(`✅ Batch ${batchIndex}: ${results.length}/${batch.length} items processed`);
        return results;

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Batch ${batchIndex} failed:`, error);
        throw error;

      } finally {
        client.release();
      }
    };
  }
}
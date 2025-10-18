/**
 * T008: Progress tracking utility
 * Real-time progress monitoring for migration operations
 */

import {
  ProgressTracker,
  BatchResult,
  MigrationStats
} from '../interfaces/migration-types';

export class ProgressTrackingService {
  private progressMap: Map<string, ProgressTracker> = new Map();
  private startTimes: Map<string, Date> = new Map();

  /**
   * Initialize progress tracking for a migration
   */
  initializeProgress(
    migrationName: string,
    totalRecords: number,
    batchSize: number
  ): ProgressTracker {
    const tracker: ProgressTracker = {
      totalRecords,
      processedRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      currentBatch: 0,
      totalBatches: Math.ceil(totalRecords / batchSize),
      startTime: new Date(),
      estimatedTimeRemaining: 0,
      progressPercentage: 0
    };

    this.progressMap.set(migrationName, tracker);
    this.startTimes.set(migrationName, new Date());

    console.log(`📊 Progress tracking initialized for ${migrationName}`);
    console.log(`   Total records: ${totalRecords.toLocaleString()}`);
    console.log(`   Total batches: ${tracker.totalBatches}`);
    console.log(`   Batch size: ${batchSize}`);

    return tracker;
  }

  /**
   * Update progress with batch results
   */
  updateProgress(
    migrationName: string,
    batchResult: BatchResult
  ): ProgressTracker | null {
    const tracker = this.progressMap.get(migrationName);
    if (!tracker) {
      console.error(`No progress tracker found for migration: ${migrationName}`);
      return null;
    }

    // Update counters
    tracker.currentBatch = batchResult.batchNumber;
    tracker.processedRecords += batchResult.processed;
    tracker.successfulRecords += batchResult.successful;
    tracker.failedRecords += batchResult.failed;
    tracker.skippedRecords += batchResult.skipped;

    // Calculate progress percentage
    tracker.progressPercentage = (tracker.processedRecords / tracker.totalRecords) * 100;

    // Calculate estimated time remaining
    if (tracker.processedRecords > 0) {
      const elapsed = Date.now() - tracker.startTime.getTime();
      const rate = tracker.processedRecords / elapsed; // records per millisecond
      const remaining = tracker.totalRecords - tracker.processedRecords;
      tracker.estimatedTimeRemaining = remaining / rate;
    }

    this.progressMap.set(migrationName, tracker);
    return tracker;
  }

  /**
   * Get current progress for a migration
   */
  getProgress(migrationName: string): ProgressTracker | null {
    return this.progressMap.get(migrationName) || null;
  }

  /**
   * Print progress report to console
   */
  printProgress(migrationName: string): void {
    const tracker = this.progressMap.get(migrationName);
    if (!tracker) {
      console.log(`No progress data for ${migrationName}`);
      return;
    }

    const progressPercent = tracker.progressPercentage.toFixed(1);
    const processed = tracker.processedRecords.toLocaleString();
    const total = tracker.totalRecords.toLocaleString();
    const success = tracker.successfulRecords.toLocaleString();
    const skipped = tracker.skippedRecords.toLocaleString();
    const errors = tracker.failedRecords.toLocaleString();

    console.log(`📊 ${migrationName} Progress: ${progressPercent}% (${processed}/${total})`);
    console.log(`   Batch: ${tracker.currentBatch}/${tracker.totalBatches}`);
    console.log(`   Success: ${success}, Skipped: ${skipped}, Errors: ${errors}`);

    if (tracker.estimatedTimeRemaining > 0) {
      const remainingMinutes = Math.ceil(tracker.estimatedTimeRemaining / (1000 * 60));
      console.log(`   Estimated time remaining: ${remainingMinutes} minutes`);
    }

    // Show rate if we have enough data
    if (tracker.processedRecords > 100) {
      const elapsed = Date.now() - tracker.startTime.getTime();
      const rate = Math.round(tracker.processedRecords / (elapsed / 1000)); // records per second
      console.log(`   Processing rate: ${rate} records/second`);
    }
  }

  /**
   * Print detailed progress report for all active migrations
   */
  printAllProgress(): void {
    console.log('\n=== MIGRATION PROGRESS SUMMARY ===');

    for (const [migrationName, tracker] of this.progressMap.entries()) {
      const progressPercent = tracker.progressPercentage.toFixed(1);
      const status = tracker.progressPercentage === 100 ? '✅' : '🔄';

      console.log(`${status} ${migrationName}: ${progressPercent}%`);
      console.log(`    Records: ${tracker.successfulRecords.toLocaleString()}/${tracker.totalRecords.toLocaleString()}`);

      if (tracker.skippedRecords > 0) {
        console.log(`    Skipped: ${tracker.skippedRecords.toLocaleString()}`);
      }
      if (tracker.failedRecords > 0) {
        console.log(`    Failed: ${tracker.failedRecords.toLocaleString()}`);
      }
    }
    console.log('=================================\n');
  }

  /**
   * Calculate overall migration progress across all tables
   */
  getOverallProgress(): {
    totalMigrations: number;
    completedMigrations: number;
    totalRecords: number;
    processedRecords: number;
    overallPercentage: number;
  } {
    let totalRecords = 0;
    let processedRecords = 0;
    let completedMigrations = 0;

    for (const tracker of this.progressMap.values()) {
      totalRecords += tracker.totalRecords;
      processedRecords += tracker.processedRecords;

      if (tracker.progressPercentage === 100) {
        completedMigrations++;
      }
    }

    return {
      totalMigrations: this.progressMap.size,
      completedMigrations,
      totalRecords,
      processedRecords,
      overallPercentage: totalRecords > 0 ? (processedRecords / totalRecords) * 100 : 0
    };
  }

  /**
   * Generate final migration statistics
   */
  generateFinalStats(migrationName: string): MigrationStats | null {
    const tracker = this.progressMap.get(migrationName);
    if (!tracker) return null;

    const startTime = this.startTimes.get(migrationName) || tracker.startTime;
    const endTime = new Date();

    return {
      totalProcessed: tracker.processedRecords,
      successful: tracker.successfulRecords,
      failed: tracker.failedRecords,
      skipped: tracker.skippedRecords,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      errorDetails: []
    };
  }

  /**
   * Clear progress tracking for completed migration
   */
  clearProgress(migrationName: string): void {
    this.progressMap.delete(migrationName);
    this.startTimes.delete(migrationName);
  }

  /**
   * Export progress data for external monitoring
   */
  exportProgressData(): { [migrationName: string]: ProgressTracker } {
    const result: { [migrationName: string]: ProgressTracker } = {};

    for (const [name, tracker] of this.progressMap.entries()) {
      result[name] = { ...tracker };
    }

    return result;
  }

  /**
   * Create progress checkpoint for recovery
   */
  createCheckpoint(migrationName: string): ProgressCheckpoint | null {
    const tracker = this.progressMap.get(migrationName);
    if (!tracker) return null;

    return {
      migrationName,
      timestamp: new Date(),
      currentBatch: tracker.currentBatch,
      processedRecords: tracker.processedRecords,
      successfulRecords: tracker.successfulRecords,
      failedRecords: tracker.failedRecords,
      skippedRecords: tracker.skippedRecords,
      canResume: true
    };
  }

  /**
   * Restore progress from checkpoint
   */
  restoreFromCheckpoint(checkpoint: ProgressCheckpoint): boolean {
    try {
      const existingTracker = this.progressMap.get(checkpoint.migrationName);
      if (!existingTracker) {
        console.error(`Cannot restore checkpoint: no tracker for ${checkpoint.migrationName}`);
        return false;
      }

      // Update tracker with checkpoint data
      existingTracker.currentBatch = checkpoint.currentBatch;
      existingTracker.processedRecords = checkpoint.processedRecords;
      existingTracker.successfulRecords = checkpoint.successfulRecords;
      existingTracker.failedRecords = checkpoint.failedRecords;
      existingTracker.skippedRecords = checkpoint.skippedRecords;

      // Recalculate progress percentage
      existingTracker.progressPercentage =
        (existingTracker.processedRecords / existingTracker.totalRecords) * 100;

      this.progressMap.set(checkpoint.migrationName, existingTracker);

      console.log(`🔄 Progress restored from checkpoint for ${checkpoint.migrationName}`);
      console.log(`   Resuming from batch ${checkpoint.currentBatch}`);
      console.log(`   Progress: ${existingTracker.progressPercentage.toFixed(1)}%`);

      return true;
    } catch (error) {
      console.error(`Failed to restore checkpoint: ${error}`);
      return false;
    }
  }
}

// Progress checkpoint interface
export interface ProgressCheckpoint {
  migrationName: string;
  timestamp: Date;
  currentBatch: number;
  processedRecords: number;
  successfulRecords: number;
  failedRecords: number;
  skippedRecords: number;
  canResume: boolean;
}

// Global progress tracking instance
export const globalProgressTracker = new ProgressTrackingService();
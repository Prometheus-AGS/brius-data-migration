/**
 * MigrationMetrics Model
 *
 * Detailed performance and success metrics for each migration operation.
 */

import { v4 as uuidv4 } from 'uuid';

export interface MigrationMetricsData {
  id: string;
  scriptId: string;
  entityId?: string;
  executionDate: string;
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  recordsSkipped: number;
  executionTimeMs: number;
  throughputPerSecond: number;
  errorDetails?: any;
}

export class MigrationMetrics {
  public readonly id: string;
  public readonly scriptId: string;
  public readonly entityId?: string;
  public readonly executionDate: string;
  public readonly recordsProcessed: number;
  public readonly recordsSuccessful: number;
  public readonly recordsFailed: number;
  public readonly recordsSkipped: number;
  public readonly executionTimeMs: number;
  public readonly throughputPerSecond: number;
  public readonly errorDetails?: any;

  constructor(data: Omit<Partial<MigrationMetricsData>, 'scriptId'> & { scriptId: string }) {
    this.id = data.id || uuidv4();
    this.scriptId = data.scriptId;
    this.entityId = data.entityId;
    this.executionDate = data.executionDate || new Date().toISOString();
    this.recordsProcessed = data.recordsProcessed || 0;
    this.recordsSuccessful = data.recordsSuccessful || 0;
    this.recordsFailed = data.recordsFailed || 0;
    this.recordsSkipped = data.recordsSkipped || 0;
    this.executionTimeMs = data.executionTimeMs || 0;
    this.throughputPerSecond = data.throughputPerSecond || 0;
    this.errorDetails = data.errorDetails;

    this.validateData();
  }

  private validateData(): void {
    if (!this.scriptId || !this.scriptId.trim()) {
      throw new Error('Script ID is required');
    }

    if (this.recordsProcessed < 0) {
      throw new Error('Records processed must be non-negative');
    }

    if (this.recordsSuccessful < 0) {
      throw new Error('Records successful must be non-negative');
    }

    if (this.recordsFailed < 0) {
      throw new Error('Records failed must be non-negative');
    }

    if (this.recordsSkipped < 0) {
      throw new Error('Records skipped must be non-negative');
    }

    if (this.recordsSuccessful + this.recordsFailed + this.recordsSkipped > this.recordsProcessed) {
      throw new Error('Sum of successful, failed, and skipped records cannot exceed processed records');
    }

    if (this.executionTimeMs < 0) {
      throw new Error('Execution time must be non-negative');
    }

    if (this.throughputPerSecond < 0) {
      throw new Error('Throughput per second must be non-negative');
    }

    if (isNaN(Date.parse(this.executionDate))) {
      throw new Error('Execution date must be a valid ISO date string');
    }
  }

  public getSuccessRate(): number {
    return this.recordsProcessed > 0 ? this.recordsSuccessful / this.recordsProcessed : 0;
  }

  public getFailureRate(): number {
    return this.recordsProcessed > 0 ? this.recordsFailed / this.recordsProcessed : 0;
  }

  public getSkipRate(): number {
    return this.recordsProcessed > 0 ? this.recordsSkipped / this.recordsProcessed : 0;
  }

  public getThroughputValidation(): { valid: boolean; calculatedThroughput: number; difference: number } {
    const calculatedThroughput = this.executionTimeMs > 0
      ? (this.recordsProcessed / this.executionTimeMs) * 1000
      : 0;

    const difference = Math.abs(this.throughputPerSecond - calculatedThroughput);
    const valid = difference < 1; // Allow for rounding differences

    return {
      valid,
      calculatedThroughput,
      difference
    };
  }

  public hasErrors(): boolean {
    return this.recordsFailed > 0 || (this.errorDetails && Object.keys(this.errorDetails).length > 0);
  }

  public toJSON(): MigrationMetricsData {
    return {
      id: this.id,
      scriptId: this.scriptId,
      entityId: this.entityId,
      executionDate: this.executionDate,
      recordsProcessed: this.recordsProcessed,
      recordsSuccessful: this.recordsSuccessful,
      recordsFailed: this.recordsFailed,
      recordsSkipped: this.recordsSkipped,
      executionTimeMs: this.executionTimeMs,
      throughputPerSecond: this.throughputPerSecond,
      errorDetails: this.errorDetails
    };
  }

  public static fromDatabaseRow(row: any): MigrationMetrics {
    return new MigrationMetrics({
      id: row.id,
      scriptId: row.script_id,
      entityId: row.entity_id,
      executionDate: row.execution_date,
      recordsProcessed: parseInt(row.records_processed) || 0,
      recordsSuccessful: parseInt(row.records_successful) || 0,
      recordsFailed: parseInt(row.records_failed) || 0,
      recordsSkipped: parseInt(row.records_skipped) || 0,
      executionTimeMs: parseInt(row.execution_time_ms) || 0,
      throughputPerSecond: parseFloat(row.throughput_per_second) || 0,
      errorDetails: row.error_details ? JSON.parse(row.error_details) : undefined
    });
  }

  public static calculateThroughput(recordsProcessed: number, executionTimeMs: number): number {
    return executionTimeMs > 0 ? (recordsProcessed / executionTimeMs) * 1000 : 0;
  }
}
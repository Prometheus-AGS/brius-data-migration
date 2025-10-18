/**
 * T004: Batch processor utility
 * Standardizes batch processing logic across all migrations
 */

import { Client } from 'pg';
import {
  BatchProcessor,
  BatchProcessingResult,
  LookupMappings,
  ValidationIssue,
  MIGRATION_CONSTANTS
} from '../interfaces/migration-types';

export class StandardBatchProcessor<TSource = any, TTarget = any> implements BatchProcessor<TSource, TTarget> {
  constructor(
    private targetClient: Client,
    private transformFunc: (source: TSource, mappings: LookupMappings) => TTarget | null,
    private validateFunc: (target: TTarget) => ValidationIssue[],
    private tableName: string,
    private insertFields: string[]
  ) {}

  /**
   * Process a single batch of records
   */
  async processBatch(
    records: TSource[],
    batchNumber: number,
    lookupMappings: LookupMappings
  ): Promise<BatchProcessingResult<TTarget>> {
    console.log(`  Processing batch ${batchNumber}: ${records.length} records`);

    const transformedRecords: TTarget[] = [];
    const validationIssues: ValidationIssue[] = [];
    let skippedRecords = 0;

    // Transform all records in the batch
    for (const sourceRecord of records) {
      const transformed = this.transformFunc(sourceRecord, lookupMappings);

      if (!transformed) {
        skippedRecords++;
        continue;
      }

      // Validate transformed record
      const issues = this.validateFunc(transformed);
      if (issues.length > 0) {
        validationIssues.push(...issues);

        // Skip records with critical validation issues
        const hasErrors = issues.some(issue => issue.severity === 'error');
        if (hasErrors) {
          skippedRecords++;
          continue;
        }
      }

      transformedRecords.push(transformed);
    }

    // Insert transformed records
    let insertionResult = {
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    if (transformedRecords.length > 0) {
      insertionResult = await this.insertBatch(transformedRecords);
    }

    return {
      batchNumber,
      inputRecords: records.length,
      transformedRecords,
      skippedRecords,
      validationIssues,
      insertionResult
    };
  }

  /**
   * Transform source record to target format
   * Uses the provided transform function
   */
  transformRecord(sourceRecord: TSource, lookupMappings: LookupMappings): TTarget | null {
    return this.transformFunc(sourceRecord, lookupMappings);
  }

  /**
   * Validate transformed record before insertion
   * Uses the provided validation function
   */
  validateRecord(targetRecord: TTarget): ValidationIssue[] {
    return this.validateFunc(targetRecord);
  }

  /**
   * Insert batch of records into target database
   */
  private async insertBatch(records: TTarget[]): Promise<{successful: number; failed: number; errors: string[]}> {
    if (records.length === 0) {
      return { successful: 0, failed: 0, errors: [] };
    }

    try {
      // Build parameterized insert query
      const values = records.map((_, index) => {
        const base = index * this.insertFields.length;
        return `(${this.insertFields.map((_, i) => `$${base + i + 1}`).join(', ')})`;
      }).join(', ');

      const query = `
        INSERT INTO ${this.tableName} (${this.insertFields.join(', ')})
        VALUES ${values}
        ON CONFLICT DO NOTHING
      `;

      // Build query parameters
      const queryParams: any[] = [];
      for (const record of records) {
        for (const field of this.insertFields) {
          queryParams.push((record as any)[field]);
        }
      }

      const result = await this.targetClient.query(query, queryParams);

      return {
        successful: result.rowCount || 0,
        failed: 0,
        errors: []
      };

    } catch (error: any) {
      console.error('  Batch insert error:', error.message);
      return {
        successful: 0,
        failed: records.length,
        errors: [error.message]
      };
    }
  }

  /**
   * Utility to build lookup mappings from target tables
   */
  protected async buildBasicLookupMappings(): Promise<LookupMappings> {
    const mappings: LookupMappings = {
      patients: {},
      profiles: {},
      orders: {},
      cases: {},
      files: {},
      messages: {}
    };

    try {
      // Build patient mapping
      const patientResult = await this.targetClient.query(`
        SELECT id, legacy_patient_id
        FROM patients
        WHERE legacy_patient_id IS NOT NULL
      `);
      for (const row of patientResult.rows) {
        mappings.patients[row.legacy_patient_id] = row.id;
      }

      // Build profile mapping
      const profileResult = await this.targetClient.query(`
        SELECT id, legacy_user_id
        FROM profiles
        WHERE legacy_user_id IS NOT NULL
      `);
      for (const row of profileResult.rows) {
        mappings.profiles[row.legacy_user_id] = row.id;
      }

      // Build order mapping
      const orderResult = await this.targetClient.query(`
        SELECT id, legacy_instruction_id
        FROM orders
        WHERE legacy_instruction_id IS NOT NULL
      `);
      for (const row of orderResult.rows) {
        mappings.orders[row.legacy_instruction_id] = row.id;
      }

      // Build case mapping
      const caseResult = await this.targetClient.query(`
        SELECT id, legacy_patient_id
        FROM cases
        WHERE legacy_patient_id IS NOT NULL
      `);
      for (const row of caseResult.rows) {
        mappings.cases[row.legacy_patient_id] = row.id;
      }

      // Build file mapping
      const fileResult = await this.targetClient.query(`
        SELECT id, legacy_file_id
        FROM files
        WHERE legacy_file_id IS NOT NULL
      `);
      for (const row of fileResult.rows) {
        mappings.files[row.legacy_file_id] = row.id;
      }

      // Build message mapping
      const messageResult = await this.targetClient.query(`
        SELECT id, legacy_record_id
        FROM messages
        WHERE legacy_record_id IS NOT NULL
      `);
      for (const row of messageResult.rows) {
        mappings.messages[row.legacy_record_id] = row.id;
      }

      console.log('✅ Lookup mappings built:', {
        patients: Object.keys(mappings.patients).length,
        profiles: Object.keys(mappings.profiles).length,
        orders: Object.keys(mappings.orders).length,
        cases: Object.keys(mappings.cases).length,
        files: Object.keys(mappings.files).length,
        messages: Object.keys(mappings.messages).length
      });

      return mappings;

    } catch (error: any) {
      throw new Error(`Failed to build lookup mappings: ${error.message}`);
    }
  }

  /**
   * Initialize progress tracking
   */
  protected initializeProgress(totalRecords: number): void {
    this.progress = {
      totalRecords,
      processedRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      currentBatch: 0,
      totalBatches: Math.ceil(totalRecords / this.config.batchSize),
      startTime: new Date(),
      estimatedTimeRemaining: 0,
      progressPercentage: 0
    };
  }

  /**
   * Update progress with batch results
   */
  protected updateProgressWithBatch(batchResult: BatchProcessingResult<TTarget>): void {
    if (this.progress) {
      this.progress.currentBatch = batchResult.batchNumber;
      this.progress.processedRecords += batchResult.inputRecords;
      this.progress.successfulRecords += batchResult.insertionResult.successful;
      this.progress.failedRecords += batchResult.insertionResult.failed;
      this.progress.skippedRecords += batchResult.skippedRecords;

      // Calculate progress percentage and time remaining
      this.progress.progressPercentage = (this.progress.processedRecords / this.progress.totalRecords) * 100;

      if (this.progress.processedRecords > 0) {
        const elapsed = Date.now() - this.progress.startTime.getTime();
        const rate = this.progress.processedRecords / elapsed;
        const remaining = this.progress.totalRecords - this.progress.processedRecords;
        this.progress.estimatedTimeRemaining = remaining / rate;
      }
    }
  }

  /**
   * Default recovery implementation
   */
  async recover(config: MigrationConfig, lastKnownState?: ErrorRecovery): Promise<boolean> {
    console.log('🔄 Base recovery implementation - subclasses should override for specific recovery logic');
    return false;
  }
}
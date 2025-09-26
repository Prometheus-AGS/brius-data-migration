/**
 * MigrationScript Model
 *
 * Represents individual migration scripts in the repository with their metadata,
 * execution status, and performance metrics.
 */

import { v4 as uuidv4 } from 'uuid';

export enum ScriptCategory {
  CORE = 'core',
  COMMUNICATIONS = 'communications',
  BUSINESS = 'business',
  SPECIALIZED = 'specialized',
  SYSTEM = 'system',
  CRITICAL_FIX = 'critical_fix'
}

export enum DataDomainType {
  CLINICAL = 'clinical',
  BUSINESS = 'business',
  COMMUNICATIONS = 'communications',
  TECHNICAL = 'technical'
}

export enum MigrationStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETE = 'complete',
  FAILED = 'failed',
  ROLLBACK_REQUIRED = 'rollback_required'
}

export interface MigrationScriptData {
  id: string;
  name: string;
  category: ScriptCategory;
  dataDomain: DataDomainType;
  sourceTable?: string;
  targetTable?: string;
  recordCount: number;
  successRate: number;
  status: MigrationStatus;
  lastExecuted?: string;
  filePath?: string;
  description?: string;
}

export class MigrationScript {
  public readonly id: string;
  public readonly name: string;
  public readonly category: ScriptCategory;
  public readonly dataDomain: DataDomainType;
  public readonly sourceTable?: string;
  public readonly targetTable?: string;
  public recordCount: number;
  public successRate: number;
  public status: MigrationStatus;
  public lastExecuted?: string;
  public readonly filePath?: string;
  public readonly description?: string;

  constructor(data: Partial<MigrationScriptData> & { name: string }) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.category = data.category || ScriptCategory.SYSTEM;
    this.dataDomain = data.dataDomain || DataDomainType.TECHNICAL;
    this.sourceTable = data.sourceTable;
    this.targetTable = data.targetTable;
    this.recordCount = data.recordCount || 0;
    this.successRate = data.successRate || 0;
    this.status = data.status || MigrationStatus.NOT_STARTED;
    this.lastExecuted = data.lastExecuted;
    this.filePath = data.filePath;
    this.description = data.description;

    this.validateData();
  }

  private validateData(): void {
    if (!this.name || !this.name.trim()) {
      throw new Error('Migration script name is required');
    }

    if (!this.name.endsWith('.ts')) {
      throw new Error('Migration script name must end with .ts');
    }

    if (this.recordCount < 0) {
      throw new Error('Record count must be non-negative');
    }

    if (this.successRate < 0 || this.successRate > 1) {
      throw new Error('Success rate must be between 0.0 and 1.0');
    }

    if (this.lastExecuted && isNaN(Date.parse(this.lastExecuted))) {
      throw new Error('Last executed must be a valid ISO date string');
    }
  }

  public toJSON(): MigrationScriptData {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      dataDomain: this.dataDomain,
      sourceTable: this.sourceTable,
      targetTable: this.targetTable,
      recordCount: this.recordCount,
      successRate: this.successRate,
      status: this.status,
      lastExecuted: this.lastExecuted,
      filePath: this.filePath,
      description: this.description
    };
  }

  public updateStatus(status: MigrationStatus, recordCount?: number, successRate?: number): void {
    this.status = status;
    this.lastExecuted = new Date().toISOString();

    if (recordCount !== undefined) {
      this.recordCount = recordCount;
    }

    if (successRate !== undefined) {
      if (successRate < 0 || successRate > 1) {
        throw new Error('Success rate must be between 0.0 and 1.0');
      }
      this.successRate = successRate;
    }
  }

  public getSuccessPercentage(): number {
    return Math.round(this.successRate * 10000) / 100; // Return as percentage with 2 decimal places
  }

  public isComplete(): boolean {
    return this.status === MigrationStatus.COMPLETE;
  }

  public hasFailed(): boolean {
    return this.status === MigrationStatus.FAILED || this.status === MigrationStatus.ROLLBACK_REQUIRED;
  }

  public isInProgress(): boolean {
    return this.status === MigrationStatus.IN_PROGRESS;
  }

  public static fromDatabaseRow(row: any): MigrationScript {
    return new MigrationScript({
      id: row.id,
      name: row.name,
      category: row.category as ScriptCategory,
      dataDomain: row.data_domain as DataDomainType,
      sourceTable: row.source_table,
      targetTable: row.target_table,
      recordCount: parseInt(row.record_count) || 0,
      successRate: parseFloat(row.success_rate) || 0,
      status: row.status as MigrationStatus,
      lastExecuted: row.last_executed,
      filePath: row.file_path,
      description: row.description
    });
  }

  public static createFromFile(filename: string, category?: ScriptCategory, dataDomain?: DataDomainType): MigrationScript {
    // Infer category and domain from filename if not provided
    const inferredCategory = category || MigrationScript.inferCategoryFromFilename(filename);
    const inferredDomain = dataDomain || MigrationScript.inferDomainFromFilename(filename);

    return new MigrationScript({
      name: filename,
      category: inferredCategory,
      dataDomain: inferredDomain,
      filePath: filename
    });
  }

  private static inferCategoryFromFilename(filename: string): ScriptCategory {
    if (filename.startsWith('src/') && filename.includes('-migration.ts')) {
      return ScriptCategory.CORE;
    }
    if (filename.includes('message') || filename.includes('comment') || filename.includes('communication')) {
      return ScriptCategory.COMMUNICATIONS;
    }
    if (filename.includes('payment') || filename.includes('billing') || filename.includes('offer')) {
      return ScriptCategory.BUSINESS;
    }
    if (filename.includes('fix-') || filename.includes('validate-')) {
      return ScriptCategory.CRITICAL_FIX;
    }
    if (filename.includes('bracket') || filename.includes('jaw') || filename.includes('scan')) {
      return ScriptCategory.SPECIALIZED;
    }
    return ScriptCategory.SYSTEM;
  }

  private static inferDomainFromFilename(filename: string): DataDomainType {
    if (filename.includes('patient') || filename.includes('doctor') || filename.includes('order') || filename.includes('treatment')) {
      return DataDomainType.CLINICAL;
    }
    if (filename.includes('office') || filename.includes('payment') || filename.includes('billing')) {
      return DataDomainType.BUSINESS;
    }
    if (filename.includes('message') || filename.includes('comment') || filename.includes('communication') || filename.includes('feedback')) {
      return DataDomainType.COMMUNICATIONS;
    }
    return DataDomainType.TECHNICAL;
  }
}
/**
 * DataEntity Model
 *
 * Represents specific data entities within each domain (e.g., patients, orders, messages).
 */

import { v4 as uuidv4 } from 'uuid';

export interface DataEntityData {
  id: string;
  name: string;
  domainId: string;
  legacyTable?: string;
  targetTable?: string;
  totalRecords: number;
  migratedRecords: number;
  failedRecords: number;
  migrationScriptId?: string;
  lastMigrated?: string;
}

export class DataEntity {
  public readonly id: string;
  public readonly name: string;
  public readonly domainId: string;
  public readonly legacyTable?: string;
  public readonly targetTable?: string;
  public totalRecords: number;
  public migratedRecords: number;
  public failedRecords: number;
  public migrationScriptId?: string;
  public lastMigrated?: string;

  constructor(data: Partial<DataEntityData> & { name: string; domainId: string }) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.domainId = data.domainId;
    this.legacyTable = data.legacyTable;
    this.targetTable = data.targetTable;
    this.totalRecords = data.totalRecords || 0;
    this.migratedRecords = data.migratedRecords || 0;
    this.failedRecords = data.failedRecords || 0;
    this.migrationScriptId = data.migrationScriptId;
    this.lastMigrated = data.lastMigrated;

    this.validateData();
  }

  private validateData(): void {
    if (!this.name || !this.name.trim()) {
      throw new Error('Entity name is required');
    }

    if (!this.domainId || !this.domainId.trim()) {
      throw new Error('Domain ID is required');
    }

    if (this.totalRecords < 0) {
      throw new Error('Total records must be non-negative');
    }

    if (this.migratedRecords < 0) {
      throw new Error('Migrated records must be non-negative');
    }

    if (this.failedRecords < 0) {
      throw new Error('Failed records must be non-negative');
    }

    if (this.migratedRecords + this.failedRecords > this.totalRecords) {
      throw new Error('Migrated + failed records cannot exceed total records');
    }

    if (this.lastMigrated && isNaN(Date.parse(this.lastMigrated))) {
      throw new Error('Last migrated must be a valid ISO date string');
    }
  }

  public getSuccessRate(): number {
    if (this.totalRecords === 0) return 0;
    return this.migratedRecords / this.totalRecords;
  }

  public getSuccessPercentage(): number {
    return Math.round(this.getSuccessRate() * 10000) / 100;
  }

  public getSkippedRecords(): number {
    return this.totalRecords - this.migratedRecords - this.failedRecords;
  }

  public updateMigrationStats(migrated: number, failed: number, total?: number): void {
    if (total !== undefined) {
      this.totalRecords = total;
    }
    this.migratedRecords = migrated;
    this.failedRecords = failed;
    this.lastMigrated = new Date().toISOString();

    this.validateData();
  }

  public isFullyMigrated(): boolean {
    return this.totalRecords > 0 && this.migratedRecords === this.totalRecords;
  }

  public hasMigrationIssues(): boolean {
    return this.failedRecords > 0 || (this.totalRecords > 0 && this.migratedRecords === 0);
  }

  public toJSON(): DataEntityData {
    return {
      id: this.id,
      name: this.name,
      domainId: this.domainId,
      legacyTable: this.legacyTable,
      targetTable: this.targetTable,
      totalRecords: this.totalRecords,
      migratedRecords: this.migratedRecords,
      failedRecords: this.failedRecords,
      migrationScriptId: this.migrationScriptId,
      lastMigrated: this.lastMigrated
    };
  }

  public static fromDatabaseRow(row: any): DataEntity {
    return new DataEntity({
      id: row.id,
      name: row.name,
      domainId: row.domain_id,
      legacyTable: row.legacy_table,
      targetTable: row.target_table,
      totalRecords: parseInt(row.total_records) || 0,
      migratedRecords: parseInt(row.migrated_records) || 0,
      failedRecords: parseInt(row.failed_records) || 0,
      migrationScriptId: row.migration_script_id,
      lastMigrated: row.last_migrated
    });
  }
}
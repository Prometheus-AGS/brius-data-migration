/**
 * LegacyMapping Model
 *
 * Maintains traceability between legacy and modern system identifiers.
 */

import { v4 as uuidv4 } from 'uuid';

export interface LegacyMappingData {
  id: string;
  entityType: string;
  legacyId: number;
  modernId: string;
  migrationBatch: string;
  migratedAt: string;
  metadata?: any;
}

export class LegacyMapping {
  public readonly id: string;
  public readonly entityType: string;
  public readonly legacyId: number;
  public readonly modernId: string;
  public readonly migrationBatch: string;
  public readonly migratedAt: string;
  public readonly metadata?: any;

  constructor(data: Omit<Partial<LegacyMappingData>, 'entityType' | 'legacyId' | 'modernId'> & {
    entityType: string;
    legacyId: number;
    modernId: string;
  }) {
    this.id = data.id || uuidv4();
    this.entityType = data.entityType;
    this.legacyId = data.legacyId;
    this.modernId = data.modernId;
    this.migrationBatch = data.migrationBatch || `migration_${Date.now()}`;
    this.migratedAt = data.migratedAt || new Date().toISOString();
    this.metadata = data.metadata;

    this.validateData();
  }

  private validateData(): void {
    if (!this.entityType || !this.entityType.trim()) {
      throw new Error('Entity type is required');
    }

    if (!Number.isInteger(this.legacyId) || this.legacyId < 0) {
      throw new Error('Legacy ID must be a non-negative integer');
    }

    if (!this.modernId || !this.modernId.trim()) {
      throw new Error('Modern ID is required');
    }

    if (!this.isValidUUID(this.modernId)) {
      throw new Error('Modern ID must be a valid UUID');
    }

    if (!this.migrationBatch || !this.migrationBatch.trim()) {
      throw new Error('Migration batch is required');
    }

    if (isNaN(Date.parse(this.migratedAt))) {
      throw new Error('Migrated at must be a valid ISO date string');
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  public toJSON(): LegacyMappingData {
    return {
      id: this.id,
      entityType: this.entityType,
      legacyId: this.legacyId,
      modernId: this.modernId,
      migrationBatch: this.migrationBatch,
      migratedAt: this.migratedAt,
      metadata: this.metadata
    };
  }

  public static fromDatabaseRow(row: any): LegacyMapping {
    return new LegacyMapping({
      id: row.id,
      entityType: row.entity_type,
      legacyId: parseInt(row.legacy_id),
      modernId: row.modern_id,
      migrationBatch: row.migration_batch,
      migratedAt: row.migrated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    });
  }

  public static isValidEntityType(entityType: string): boolean {
    const validTypes = [
      'office', 'profile', 'doctor', 'patient', 'order', 'product',
      'jaw', 'project', 'treatment', 'case', 'task', 'file',
      'message', 'comment', 'notification', 'feedback'
    ];
    return validTypes.includes(entityType.toLowerCase());
  }
}
// UUID Mapper Utility
// Extends existing migration patterns for UUID generation and legacy ID mapping

import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';

export interface LegacyMapping {
  entityType: string;
  legacyId: string;
  uuid: string;
  migrationBatch: string;
  migratedAt: Date;
  sourceTable?: string;
  targetTable?: string;
  checksum?: string;
  metadata?: Record<string, any>;
}

export interface MappingLookupResult {
  found: boolean;
  uuid?: string;
  mapping?: LegacyMapping;
}

export interface BulkMappingResult {
  successful: number;
  failed: number;
  duplicates: number;
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  invalidMappings: Array<{
    legacyId: string;
    issue: string;
  }>;
}

export class UUIDMapperService {
  private uuidCache: Map<string, string> = new Map();
  private batchCache: Map<string, LegacyMapping[]> = new Map();
  private cacheEnabled: boolean = true;

  constructor(private db: Pool, enableCache: boolean = true) {
    this.cacheEnabled = enableCache;
  }

  /**
   * Generate UUID v4 (following existing pattern from orders-migration-comprehensive.ts)
   */
  static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Generate multiple UUIDs at once
   */
  static generateUUIDs(count: number): string[] {
    return Array.from({ length: count }, () => this.generateUUID());
  }

  /**
   * Create UUID mapping entry (following existing pattern from office-migration.ts)
   */
  async createMapping(
    entityType: string,
    legacyId: string | number,
    uuid?: string,
    options?: {
      migrationBatch?: string;
      sourceTable?: string;
      targetTable?: string;
      metadata?: Record<string, any>;
      client?: PoolClient;
    }
  ): Promise<string> {
    const mappingUuid = uuid || UUIDMapperService.generateUUID();
    const legacyIdStr = legacyId.toString();

    const query = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, uuid_id, migration_batch,
        migration_timestamp, validation_status, source_table,
        target_table, checksum, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
        uuid_id = EXCLUDED.uuid_id,
        migration_timestamp = EXCLUDED.migration_timestamp,
        migration_batch = EXCLUDED.migration_batch
      RETURNING uuid_id
    `;

    const migrationBatch = options?.migrationBatch ||
      `${entityType}_mapping_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_${Date.now()}`;

    const checksum = this.generateChecksum(legacyIdStr + mappingUuid + entityType);

    const values = [
      entityType,
      legacyIdStr,
      mappingUuid,
      migrationBatch,
      new Date(),
      'validated', // Following existing pattern
      options?.sourceTable || `dispatch_${entityType.replace('-', '_')}`,
      options?.targetTable || entityType.replace('-', '_'),
      checksum,
      JSON.stringify(options?.metadata || {})
    ];

    try {
      const client = options?.client || this.db;
      const result = await client.query(query, values);

      // Update cache
      if (this.cacheEnabled) {
        const cacheKey = `${entityType}:${legacyIdStr}`;
        this.uuidCache.set(cacheKey, mappingUuid);
      }

      return result.rows[0].uuid_id;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`⚠️  Failed to create mapping for ${entityType}[${legacyIdStr}]:`, errorMessage);
      throw new Error(`UUID mapping creation failed: ${errorMessage}`);
    }
  }

  /**
   * Lookup UUID by legacy ID
   */
  async lookupUUID(entityType: string, legacyId: string | number): Promise<MappingLookupResult> {
    const legacyIdStr = legacyId.toString();
    const cacheKey = `${entityType}:${legacyIdStr}`;

    // Check cache first
    if (this.cacheEnabled && this.uuidCache.has(cacheKey)) {
      return {
        found: true,
        uuid: this.uuidCache.get(cacheKey)!
      };
    }

    const query = `
      SELECT uuid_id, migration_batch, migration_timestamp,
             source_table, target_table, checksum, metadata
      FROM migration_mappings
      WHERE entity_type = $1 AND legacy_id = $2
    `;

    try {
      const result = await this.db.query(query, [entityType, legacyIdStr]);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const mapping: LegacyMapping = {
          entityType,
          legacyId: legacyIdStr,
          uuid: row.uuid_id,
          migrationBatch: row.migration_batch,
          migratedAt: new Date(row.migration_timestamp),
          sourceTable: row.source_table,
          targetTable: row.target_table,
          checksum: row.checksum,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
        };

        // Update cache
        if (this.cacheEnabled) {
          this.uuidCache.set(cacheKey, row.uuid_id);
        }

        return {
          found: true,
          uuid: row.uuid_id,
          mapping
        };
      }

      return { found: false };

    } catch (error) {
      console.error(`❌ Error looking up UUID for ${entityType}[${legacyIdStr}]:`, error);
      return { found: false };
    }
  }

  /**
   * Bulk lookup UUIDs for multiple legacy IDs
   */
  async bulkLookupUUIDs(
    entityType: string,
    legacyIds: (string | number)[]
  ): Promise<Map<string, string>> {
    const legacyIdStrings = legacyIds.map(id => id.toString());
    const results = new Map<string, string>();

    // Check cache first
    if (this.cacheEnabled) {
      legacyIdStrings.forEach(legacyId => {
        const cacheKey = `${entityType}:${legacyId}`;
        const cachedUuid = this.uuidCache.get(cacheKey);
        if (cachedUuid) {
          results.set(legacyId, cachedUuid);
        }
      });
    }

    // Find uncached IDs
    const uncachedIds = legacyIdStrings.filter(id => !results.has(id));

    if (uncachedIds.length === 0) {
      return results;
    }

    const query = `
      SELECT legacy_id, uuid_id
      FROM migration_mappings
      WHERE entity_type = $1 AND legacy_id = ANY($2::text[])
    `;

    try {
      const result = await this.db.query(query, [entityType, uncachedIds]);

      result.rows.forEach(row => {
        results.set(row.legacy_id, row.uuid_id);

        // Update cache
        if (this.cacheEnabled) {
          const cacheKey = `${entityType}:${row.legacy_id}`;
          this.uuidCache.set(cacheKey, row.uuid_id);
        }
      });

      return results;

    } catch (error) {
      console.error(`❌ Error in bulk UUID lookup for ${entityType}:`, error);
      return results; // Return partial results
    }
  }

  /**
   * Create bulk mappings efficiently
   */
  async createBulkMappings(
    mappings: Array<{
      entityType: string;
      legacyId: string | number;
      uuid?: string;
      migrationBatch?: string;
      sourceTable?: string;
      targetTable?: string;
      metadata?: Record<string, any>;
    }>,
    client?: PoolClient
  ): Promise<BulkMappingResult> {
    const result: BulkMappingResult = {
      successful: 0,
      failed: 0,
      duplicates: 0,
      errors: []
    };

    if (mappings.length === 0) {
      return result;
    }

    // Group by entity type for better performance
    const groupedMappings = this.groupMappingsByEntity(mappings);

    const dbClient = client || this.db;

    for (const [entityType, entityMappings] of Object.entries(groupedMappings)) {
      try {
        const batchResult = await this.insertMappingBatch(entityType, entityMappings, dbClient);
        result.successful += batchResult.successful;
        result.failed += batchResult.failed;
        result.duplicates += batchResult.duplicates;
        result.errors.push(...batchResult.errors);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.failed += entityMappings.length;
        result.errors.push(`Batch failed for ${entityType}: ${errorMessage}`);
      }
    }

    return result;
  }

  /**
   * Insert a batch of mappings for a single entity type
   */
  private async insertMappingBatch(
    entityType: string,
    mappings: any[],
    client: Pool | PoolClient
  ): Promise<BulkMappingResult> {
    const result: BulkMappingResult = { successful: 0, failed: 0, duplicates: 0, errors: [] };

    // Build values array for bulk insert
    const values: any[] = [];
    const placeholders: string[] = [];

    mappings.forEach((mapping, index) => {
      const baseIndex = index * 10;
      const uuid = mapping.uuid || UUIDMapperService.generateUUID();
      const legacyIdStr = mapping.legacyId.toString();
      const migrationBatch = mapping.migrationBatch ||
        `${entityType}_bulk_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_${Date.now()}`;

      const checksum = this.generateChecksum(legacyIdStr + uuid + entityType);

      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10})`
      );

      values.push(
        entityType,
        legacyIdStr,
        uuid,
        migrationBatch,
        new Date(),
        'validated',
        mapping.sourceTable || `dispatch_${entityType.replace('-', '_')}`,
        mapping.targetTable || entityType.replace('-', '_'),
        checksum,
        JSON.stringify(mapping.metadata || {})
      );

      // Update cache
      if (this.cacheEnabled) {
        const cacheKey = `${entityType}:${legacyIdStr}`;
        this.uuidCache.set(cacheKey, uuid);
      }
    });

    const query = `
      INSERT INTO migration_mappings (
        entity_type, legacy_id, uuid_id, migration_batch,
        migration_timestamp, validation_status, source_table,
        target_table, checksum, metadata
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (entity_type, legacy_id) DO UPDATE SET
        uuid_id = EXCLUDED.uuid_id,
        migration_timestamp = EXCLUDED.migration_timestamp,
        migration_batch = EXCLUDED.migration_batch
    `;

    try {
      await client.query(query, values);
      result.successful = mappings.length;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.failed = mappings.length;
      result.errors.push(`Bulk insert failed for ${entityType}: ${errorMessage}`);
    }

    return result;
  }

  /**
   * Resolve legacy ID to UUID with caching
   */
  async resolveUUID(entityType: string, legacyId: string | number): Promise<string> {
    const lookupResult = await this.lookupUUID(entityType, legacyId);

    if (lookupResult.found && lookupResult.uuid) {
      return lookupResult.uuid;
    }

    // Create new mapping if not found
    const newUuid = await this.createMapping(entityType, legacyId);
    console.log(`🆔 Created new UUID mapping: ${entityType}[${legacyId}] → ${newUuid}`);

    return newUuid;
  }

  /**
   * Batch resolve multiple legacy IDs to UUIDs
   */
  async batchResolveUUIDs(
    entityType: string,
    legacyIds: (string | number)[]
  ): Promise<Map<string, string>> {
    const lookupResults = await this.bulkLookupUUIDs(entityType, legacyIds);
    const missingIds: (string | number)[] = [];

    // Find IDs that don't have mappings
    legacyIds.forEach(legacyId => {
      const legacyIdStr = legacyId.toString();
      if (!lookupResults.has(legacyIdStr)) {
        missingIds.push(legacyId);
      }
    });

    // Create mappings for missing IDs
    if (missingIds.length > 0) {
      console.log(`🆔 Creating ${missingIds.length} new UUID mappings for ${entityType}`);

      const newMappings = missingIds.map(legacyId => ({
        entityType,
        legacyId,
        uuid: UUIDMapperService.generateUUID(),
        migrationBatch: `batch_resolve_${Date.now()}`
      }));

      await this.createBulkMappings(newMappings);

      // Add new mappings to results
      newMappings.forEach(mapping => {
        lookupResults.set(mapping.legacyId.toString(), mapping.uuid!);
      });
    }

    return lookupResults;
  }

  /**
   * Get mapping statistics for an entity type
   */
  async getMappingStats(entityType?: string): Promise<any> {
    let query = `
      SELECT
        entity_type,
        COUNT(*) as total_mappings,
        COUNT(DISTINCT migration_batch) as unique_batches,
        MIN(migration_timestamp) as first_migration,
        MAX(migration_timestamp) as last_migration,
        COUNT(*) FILTER (WHERE validation_status = 'validated') as validated_mappings
      FROM migration_mappings
    `;

    const values: any[] = [];

    if (entityType) {
      query += ` WHERE entity_type = $1`;
      values.push(entityType);
    }

    query += ` GROUP BY entity_type ORDER BY entity_type`;

    try {
      const result = await this.db.query(query, values);

      return result.rows.map(row => ({
        entity_type: row.entity_type,
        total_mappings: parseInt(row.total_mappings),
        unique_batches: parseInt(row.unique_batches),
        first_migration: row.first_migration,
        last_migration: row.last_migration,
        validated_mappings: parseInt(row.validated_mappings),
        validation_rate: ((parseInt(row.validated_mappings) / parseInt(row.total_mappings)) * 100).toFixed(1) + '%'
      }));

    } catch (error) {
      console.error('❌ Error getting mapping statistics:', error);
      return [];
    }
  }

  /**
   * Validate mapping integrity
   */
  async validateMappings(entityType?: string): Promise<ValidationResult> {
    let query = `
      SELECT
        mm.entity_type,
        mm.legacy_id,
        mm.uuid_id,
        mm.checksum,
        mm.source_table,
        mm.target_table
      FROM migration_mappings mm
    `;

    const values: any[] = [];

    if (entityType) {
      query += ` WHERE mm.entity_type = $1`;
      values.push(entityType);
    }

    query += ` ORDER BY mm.entity_type, mm.legacy_id::integer`;

    try {
      const result = await this.db.query(query, values);
      const invalidMappings: Array<{ legacyId: string; issue: string }> = [];

      for (const row of result.rows) {
        // Validate checksum
        const expectedChecksum = this.generateChecksum(
          row.legacy_id + row.uuid_id + row.entity_type
        );

        if (row.checksum !== expectedChecksum) {
          invalidMappings.push({
            legacyId: row.legacy_id,
            issue: `Invalid checksum for ${row.entity_type}[${row.legacy_id}]`
          });
        }

        // Validate UUID format
        if (!this.isValidUUID(row.uuid_id)) {
          invalidMappings.push({
            legacyId: row.legacy_id,
            issue: `Invalid UUID format for ${row.entity_type}[${row.legacy_id}]: ${row.uuid_id}`
          });
        }
      }

      return {
        valid: invalidMappings.length === 0,
        invalidMappings
      };

    } catch (error) {
      console.error('❌ Error validating mappings:', error);
      return {
        valid: false,
        invalidMappings: [{ legacyId: 'unknown', issue: `Validation query failed: ${error}` }]
      };
    }
  }

  /**
   * Clear mapping cache
   */
  clearCache(): void {
    this.uuidCache.clear();
    this.batchCache.clear();
    console.log('🗑️  UUID mapping cache cleared');
  }

  /**
   * Pre-load cache for an entity type
   */
  async preloadCache(entityType: string): Promise<number> {
    if (!this.cacheEnabled) {
      return 0;
    }

    const query = `
      SELECT legacy_id, uuid_id
      FROM migration_mappings
      WHERE entity_type = $1
    `;

    try {
      const result = await this.db.query(query, [entityType]);

      result.rows.forEach(row => {
        const cacheKey = `${entityType}:${row.legacy_id}`;
        this.uuidCache.set(cacheKey, row.uuid_id);
      });

      console.log(`📥 Preloaded ${result.rows.length} UUID mappings for ${entityType}`);
      return result.rows.length;

    } catch (error) {
      console.error(`❌ Error preloading cache for ${entityType}:`, error);
      return 0;
    }
  }

  /**
   * Export mappings for backup or analysis
   */
  async exportMappings(entityType?: string): Promise<LegacyMapping[]> {
    let query = `
      SELECT *
      FROM migration_mappings
    `;

    const values: any[] = [];

    if (entityType) {
      query += ` WHERE entity_type = $1`;
      values.push(entityType);
    }

    query += ` ORDER BY entity_type, migration_timestamp`;

    try {
      const result = await this.db.query(query, values);

      return result.rows.map(row => ({
        entityType: row.entity_type,
        legacyId: row.legacy_id,
        uuid: row.uuid_id,
        migrationBatch: row.migration_batch,
        migratedAt: new Date(row.migration_timestamp),
        sourceTable: row.source_table,
        targetTable: row.target_table,
        checksum: row.checksum,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));

    } catch (error) {
      console.error('❌ Error exporting mappings:', error);
      return [];
    }
  }

  /**
   * Group mappings by entity type for efficient processing
   */
  private groupMappingsByEntity(mappings: any[]): Record<string, any[]> {
    return mappings.reduce((groups, mapping) => {
      const entityType = mapping.entityType;
      if (!groups[entityType]) {
        groups[entityType] = [];
      }
      groups[entityType].push(mapping);
      return groups;
    }, {} as Record<string, any[]>);
  }

  /**
   * Generate checksum for mapping validation
   */
  private generateChecksum(input: string): string {
    return createHash('md5').update(input).digest('hex');
  }

  /**
   * Validate UUID format
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    enabled: boolean;
    uuidCacheSize: number;
    batchCacheSize: number;
  } {
    return {
      enabled: this.cacheEnabled,
      uuidCacheSize: this.uuidCache.size,
      batchCacheSize: this.batchCache.size
    };
  }
}

/**
 * Helper functions following existing patterns
 */

/**
 * Record lineage mapping (following office-migration.ts pattern)
 */
export async function recordLineage(
  pool: Pool,
  entityType: string,
  legacyId: number | string,
  uuid: string,
  migrationBatch?: string
): Promise<void> {
  const query = `
    INSERT INTO migration_mappings (
      entity_type, legacy_id, uuid_id, migration_batch, migration_timestamp
    ) VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (entity_type, legacy_id) DO NOTHING
  `;

  const batch = migrationBatch ||
    `${entityType}_migration_${new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14)}`;

  try {
    await pool.query(query, [entityType, legacyId.toString(), uuid, batch]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`⚠️  Warning: Could not record lineage for ${entityType}[${legacyId}]:`, errorMessage);
  }
}

/**
 * Lookup foreign key UUID (following existing pattern from orders-migration-comprehensive.ts)
 */
export async function lookupForeignKeyUUID(
  pool: Pool,
  entityType: string,
  legacyId: number | string
): Promise<string | null> {
  if (!legacyId) return null;

  const query = `
    SELECT uuid_id FROM migration_mappings
    WHERE entity_type = $1 AND legacy_id = $2
  `;

  try {
    const result = await pool.query(query, [entityType, legacyId.toString()]);
    return result.rows.length > 0 ? result.rows[0].uuid_id : null;
  } catch (error) {
    console.error(`❌ Error looking up foreign key UUID for ${entityType}[${legacyId}]:`, error);
    return null;
  }
}

/**
 * Build lookup map for bulk operations (following existing pattern)
 */
export async function buildLookupMap(
  pool: Pool,
  entityType: string
): Promise<Map<number, string>> {
  const query = `
    SELECT legacy_id, uuid_id FROM migration_mappings
    WHERE entity_type = $1
  `;

  try {
    const result = await pool.query(query, [entityType]);
    const lookupMap = new Map<number, string>();

    result.rows.forEach(row => {
      lookupMap.set(parseInt(row.legacy_id), row.uuid_id);
    });

    console.log(`📥 Built lookup map for ${entityType}: ${lookupMap.size} entries`);
    return lookupMap;

  } catch (error) {
    console.error(`❌ Error building lookup map for ${entityType}:`, error);
    return new Map();
  }
}

/**
 * Default UUID mapper instance
 */
export function createUUIDMapper(db: Pool, enableCache: boolean = true): UUIDMapperService {
  return new UUIDMapperService(db, enableCache);
}
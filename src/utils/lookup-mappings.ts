/**
 * T005: Lookup mapping builder
 * Builds UUID mappings for foreign key resolution during migration
 */

import { Client } from 'pg';
import { LookupMappings, UuidMapping } from '../interfaces/migration-types';

export class LookupMappingBuilder {
  constructor(private targetClient: Client) {}

  /**
   * Build comprehensive lookup mappings for all migrated entities
   */
  async buildAllMappings(): Promise<LookupMappings> {
    console.log('Building comprehensive lookup mappings...');

    const mappings: LookupMappings = {
      patients: await this.buildPatientMapping(),
      profiles: await this.buildProfileMapping(),
      orders: await this.buildOrderMapping(),
      cases: await this.buildCaseMapping(),
      files: await this.buildFileMapping(),
      messages: await this.buildMessageMapping()
    };

    // Build optional mappings if tables exist
    try {
      mappings.technicians = await this.buildTechnicianMapping();
    } catch (error) {
      console.log('  Technicians table not yet migrated - mapping will be empty');
      mappings.technicians = {};
    }

    try {
      mappings.templateGroups = await this.buildTemplateGroupMapping();
    } catch (error) {
      console.log('  Template groups table not yet migrated - mapping will be empty');
      mappings.templateGroups = {};
    }

    return mappings;
  }

  /**
   * Build patient UUID mapping (legacy_patient_id -> UUID)
   */
  private async buildPatientMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_patient_id
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_patient_id] = row.id;
    }

    console.log(`  ✅ Patient mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build profile UUID mapping (legacy_user_id -> UUID)
   */
  private async buildProfileMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_user_id
      FROM profiles
      WHERE legacy_user_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_user_id] = row.id;
    }

    console.log(`  ✅ Profile mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build order UUID mapping (legacy_instruction_id -> UUID)
   */
  private async buildOrderMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_instruction_id
      FROM orders
      WHERE legacy_instruction_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_instruction_id] = row.id;
    }

    console.log(`  ✅ Order mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build case UUID mapping (legacy_patient_id -> UUID)
   */
  private async buildCaseMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_patient_id
      FROM cases
      WHERE legacy_patient_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_patient_id] = row.id;
    }

    console.log(`  ✅ Case mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build file UUID mapping (legacy_file_id -> UUID)
   */
  private async buildFileMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_file_id
      FROM files
      WHERE legacy_file_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_file_id] = row.id;
    }

    console.log(`  ✅ File mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build message UUID mapping (legacy_record_id -> UUID)
   */
  private async buildMessageMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_record_id
      FROM messages
      WHERE legacy_record_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_record_id] = row.id;
    }

    console.log(`  ✅ Message mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build technician UUID mapping (legacy_technician_id -> UUID)
   */
  private async buildTechnicianMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_technician_id
      FROM technicians
      WHERE legacy_technician_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_technician_id] = row.id;
    }

    console.log(`  ✅ Technician mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build template group UUID mapping (legacy_group_id -> UUID)
   */
  private async buildTemplateGroupMapping(): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, legacy_group_id
      FROM template_view_groups
      WHERE legacy_group_id IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row.legacy_group_id] = row.id;
    }

    console.log(`  ✅ Template group mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Build specific mapping for any table with a legacy ID field
   */
  async buildCustomMapping(
    tableName: string,
    legacyIdField: string,
    description?: string
  ): Promise<UuidMapping> {
    const result = await this.targetClient.query(`
      SELECT id, ${legacyIdField}
      FROM ${tableName}
      WHERE ${legacyIdField} IS NOT NULL
    `);

    const mapping: UuidMapping = {};
    for (const row of result.rows) {
      mapping[row[legacyIdField]] = row.id;
    }

    console.log(`  ✅ ${description || tableName} mappings: ${Object.keys(mapping).length}`);
    return mapping;
  }

  /**
   * Validate that required mappings are not empty
   */
  static validateMappings(mappings: LookupMappings, requiredMappings: string[]): void {
    const errors: string[] = [];

    for (const requiredMapping of requiredMappings) {
      const mappingData = (mappings as any)[requiredMapping];
      if (!mappingData || Object.keys(mappingData).length === 0) {
        errors.push(`Required mapping '${requiredMapping}' is empty or missing`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Mapping validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Get mapping statistics for reporting
   */
  static getMappingStats(mappings: LookupMappings): { [key: string]: number } {
    const stats: { [key: string]: number } = {};

    Object.keys(mappings).forEach(key => {
      const mapping = (mappings as any)[key];
      stats[key] = mapping ? Object.keys(mapping).length : 0;
    });

    return stats;
  }
}
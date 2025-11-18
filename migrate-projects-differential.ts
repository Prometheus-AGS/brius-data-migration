import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface Project {
  id: number;
  uid: string;
  created_at: Date;
  name: string;
  size: number;
  public: boolean;
  type: number;
  status: number;
  creator_id: number | null;
}

interface ProjectMigrationStats {
  totalSourceRecords: number;
  totalTargetRecords: number;
  missingRecords: number;
  migratedRecords: number;
  skippedRecords: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class ProjectsDifferentialMigration {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: ProjectMigrationStats;
  private batchSize: number = 1000;

  constructor() {
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false }
    });

    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    this.stats = {
      totalSourceRecords: 0,
      totalTargetRecords: 0,
      missingRecords: 0,
      migratedRecords: 0,
      skippedRecords: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Check dispatch_project table schema first
   */
  private async checkSourceSchema(): Promise<void> {
    try {
      const schemaQuery = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'dispatch_project'
        AND table_schema = 'public'
        ORDER BY ordinal_position;
      `;

      const result = await this.sourcePool.query(schemaQuery);
      console.log('✓ dispatch_project table schema:');
      result.rows.forEach(row => {
        console.log(`   ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
      });
    } catch (error) {
      console.error('❌ Error checking source schema:', error);
    }
  }

  /**
   * Get existing project IDs in target database
   */
  private async getExistingProjectIds(): Promise<Set<number>> {
    const query = `
      SELECT legacy_project_id
      FROM projects
      WHERE legacy_project_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const existingIds = new Set<number>();

      result.rows.forEach(row => {
        if (row.legacy_project_id) {
          existingIds.add(row.legacy_project_id);
        }
      });

      console.log(`✓ Found ${existingIds.size} existing project IDs in target`);
      return existingIds;
    } catch (error) {
      console.error('❌ Error fetching existing project IDs:', error);
      throw error;
    }
  }

  /**
   * Get missing projects from source database
   */
  private async getMissingProjects(existingIds: Set<number>): Promise<Project[]> {
    const query = `
      SELECT
        id,
        uid,
        created_at,
        name,
        size,
        public,
        type,
        status,
        creator_id
      FROM dispatch_project
      ORDER BY id
    `;

    try {
      const result = await this.sourcePool.query(query);
      this.stats.totalSourceRecords = result.rows.length;

      // Filter to only missing projects
      const missingProjects = result.rows.filter((project: any) => !existingIds.has(project.id));
      this.stats.missingRecords = missingProjects.length;

      console.log(`✓ Found ${this.stats.totalSourceRecords} total projects in source`);
      console.log(`✓ Identified ${this.stats.missingRecords} missing projects to migrate`);

      return missingProjects;
    } catch (error) {
      console.error('❌ Error fetching missing projects:', error);
      throw error;
    }
  }

  /**
   * Get required mappings for project migration
   */
  private async getMappings(): Promise<{
    creatorMappings: Map<number, string>
  }> {
    try {
      // Get creator mappings (creator_id maps to profiles)
      const creatorMappingsResult = await this.targetPool.query(`
        SELECT legacy_user_id, id
        FROM profiles
        WHERE legacy_user_id IS NOT NULL
      `);

      const creatorMappings = new Map<number, string>();

      creatorMappingsResult.rows.forEach(row => {
        creatorMappings.set(row.legacy_user_id, row.id);
      });

      console.log(`✓ Found ${creatorMappings.size} creator mappings`);

      return { creatorMappings };
    } catch (error) {
      console.error('❌ Error fetching mappings:', error);
      throw error;
    }
  }

  /**
   * Map source project type to target enum
   */
  private mapProjectType(sourceType: number): string {
    // Map based on common patterns, fallback to 'other'
    switch (sourceType) {
      case 1: return 'treatment_plan';
      case 2: return 'stl_upper';
      case 3: return 'stl_lower';
      case 4: return 'clinical_photo';
      case 5: return 'xray';
      case 6: return 'cbct_scan';
      case 7: return 'simulation';
      case 8: return 'aligner_design';
      case 9: return 'document';
      default: return 'other';
    }
  }

  /**
   * Map source project status to target enum
   */
  private mapProjectStatus(sourceStatus: number): string {
    // Map based on common patterns, fallback to 'draft'
    switch (sourceStatus) {
      case 0: return 'draft';
      case 1: return 'in_review';
      case 2: return 'approved';
      case 3: return 'in_progress';
      case 4: return 'completed';
      case 5: return 'archived';
      case 6: return 'deleted';
      default: return 'draft';
    }
  }

  /**
   * Migrate projects batch
   */
  private async migrateProjectsBatch(
    projects: Project[],
    creatorMappings: Map<number, string>
  ): Promise<void> {
    if (projects.length === 0) return;

    console.log(`📊 Migrating batch of ${projects.length} projects...`);

    // Prepare batch insert
    const projectRecords = projects
      .map(project => {
        const creatorId = project.creator_id ? creatorMappings.get(project.creator_id) : null;

        // Map source type/status to target enums (with fallbacks)
        const projectType = this.mapProjectType(project.type);
        const projectStatus = this.mapProjectStatus(project.status);

        return {
          creator_id: creatorId,
          name: project.name,
          project_type: projectType,
          status: projectStatus,
          file_uid: project.uid,
          file_size_bytes: project.size,
          is_public: project.public,
          legacy_project_id: project.id,
          metadata: JSON.stringify({
            source_name: project.name,
            source_created_at: project.created_at,
            source_uid: project.uid,
            source_size: project.size,
            source_type: project.type,
            source_status: project.status,
            source_creator_id: project.creator_id,
            migrated_at: new Date().toISOString()
          })
        };
      })
      .filter(record => {
        if (!record.creator_id) {
          console.log(`⏭️  Skipping project ${record.legacy_project_id} - no matching creator`);
          return false;
        }
        return true;
      });

    console.log(`   → ${projectRecords.length}/${projects.length} projects have required creator mappings`);

    try {
      // Insert batch (no conflict clause needed since we pre-filtered missing records)
      const insertQuery = `
        INSERT INTO projects (
          creator_id, name, project_type, status, file_uid, file_size_bytes,
          is_public, legacy_project_id, metadata, created_at, updated_at
        ) VALUES ${projectRecords.map((_, i) =>
          `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9}, NOW(), NOW())`
        ).join(', ')}
      `;

      const values = projectRecords.flatMap(project => [
        project.creator_id,
        project.name,
        project.project_type,
        project.status,
        project.file_uid,
        project.file_size_bytes,
        project.is_public,
        project.legacy_project_id,
        project.metadata
      ]);

      const result = await this.targetPool.query(insertQuery, values);
      const insertedCount = result.rowCount || 0;

      this.stats.migratedRecords += insertedCount;
      this.stats.skippedRecords += (projects.length - insertedCount);

      console.log(`✅ Successfully migrated ${insertedCount} projects`);

    } catch (error) {
      this.stats.errors++;
      console.error(`❌ Error migrating projects batch:`, error);
    }
  }

  /**
   * Main differential migration function
   */
  public async executeDifferentialMigration(): Promise<ProjectMigrationStats> {
    console.log('🚀 Starting Projects Differential Migration...\n');

    try {
      // Check source schema first
      await this.checkSourceSchema();

      // Get existing IDs and missing projects
      const existingIds = await this.getExistingProjectIds();
      const missingProjects = await this.getMissingProjects(existingIds);

      if (missingProjects.length === 0) {
        console.log('🎉 All projects are already migrated!');
        this.stats.endTime = new Date();
        return this.stats;
      }

      // Get required mappings
      const { creatorMappings } = await this.getMappings();

      console.log('\n🔄 Starting batch migration...');

      // Process in batches
      for (let i = 0; i < missingProjects.length; i += this.batchSize) {
        const batchStartTime = Date.now();
        const batch = missingProjects.slice(i, i + this.batchSize);

        await this.migrateProjectsBatch(batch, creatorMappings);

        const batchDuration = Date.now() - batchStartTime;
        const recordsPerSecond = (batch.length / batchDuration * 1000).toFixed(0);
        console.log(`   ⚡ Batch ${Math.floor(i / this.batchSize) + 1} completed in ${batchDuration}ms (${recordsPerSecond} records/sec)`);

        if (this.stats.migratedRecords % 5000 === 0 && this.stats.migratedRecords > 0) {
          console.log(`✅ Progress: ${this.stats.migratedRecords} projects migrated...`);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Projects Differential Migration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Records: ${this.stats.totalSourceRecords}`);
      console.log(`📊 Missing Records: ${this.stats.missingRecords}`);
      console.log(`✅ Successfully Migrated: ${this.stats.migratedRecords}`);
      console.log(`⏭️  Skipped: ${this.stats.skippedRecords}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = this.stats.missingRecords > 0
        ? ((this.stats.migratedRecords / this.stats.missingRecords) * 100).toFixed(2)
        : 100;
      console.log(`📈 Success Rate: ${successRate}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Projects differential migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate the migration results
   */
  public async validateMigration(): Promise<void> {
    console.log('\n🔍 Validating projects migration...');

    try {
      const validationStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_projects,
          COUNT(CASE WHEN legacy_project_id IS NOT NULL THEN 1 END) as migrated_projects,
          COUNT(DISTINCT patient_id) as unique_patients,
          COUNT(CASE WHEN is_archived = true THEN 1 END) as archived_projects,
          MIN(created_at) as earliest_project,
          MAX(created_at) as latest_project
        FROM projects
      `);

      const stats = validationStats.rows[0];
      console.log('📊 Projects Validation:');
      console.log(`   Total Projects: ${stats.total_projects}`);
      console.log(`   Migrated Projects (with legacy_project_id): ${stats.migrated_projects}`);
      console.log(`   Unique Patients: ${stats.unique_patients}`);
      console.log(`   Archived Projects: ${stats.archived_projects}`);
      console.log(`   Date Range: ${stats.earliest_project} to ${stats.latest_project}`);

      // Check for any gaps
      const sourceTotal = await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_project');
      const targetMigrated = parseInt(stats.migrated_projects);
      const sourceCount = parseInt(sourceTotal.rows[0].count);

      console.log(`\n📊 Migration Coverage:`);
      console.log(`   Source Projects: ${sourceCount}`);
      console.log(`   Target Migrated: ${targetMigrated}`);
      console.log(`   Coverage: ${((targetMigrated / sourceCount) * 100).toFixed(2)}%`);

      if (sourceCount === targetMigrated) {
        console.log('🎉 PERFECT MIGRATION: All projects successfully migrated!');
      } else {
        console.log(`⚠️  ${sourceCount - targetMigrated} projects still missing`);
      }

      console.log('\n✅ Validation completed');

    } catch (error) {
      console.error('❌ Validation failed:', error);
    }
  }

  /**
   * Cleanup connections
   */
  private async cleanup(): Promise<void> {
    try {
      await Promise.all([
        this.sourcePool.end(),
        this.targetPool.end()
      ]);
      console.log('🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  const migration = new ProjectsDifferentialMigration();

  try {
    switch (command) {
      case 'migrate':
        await migration.executeDifferentialMigration();
        await migration.validateMigration();
        break;

      case 'validate':
        await migration.validateMigration();
        break;

      default:
        console.log('Usage: npx ts-node migrate-projects-differential.ts [migrate|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { ProjectsDifferentialMigration };

// Run if called directly
if (require.main === module) {
  main();
}
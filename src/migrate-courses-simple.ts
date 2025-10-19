import { createClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database configuration
const sourceDb = new PgClient({
  host: process.env.SOURCE_DB_HOST!,
  port: parseInt(process.env.SOURCE_DB_PORT!),
  user: process.env.SOURCE_DB_USER!,
  password: process.env.SOURCE_DB_PASSWORD!,
  database: process.env.SOURCE_DB_NAME!,
});

// Supabase client configuration
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!
);

interface SourceProject {
  id: number;
  uid: string;
  created_at: string;
  name: string;
  size: number;
  public: boolean;
  type: number;
  status: number;
  creator_id: number | null;
}

interface TargetProject {
  name: string;
  project_type: string;
  status: string;
  creator_id: string;
  file_uid: string | null;
  file_size_bytes: number;
  is_public: boolean;
  created_at: string;
  metadata: any;
  legacy_project_id: number;
}

// Mapping dispatch_project.type to project_type enum
const PROJECT_TYPE_MAPPING: Record<number, string> = {
  0: 'stl_upper',       // Assuming type 0 is STL upper
  3: 'treatment_plan',  // Type 3 appears to be treatment plans (52% of data)
  10: 'simulation',     // Type 10 might be simulations
  11: 'aligner_design', // Type 11 might be aligner designs
};

// Mapping dispatch_project.status to project_status enum
const PROJECT_STATUS_MAPPING: Record<number, string> = {
  0: 'draft',      // Status 0 is 99.98% of data, likely draft
  2: 'completed',  // Status 2 is rare, likely completed
};

class ProjectsMigration {
  private processed = 0;
  private errors = 0;
  private skipped = 0;
  private creatorLookupMap = new Map<number, string>();
  private systemProfileId: string = '';
  private batchSize = 500;

  async migrate() {
    const isValidation = process.argv.includes('validate');
    const isRollback = process.argv.includes('rollback');

    if (isValidation) {
      return this.validate();
    }
    
    if (isRollback) {
      return this.rollback();
    }

    console.log('🚀 Starting projects migration...\n');

    try {
      await sourceDb.connect();
      await this.getSystemProfile();
      await this.buildCreatorLookupMap();
      await this.migrateProjects();
      console.log('\n✅ Projects migration completed successfully!');
      console.log(`📊 Summary: ${this.processed} processed, ${this.errors} errors, ${this.skipped} skipped`);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async getSystemProfile() {
    console.log('🔧 Getting system profile for projects without creators...');

    const { data: systemProfile, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', 'system@brius.com')
      .single();

    if (error || !systemProfile) {
      throw new Error('System profile not found. Please run create-system-profile.ts first.');
    }

    this.systemProfileId = systemProfile.id;
    console.log(`    ✅ System profile ID: ${this.systemProfileId}\n`);
  }

  private async buildCreatorLookupMap() {
    console.log('🔍 Building creator lookup map...');

    // Get all profiles that have legacy_user_id (migrated users)
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, legacy_user_id')
      .not('legacy_user_id', 'is', null);

    if (error) {
      throw new Error(`Error fetching profiles: ${error.message}`);
    }

    profiles?.forEach(profile => {
      if (profile.legacy_user_id) {
        this.creatorLookupMap.set(profile.legacy_user_id, profile.id);
      }
    });

    console.log(`    ✅ Built creator lookup map: ${this.creatorLookupMap.size} creators\n`);
  }

  private async migrateProjects() {
    // Fetch all projects from source
    const query = `
      SELECT 
        id, uid, created_at, name, size, public, type, status, creator_id
      FROM dispatch_project
      ORDER BY id;
    `;

    const result = await sourceDb.query(query);
    const sourceProjects: SourceProject[] = result.rows;

    console.log(`📦 Found ${sourceProjects.length} projects to migrate`);

    // Process in batches
    for (let i = 0; i < sourceProjects.length; i += this.batchSize) {
      const batch = sourceProjects.slice(i, i + this.batchSize);
      await this.processBatch(batch);
      
      if (this.processed % 5000 === 0 || i + this.batchSize >= sourceProjects.length) {
        console.log(`⏳ Processed ${this.processed}/${sourceProjects.length} projects (${Math.round(this.processed/sourceProjects.length * 100)}%)`);
      }
    }
  }

  private async processBatch(batch: SourceProject[]) {
    const targetProjects: TargetProject[] = [];

    for (const sourceProject of batch) {
      try {
        const targetProject = this.transformProject(sourceProject);
        if (targetProject) {
          targetProjects.push(targetProject);
        }
      } catch (error) {
        console.error(`❌ Error transforming project ${sourceProject.id}:`, error);
        this.errors++;
      }
    }

    if (targetProjects.length > 0) {
      try {
        // Try bulk insert first
        const { error } = await supabase
          .from('projects')
          .insert(targetProjects);

        if (error) {
          console.warn(`⚠️  Bulk insert failed, trying individual inserts: ${error.message}`);
          await this.insertIndividually(targetProjects);
        } else {
          this.processed += targetProjects.length;
        }
      } catch (error) {
        console.error(`❌ Batch insert failed:`, error);
        await this.insertIndividually(targetProjects);
      }
    }
  }

  private async insertIndividually(targetProjects: TargetProject[]) {
    for (const project of targetProjects) {
      try {
        const { error } = await supabase
          .from('projects')
          .insert(project);

        if (error) {
          console.error(`❌ Error inserting project ${project.legacy_project_id}:`, error.message);
          this.errors++;
        } else {
          this.processed++;
        }
      } catch (error) {
        console.error(`❌ Error inserting project ${project.legacy_project_id}:`, error);
        this.errors++;
      }
    }
  }

  private transformProject(source: SourceProject): TargetProject | null {
    // Map project type
    const projectType = PROJECT_TYPE_MAPPING[source.type];
    if (!projectType) {
      console.warn(`⚠️  Skipping project ${source.id}: unmapped type ${source.type}`);
      this.skipped++;
      return null;
    }

    // Map project status
    const status = PROJECT_STATUS_MAPPING[source.status] || 'draft';

    // Map creator_id to profile UUID - use system profile as fallback
    let creatorId: string = this.systemProfileId; // Default fallback
    if (source.creator_id) {
      const mappedCreator = this.creatorLookupMap.get(source.creator_id);
      if (mappedCreator) {
        creatorId = mappedCreator;
      } else {
        console.warn(`⚠️  Creator UUID not found for user ${source.creator_id} in project ${source.id}, using system profile`);
      }
    }

    const metadata = {
      legacy_project_id: source.id,
      original_type: source.type,
      original_status: source.status,
      legacy_creator_id: source.creator_id,
      is_system_creator: source.creator_id === null,
    };

    return {
      name: source.name || `Project ${source.id}`,
      project_type: projectType,
      status,
      creator_id: creatorId,
      file_uid: source.uid,
      file_size_bytes: source.size,
      is_public: source.public,
      created_at: source.created_at,
      metadata,
      legacy_project_id: source.id,
    };
  }

  private async validate() {
    console.log('🔍 Validating projects migration...\n');

    try {
      await sourceDb.connect();

      // Count source projects
      const sourceResult = await sourceDb.query('SELECT COUNT(*) FROM dispatch_project');
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Count target projects
      const { count: targetCount, error } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true });

      if (error) {
        throw new Error(`Error counting target projects: ${error.message}`);
      }

      console.log('📊 Migration Validation Results:');
      console.log(`Source projects: ${sourceCount}`);
      console.log(`Target projects: ${targetCount}`);
      console.log(`Match: ${sourceCount === targetCount ? '✅ Yes' : '❌ No'}`);

      // Validate project type distribution
      const typeDistQuery = `
        SELECT type, COUNT(*) as count 
        FROM dispatch_project 
        GROUP BY type 
        ORDER BY type;
      `;
      
      const typeResult = await sourceDb.query(typeDistQuery);

      console.log('\n📈 Project Type Distribution Validation:');
      for (const row of typeResult.rows) {
        const projectType = PROJECT_TYPE_MAPPING[row.type];
        console.log(`Source type ${row.type} -> ${projectType}: ${row.count} projects`);
      }

    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    } finally {
      await sourceDb.end();
    }
  }

  private async rollback() {
    console.log('🔄 Rolling back projects migration...\n');

    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .not('legacy_project_id', 'is', null);

      if (error) {
        throw new Error(`Rollback error: ${error.message}`);
      }

      console.log('✅ Projects migration rolled back successfully');

    } catch (error) {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    }
  }
}

const migration = new ProjectsMigration();
migration.migrate().catch(console.error);

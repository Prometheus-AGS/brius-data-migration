import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface SuffixUpdate {
  sourcePatientId: number;
  targetPatientId: string;
  suffix: string;
  patientName?: string;
}

interface SuffixStats {
  sourcePatients: number;
  targetPatients: number;
  suffixesRestored: number;
  suffixesSkipped: number;
  formatCompliant: number;
  formatNonCompliant: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class PatientSuffixSystemFix {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: SuffixStats;

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
      sourcePatients: 0,
      targetPatients: 0,
      suffixesRestored: 0,
      suffixesSkipped: 0,
      formatCompliant: 0,
      formatNonCompliant: 0,
      errors: 0,
      startTime: new Date(),
    };
  }

  /**
   * Get suffix data from source database
   */
  private async getSourceSuffixData(): Promise<any[]> {
    const query = `
      SELECT
        dp.id as source_patient_id,
        dp.suffix,
        COALESCE(NULLIF(u.first_name, ''), '') || ' ' || COALESCE(NULLIF(u.last_name, ''), '') as patient_name
      FROM dispatch_patient dp
      JOIN auth_user u ON dp.user_id = u.id
      WHERE (dp.archived = false OR dp.archived IS NULL)
        AND dp.suffix IS NOT NULL
        AND dp.suffix != ''
      ORDER BY dp.id
    `;

    try {
      const result = await this.sourcePool.query(query);
      console.log(`✓ Found ${result.rows.length} patients with suffix data in source`);

      // Analyze suffix formats
      const formatAnalysis = result.rows.reduce((acc: any, row: any) => {
        const suffixLength = row.suffix ? row.suffix.length : 0;
        acc[suffixLength] = (acc[suffixLength] || 0) + 1;
        return acc;
      }, {});

      console.log('📊 Source suffix format distribution:');
      Object.entries(formatAnalysis).forEach(([length, count]) => {
        console.log(`   ${length}-character suffixes: ${count}`);
      });

      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching source suffix data:', error);
      throw error;
    }
  }

  /**
   * Get target patient mappings
   */
  private async getTargetPatientMappings(): Promise<Map<number, string>> {
    const query = `
      SELECT legacy_patient_id, id
      FROM patients
      WHERE legacy_patient_id IS NOT NULL
    `;

    try {
      const result = await this.targetPool.query(query);
      const mappings = new Map<number, string>();

      result.rows.forEach(row => {
        mappings.set(row.legacy_patient_id, row.id);
      });

      console.log(`✓ Found ${mappings.size} target patient mappings`);
      return mappings;
    } catch (error) {
      console.error('❌ Error fetching target patient mappings:', error);
      throw error;
    }
  }

  /**
   * Build suffix update mappings
   */
  private async buildSuffixMappings(): Promise<SuffixUpdate[]> {
    try {
      const [sourceSuffixData, targetMappings] = await Promise.all([
        this.getSourceSuffixData(),
        this.getTargetPatientMappings()
      ]);

      this.stats.sourcePatients = sourceSuffixData.length;
      this.stats.targetPatients = targetMappings.size;

      const suffixUpdates: SuffixUpdate[] = [];
      let skipped = 0;

      for (const sourceData of sourceSuffixData) {
        const targetPatientId = targetMappings.get(sourceData.source_patient_id);

        if (!targetPatientId) {
          skipped++;
          continue;
        }

        suffixUpdates.push({
          sourcePatientId: sourceData.source_patient_id,
          targetPatientId: targetPatientId,
          suffix: sourceData.suffix,
          patientName: sourceData.patient_name
        });

        // Track format compliance
        if (sourceData.suffix && sourceData.suffix.length === 4) {
          this.stats.formatCompliant++;
        } else {
          this.stats.formatNonCompliant++;
        }
      }

      this.stats.suffixesSkipped = skipped;

      console.log(`✓ Built ${suffixUpdates.length} suffix update mappings (${skipped} skipped due to missing target)`);
      console.log(`📊 Format compliance: ${this.stats.formatCompliant} proper 4-char, ${this.stats.formatNonCompliant} non-standard`);

      return suffixUpdates;
    } catch (error) {
      console.error('❌ Error building suffix mappings:', error);
      throw error;
    }
  }

  /**
   * Update patient suffix
   */
  private async updatePatientSuffix(suffixUpdate: SuffixUpdate): Promise<boolean> {
    const query = `
      UPDATE patients
      SET
        suffix = $1,
        updated_at = NOW()
      WHERE id = $2
    `;

    try {
      const result = await this.targetPool.query(query, [
        suffixUpdate.suffix,
        suffixUpdate.targetPatientId
      ]);

      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error(`❌ Error updating suffix for patient ${suffixUpdate.targetPatientId}:`, error);
      return false;
    }
  }

  /**
   * Main suffix restoration function
   */
  public async restorePatientSuffixes(): Promise<SuffixStats> {
    console.log('🚀 Starting Patient Suffix System Restoration...\n');

    try {
      const suffixUpdates = await this.buildSuffixMappings();

      console.log('\n🔄 Restoring patient suffixes...');

      for (const suffixUpdate of suffixUpdates) {
        try {
          const success = await this.updatePatientSuffix(suffixUpdate);

          if (success) {
            this.stats.suffixesRestored++;
            console.log(`✅ Restored: ${suffixUpdate.patientName?.trim()} → suffix: "${suffixUpdate.suffix}"`);
          } else {
            this.stats.errors++;
            console.log(`❌ Failed: ${suffixUpdate.patientName?.trim()} → suffix: "${suffixUpdate.suffix}"`);
          }

        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing patient ${suffixUpdate.sourcePatientId}:`, error);
        }
      }

      this.stats.endTime = new Date();

      // Final summary
      console.log('\n📋 Patient Suffix Restoration Summary:');
      console.log(`⏱️  Duration: ${this.stats.endTime.getTime() - this.stats.startTime.getTime()}ms`);
      console.log(`📊 Source Patients: ${this.stats.sourcePatients}`);
      console.log(`📊 Target Mappings: ${this.stats.targetPatients}`);
      console.log(`✅ Suffixes Restored: ${this.stats.suffixesRestored}`);
      console.log(`⏭️  Skipped (no mapping): ${this.stats.suffixesSkipped}`);
      console.log(`📏 Format Compliant (4-char): ${this.stats.formatCompliant}`);
      console.log(`⚠️  Format Non-Compliant: ${this.stats.formatNonCompliant}`);
      console.log(`❌ Errors: ${this.stats.errors}`);

      const successRate = ((this.stats.suffixesRestored / (this.stats.suffixesRestored + this.stats.errors)) * 100).toFixed(2);
      console.log(`📈 Success Rate: ${successRate}%`);

      return this.stats;

    } catch (error) {
      console.error('💥 Suffix restoration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Validate suffix restoration results
   */
  public async validateSuffixRestoration(): Promise<void> {
    console.log('\n🔍 Validating suffix restoration results...');

    try {
      // Check final suffix statistics
      const finalStats = await this.targetPool.query(`
        SELECT
          COUNT(*) as total_patients,
          COUNT(CASE WHEN suffix IS NOT NULL AND suffix != '' THEN 1 END) as patients_with_suffix,
          COUNT(CASE WHEN LENGTH(suffix) = 4 THEN 1 END) as proper_4char_suffixes,
          ROUND(COUNT(CASE WHEN suffix IS NOT NULL AND suffix != '' THEN 1 END) * 100.0 / COUNT(*), 2) as suffix_coverage_percent,
          ROUND(COUNT(CASE WHEN LENGTH(suffix) = 4 THEN 1 END) * 100.0 /
                COUNT(CASE WHEN suffix IS NOT NULL AND suffix != '' THEN 1 END), 2) as format_compliance_percent
        FROM patients
        WHERE legacy_patient_id IS NOT NULL
      `);

      const result = finalStats.rows[0];
      console.log('📊 Final Suffix System Status:');
      console.log(`   Total Patients: ${result.total_patients}`);
      console.log(`   Patients with Suffix: ${result.patients_with_suffix}`);
      console.log(`   Proper 4-Character Suffixes: ${result.proper_4char_suffixes}`);
      console.log(`   Suffix Coverage: ${result.suffix_coverage_percent}%`);
      console.log(`   Format Compliance: ${result.format_compliance_percent}%`);

      // Sample suffix data
      const sampleSuffixes = await this.targetPool.query(`
        SELECT
          pp.first_name || ' ' || pp.last_name as patient_name,
          suffix,
          LENGTH(suffix) as suffix_length
        FROM patients p
        JOIN profiles pp ON p.profile_id = pp.id
        WHERE p.suffix IS NOT NULL AND p.suffix != ''
        ORDER BY p.updated_at DESC
        LIMIT 10
      `);

      console.log('\n📋 Sample Restored Suffixes:');
      sampleSuffixes.rows.forEach(row => {
        const compliance = row.suffix_length === 4 ? '✅' : '⚠️';
        console.log(`   ${compliance} ${row.patient_name}: "${row.suffix}" (${row.suffix_length} chars)`);
      });

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
  const command = args[0] || 'restore';

  const suffixFix = new PatientSuffixSystemFix();

  try {
    switch (command) {
      case 'restore':
        await suffixFix.restorePatientSuffixes();
        await suffixFix.validateSuffixRestoration();
        break;

      case 'validate':
        await suffixFix.validateSuffixRestoration();
        break;

      default:
        console.log('Usage: npx ts-node fix-patient-suffix-system.ts [restore|validate]');
        process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    console.error('💥 Operation failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { PatientSuffixSystemFix };

// Run if called directly
if (require.main === module) {
  main();
}
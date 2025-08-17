import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Source database connection
const sourceClient = new Client({
  host: process.env.SOURCE_DB_HOST,
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
});

// Target database connection
const targetClient = new Client({
  host: process.env.TARGET_DB_HOST,
  port: parseInt(process.env.TARGET_DB_PORT || '5432'),
  database: process.env.TARGET_DB_NAME,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
});

interface ValidationResult {
  source_total: number;
  source_with_valid_offices: number;
  target_migrated: number;
  target_unique_doctors: number;
  target_unique_offices: number;
  sample_associations: any[];
  coverage_analysis: any;
}

async function validateDoctorOfficesMigration(): Promise<ValidationResult> {
  try {
    await sourceClient.connect();
    await targetClient.connect();
    
    // Get source total count
    const sourceResult = await sourceClient.query(`
      SELECT COUNT(*) as total FROM dispatch_office_doctors
    `);
    const sourceTotal = parseInt(sourceResult.rows[0].total);

    // Get source count with valid offices (offices that were migrated)
    const sourceValidResult = await sourceClient.query(`
      SELECT COUNT(*) as total 
      FROM dispatch_office_doctors dod
      INNER JOIN dispatch_office office ON dod.office_id = office.id
      WHERE office.valid = true
    `);
    const sourceWithValidOffices = parseInt(sourceValidResult.rows[0].total);

    // Get target statistics
    const targetStatsResult = await targetClient.query(`
      SELECT 
        COUNT(*) as total_migrated,
        COUNT(DISTINCT doctor_id) as unique_doctors,
        COUNT(DISTINCT office_id) as unique_offices
      FROM doctor_offices
    `);

    // Get sample associations for verification
    const sampleResult = await targetClient.query(`
      SELECT 
        doctoroff.doctor_id,
        doctoroff.office_id,
        doctoroff.is_primary,
        doctoroff.is_active,
        p.first_name || ' ' || p.last_name as doctor_name,
        p.legacy_user_id,
        o.name as office_name,
        o.legacy_office_id
      FROM doctor_offices doctoroff
      JOIN profiles p ON doctoroff.doctor_id = p.id
      JOIN offices o ON doctoroff.office_id = o.id
      ORDER BY doctoroff.created_at
      LIMIT 10
    `);

    // Analyze coverage by office validity
    const coverageResult = await sourceClient.query(`
      SELECT 
        office.valid,
        COUNT(*) as associations_count,
        COUNT(DISTINCT dod.office_id) as unique_offices_count,
        COUNT(DISTINCT dod.user_id) as unique_doctors_count
      FROM dispatch_office_doctors dod
      INNER JOIN dispatch_office office ON dod.office_id = office.id
      GROUP BY office.valid
      ORDER BY office.valid
    `);

    const stats = targetStatsResult.rows[0];
    
    return {
      source_total: sourceTotal,
      source_with_valid_offices: sourceWithValidOffices,
      target_migrated: parseInt(stats.total_migrated),
      target_unique_doctors: parseInt(stats.unique_doctors),
      target_unique_offices: parseInt(stats.unique_offices),
      sample_associations: sampleResult.rows,
      coverage_analysis: coverageResult.rows
    };

  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

async function main() {
  try {
    console.log('🔍 Validating doctor-offices migration...\n');
    
    const validation = await validateDoctorOfficesMigration();
    
    console.log('📊 Migration Validation Results:');
    console.log('================================');
    console.log(`Source total associations: ${validation.source_total.toLocaleString()}`);
    console.log(`Source with valid offices: ${validation.source_with_valid_offices.toLocaleString()}`);
    console.log(`Target migrated associations: ${validation.target_migrated.toLocaleString()}`);
    console.log(`Target unique doctors: ${validation.target_unique_doctors.toLocaleString()}`);
    console.log(`Target unique offices: ${validation.target_unique_offices.toLocaleString()}`);
    
    const validOfficeCoverage = (validation.target_migrated / validation.source_with_valid_offices) * 100;
    const totalCoverage = (validation.target_migrated / validation.source_total) * 100;
    
    console.log(`\n📈 Coverage Analysis:`);
    console.log(`  Valid offices coverage: ${validOfficeCoverage.toFixed(2)}%`);
    console.log(`  Total coverage: ${totalCoverage.toFixed(2)}%`);
    
    console.log('\n🏢 Source Office Coverage Breakdown:');
    console.log('====================================');
    for (const row of validation.coverage_analysis) {
      const validStatus = row.valid === null ? 'NULL' : (row.valid ? 'Valid' : 'Invalid');
      console.log(`${validStatus} offices: ${row.associations_count} associations, ${row.unique_offices_count} offices, ${row.unique_doctors_count} doctors`);
    }
    
    console.log('\n🔍 Sample Migrated Associations:');
    console.log('================================');
    validation.sample_associations.forEach((record, idx) => {
      console.log(`${idx + 1}. Dr. ${record.doctor_name} (Legacy User ${record.legacy_user_id})`);
      console.log(`   → ${record.office_name} (Legacy Office ${record.legacy_office_id})`);
      console.log(`   Primary: ${record.is_primary}, Active: ${record.is_active}`);
      console.log('');
    });
    
    // Validation checks
    console.log('✅ Validation Summary:');
    console.log('======================');
    
    if (validOfficeCoverage >= 90) {
      console.log(`✅ Valid office coverage: ${validOfficeCoverage.toFixed(2)}% (Good)`);
    } else if (validOfficeCoverage >= 70) {
      console.log(`⚠️  Valid office coverage: ${validOfficeCoverage.toFixed(2)}% (Acceptable)`);
    } else {
      console.log(`❌ Valid office coverage: ${validOfficeCoverage.toFixed(2)}% (Low)`);
    }
    
    if (validation.target_migrated > 0) {
      console.log('✅ Doctor-office associations successfully created');
    } else {
      console.log('❌ No associations were created');
    }
    
    console.log(`✅ ${validation.target_unique_doctors} doctors associated with ${validation.target_unique_offices} offices`);
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

main();

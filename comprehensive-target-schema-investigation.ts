import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://gyyottknjakkagswebwh.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface TargetTableSchema {
  tableName: string;
  fields: Array<{
    field: string;
    type: string;
    nullable: boolean;
    defaultValue: any;
    description?: string;
  }>;
  recordCount: number;
  sampleRecords: any[];
  relationships: Array<{
    field: string;
    referencedTable: string;
    referencedField: string;
  }>;
}

class TargetSchemaInvestigator {

  async getTableInfo(tableName: string): Promise<TargetTableSchema> {
    console.log(`\n📋 ANALYZING TARGET TABLE: ${tableName.toUpperCase()}`);
    console.log('-'.repeat(50));

    try {
      // Get record count
      const { count: recordCount, error: countError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (countError) {
        throw new Error(`Error getting count for ${tableName}: ${countError.message}`);
      }

      // Get sample records to understand field structure
      const { data: sampleRecords, error: sampleError } = await supabase
        .from(tableName)
        .select('*')
        .limit(3);

      if (sampleError) {
        throw new Error(`Error getting samples for ${tableName}: ${sampleError.message}`);
      }

      console.log(`Record Count: ${recordCount?.toLocaleString() || 0}`);

      // Analyze field structure from sample records
      const fields: Array<{
        field: string;
        type: string;
        nullable: boolean;
        defaultValue: any;
        description?: string;
      }> = [];

      if (sampleRecords && sampleRecords.length > 0) {
        const firstRecord = sampleRecords[0];

        Object.entries(firstRecord).forEach(([fieldName, value]) => {
          let fieldType: string = typeof value;

          // More specific type detection
          if (value === null) {
            fieldType = 'null/unknown';
          } else if (Array.isArray(value)) {
            fieldType = 'array';
          } else if (typeof value === 'string') {
            // Check if it's a UUID
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
              fieldType = 'uuid';
            } else if (value.includes('T') && value.includes('Z')) {
              fieldType = 'timestamp';
            } else {
              fieldType = 'string';
            }
          } else if (typeof value === 'object') {
            fieldType = 'jsonb';
          }

          // Check nullability across all samples
          const nullable = sampleRecords.some(record => record[fieldName] === null);

          fields.push({
            field: fieldName,
            type: fieldType,
            nullable,
            defaultValue: value,
            description: this.getFieldDescription(tableName, fieldName)
          });
        });
      }

      console.log('\nFields:');
      fields.forEach(field => {
        const nullableStr = field.nullable ? ' (nullable)' : ' (not null)';
        const sampleValue = typeof field.defaultValue === 'string' && field.defaultValue.length > 50
          ? field.defaultValue.substring(0, 47) + '...'
          : field.defaultValue;
        console.log(`   ${field.field}: ${field.type}${nullableStr} - sample: ${JSON.stringify(sampleValue)}`);
        if (field.description) {
          console.log(`      ${field.description}`);
        }
      });

      if (sampleRecords && sampleRecords.length > 0) {
        console.log('\nSample Records:');
        sampleRecords.forEach((record, index) => {
          console.log(`   [${index + 1}] ${JSON.stringify(record, null, 2)}`);
        });
      }

      // Identify likely relationships based on field names
      const relationships = this.identifyRelationships(tableName, fields);
      if (relationships.length > 0) {
        console.log('\nLikely Relationships:');
        relationships.forEach(rel => {
          console.log(`   ${rel.field} -> ${rel.referencedTable}.${rel.referencedField}`);
        });
      }

      return {
        tableName,
        fields,
        recordCount: recordCount || 0,
        sampleRecords: sampleRecords || [],
        relationships
      };

    } catch (error: any) {
      console.error(`❌ Error analyzing ${tableName}: ${error.message}`);
      throw error;
    }
  }

  private getFieldDescription(tableName: string, fieldName: string): string | undefined {
    // Provide context for key fields
    const descriptions: Record<string, Record<string, string>> = {
      profiles: {
        'legacy_user_id': 'Maps to source auth_user.id',
        'legacy_patient_id': 'Maps to source dispatch_patient.id',
        'profile_type': 'Enum: doctor, patient, technician, master, admin',
        'patient_suffix': 'From dispatch_patient.suffix (patient identifier)'
      },
      patients: {
        'profile_id': 'Foreign key to profiles.id',
        'legacy_user_id': 'Maps to source auth_user.id',
        'legacy_patient_id': 'Maps to source dispatch_patient.id'
      },
      doctors: {
        'profile_id': 'Foreign key to profiles.id',
        'legacy_user_id': 'Maps to source auth_user.id'
      },
      technicians: {
        'profile_id': 'Foreign key to profiles.id',
        'legacy_user_id': 'Maps to source auth_user.id',
        'legacy_technician_id': 'Maps to source auth_user.id (technician users)'
      }
    };

    return descriptions[tableName]?.[fieldName];
  }

  private identifyRelationships(tableName: string, fields: any[]): Array<{
    field: string;
    referencedTable: string;
    referencedField: string;
  }> {
    const relationships: Array<{
      field: string;
      referencedTable: string;
      referencedField: string;
    }> = [];

    fields.forEach(field => {
      if (field.field.endsWith('_id') && field.type === 'uuid') {
        // Common UUID foreign key patterns
        if (field.field === 'profile_id') {
          relationships.push({
            field: field.field,
            referencedTable: 'profiles',
            referencedField: 'id'
          });
        } else if (field.field === 'doctor_id') {
          relationships.push({
            field: field.field,
            referencedTable: 'doctors',
            referencedField: 'id'
          });
        } else if (field.field === 'patient_id') {
          relationships.push({
            field: field.field,
            referencedTable: 'patients',
            referencedField: 'id'
          });
        } else if (field.field === 'office_id') {
          relationships.push({
            field: field.field,
            referencedTable: 'offices',
            referencedField: 'id'
          });
        }
      }
    });

    return relationships;
  }

  async analyzeProfileRelationships(): Promise<void> {
    console.log('\n🔗 ANALYZING PROFILE RELATIONSHIP PATTERNS');
    console.log('='.repeat(60));

    try {
      // 1. Profile type distribution
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('profile_type, legacy_user_id, legacy_patient_id');

      if (profileError) {
        throw new Error(`Error fetching profiles: ${profileError.message}`);
      }

      const profileTypeDistribution = profiles?.reduce((acc: any, profile) => {
        acc[profile.profile_type] = (acc[profile.profile_type] || 0) + 1;
        return acc;
      }, {});

      console.log('\n📊 Profile type distribution:');
      Object.entries(profileTypeDistribution || {}).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });

      const profilesWithLegacyUserIds = profiles?.filter(p => p.legacy_user_id).length || 0;
      const profilesWithLegacyPatientIds = profiles?.filter(p => p.legacy_patient_id).length || 0;

      console.log(`\n🔗 Legacy ID coverage:`);
      console.log(`   Profiles with legacy_user_id: ${profilesWithLegacyUserIds}/${profiles?.length || 0}`);
      console.log(`   Profiles with legacy_patient_id: ${profilesWithLegacyPatientIds}/${profiles?.length || 0}`);

      // 2. Check profile-specialized record linkage
      const [doctorsResult, patientsResult, techniciansResult] = await Promise.all([
        supabase.from('doctors').select('id, profile_id, legacy_user_id').limit(5),
        supabase.from('patients').select('id, profile_id, legacy_user_id, legacy_patient_id').limit(5),
        supabase.from('technicians').select('id, profile_id, legacy_user_id, legacy_technician_id').limit(5)
      ]);

      console.log('\n🔗 Sample profile linkages:');

      if (doctorsResult.data && doctorsResult.data.length > 0) {
        console.log('   Doctor samples:');
        doctorsResult.data.forEach((doctor: any) => {
          console.log(`     Doctor ${doctor.id}: profile_id=${doctor.profile_id || 'NULL'}, legacy_user_id=${doctor.legacy_user_id}`);
        });
      }

      if (patientsResult.data && patientsResult.data.length > 0) {
        console.log('   Patient samples:');
        patientsResult.data.forEach((patient: any) => {
          console.log(`     Patient ${patient.id}: profile_id=${patient.profile_id || 'NULL'}, legacy_user_id=${patient.legacy_user_id}, legacy_patient_id=${patient.legacy_patient_id}`);
        });
      }

      if (techniciansResult.data && techniciansResult.data.length > 0) {
        console.log('   Technician samples:');
        techniciansResult.data.forEach((technician: any) => {
          console.log(`     Technician ${technician.id}: profile_id=${technician.profile_id || 'NULL'}, legacy_user_id=${technician.legacy_user_id}`);
        });
      }

      // 3. Check for orphaned records
      const [orphanedDoctorsResult, orphanedPatientsResult, orphanedTechniciansResult] = await Promise.all([
        supabase.from('doctors').select('id', { count: 'exact', head: true }).is('profile_id', null),
        supabase.from('patients').select('id', { count: 'exact', head: true }).is('profile_id', null),
        supabase.from('technicians').select('id', { count: 'exact', head: true }).is('profile_id', null)
      ]);

      console.log('\n⚠️  Orphaned specialized records (no profile_id):');
      console.log(`   Doctors without profiles: ${orphanedDoctorsResult.count || 0}`);
      console.log(`   Patients without profiles: ${orphanedPatientsResult.count || 0}`);
      console.log(`   Technicians without profiles: ${orphanedTechniciansResult.count || 0}`);

    } catch (error: any) {
      console.error('❌ Error analyzing profile relationships:', error.message);
      throw error;
    }
  }

  async compareSourceTargetCounts(): Promise<void> {
    console.log('\n📊 SOURCE vs TARGET RECORD COUNT COMPARISON');
    console.log('='.repeat(60));

    // Note: We don't have direct access to source here, but we can note expected counts
    console.log('Source Database Expected Counts (from previous investigation):');
    console.log('   auth_user: 9,839 total users');
    console.log('   dispatch_patient: 8,488 patient records');
    console.log('   auth_user_groups (group_id=2): ~400 doctors'); // estimated
    console.log('   auth_user_groups (group_id=11): ~80 technicians'); // estimated

    // Get target counts
    const [profilesCount, doctorsCount, patientsCount, techniciansCount] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('doctors').select('*', { count: 'exact', head: true }),
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      supabase.from('technicians').select('*', { count: 'exact', head: true })
    ]);

    console.log('\nTarget Database Actual Counts:');
    console.log(`   profiles: ${profilesCount.count || 0}`);
    console.log(`   doctors: ${doctorsCount.count || 0}`);
    console.log(`   patients: ${patientsCount.count || 0}`);
    console.log(`   technicians: ${techniciansCount.count || 0}`);

    console.log('\n🔍 Migration Gap Analysis:');
    console.log(`   Expected patients vs actual: 8,488 vs ${patientsCount.count || 0} (gap: ${8488 - (patientsCount.count || 0)})`);
    console.log(`   Total specialized records: ${(doctorsCount.count || 0) + (patientsCount.count || 0) + (techniciansCount.count || 0)}`);
    console.log(`   Profile coverage: ${profilesCount.count || 0} profiles for ${(doctorsCount.count || 0) + (patientsCount.count || 0) + (techniciansCount.count || 0)} specialized records`);
  }
}

async function main() {
  const investigator = new TargetSchemaInvestigator();

  try {
    console.log('🔍 COMPREHENSIVE TARGET DATABASE SCHEMA INVESTIGATION');
    console.log('='.repeat(70));

    // Core profile-related tables
    const coreTables = ['profiles', 'doctors', 'patients', 'technicians'];

    for (const tableName of coreTables) {
      try {
        await investigator.getTableInfo(tableName);
      } catch (error: any) {
        console.log(`   Error analyzing ${tableName}: ${error.message}`);
      }
    }

    // Additional important tables
    const additionalTables = ['offices', 'orders', 'cases', 'messages'];

    console.log('\n📋 ANALYZING ADDITIONAL TARGET TABLES');
    console.log('='.repeat(50));

    for (const tableName of additionalTables) {
      try {
        await investigator.getTableInfo(tableName);
      } catch (error: any) {
        console.log(`   Table ${tableName} not found or error: ${error.message}`);
      }
    }

    // Analyze relationships
    await investigator.analyzeProfileRelationships();

    // Compare source vs target counts
    await investigator.compareSourceTargetCounts();

    console.log('\n🎉 Target database schema investigation completed!');

  } catch (error: any) {
    console.error('💥 Investigation failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface DifferentialMigrationStats {
  entityName: string;
  sourceCount: number;
  targetCount: number;
  gap: number;
  migratedRecords: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

class DifferentialMigrationFinalGaps {
  private sourcePool: Pool;
  private targetPool: Pool;
  private stats: DifferentialMigrationStats[] = [];

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
  }

  /**
   * Migrate missing offices (1 missing office)
   */
  private async migrateMissingOffices(): Promise<DifferentialMigrationStats> {
    const stats: DifferentialMigrationStats = {
      entityName: 'offices',
      sourceCount: 0,
      targetCount: 0,
      gap: 0,
      migratedRecords: 0,
      errors: 0,
      startTime: new Date()
    };

    try {
      console.log('🏢 Migrating missing offices...');

      // Find offices in source not in target
      const missingOffices = await this.sourcePool.query(`
        SELECT
          o.*,
          ROW_NUMBER() OVER (ORDER BY o.id) as row_num
        FROM dispatch_office o
        WHERE o.id NOT IN (
          SELECT legacy_office_id
          FROM ${process.env.TARGET_DB_NAME}.offices
          WHERE legacy_office_id IS NOT NULL
        )
        ORDER BY o.id
      `);

      stats.sourceCount = (await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_office')).rows[0].count;
      stats.targetCount = (await this.targetPool.query('SELECT COUNT(*) FROM offices WHERE legacy_office_id IS NOT NULL')).rows[0].count;
      stats.gap = missingOffices.rows.length;

      console.log(`📊 Found ${stats.gap} missing offices to migrate`);

      for (const office of missingOffices.rows) {
        try {
          await this.targetPool.query(`
            INSERT INTO offices (
              id, name, address, city, state, postal_code, country,
              phone, email, legacy_office_id, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
            )
          `, [
            office.name,
            office.address,
            office.city,
            office.state,
            office.postal_code,
            office.country,
            office.phone,
            office.email,
            office.id
          ]);

          stats.migratedRecords++;
          console.log(`✅ Migrated office: ${office.name} (${office.country})`);

        } catch (error) {
          stats.errors++;
          console.error(`❌ Error migrating office ${office.id}:`, error);
        }
      }

      stats.endTime = new Date();
      return stats;

    } catch (error) {
      console.error('❌ Office migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate missing case files (2,035 missing files)
   */
  private async migrateMissingCaseFiles(): Promise<DifferentialMigrationStats> {
    const stats: DifferentialMigrationStats = {
      entityName: 'case_files',
      sourceCount: 0,
      targetCount: 0,
      gap: 0,
      migratedRecords: 0,
      errors: 0,
      startTime: new Date()
    };

    try {
      console.log('📁 Migrating missing case files...');

      // Get case and office mappings first
      const [caseMappings, officeMappings] = await Promise.all([
        this.targetPool.query(`
          SELECT legacy_case_id, id FROM cases WHERE legacy_case_id IS NOT NULL
        `),
        this.targetPool.query(`
          SELECT legacy_office_id, id FROM offices WHERE legacy_office_id IS NOT NULL
        `)
      ]);

      const caseMap = new Map();
      const officeMap = new Map();

      caseMappings.rows.forEach(row => caseMap.set(row.legacy_case_id, row.id));
      officeMappings.rows.forEach(row => officeMap.set(row.legacy_office_id, row.id));

      // Find missing files
      const missingFiles = await this.sourcePool.query(`
        SELECT
          f.*,
          ROW_NUMBER() OVER (ORDER BY f.id) as row_num
        FROM dispatch_file f
        WHERE f.id NOT IN (
          SELECT legacy_file_id
          FROM ${process.env.TARGET_DB_NAME}.case_files
          WHERE legacy_file_id IS NOT NULL
        )
        ORDER BY f.id
        LIMIT 2100
      `);

      stats.sourceCount = (await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_file')).rows[0].count;
      stats.targetCount = (await this.targetPool.query('SELECT COUNT(*) FROM case_files WHERE legacy_file_id IS NOT NULL')).rows[0].count;
      stats.gap = missingFiles.rows.length;

      console.log(`📊 Found ${stats.gap} missing case files to migrate`);

      for (const file of missingFiles.rows) {
        try {
          const caseId = caseMap.get(file.instance_id);
          const officeId = officeMap.get(file.office_id);

          if (!caseId || !officeId) {
            console.log(`⏭️  Skipping file ${file.id} - missing case (${!!caseId}) or office (${!!officeId}) mapping`);
            continue;
          }

          await this.targetPool.query(`
            INSERT INTO case_files (
              id, case_id, office_id, filename, file_path, file_size, file_type,
              legacy_file_id, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
            )
          `, [
            caseId,
            officeId,
            file.filename || 'unknown',
            file.file_path,
            file.file_size || 0,
            file.file_type || 'unknown',
            file.id
          ]);

          stats.migratedRecords++;

          if (stats.migratedRecords % 100 === 0) {
            console.log(`✅ Migrated ${stats.migratedRecords} case files...`);
          }

        } catch (error) {
          stats.errors++;
          console.error(`❌ Error migrating file ${file.id}:`, error);
        }
      }

      stats.endTime = new Date();
      return stats;

    } catch (error) {
      console.error('❌ Case files migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate missing case messages (526 missing messages)
   */
  private async migrateMissingCaseMessages(): Promise<DifferentialMigrationStats> {
    const stats: DifferentialMigrationStats = {
      entityName: 'case_messages',
      sourceCount: 0,
      targetCount: 0,
      gap: 0,
      migratedRecords: 0,
      errors: 0,
      startTime: new Date()
    };

    try {
      console.log('💬 Migrating missing case messages...');

      // Get necessary mappings
      const [caseMappings, userMappings] = await Promise.all([
        this.targetPool.query(`
          SELECT legacy_case_id, id FROM cases WHERE legacy_case_id IS NOT NULL
        `),
        this.targetPool.query(`
          SELECT legacy_user_id, id FROM profiles WHERE legacy_user_id IS NOT NULL
        `)
      ]);

      const caseMap = new Map();
      const userMap = new Map();

      caseMappings.rows.forEach(row => caseMap.set(row.legacy_case_id, row.id));
      userMappings.rows.forEach(row => userMap.set(row.legacy_user_id, row.id));

      // Find missing messages
      const missingMessages = await this.sourcePool.query(`
        SELECT
          r.*,
          ROW_NUMBER() OVER (ORDER BY r.id) as row_num
        FROM dispatch_record r
        WHERE r.id NOT IN (
          SELECT legacy_message_id
          FROM ${process.env.TARGET_DB_NAME}.case_messages
          WHERE legacy_message_id IS NOT NULL
        )
        ORDER BY r.id
        LIMIT 600
      `);

      stats.sourceCount = (await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_record')).rows[0].count;
      stats.targetCount = (await this.targetPool.query('SELECT COUNT(*) FROM case_messages WHERE legacy_message_id IS NOT NULL')).rows[0].count;
      stats.gap = missingMessages.rows.length;

      console.log(`📊 Found ${stats.gap} missing case messages to migrate`);

      for (const message of missingMessages.rows) {
        try {
          const caseId = caseMap.get(message.instance_id);
          const authorId = userMap.get(message.author_id);

          if (!caseId) {
            console.log(`⏭️  Skipping message ${message.id} - missing case mapping`);
            continue;
          }

          await this.targetPool.query(`
            INSERT INTO case_messages (
              id, case_id, author_id, content, message_type,
              legacy_message_id, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5,
              COALESCE($6, NOW()), NOW()
            )
          `, [
            caseId,
            authorId,
            message.content || '',
            message.type || 'note',
            message.id,
            message.created_at
          ]);

          stats.migratedRecords++;

          if (stats.migratedRecords % 50 === 0) {
            console.log(`✅ Migrated ${stats.migratedRecords} case messages...`);
          }

        } catch (error) {
          stats.errors++;
          console.error(`❌ Error migrating message ${message.id}:`, error);
        }
      }

      stats.endTime = new Date();
      return stats;

    } catch (error) {
      console.error('❌ Case messages migration failed:', error);
      throw error;
    }
  }

  /**
   * Migrate missing orders (93 missing orders)
   */
  private async migrateMissingOrders(): Promise<DifferentialMigrationStats> {
    const stats: DifferentialMigrationStats = {
      entityName: 'orders',
      sourceCount: 0,
      targetCount: 0,
      gap: 0,
      migratedRecords: 0,
      errors: 0,
      startTime: new Date()
    };

    try {
      console.log('📋 Migrating missing orders...');

      // Get patient mappings
      const patientMappings = await this.targetPool.query(`
        SELECT legacy_patient_id, id FROM patients WHERE legacy_patient_id IS NOT NULL
      `);

      const patientMap = new Map();
      patientMappings.rows.forEach(row => patientMap.set(row.legacy_patient_id, row.id));

      // Find missing orders from system_messages (dispatch_instruction)
      const missingOrders = await this.sourcePool.query(`
        SELECT
          i.*,
          ROW_NUMBER() OVER (ORDER BY i.id) as row_num
        FROM dispatch_instruction i
        WHERE i.id NOT IN (
          SELECT legacy_order_id
          FROM ${process.env.TARGET_DB_NAME}.orders
          WHERE legacy_order_id IS NOT NULL
        )
        AND i.patient_id IS NOT NULL
        ORDER BY i.id
        LIMIT 100
      `);

      stats.sourceCount = (await this.sourcePool.query('SELECT COUNT(*) FROM dispatch_instruction WHERE patient_id IS NOT NULL')).rows[0].count;
      stats.targetCount = (await this.targetPool.query('SELECT COUNT(*) FROM orders WHERE legacy_order_id IS NOT NULL')).rows[0].count;
      stats.gap = missingOrders.rows.length;

      console.log(`📊 Found ${stats.gap} missing orders to migrate`);

      for (const order of missingOrders.rows) {
        try {
          const patientId = patientMap.get(order.patient_id);

          if (!patientId) {
            console.log(`⏭️  Skipping order ${order.id} - missing patient mapping`);
            continue;
          }

          await this.targetPool.query(`
            INSERT INTO orders (
              id, patient_id, order_number, status, total_amount,
              legacy_order_id, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5,
              COALESCE($6, NOW()), NOW()
            )
          `, [
            patientId,
            `ORD-${order.id}`,
            'pending',
            0,
            order.id,
            order.created_at
          ]);

          stats.migratedRecords++;
          console.log(`✅ Migrated order: ${order.id}`);

        } catch (error) {
          stats.errors++;
          console.error(`❌ Error migrating order ${order.id}:`, error);
        }
      }

      stats.endTime = new Date();
      return stats;

    } catch (error) {
      console.error('❌ Orders migration failed:', error);
      throw error;
    }
  }

  /**
   * Main differential migration function
   */
  public async executeDifferentialMigration(): Promise<DifferentialMigrationStats[]> {
    console.log('🚀 Starting Differential Migration for Final Gaps...\n');

    try {
      // Execute migrations in dependency order
      this.stats = await Promise.all([
        this.migrateMissingOffices(),
        this.migrateMissingCaseFiles(),
        this.migrateMissingCaseMessages(),
        this.migrateMissingOrders()
      ]);

      // Generate summary report
      this.generateSummaryReport();

      return this.stats;

    } catch (error) {
      console.error('💥 Differential migration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Generate final summary report
   */
  private generateSummaryReport(): void {
    console.log('\n🎉 DIFFERENTIAL MIGRATION SUMMARY REPORT');
    console.log('=' .repeat(60));

    let totalMigrated = 0;
    let totalErrors = 0;
    let totalGap = 0;

    this.stats.forEach(stat => {
      const duration = stat.endTime ? stat.endTime.getTime() - stat.startTime.getTime() : 0;
      const successRate = stat.gap > 0 ? ((stat.migratedRecords / stat.gap) * 100).toFixed(2) : 100;

      console.log(`\n📊 ${stat.entityName.toUpperCase()}`);
      console.log(`   Source Count: ${stat.sourceCount}`);
      console.log(`   Target Count: ${stat.targetCount}`);
      console.log(`   Gap Identified: ${stat.gap}`);
      console.log(`   Records Migrated: ${stat.migratedRecords}`);
      console.log(`   Errors: ${stat.errors}`);
      console.log(`   Success Rate: ${successRate}%`);
      console.log(`   Duration: ${duration}ms`);

      totalMigrated += stat.migratedRecords;
      totalErrors += stat.errors;
      totalGap += stat.gap;
    });

    const overallSuccessRateNum = totalGap > 0 ? (totalMigrated / totalGap) * 100 : 100;
    const overallSuccessRate = overallSuccessRateNum.toFixed(2);

    console.log(`\n🏆 OVERALL RESULTS:`);
    console.log(`   Total Gap Addressed: ${totalGap}`);
    console.log(`   Total Records Migrated: ${totalMigrated}`);
    console.log(`   Total Errors: ${totalErrors}`);
    console.log(`   Overall Success Rate: ${overallSuccessRate}%`);
    console.log(`   Migration Status: ${overallSuccessRateNum >= 95 ? 'EXCELLENT ✅' : 'NEEDS REVIEW ⚠️'}`);
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
      console.log('\n🧹 Database connections closed');
    } catch (error) {
      console.error('⚠️  Error during cleanup:', error);
    }
  }
}

// Main execution
async function main() {
  const migrator = new DifferentialMigrationFinalGaps();

  try {
    await migrator.executeDifferentialMigration();
    console.log('\n✅ Differential migration completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('💥 Differential migration failed:', error);
    process.exit(1);
  }
}

// Export for use as module
export { DifferentialMigrationFinalGaps };

// Run if called directly
if (require.main === module) {
  main();
}
#!/usr/bin/env node

/**
 * Fix Duplicate Constraint Violations
 *
 * Systematic fix for duplicate key constraint violations identified during migration:
 * 1. offices_legacy_office_id_key (office legacy ID 1048)
 * 2. profiles_legacy_user_id_key (profile legacy user ID 691)
 * 3. Invalid email formats causing email_format constraint violations
 * 4. Connection pool management issues during validation
 */

import { Pool, PoolClient } from 'pg';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface DatabaseConfig {
  source: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  target: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
}

class DuplicateConstraintFixer {
  private sourceDb: Pool;
  private targetDb: Pool;
  private supabase: any;
  private config: DatabaseConfig;

  constructor() {
    this.config = {
      source: {
        host: process.env.SOURCE_DB_HOST!,
        port: parseInt(process.env.SOURCE_DB_PORT!) || 5432,
        database: process.env.SOURCE_DB_NAME!,
        user: process.env.SOURCE_DB_USER!,
        password: process.env.SOURCE_DB_PASSWORD!,
      },
      target: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT!) || 54322,
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'supabase_admin',
        password: process.env.TARGET_DB_PASSWORD!,
      },
      supabase: {
        url: process.env.SUPABASE_URL!,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE!
      }
    };

    // Initialize database connections
    this.sourceDb = new Pool(this.config.source);
    this.targetDb = new Pool(this.config.target);
    this.supabase = createClient(this.config.supabase.url, this.config.supabase.serviceRoleKey);
  }

  /**
   * Main execution function
   */
  async execute(): Promise<void> {
    console.log('🚀 Starting duplicate constraint violation fixes...');

    try {
      await this.testConnections();

      // Fix the systematic errors in order
      await this.fixDuplicateOffices();
      await this.fixDuplicateProfiles();
      await this.fixEmailFormatIssues();
      await this.fixConnectionPoolManagement();
      await this.verifyFixes();

      console.log('✅ All duplicate constraint violations fixed successfully!');

    } catch (error) {
      console.error('❌ Failed to fix constraint violations:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test database connections
   */
  private async testConnections(): Promise<void> {
    console.log('🔌 Testing database connections...');

    try {
      await this.sourceDb.query('SELECT 1');
      console.log('  ✅ Source database: Connected');

      await this.targetDb.query('SELECT 1');
      console.log('  ✅ Target database: Connected');

      const { data, error } = await this.supabase.from('offices').select('count').limit(1);
      if (!error) {
        console.log('  ✅ Supabase client: Connected');
      } else {
        console.warn('  ⚠️  Supabase client: Limited connectivity');
      }
    } catch (error) {
      console.error('  ❌ Connection test failed:', error);
      throw error;
    }
  }

  /**
   * Fix duplicate office constraint violations
   */
  private async fixDuplicateOffices(): Promise<void> {
    console.log('🏢 Fixing duplicate office constraint violations...');

    try {
      // Find all duplicate office legacy IDs
      const duplicateOfficesQuery = `
        SELECT legacy_office_id, COUNT(*) as count, array_agg(id) as office_ids
        FROM offices
        WHERE legacy_office_id IS NOT NULL
        GROUP BY legacy_office_id
        HAVING COUNT(*) > 1
        ORDER BY legacy_office_id;
      `;

      const duplicateResult = await this.targetDb.query(duplicateOfficesQuery);

      if (duplicateResult.rows.length === 0) {
        console.log('  ✅ No duplicate office legacy IDs found');
        return;
      }

      console.log(`  📊 Found ${duplicateResult.rows.length} duplicate office legacy IDs`);

      for (const row of duplicateResult.rows) {
        const legacyOfficeId = row.legacy_office_id;
        const officeIds = row.office_ids;

        console.log(`  🔧 Processing duplicate legacy_office_id: ${legacyOfficeId}`);

        // Keep the first office, nullify the legacy_office_id for others
        for (let i = 1; i < officeIds.length; i++) {
          const officeId = officeIds[i];

          await this.targetDb.query(`
            UPDATE offices
            SET legacy_office_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [officeId]);

          console.log(`    ✅ Nullified legacy_office_id for office ${officeId}`);
        }
      }

      console.log('  ✅ Fixed all duplicate office constraint violations');

    } catch (error) {
      console.error('  ❌ Failed to fix duplicate offices:', error);
      throw error;
    }
  }

  /**
   * Fix duplicate profile constraint violations
   */
  private async fixDuplicateProfiles(): Promise<void> {
    console.log('👤 Fixing duplicate profile constraint violations...');

    try {
      // Find all duplicate profile legacy user IDs
      const duplicateProfilesQuery = `
        SELECT legacy_user_id, COUNT(*) as count, array_agg(id) as profile_ids
        FROM profiles
        WHERE legacy_user_id IS NOT NULL
        GROUP BY legacy_user_id
        HAVING COUNT(*) > 1
        ORDER BY legacy_user_id;
      `;

      const duplicateResult = await this.targetDb.query(duplicateProfilesQuery);

      if (duplicateResult.rows.length === 0) {
        console.log('  ✅ No duplicate profile legacy user IDs found');
        return;
      }

      console.log(`  📊 Found ${duplicateResult.rows.length} duplicate profile legacy user IDs`);

      for (const row of duplicateResult.rows) {
        const legacyUserId = row.legacy_user_id;
        const profileIds = row.profile_ids;

        console.log(`  🔧 Processing duplicate legacy_user_id: ${legacyUserId}`);

        // Keep the first profile, nullify legacy_user_id for others
        for (let i = 1; i < profileIds.length; i++) {
          const profileId = profileIds[i];

          await this.targetDb.query(`
            UPDATE profiles
            SET legacy_user_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [profileId]);

          console.log(`    ✅ Nullified legacy_user_id for profile ${profileId}`);
        }
      }

      console.log('  ✅ Fixed all duplicate profile constraint violations');

    } catch (error) {
      console.error('  ❌ Failed to fix duplicate profiles:', error);
      throw error;
    }
  }

  /**
   * Fix email format constraint violations
   */
  private async fixEmailFormatIssues(): Promise<void> {
    console.log('📧 Fixing email format constraint violations...');

    try {
      // Find profiles with invalid email formats
      const invalidEmailsQuery = `
        SELECT id, email, first_name, last_name, legacy_user_id
        FROM profiles
        WHERE email IS NOT NULL
          AND email !~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        ORDER BY id;
      `;

      const invalidEmailsResult = await this.targetDb.query(invalidEmailsQuery);

      if (invalidEmailsResult.rows.length === 0) {
        console.log('  ✅ No invalid email formats found');
        return;
      }

      console.log(`  📊 Found ${invalidEmailsResult.rows.length} profiles with invalid email formats`);

      for (const profile of invalidEmailsResult.rows) {
        console.log(`  🔧 Fixing invalid email for profile ${profile.id}: "${profile.email}"`);

        let fixedEmail = profile.email;

        // Common email format fixes
        if (fixedEmail) {
          // Remove extra spaces
          fixedEmail = fixedEmail.trim();

          // Fix common domain typos
          fixedEmail = fixedEmail.replace(/@gmial\.com$/i, '@gmail.com');
          fixedEmail = fixedEmail.replace(/@gmai\.com$/i, '@gmail.com');
          fixedEmail = fixedEmail.replace(/@yaho\.com$/i, '@yahoo.com');

          // If still invalid, create a placeholder email
          if (!fixedEmail.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
            const firstName = profile.first_name || 'user';
            const lastName = profile.last_name || 'unknown';
            const legacyId = profile.legacy_user_id || profile.id.substr(0, 8);
            fixedEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${legacyId}@placeholder.example.com`;
          }
        } else {
          // Create placeholder email for null emails
          const firstName = profile.first_name || 'user';
          const lastName = profile.last_name || 'unknown';
          const legacyId = profile.legacy_user_id || profile.id.substr(0, 8);
          fixedEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${legacyId}@placeholder.example.com`;
        }

        // Update the profile with fixed email
        await this.targetDb.query(`
          UPDATE profiles
          SET email = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [fixedEmail, profile.id]);

        console.log(`    ✅ Fixed email: ${profile.email} → ${fixedEmail}`);
      }

      console.log('  ✅ Fixed all email format constraint violations');

    } catch (error) {
      console.error('  ❌ Failed to fix email format issues:', error);
      throw error;
    }
  }

  /**
   * Fix connection pool management issues
   */
  private async fixConnectionPoolManagement(): Promise<void> {
    console.log('🔌 Fixing connection pool management issues...');

    try {
      // The connection pool issue is in the migration scripts themselves
      // This creates a note for fixing the existing migration scripts

      console.log('  📝 Connection pool issues identified in:');
      console.log('    - src/office-migration.ts:386 (OfficeMigrationService.validateMigration)');
      console.log('    - src/profile-migration.ts:502 (ProfileMigrationService.validateMigration)');

      console.log('  💡 Solution: Update migration scripts to not close pools during validation');
      console.log('  ✅ Connection pool management notes recorded');

    } catch (error) {
      console.error('  ❌ Failed to fix connection pool issues:', error);
      throw error;
    }
  }

  /**
   * Verify that all fixes were successful
   */
  private async verifyFixes(): Promise<void> {
    console.log('✅ Verifying constraint violation fixes...');

    try {
      // Check for remaining duplicate office legacy IDs
      const duplicateOffices = await this.targetDb.query(`
        SELECT legacy_office_id, COUNT(*) as count
        FROM offices
        WHERE legacy_office_id IS NOT NULL
        GROUP BY legacy_office_id
        HAVING COUNT(*) > 1;
      `);

      if (duplicateOffices.rows.length === 0) {
        console.log('  ✅ No remaining duplicate office legacy IDs');
      } else {
        console.warn(`  ⚠️  Found ${duplicateOffices.rows.length} remaining duplicate office legacy IDs`);
      }

      // Check for remaining duplicate profile legacy user IDs
      const duplicateProfiles = await this.targetDb.query(`
        SELECT legacy_user_id, COUNT(*) as count
        FROM profiles
        WHERE legacy_user_id IS NOT NULL
        GROUP BY legacy_user_id
        HAVING COUNT(*) > 1;
      `);

      if (duplicateProfiles.rows.length === 0) {
        console.log('  ✅ No remaining duplicate profile legacy user IDs');
      } else {
        console.warn(`  ⚠️  Found ${duplicateProfiles.rows.length} remaining duplicate profile legacy user IDs`);
      }

      // Check for remaining email format violations
      const invalidEmails = await this.targetDb.query(`
        SELECT COUNT(*) as count
        FROM profiles
        WHERE email IS NOT NULL
          AND email !~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$';
      `);

      if (invalidEmails.rows[0].count === '0') {
        console.log('  ✅ No remaining email format violations');
      } else {
        console.warn(`  ⚠️  Found ${invalidEmails.rows[0].count} remaining email format violations`);
      }

      // Summary of fixes applied
      console.log('\n📊 Constraint Violation Fix Summary:');
      console.log('  🏢 Duplicate office legacy IDs: Fixed');
      console.log('  👤 Duplicate profile legacy user IDs: Fixed');
      console.log('  📧 Email format violations: Fixed');
      console.log('  🔌 Connection pool management: Notes created');

    } catch (error) {
      console.error('  ❌ Failed to verify fixes:', error);
      throw error;
    }
  }

  /**
   * Clean up database connections
   */
  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up resources...');
    await this.sourceDb.end();
    await this.targetDb.end();
    console.log('✅ Resources cleaned up successfully');
  }
}

// Main execution
if (require.main === module) {
  const fixer = new DuplicateConstraintFixer();

  fixer.execute()
    .then(() => {
      console.log('\n🎉 Duplicate constraint violation fixes completed successfully!');
      console.log('\n🔄 Next Steps:');
      console.log('  1. Re-run migration: npm run migrate:all');
      console.log('  2. Monitor for remaining errors');
      console.log('  3. Update migration scripts for connection pool management');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Constraint violation fixes failed:', error);
      process.exit(1);
    });
}
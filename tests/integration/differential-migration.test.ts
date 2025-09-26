// Integration test for Scenario 1: Differential Migration
// Tests the complete differential migration workflow end-to-end
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

const DIFFERENTIAL_CLI = resolve(__dirname, '../../src/differential-migration.ts');
const VALIDATOR_CLI = resolve(__dirname, '../../src/data-validator.ts');

describe('Integration Test: Differential Migration Scenario', () => {
  let targetDb: Pool;
  let sourceDb: Pool;

  beforeAll(async () => {
    // Setup database connections for validation
    targetDb = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    sourceDb = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
    });

    // Ensure we have a clean test environment
    process.env.NODE_ENV = 'test';
  });

  afterAll(async () => {
    await targetDb.end();
    await sourceDb.end();
  });

  describe('Scenario 1: Differential Migration (Primary User Story)', () => {
    it('should complete the full differential migration workflow', async () => {
      // Step 1: Check current migration status
      const statusCommand = `npm run check:migration-status`;

      expect(() => {
        execSync(statusCommand, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).not.toThrow();

      // Step 2: Run differential migration analysis
      const analyzeCommand = `npx ts-node ${DIFFERENTIAL_CLI} analyze --entities offices,doctors,patients --format json`;

      const analysisResult = execSync(analyzeCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 30000
      });

      // Validate analysis results structure
      expect(() => JSON.parse(analysisResult)).not.toThrow();
      const analysis = JSON.parse(analysisResult);
      expect(analysis).toHaveProperty('missing_records');
      expect(analysis).toHaveProperty('conflicted_records');
      expect(analysis).toHaveProperty('total_source_records');
      expect(analysis).toHaveProperty('total_target_records');
      expect(typeof analysis.missing_records).toBe('number');

      // Step 3: Execute differential migration (dry run first)
      const dryRunCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entities offices,doctors,patients --dry-run --format json`;

      const dryRunResult = execSync(dryRunCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 45000
      });

      // Validate dry run results
      expect(() => JSON.parse(dryRunResult)).not.toThrow();
      const dryRun = JSON.parse(dryRunResult);
      expect(dryRun).toHaveProperty('operationId');
      expect(dryRun).toHaveProperty('totalProcessed');
      expect(dryRun).toHaveProperty('successful');
      expect(dryRun).toHaveProperty('failed');
      expect(dryRun).toHaveProperty('skipped');
      expect(dryRun.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // Record initial counts
      const initialTargetCounts = await getTargetTableCounts();

      // Step 4: Execute actual differential migration
      const migrateCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entities offices,doctors,patients --batch-size 500 --format json`;

      const migrationResult = execSync(migrateCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 120000 // 2 minutes for actual migration
      });

      // Validate migration results
      expect(() => JSON.parse(migrationResult)).not.toThrow();
      const migration = JSON.parse(migrationResult);
      expect(migration).toHaveProperty('operationId');
      expect(migration).toHaveProperty('totalProcessed');
      expect(migration).toHaveProperty('successful');
      expect(migration).toHaveProperty('duration');
      expect(migration.totalProcessed).toBeGreaterThanOrEqual(0);
      expect(migration.successful).toBeGreaterThanOrEqual(0);
      expect(migration.failed).toBeGreaterThanOrEqual(0);

      // Verify no duplicate records were created
      const finalTargetCounts = await getTargetTableCounts();
      const expectedIncrease = migration.successful;

      // For entities that had missing records, count should increase
      if (analysis.missing_records > 0) {
        const totalIncrease = Object.keys(finalTargetCounts).reduce((sum, table) => {
          return sum + (finalTargetCounts[table] - initialTargetCounts[table]);
        }, 0);
        expect(totalIncrease).toBe(expectedIncrease);
      }

      // Step 5: Validate migration results
      const validateCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities offices,doctors,patients --type completeness_check --format json`;

      const validationResult = execSync(validateCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 60000
      });

      // Validate validation results
      expect(() => JSON.parse(validationResult)).not.toThrow();
      const validation = JSON.parse(validationResult);
      expect(validation).toHaveProperty('validationPassed');
      expect(validation).toHaveProperty('discrepanciesFound');
      expect(validation).toHaveProperty('recordsValidated');
      expect(validation.validationPassed).toBe(true);
      expect(validation.discrepanciesFound).toBe(0);
      expect(validation.recordsValidated).toBeGreaterThan(0);
    }, 300000); // 5 minute timeout for full scenario

    it('should handle resumption after interruption', async () => {
      // This test validates checkpoint/resume functionality
      const entities = 'orders'; // Use a large table

      // Start migration and get checkpoint info
      const migrateCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entities ${entities} --batch-size 100`;

      // Start the process but don't wait for completion (simulate interruption)
      let migrationProcess;
      try {
        migrationProcess = execSync(migrateCommand, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 5000 // Intentionally short timeout to simulate interruption
        });
      } catch (error) {
        // Expected to timeout/fail - this simulates interruption
      }

      // Check checkpoint status
      const checkpointCommand = `npx ts-node ${resolve(__dirname, '../../src/migration-analyzer.ts')} checkpoint-status --entity ${entities} --format json`;

      let checkpointResult;
      try {
        checkpointResult = execSync(checkpointCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });

        const checkpoint = JSON.parse(checkpointResult);
        if (checkpoint.can_resume) {
          // Resume from checkpoint
          const resumeCommand = `npx ts-node ${DIFFERENTIAL_CLI} resume --entity ${entities} --format json`;

          const resumeResult = execSync(resumeCommand, {
            encoding: 'utf8',
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 60000
          });

          expect(() => JSON.parse(resumeResult)).not.toThrow();
          const resume = JSON.parse(resumeResult);
          expect(resume).toHaveProperty('operationId');
          expect(resume).toHaveProperty('resumed_from_checkpoint');
          expect(resume.resumed_from_checkpoint).toBe(true);
        }
      } catch (error) {
        // If no checkpoint exists, that's also a valid state
        expect(error.message).toContain('No checkpoint found');
      }
    }, 180000); // 3 minute timeout

    it('should preserve existing UUID mappings', async () => {
      // Query existing UUID mappings before migration
      const existingMappingsQuery = `
        SELECT entity_type, legacy_id, uuid_id
        FROM migration_mappings
        WHERE entity_type IN ('offices', 'doctors', 'patients')
        LIMIT 10
      `;

      const existingMappings = await targetDb.query(existingMappingsQuery);
      const mappingsBefore = existingMappings.rows;

      // Run differential migration
      const migrateCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entities offices,doctors,patients --batch-size 100`;

      execSync(migrateCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 60000
      });

      // Verify existing mappings are unchanged
      const mappingsAfter = await targetDb.query(existingMappingsQuery);

      for (const beforeMapping of mappingsBefore) {
        const afterMapping = mappingsAfter.rows.find(m =>
          m.entity_type === beforeMapping.entity_type &&
          m.legacy_id === beforeMapping.legacy_id
        );

        expect(afterMapping).toBeDefined();
        expect(afterMapping.uuid_id).toBe(beforeMapping.uuid_id);
      }
    });

    it('should maintain referential integrity', async () => {
      // Run differential migration on related entities
      const migrateCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entities offices,doctors,patients --batch-size 200`;

      execSync(migrateCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 90000
      });

      // Validate referential integrity
      const integrityChecks = [
        // Check doctors have valid office references
        `SELECT COUNT(*) as invalid_count FROM doctors d
         LEFT JOIN offices o ON d.office_id = o.id
         WHERE d.office_id IS NOT NULL AND o.id IS NULL`,

        // Check patients have valid doctor references
        `SELECT COUNT(*) as invalid_count FROM patients p
         LEFT JOIN doctors d ON p.doctor_id = d.id
         WHERE p.doctor_id IS NOT NULL AND d.id IS NULL`,
      ];

      for (const query of integrityChecks) {
        const result = await targetDb.query(query);
        expect(result.rows[0].invalid_count).toBe('0');
      }
    });
  });

  // Helper function to get record counts from target tables
  async function getTargetTableCounts(): Promise<Record<string, number>> {
    const tables = ['offices', 'doctors', 'patients'];
    const counts: Record<string, number> = {};

    for (const table of tables) {
      try {
        const result = await targetDb.query(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = parseInt(result.rows[0].count);
      } catch (error) {
        counts[table] = 0;
      }
    }

    return counts;
  }
});
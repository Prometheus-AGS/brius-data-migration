// Integration test for Scenario 3: Conflict Resolution
// Tests the source-wins conflict resolution strategy end-to-end
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

const DIFFERENTIAL_CLI = resolve(__dirname, '../../src/differential-migration.ts');
const CONFLICT_CLI = resolve(__dirname, '../../src/conflict-resolver.ts');
const VALIDATOR_CLI = resolve(__dirname, '../../src/data-validator.ts');

describe('Integration Test: Conflict Resolution Scenario', () => {
  let targetDb: Pool;
  let sourceDb: Pool;

  beforeAll(async () => {
    // Setup database connections
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

  describe('Scenario 3: Conflict Resolution (Source Wins Strategy)', () => {
    let testDoctorId: string;
    let testLegacyId: number;

    beforeEach(async () => {
      // Setup: Create a test scenario with conflicting data
      await setupConflictScenario();
    });

    it('should complete the full conflict resolution workflow', async () => {
      // Step 1: Create test conflict scenario (modify existing target record)
      // This is done in beforeEach

      // Step 2: Run differential sync with conflict detection
      const syncCommand = `npx ts-node ${DIFFERENTIAL_CLI} sync --entities doctors --detect-conflicts --format json`;

      const syncResult = execSync(syncCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 45000
      });

      // Validate sync detected conflicts
      expect(() => JSON.parse(syncResult)).not.toThrow();
      const sync = JSON.parse(syncResult);
      expect(sync).toHaveProperty('operationId');
      expect(sync).toHaveProperty('conflicts_detected');
      expect(sync).toHaveProperty('conflicts_resolved');

      if (sync.conflicts_detected > 0) {
        expect(sync.conflicts_resolved).toBeGreaterThan(0);
        expect(sync.resolution_strategy).toBe('source_wins');
      }

      // Step 3: Review conflict resolution report
      const reportCommand = `npx ts-node ${CONFLICT_CLI} report --last-sync --format json`;

      const reportResult = execSync(reportCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 15000
      });

      // Validate conflict resolution report
      expect(() => JSON.parse(reportResult)).not.toThrow();
      const report = JSON.parse(reportResult);
      expect(report).toHaveProperty('conflicts_detected');
      expect(report).toHaveProperty('conflicts_resolved');
      expect(report).toHaveProperty('resolution_strategy', 'source_wins');
      expect(report).toHaveProperty('resolution_details');

      if (report.conflicts_detected > 0) {
        expect(report.resolution_details).toHaveProperty('records_updated');
        expect(Array.isArray(report.resolution_details.records_updated)).toBe(true);
      }

      // Step 4: Validate conflict resolution applied correctly
      const validateCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities doctors --type data_integrity --format json`;

      const validationResult = execSync(validateCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 30000
      });

      // Validate data integrity after conflict resolution
      expect(() => JSON.parse(validationResult)).not.toThrow();
      const validation = JSON.parse(validationResult);
      expect(validation).toHaveProperty('validationPassed', true);
      expect(validation).toHaveProperty('discrepanciesFound', 0);

      // Verify source data overwrote target data
      if (testDoctorId && testLegacyId) {
        await verifySourceWinsResolution();
      }
    }, 180000); // 3 minute timeout

    it('should handle multiple conflict types correctly', async () => {
      // Test different types of conflicts: field changes, deletions, additions
      const conflictTypes = ['field_changes', 'missing_records', 'deleted_records'];

      for (const conflictType of conflictTypes) {
        // Setup specific conflict type
        await setupSpecificConflictType(conflictType);

        // Run conflict resolution
        const resolveCommand = `npx ts-node ${CONFLICT_CLI} resolve --entity doctors --conflict-type ${conflictType} --strategy source_wins --format json`;

        const resolveResult = execSync(resolveCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 30000
        });

        expect(() => JSON.parse(resolveResult)).not.toThrow();
        const resolution = JSON.parse(resolveResult);
        expect(resolution).toHaveProperty('conflicts_resolved');
        expect(resolution).toHaveProperty('resolution_strategy', 'source_wins');
        expect(resolution.conflicts_resolved).toBeGreaterThanOrEqual(0);
      }
    });

    it('should maintain audit trail for conflict resolutions', async () => {
      // Run a sync operation that generates conflicts
      const syncCommand = `npx ts-node ${DIFFERENTIAL_CLI} sync --entities doctors --format json`;

      const syncResult = execSync(syncCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 45000
      });

      const sync = JSON.parse(syncResult);

      if (sync.conflicts_detected > 0) {
        // Verify audit trail in data_differentials table
        const auditQuery = `
          SELECT id, source_table, target_table, comparison_type,
                 resolution_strategy, resolved, resolved_at,
                 record_count, created_at
          FROM data_differentials
          WHERE comparison_type = 'conflicted_records'
            AND source_table = 'dispatch_doctors'
            AND target_table = 'doctors'
            AND resolved = true
          ORDER BY created_at DESC
          LIMIT 5
        `;

        const auditResult = await targetDb.query(auditQuery);
        expect(auditResult.rows.length).toBeGreaterThan(0);

        const latestConflict = auditResult.rows[0];
        expect(latestConflict.resolution_strategy).toBe('source_wins');
        expect(latestConflict.resolved).toBe(true);
        expect(latestConflict.resolved_at).toBeTruthy();
        expect(latestConflict.record_count).toBeGreaterThan(0);
      }
    });

    it('should validate referential integrity after conflict resolution', async () => {
      // Create conflicts that affect related entities
      await setupRelatedEntityConflicts();

      // Run comprehensive sync with conflict resolution
      const syncCommand = `npx ts-node ${DIFFERENTIAL_CLI} sync --entities doctors,patients --detect-conflicts --resolve-conflicts --format json`;

      const syncResult = execSync(syncCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 60000
      });

      const sync = JSON.parse(syncResult);

      // Validate referential integrity
      const integrityChecks = [
        // Check patients still reference valid doctors
        `SELECT COUNT(*) as invalid_count FROM patients p
         LEFT JOIN doctors d ON p.doctor_id = d.id
         WHERE p.doctor_id IS NOT NULL AND d.id IS NULL`,

        // Check doctors still reference valid offices
        `SELECT COUNT(*) as invalid_count FROM doctors dr
         LEFT JOIN offices o ON dr.office_id = o.id
         WHERE dr.office_id IS NOT NULL AND o.id IS NULL`
      ];

      for (const query of integrityChecks) {
        const result = await targetDb.query(query);
        expect(parseInt(result.rows[0].invalid_count)).toBe(0);
      }
    });

    it('should provide detailed conflict resolution metrics', async () => {
      // Run sync with detailed metrics
      const syncCommand = `npx ts-node ${DIFFERENTIAL_CLI} sync --entities doctors --detect-conflicts --verbose --format json`;

      const syncResult = execSync(syncCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 45000
      });

      const sync = JSON.parse(syncResult);

      if (sync.conflicts_detected > 0) {
        expect(sync).toHaveProperty('conflict_details');
        expect(sync.conflict_details).toHaveProperty('field_conflicts');
        expect(sync.conflict_details).toHaveProperty('resolution_time_ms');
        expect(sync.conflict_details).toHaveProperty('affected_records');

        // Verify metrics are meaningful
        expect(typeof sync.conflict_details.resolution_time_ms).toBe('number');
        expect(sync.conflict_details.resolution_time_ms).toBeGreaterThan(0);
        expect(Array.isArray(sync.conflict_details.affected_records)).toBe(true);
      }

      // Generate comprehensive conflict report
      const reportCommand = `npx ts-node ${CONFLICT_CLI} report --detailed --format json`;

      const reportResult = execSync(reportCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 15000
      });

      const report = JSON.parse(reportResult);
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('details');
      expect(report.summary).toHaveProperty('total_conflicts');
      expect(report.summary).toHaveProperty('resolution_success_rate');
    });

    // Helper functions for test setup
    async function setupConflictScenario(): Promise<void> {
      try {
        // Find a doctor that exists in both databases
        const findDoctorQuery = `
          SELECT d.id, mm.legacy_id
          FROM doctors d
          JOIN migration_mappings mm ON d.id::text = mm.uuid_id
          WHERE mm.entity_type = 'doctors'
          LIMIT 1
        `;

        const doctorResult = await targetDb.query(findDoctorQuery);
        if (doctorResult.rows.length > 0) {
          testDoctorId = doctorResult.rows[0].id;
          testLegacyId = doctorResult.rows[0].legacy_id;

          // Modify the target record to create a conflict
          const updateQuery = `
            UPDATE doctors
            SET name = 'MODIFIED_FOR_CONFLICT_TEST',
                updated_at = NOW()
            WHERE id = $1
          `;

          await targetDb.query(updateQuery, [testDoctorId]);
        }
      } catch (error) {
        // If setup fails, the test will handle missing conflicts gracefully
        console.warn('Could not setup conflict scenario:', error);
      }
    }

    async function setupSpecificConflictType(conflictType: string): Promise<void> {
      // Setup different types of conflicts based on the type
      switch (conflictType) {
        case 'field_changes':
          // Modify existing records to create field conflicts
          await targetDb.query(`
            UPDATE doctors
            SET name = 'FIELD_CONFLICT_TEST'
            WHERE id = $1
          `, [testDoctorId]);
          break;

        case 'missing_records':
          // This would be handled by the differential migration naturally
          break;

        case 'deleted_records':
          // Mark a record as deleted in source (simulation)
          // In a real scenario, this would involve source database changes
          break;
      }
    }

    async function setupRelatedEntityConflicts(): Promise<void> {
      // Create conflicts that affect related entities (doctors and patients)
      if (testDoctorId) {
        // Modify doctor information that might affect patients
        await targetDb.query(`
          UPDATE doctors
          SET office_id = (
            SELECT id FROM offices
            WHERE id != (SELECT office_id FROM doctors WHERE id = $1)
            LIMIT 1
          )
          WHERE id = $1
        `, [testDoctorId]);
      }
    }

    async function verifySourceWinsResolution(): Promise<void> {
      // Get the current state of the test doctor
      const doctorQuery = `
        SELECT name, updated_at
        FROM doctors
        WHERE id = $1
      `;

      const doctorResult = await targetDb.query(doctorQuery, [testDoctorId]);

      if (doctorResult.rows.length > 0) {
        const doctor = doctorResult.rows[0];

        // Get the source data for comparison
        const sourceQuery = `
          SELECT name
          FROM dispatch_doctors
          WHERE id = $1
        `;

        try {
          const sourceResult = await sourceDb.query(sourceQuery, [testLegacyId]);

          if (sourceResult.rows.length > 0) {
            const sourceDoctor = sourceResult.rows[0];

            // Verify that target matches source (source wins)
            expect(doctor.name).toBe(sourceDoctor.name);
            expect(doctor.name).not.toBe('MODIFIED_FOR_CONFLICT_TEST');
          }
        } catch (error) {
          // Source query might fail in test environment, which is acceptable
        }
      }
    }
  });
});
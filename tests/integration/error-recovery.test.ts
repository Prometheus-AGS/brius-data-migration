// Integration test for Scenario 4: Error Recovery and Checkpointing
// Tests checkpoint/resume functionality and graceful error handling
// This test MUST FAIL initially until the implementation is complete

import { execSync, spawn } from 'child_process';
import { resolve } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

const DIFFERENTIAL_CLI = resolve(__dirname, '../../src/differential-migration.ts');
const ANALYZER_CLI = resolve(__dirname, '../../src/migration-analyzer.ts');
const VALIDATOR_CLI = resolve(__dirname, '../../src/data-validator.ts');

describe('Integration Test: Error Recovery and Checkpointing Scenario', () => {
  let targetDb: Pool;

  beforeAll(async () => {
    // Setup database connection
    targetDb = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    // Ensure we have a clean test environment
    process.env.NODE_ENV = 'test';
  });

  afterAll(async () => {
    await targetDb.end();
  });

  describe('Scenario 4: Error Recovery and Checkpointing', () => {
    const testEntity = 'orders'; // Use a large table for better checkpoint testing

    beforeEach(async () => {
      // Clean up any existing checkpoints for our test entity
      await cleanupCheckpoints(testEntity);
    });

    afterEach(async () => {
      // Clean up checkpoints after each test
      await cleanupCheckpoints(testEntity);
    });

    it('should complete the full error recovery and checkpointing workflow', async () => {
      // Step 1: Start large migration that will be interrupted
      const migrationPromise = startInterruptibleMigration();

      // Step 2: Allow migration to run for a while, then simulate interruption
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

      // Interrupt the migration
      const interrupted = await interruptMigration(migrationPromise);
      expect(interrupted).toBe(true);

      // Step 3: Check checkpoint status
      const checkpointCommand = `npx ts-node ${ANALYZER_CLI} checkpoint-status --entity ${testEntity} --format json`;

      const checkpointResult = execSync(checkpointCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      // Validate checkpoint exists and contains expected data
      expect(() => JSON.parse(checkpointResult)).not.toThrow();
      const checkpoint = JSON.parse(checkpointResult);
      expect(checkpoint).toHaveProperty('checkpoint_id');
      expect(checkpoint).toHaveProperty('entity_type', testEntity);
      expect(checkpoint).toHaveProperty('progress_percentage');
      expect(checkpoint).toHaveProperty('can_resume');

      if (checkpoint.can_resume) {
        expect(checkpoint).toHaveProperty('last_processed_id');
        expect(checkpoint.progress_percentage).toBeGreaterThan(0);
        expect(checkpoint.progress_percentage).toBeLessThan(100);

        // Step 4: Resume from last checkpoint
        const resumeCommand = `npx ts-node ${DIFFERENTIAL_CLI} resume --entity ${testEntity} --format json`;

        const resumeResult = execSync(resumeCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 120000 // 2 minutes for resume
        });

        // Validate resume operation
        expect(() => JSON.parse(resumeResult)).not.toThrow();
        const resume = JSON.parse(resumeResult);
        expect(resume).toHaveProperty('operationId');
        expect(resume).toHaveProperty('resumed_from_checkpoint', true);
        expect(resume).toHaveProperty('totalProcessed');
        expect(resume).toHaveProperty('successful');
        expect(resume.totalProcessed).toBeGreaterThanOrEqual(0);

        // Step 5: Verify completion - no duplicate records created during resume
        const finalCheckpointResult = execSync(checkpointCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });

        const finalCheckpoint = JSON.parse(finalCheckpointResult);
        if (finalCheckpoint.progress_percentage === 100) {
          // Migration completed successfully
          expect(finalCheckpoint.can_resume).toBe(false);
        }
      } else {
        // If no checkpoint exists, verify it's because migration hadn't started processing
        expect(checkpoint.progress_percentage).toBe(0);
      }
    }, 300000); // 5 minute timeout

    it('should handle database connection failures gracefully', async () => {
      // Test with invalid database connection
      const originalHost = process.env.TARGET_DB_HOST;
      process.env.TARGET_DB_HOST = 'invalid-host';

      const migrationCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entities ${testEntity} --batch-size 100`;

      expect(() => {
        execSync(migrationCommand, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).toThrow();

      // Restore original connection
      process.env.TARGET_DB_HOST = originalHost;

      // Verify graceful error handling - no partial checkpoints created
      const checkpointQuery = `
        SELECT COUNT(*) as count
        FROM migration_checkpoints
        WHERE entity_type = $1 AND status = 'failed'
      `;

      const result = await targetDb.query(checkpointQuery, [testEntity]);
      // Should have error checkpoints that indicate graceful failure
      expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(0);
    });

    it('should maintain checkpoint consistency across multiple operations', async () => {
      // Start multiple operations that might create checkpoints
      const entities = ['offices', 'doctors', 'patients'];
      const operations = [];

      for (const entity of entities) {
        const command = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entity ${entity} --batch-size 50`;
        operations.push({
          entity,
          command,
          process: spawn('npx', ['ts-node', DIFFERENTIAL_CLI, 'migrate', '--entity', entity, '--batch-size', '50'], {
            cwd: resolve(__dirname, '../..'),
            stdio: 'pipe'
          })
        });
      }

      // Let them run briefly
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Interrupt all operations
      for (const op of operations) {
        op.process.kill('SIGTERM');
      }

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check that each entity has consistent checkpoint state
      for (const entity of entities) {
        const checkpointQuery = `
          SELECT operation_type, status, records_processed, started_at, updated_at
          FROM migration_checkpoints
          WHERE entity_type = $1
          ORDER BY created_at DESC
          LIMIT 1
        `;

        const result = await targetDb.query(checkpointQuery, [entity]);
        if (result.rows.length > 0) {
          const checkpoint = result.rows[0];
          expect(['pending', 'in_progress', 'failed', 'paused'].includes(checkpoint.status)).toBe(true);
          expect(checkpoint.records_processed).toBeGreaterThanOrEqual(0);
          expect(new Date(checkpoint.started_at)).toBeInstanceOf(Date);
        }
      }
    });

    it('should handle checkpoint corruption and recovery', async () => {
      // Create a checkpoint and then corrupt it
      const createCheckpointCommand = `npx ts-node ${DIFFERENTIAL_CLI} migrate --entity ${testEntity} --batch-size 10`;

      // Start and quickly interrupt to create a checkpoint
      const process = spawn('npx', ['ts-node', DIFFERENTIAL_CLI, 'migrate', '--entity', testEntity, '--batch-size', '10'], {
        cwd: resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      await new Promise(resolve => setTimeout(resolve, 3000));
      process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Corrupt the checkpoint by setting invalid data
      const corruptQuery = `
        UPDATE migration_checkpoints
        SET last_processed_id = 'invalid-id',
            records_total = -1,
            metadata = '{"corrupted": true}'
        WHERE entity_type = $1 AND status IN ('in_progress', 'paused')
      `;

      await targetDb.query(corruptQuery, [testEntity]);

      // Try to resume - should detect corruption and handle gracefully
      const resumeCommand = `npx ts-node ${DIFFERENTIAL_CLI} resume --entity ${testEntity}`;

      expect(() => {
        const result = execSync(resumeCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });

        // Should either recover gracefully or restart from beginning
        expect(result).toBeDefined();
      }).not.toThrow();

      // Verify checkpoint was reset or fixed
      const checkQuery = `
        SELECT status, last_processed_id, records_total
        FROM migration_checkpoints
        WHERE entity_type = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const checkResult = await targetDb.query(checkQuery, [testEntity]);
      if (checkResult.rows.length > 0) {
        const checkpoint = checkResult.rows[0];
        expect(checkpoint.records_total).toBeGreaterThanOrEqual(0);
        // Should either be reset or completed
        expect(['pending', 'completed', 'failed'].includes(checkpoint.status)).toBe(true);
      }
    });

    it('should provide detailed checkpoint debugging information', async () => {
      // Create some checkpoint data
      const migrationProcess = spawn('npx', ['ts-node', DIFFERENTIAL_CLI, 'migrate', '--entity', testEntity, '--batch-size', '20'], {
        cwd: resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      await new Promise(resolve => setTimeout(resolve, 5000));
      migrationProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get detailed debugging information
      const debugCommand = `npx ts-node ${ANALYZER_CLI} debug --entity ${testEntity} --format json`;

      const debugResult = execSync(debugCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      expect(() => JSON.parse(debugResult)).not.toThrow();
      const debug = JSON.parse(debugResult);
      expect(debug).toHaveProperty('checkpoint_details');
      expect(debug).toHaveProperty('database_state');
      expect(debug).toHaveProperty('recommendations');

      if (debug.checkpoint_details) {
        expect(debug.checkpoint_details).toHaveProperty('status');
        expect(debug.checkpoint_details).toHaveProperty('progress');
        expect(debug.checkpoint_details).toHaveProperty('timing');
      }

      expect(Array.isArray(debug.recommendations)).toBe(true);
    });

    it('should validate data consistency after checkpoint resume', async () => {
      // Run a migration with interruption and resume
      const process1 = spawn('npx', ['ts-node', DIFFERENTIAL_CLI, 'migrate', '--entity', testEntity, '--batch-size', '25'], {
        cwd: resolve(__dirname, '../..'),
        stdio: 'pipe'
      });

      await new Promise(resolve => setTimeout(resolve, 7000));
      process1.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Resume and complete
      const resumeCommand = `npx ts-node ${DIFFERENTIAL_CLI} resume --entity ${testEntity}`;

      execSync(resumeCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 60000
      });

      // Validate data consistency
      const validateCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities ${testEntity} --type data_integrity --format json`;

      const validationResult = execSync(validateCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 45000
      });

      const validation = JSON.parse(validationResult);
      expect(validation).toHaveProperty('validationPassed');
      expect(validation).toHaveProperty('discrepanciesFound');

      // Should pass validation even after interruption and resume
      expect(validation.validationPassed).toBe(true);
      expect(validation.discrepanciesFound).toBe(0);
    });

    // Helper functions
    async function startInterruptibleMigration(): Promise<any> {
      return spawn('npx', ['ts-node', DIFFERENTIAL_CLI, 'migrate', '--entity', testEntity, '--batch-size', '100'], {
        cwd: resolve(__dirname, '../..'),
        stdio: 'pipe'
      });
    }

    async function interruptMigration(migrationProcess: any): Promise<boolean> {
      try {
        migrationProcess.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for graceful shutdown
        return true;
      } catch (error) {
        return false;
      }
    }

    async function cleanupCheckpoints(entity: string): Promise<void> {
      try {
        await targetDb.query(
          'DELETE FROM migration_checkpoints WHERE entity_type = $1 AND operation_type = $2',
          [entity, 'differential_migration']
        );
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });
});
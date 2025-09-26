// Contract test for Sync Scheduler Create Job CLI
// Tests the command-line interface contracts for sync job creation
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';

const CLI_PATH = resolve(__dirname, '../../src/sync-scheduler.ts');

describe('Sync Scheduler Create Job CLI Contract Tests', () => {
  beforeAll(() => {
    // Ensure we have a clean test environment
    process.env.NODE_ENV = 'test';
  });

  describe('create-job command', () => {
    it('should accept required parameters for job creation', async () => {
      const command = `npx ts-node ${CLI_PATH} create-job --name "test-sync" --schedule "daily" --entities "offices,doctors"`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should validate job name uniqueness', async () => {
      // First create a job
      const createCommand = `npx ts-node ${CLI_PATH} create-job --name "duplicate-test" --schedule "hourly" --entities "offices"`;

      execSync(createCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      // Try to create another job with the same name
      expect(() => {
        execSync(createCommand, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).toThrow();
    });

    it('should accept valid schedule formats', async () => {
      const validSchedules = ['hourly', 'daily', 'weekly', '2h', '30m', '1d'];

      for (const schedule of validSchedules) {
        const command = `npx ts-node ${CLI_PATH} create-job --name "test-${schedule}" --schedule "${schedule}" --entities "offices"`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 10000
          });
        }).not.toThrow();
      }
    });

    it('should reject invalid schedule formats', async () => {
      const invalidSchedules = ['invalid', '25h', '61m', ''];

      for (const schedule of invalidSchedules) {
        const command = `npx ts-node ${CLI_PATH} create-job --name "test-invalid-${Math.random()}" --schedule "${schedule}" --entities "offices"`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        }).toThrow();
      }
    });

    it('should accept valid entity lists', async () => {
      const validEntities = [
        'offices',
        'offices,doctors',
        'offices,doctors,patients',
        'offices,profiles,doctors,patients,orders'
      ];

      for (let i = 0; i < validEntities.length; i++) {
        const entities = validEntities[i];
        const command = `npx ts-node ${CLI_PATH} create-job --name "test-entities-${i}" --schedule "daily" --entities "${entities}"`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 10000
          });
        }).not.toThrow();
      }
    });

    it('should accept optional conflict resolution parameter', async () => {
      const conflictStrategies = ['source_wins', 'target_wins', 'manual'];

      for (let i = 0; i < conflictStrategies.length; i++) {
        const strategy = conflictStrategies[i];
        const command = `npx ts-node ${CLI_PATH} create-job --name "test-conflict-${i}" --schedule "daily" --entities "offices" --conflict-resolution "${strategy}"`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 10000
          });
        }).not.toThrow();
      }
    });

    it('should accept optional max-records parameter', async () => {
      const command = `npx ts-node ${CLI_PATH} create-job --name "test-max-records" --schedule "daily" --entities "offices" --max-records 25000`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should validate max-records is within acceptable range', async () => {
      const invalidMaxRecords = [0, 500, 150000]; // Below min (1000) or above max (100000)

      for (const maxRecords of invalidMaxRecords) {
        const command = `npx ts-node ${CLI_PATH} create-job --name "test-invalid-max-${Math.random()}" --schedule "daily" --entities "offices" --max-records ${maxRecords}`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        }).toThrow();
      }
    });

    it('should return structured job creation response', async () => {
      const command = `npx ts-node ${CLI_PATH} create-job --name "test-response" --schedule "daily" --entities "offices" --format json`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      expect(() => JSON.parse(result)).not.toThrow();
      const output = JSON.parse(result);
      expect(output).toHaveProperty('jobId');
      expect(output).toHaveProperty('jobName', 'test-response');
      expect(output).toHaveProperty('status');
      expect(output).toHaveProperty('nextRunAt');
      expect(output).toHaveProperty('createdAt');
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error messages for missing required parameters', async () => {
      const incompleteCommands = [
        `npx ts-node ${CLI_PATH} create-job`,
        `npx ts-node ${CLI_PATH} create-job --name "test"`,
        `npx ts-node ${CLI_PATH} create-job --name "test" --schedule "daily"`,
        `npx ts-node ${CLI_PATH} create-job --schedule "daily" --entities "offices"`
      ];

      for (const command of incompleteCommands) {
        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        }).toThrow();
      }
    });

    it('should handle database connection errors gracefully', async () => {
      // Temporarily set invalid database config
      const originalHost = process.env.TARGET_DB_HOST;
      process.env.TARGET_DB_HOST = 'invalid-host';

      const command = `npx ts-node ${CLI_PATH} create-job --name "test-db-error" --schedule "daily" --entities "offices"`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).toThrow();

      // Restore original config
      process.env.TARGET_DB_HOST = originalHost;
    });
  });

  describe('help command', () => {
    it('should display help information for create-job command', async () => {
      const command = `npx ts-node ${CLI_PATH} create-job --help`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 5000
      });

      expect(result).toContain('create-job');
      expect(result).toContain('--name');
      expect(result).toContain('--schedule');
      expect(result).toContain('--entities');
      expect(result).toContain('--conflict-resolution');
      expect(result).toContain('--max-records');
    });
  });
});
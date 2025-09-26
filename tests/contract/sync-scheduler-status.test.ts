// Contract test for Sync Scheduler Status CLI
// Tests the command-line interface contracts for sync job status operations
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';

const CLI_PATH = resolve(__dirname, '../../src/sync-scheduler.ts');

describe('Sync Scheduler Status CLI Contract Tests', () => {
  let testJobId: string;

  beforeAll(async () => {
    // Ensure we have a clean test environment
    process.env.NODE_ENV = 'test';

    // Create a test job to use for status checks
    try {
      const createCommand = `npx ts-node ${CLI_PATH} create-job --name "status-test-job" --schedule "daily" --entities "offices" --format json`;
      const result = execSync(createCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 15000
      });
      const jobData = JSON.parse(result);
      testJobId = jobData.jobId;
    } catch (error) {
      // If job creation fails, use a dummy ID for testing error handling
      testJobId = '550e8400-e29b-41d4-a716-446655440000';
    }
  });

  describe('list-jobs command', () => {
    it('should list all synchronization jobs', async () => {
      const command = `npx ts-node ${CLI_PATH} list-jobs`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should return structured job list in JSON format', async () => {
      const command = `npx ts-node ${CLI_PATH} list-jobs --format json`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      expect(() => JSON.parse(result)).not.toThrow();
      const output = JSON.parse(result);
      expect(Array.isArray(output)).toBe(true);

      if (output.length > 0) {
        const job = output[0];
        expect(job).toHaveProperty('jobId');
        expect(job).toHaveProperty('jobName');
        expect(job).toHaveProperty('status');
        expect(job).toHaveProperty('nextRunAt');
        expect(job).toHaveProperty('createdAt');
      }
    });

    it('should support filtering by status', async () => {
      const validStatuses = ['scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled'];

      for (const status of validStatuses) {
        const command = `npx ts-node ${CLI_PATH} list-jobs --status ${status}`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 10000
          });
        }).not.toThrow();
      }
    });
  });

  describe('job-status command', () => {
    it('should accept job ID parameter', async () => {
      const command = `npx ts-node ${CLI_PATH} job-status --job-id ${testJobId}`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should accept job name parameter', async () => {
      const command = `npx ts-node ${CLI_PATH} job-status --name "status-test-job"`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should return detailed job status in JSON format', async () => {
      const command = `npx ts-node ${CLI_PATH} job-status --job-id ${testJobId} --format json`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      expect(() => JSON.parse(result)).not.toThrow();
      const output = JSON.parse(result);
      expect(output).toHaveProperty('jobId');
      expect(output).toHaveProperty('jobName');
      expect(output).toHaveProperty('status');
      expect(output).toHaveProperty('lastRunAt');
      expect(output).toHaveProperty('nextRunAt');
      expect(output).toHaveProperty('totalRecordsSynced');
      expect(output).toHaveProperty('successRate');
      expect(output).toHaveProperty('averageDuration');
      expect(output).toHaveProperty('recentRuns');
      expect(Array.isArray(output.recentRuns)).toBe(true);
    });

    it('should handle non-existent job ID gracefully', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const command = `npx ts-node ${CLI_PATH} job-status --job-id ${nonExistentId}`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).toThrow();
    });
  });

  describe('run-job command', () => {
    it('should accept job ID for manual execution', async () => {
      const command = `npx ts-node ${CLI_PATH} run-job --job-id ${testJobId} --manual`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).not.toThrow();
    });

    it('should accept job name for manual execution', async () => {
      const command = `npx ts-node ${CLI_PATH} run-job --name "status-test-job" --manual`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).not.toThrow();
    });

    it('should return run execution results', async () => {
      const command = `npx ts-node ${CLI_PATH} run-job --job-id ${testJobId} --manual --format json`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 20000
      });

      expect(() => JSON.parse(result)).not.toThrow();
      const output = JSON.parse(result);
      expect(output).toHaveProperty('runId');
      expect(output).toHaveProperty('startedAt');
      expect(output).toHaveProperty('recordsSynced');
      expect(output).toHaveProperty('status');
    });
  });

  describe('cancel-job command', () => {
    it('should accept job ID for cancellation', async () => {
      const command = `npx ts-node ${CLI_PATH} cancel-job --job-id ${testJobId}`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should accept job name for cancellation', async () => {
      const command = `npx ts-node ${CLI_PATH} cancel-job --name "status-test-job"`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error messages for missing required parameters', async () => {
      const incompleteCommands = [
        `npx ts-node ${CLI_PATH} job-status`,
        `npx ts-node ${CLI_PATH} run-job`,
        `npx ts-node ${CLI_PATH} cancel-job`
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

    it('should validate job ID format', async () => {
      const invalidJobIds = ['invalid-uuid', '123', '', 'not-a-uuid'];

      for (const jobId of invalidJobIds) {
        const command = `npx ts-node ${CLI_PATH} job-status --job-id "${jobId}"`;

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

      const command = `npx ts-node ${CLI_PATH} list-jobs`;

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
    it('should display help information for all sync scheduler commands', async () => {
      const command = `npx ts-node ${CLI_PATH} --help`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 5000
      });

      expect(result).toContain('list-jobs');
      expect(result).toContain('job-status');
      expect(result).toContain('run-job');
      expect(result).toContain('cancel-job');
      expect(result).toContain('--job-id');
      expect(result).toContain('--name');
      expect(result).toContain('--manual');
    });
  });
});
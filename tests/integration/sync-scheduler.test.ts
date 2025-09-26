// Integration test for Scenario 2: Sync Scheduler Setup
// Tests the complete sync scheduler workflow end-to-end
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

const SYNC_CLI = resolve(__dirname, '../../src/sync-scheduler.ts');

describe('Integration Test: Sync Scheduler Setup Scenario', () => {
  let targetDb: Pool;
  const testJobName = `test-sync-${Date.now()}`;

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
    // Cleanup: Remove test job if it exists
    try {
      const cancelCommand = `npx ts-node ${SYNC_CLI} cancel-job --name "${testJobName}"`;
      execSync(cancelCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });
    } catch (error) {
      // Ignore errors during cleanup
    }

    await targetDb.end();
  });

  describe('Scenario 2: Sync Scheduler Setup (Ongoing Synchronization)', () => {
    let jobId: string;

    it('should complete the full sync scheduler setup workflow', async () => {
      // Step 1: Create scheduled sync job
      const createJobCommand = `npx ts-node ${SYNC_CLI} create-job --name "${testJobName}" --schedule "daily" --entities "offices,doctors,patients,orders" --conflict-resolution "source_wins" --max-records 50000 --format json`;

      const createResult = execSync(createJobCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 15000
      });

      // Validate job creation response
      expect(() => JSON.parse(createResult)).not.toThrow();
      const createdJob = JSON.parse(createResult);
      expect(createdJob).toHaveProperty('jobId');
      expect(createdJob).toHaveProperty('jobName', testJobName);
      expect(createdJob).toHaveProperty('status');
      expect(createdJob).toHaveProperty('nextRunAt');
      expect(createdJob).toHaveProperty('createdAt');
      expect(createdJob.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      jobId = createdJob.jobId;

      // Step 2: Verify job creation by listing jobs
      const listJobsCommand = `npx ts-node ${SYNC_CLI} list-jobs --format json`;

      const listResult = execSync(listJobsCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      // Validate job appears in list
      expect(() => JSON.parse(listResult)).not.toThrow();
      const jobList = JSON.parse(listResult);
      expect(Array.isArray(jobList)).toBe(true);

      const ourJob = jobList.find((job: any) => job.jobId === jobId);
      expect(ourJob).toBeDefined();
      expect(ourJob.jobName).toBe(testJobName);
      expect(ourJob.status).toBe('scheduled');

      // Step 3: Run manual sync to test
      const runJobCommand = `npx ts-node ${SYNC_CLI} run-job --name "${testJobName}" --manual --format json`;

      const runResult = execSync(runJobCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 60000 // Allow time for sync to complete
      });

      // Validate manual run results
      expect(() => JSON.parse(runResult)).not.toThrow();
      const runData = JSON.parse(runResult);
      expect(runData).toHaveProperty('runId');
      expect(runData).toHaveProperty('startedAt');
      expect(runData).toHaveProperty('recordsSynced');
      expect(runData).toHaveProperty('status');
      expect(runData.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(typeof runData.recordsSynced).toBe('number');

      // Step 4: Check sync job history and status
      const jobStatusCommand = `npx ts-node ${SYNC_CLI} job-status --name "${testJobName}" --format json`;

      const statusResult = execSync(jobStatusCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      // Validate job status response
      expect(() => JSON.parse(statusResult)).not.toThrow();
      const jobStatus = JSON.parse(statusResult);
      expect(jobStatus).toHaveProperty('jobId', jobId);
      expect(jobStatus).toHaveProperty('jobName', testJobName);
      expect(jobStatus).toHaveProperty('status');
      expect(jobStatus).toHaveProperty('lastRunAt');
      expect(jobStatus).toHaveProperty('nextRunAt');
      expect(jobStatus).toHaveProperty('totalRecordsSynced');
      expect(jobStatus).toHaveProperty('successRate');
      expect(jobStatus).toHaveProperty('averageDuration');
      expect(jobStatus).toHaveProperty('recentRuns');
      expect(Array.isArray(jobStatus.recentRuns)).toBe(true);

      // Verify the manual run appears in recent runs
      expect(jobStatus.recentRuns.length).toBeGreaterThan(0);
      const latestRun = jobStatus.recentRuns[0];
      expect(latestRun).toHaveProperty('runId');
      expect(latestRun).toHaveProperty('status');
      expect(['completed', 'failed', 'running'].includes(latestRun.status)).toBe(true);
    }, 180000); // 3 minute timeout

    it('should handle different schedule configurations correctly', async () => {
      const scheduleTests = [
        { schedule: 'hourly', expectedInterval: 'PT1H' },
        { schedule: '2h', expectedInterval: 'PT2H' },
        { schedule: '30m', expectedInterval: 'PT30M' },
        { schedule: 'weekly', expectedInterval: 'P1W' }
      ];

      for (let i = 0; i < scheduleTests.length; i++) {
        const { schedule } = scheduleTests[i];
        const jobName = `test-schedule-${schedule}-${i}`;

        const createCommand = `npx ts-node ${SYNC_CLI} create-job --name "${jobName}" --schedule "${schedule}" --entities "offices" --format json`;

        const result = execSync(createCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });

        expect(() => JSON.parse(result)).not.toThrow();
        const job = JSON.parse(result);
        expect(job).toHaveProperty('jobId');
        expect(job).toHaveProperty('nextRunAt');
        expect(new Date(job.nextRunAt)).toBeInstanceOf(Date);

        // Cleanup
        try {
          execSync(`npx ts-node ${SYNC_CLI} cancel-job --name "${jobName}"`, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    it('should validate entity synchronization and conflict resolution', async () => {
      // Create a job with specific conflict resolution strategy
      const conflictJobName = `test-conflict-${Date.now()}`;
      const createCommand = `npx ts-node ${SYNC_CLI} create-job --name "${conflictJobName}" --schedule "daily" --entities "offices,doctors" --conflict-resolution "source_wins" --format json`;

      const createResult = execSync(createCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      const job = JSON.parse(createResult);
      const conflictJobId = job.jobId;

      // Run the sync job
      const runCommand = `npx ts-node ${SYNC_CLI} run-job --job-id "${conflictJobId}" --manual --format json`;

      const runResult = execSync(runCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 45000
      });

      const runData = JSON.parse(runResult);
      expect(runData).toHaveProperty('recordsSynced');
      expect(runData.recordsSynced).toBeGreaterThanOrEqual(0);

      // Verify job configuration in database
      const jobConfigQuery = `
        SELECT job_name, conflict_resolution, entities_to_sync, status
        FROM synchronization_jobs
        WHERE id = $1
      `;

      const dbResult = await targetDb.query(jobConfigQuery, [conflictJobId]);
      expect(dbResult.rows.length).toBe(1);

      const dbJob = dbResult.rows[0];
      expect(dbJob.job_name).toBe(conflictJobName);
      expect(dbJob.conflict_resolution).toBe('source_wins');
      expect(dbJob.entities_to_sync).toEqual(['offices', 'doctors']);

      // Cleanup
      try {
        execSync(`npx ts-node ${SYNC_CLI} cancel-job --job-id "${conflictJobId}"`, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 5000
        });
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    it('should handle job lifecycle operations correctly', async () => {
      // Create a job for lifecycle testing
      const lifecycleJobName = `test-lifecycle-${Date.now()}`;
      const createCommand = `npx ts-node ${SYNC_CLI} create-job --name "${lifecycleJobName}" --schedule "hourly" --entities "offices" --format json`;

      const createResult = execSync(createCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      const job = JSON.parse(createResult);
      const lifecycleJobId = job.jobId;

      // Verify job is scheduled
      let statusCommand = `npx ts-node ${SYNC_CLI} job-status --job-id "${lifecycleJobId}" --format json`;
      let statusResult = execSync(statusCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      let status = JSON.parse(statusResult);
      expect(status.status).toBe('scheduled');

      // Cancel the job
      const cancelCommand = `npx ts-node ${SYNC_CLI} cancel-job --job-id "${lifecycleJobId}"`;

      execSync(cancelCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      // Verify job is cancelled
      statusResult = execSync(statusCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      status = JSON.parse(statusResult);
      expect(status.status).toBe('cancelled');
    });

    it('should persist job data and sync history correctly', async () => {
      // Verify job exists in database
      const jobQuery = `
        SELECT id, job_name, job_type, status, entities_to_sync,
               conflict_resolution, max_records_per_batch, created_at
        FROM synchronization_jobs
        WHERE id = $1
      `;

      const jobResult = await targetDb.query(jobQuery, [jobId]);
      expect(jobResult.rows.length).toBe(1);

      const dbJob = jobResult.rows[0];
      expect(dbJob.job_name).toBe(testJobName);
      expect(dbJob.job_type).toBe('scheduled_sync');
      expect(dbJob.entities_to_sync).toEqual(['offices', 'doctors', 'patients', 'orders']);
      expect(dbJob.conflict_resolution).toBe('source_wins');
      expect(dbJob.max_records_per_batch).toBe(50000);

      // Verify sync run history exists
      const historyQuery = `
        SELECT id, job_id, run_type, status, records_synced, created_at
        FROM sync_run_history
        WHERE job_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      `;

      const historyResult = await targetDb.query(historyQuery, [jobId]);
      expect(historyResult.rows.length).toBeGreaterThan(0);

      const latestRun = historyResult.rows[0];
      expect(latestRun.job_id).toBe(jobId);
      expect(latestRun.run_type).toBe('manual');
      expect(['completed', 'failed', 'running'].includes(latestRun.status)).toBe(true);
      expect(typeof latestRun.records_synced).toBe('number');
    });
  });
});
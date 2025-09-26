#!/usr/bin/env node

// Sync Scheduler CLI
// Command line interface for scheduled synchronization job management

import { Command } from 'commander';
import { Pool } from 'pg';
import { SyncSchedulerService } from '../services/sync-scheduler-service';
import {
  SyncJobConfig,
  ConflictResolution,
  JobStatus,
  MigrationError
} from '../types/migration-types';

// Database configuration
const sourceDbConfig = {
  host: process.env.SOURCE_DB_HOST || 'localhost',
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME || 'dispatch_dev',
  user: process.env.SOURCE_DB_USER || 'postgres',
  password: process.env.SOURCE_DB_PASSWORD || ''
};

const targetDbConfig = {
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '54322'),
  database: process.env.TARGET_DB_NAME || 'postgres',
  user: process.env.TARGET_DB_USER || 'supabase_admin',
  password: process.env.TARGET_DB_PASSWORD || 'postgres'
};

// Available entity types
const VALID_ENTITIES = [
  'offices', 'profiles', 'doctors', 'patients', 'orders',
  'products', 'jaws', 'projects', 'treatment-plans'
];

// Valid schedule formats
const VALID_SCHEDULES = ['hourly', 'daily', 'weekly'];

/**
 * Initialize database connections
 */
function initializeConnections(): { sourceDb: Pool; targetDb: Pool } {
  const sourceDb = new Pool(sourceDbConfig);
  const targetDb = new Pool(targetDbConfig);

  return { sourceDb, targetDb };
}

/**
 * Validate entity types
 */
function validateEntities(entities: string[]): void {
  const invalidEntities = entities.filter(entity => !VALID_ENTITIES.includes(entity));
  if (invalidEntities.length > 0) {
    console.error(`❌ Invalid entity types: ${invalidEntities.join(', ')}`);
    console.error(`Valid entities: ${VALID_ENTITIES.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Validate schedule format
 */
function validateSchedule(schedule: string): void {
  const isValid = VALID_SCHEDULES.includes(schedule.toLowerCase()) ||
                  /^\d+[hmwd]$/.test(schedule);

  if (!isValid) {
    console.error(`❌ Invalid schedule format: ${schedule}`);
    console.error(`Valid formats: hourly, daily, weekly, or custom like "2h", "30m", "1d", "1w"`);
    process.exit(1);
  }
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format date for display
 */
function formatDate(date: Date | string | undefined): string {
  if (!date) return 'Never';
  return new Date(date).toLocaleString();
}

/**
 * Get status emoji
 */
function getStatusEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    'scheduled': '📅',
    'running': '🔄',
    'completed': '✅',
    'failed': '❌',
    'paused': '⏸️',
    'cancelled': '❌'
  };
  return emojiMap[status] || '❓';
}

/**
 * Display job details
 */
function displayJob(job: any, showDetails: boolean = false): void {
  const statusEmoji = getStatusEmoji(job.status);
  console.log(`${statusEmoji} ${job.job_name || job.jobName} (${job.id || job.jobId})`);
  console.log(`   Status: ${job.status}`);
  console.log(`   Entities: ${Array.isArray(job.entities_to_sync) ? job.entities_to_sync.join(', ') : job.entities?.join(', ') || 'N/A'}`);

  if (job.last_run_at || job.lastRunAt) {
    console.log(`   Last Run: ${formatDate(job.last_run_at || job.lastRunAt)}`);
  }

  if (job.next_run_at || job.nextRunAt) {
    console.log(`   Next Run: ${formatDate(job.next_run_at || job.nextRunAt)}`);
  }

  if (showDetails) {
    if (job.total_records_synced || job.totalRecordsSynced) {
      console.log(`   Records Synced: ${(job.total_records_synced || job.totalRecordsSynced).toLocaleString()}`);
    }

    if (job.success_rate || job.successRate) {
      console.log(`   Success Rate: ${(job.success_rate || job.successRate).toFixed(1)}%`);
    }

    if (job.average_duration_ms || job.averageDuration) {
      const avgDuration = job.average_duration_ms || job.averageDuration;
      console.log(`   Avg Duration: ${formatDuration(avgDuration)}`);
    }

    if (job.created_at || job.createdAt) {
      console.log(`   Created: ${formatDate(job.created_at || job.createdAt)}`);
    }

    if (job.recentRuns && job.recentRuns.length > 0) {
      console.log(`   Recent Runs (${job.recentRuns.length}):`);
      job.recentRuns.slice(0, 3).forEach((run: any) => {
        const runEmoji = getStatusEmoji(run.status);
        console.log(`     ${runEmoji} ${formatDate(run.startedAt)} - ${run.recordsSynced.toLocaleString()} records`);
      });
    }
  }

  console.log();
}

/**
 * Display scheduler statistics
 */
function displayStats(stats: any): void {
  console.log(`📊 Scheduler Statistics:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 Total Jobs: ${stats.totalJobs}`);
  console.log(`📅 Scheduled: ${stats.scheduledJobs}`);
  console.log(`🔄 Running: ${stats.runningJobs}`);
  console.log(`⏸️  Active: ${stats.activeJobs}`);
  console.log(`✅ Completed: ${stats.completedJobs}`);
  console.log(`❌ Failed: ${stats.failedJobs}`);

  if (stats.lastRunTime) {
    console.log(`🕐 Last Run: ${formatDate(stats.lastRunTime)}`);
  }

  console.log(`⏱️  Uptime: ${formatDuration(stats.uptime)}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Handle CLI errors
 */
function handleError(error: Error): never {
  console.error(`\n❌ Error: ${error.message}`);

  if (error instanceof MigrationError) {
    if (error.entityType) {
      console.error(`   Entity: ${error.entityType}`);
    }
  }

  process.exit(1);
}

/**
 * Create scheduler service instance
 */
function createSchedulerService(): SyncSchedulerService {
  const { sourceDb, targetDb } = initializeConnections();
  return new SyncSchedulerService(sourceDb, targetDb);
}

// Create CLI program
const program = new Command();

program
  .name('sync-scheduler')
  .description('CLI for scheduled synchronization job management')
  .version('1.0.0');

// Create job command
program
  .command('create-job')
  .description('Create a new scheduled synchronization job')
  .requiredOption('-n, --name <name>', 'Job name')
  .requiredOption('-s, --schedule <schedule>', 'Schedule frequency (hourly/daily/weekly or custom like "2h", "30m")')
  .requiredOption('-e, --entities <entities...>', 'Entity types to synchronize')
  .option('-c, --conflict-resolution <strategy>', 'Conflict resolution strategy', 'source_wins')
  .option('-m, --max-records <number>', 'Maximum records per sync', '50000')
  .option('-d, --description <description>', 'Job description')
  .action(async (options) => {
    try {
      // Validate inputs
      validateEntities(options.entities);
      validateSchedule(options.schedule);

      const maxRecords = parseInt(options.maxRecords);
      if (isNaN(maxRecords) || maxRecords < 1000 || maxRecords > 100000) {
        console.error('❌ Max records must be between 1,000 and 100,000');
        process.exit(1);
      }

      const validStrategies: ConflictResolution[] = ['source_wins', 'target_wins', 'manual'];
      if (!validStrategies.includes(options.conflictResolution as ConflictResolution)) {
        console.error(`❌ Invalid conflict resolution strategy. Valid options: ${validStrategies.join(', ')}`);
        process.exit(1);
      }

      console.log(`🏗️  Creating synchronization job: ${options.name}`);
      console.log(`📅 Schedule: ${options.schedule}`);
      console.log(`📋 Entities: ${options.entities.join(', ')}`);
      console.log(`⚔️  Conflict Resolution: ${options.conflictResolution}`);
      console.log(`📊 Max Records: ${maxRecords.toLocaleString()}`);
      console.log();

      const schedulerService = createSchedulerService();

      const jobConfig: SyncJobConfig = {
        jobName: options.name,
        schedule: options.schedule,
        entities: options.entities,
        conflictResolution: options.conflictResolution as ConflictResolution,
        maxRecords: maxRecords,
        description: options.description
      };

      const result = await schedulerService.createJob(jobConfig);

      console.log(`✅ Job created successfully!`);
      console.log(`📋 Job ID: ${result.jobId}`);
      console.log(`📅 Status: ${result.status}`);
      console.log(`🕐 Created: ${formatDate(result.createdAt)}`);

      if (result.nextRunAt) {
        console.log(`⏰ Next Run: ${formatDate(result.nextRunAt)}`);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// List jobs command
program
  .command('list-jobs')
  .description('List all synchronization jobs')
  .option('-s, --status <status>', 'Filter by job status')
  .option('-l, --limit <number>', 'Maximum number of jobs to display', '50')
  .option('-d, --details', 'Show detailed information', false)
  .action(async (options) => {
    try {
      const limit = parseInt(options.limit);
      if (isNaN(limit) || limit < 1) {
        console.error('❌ Limit must be a positive number');
        process.exit(1);
      }

      if (options.status) {
        const validStatuses = ['scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled'];
        if (!validStatuses.includes(options.status)) {
          console.error(`❌ Invalid status. Valid options: ${validStatuses.join(', ')}`);
          process.exit(1);
        }
      }

      console.log('📋 Retrieving synchronization jobs...\n');

      const schedulerService = createSchedulerService();
      const jobs = await schedulerService.listJobs(
        options.status as JobStatus | undefined,
        limit
      );

      if (jobs.length === 0) {
        console.log('📭 No synchronization jobs found.');
        return;
      }

      console.log(`📊 Found ${jobs.length} job${jobs.length === 1 ? '' : 's'}:\n`);

      jobs.forEach(job => {
        displayJob(job, options.details);
      });

    } catch (error) {
      handleError(error as Error);
    }
  });

// Run job command
program
  .command('run-job')
  .description('Run a synchronization job immediately')
  .requiredOption('-j, --job-id <jobId>', 'Job ID to run')
  .option('-w, --wait', 'Wait for job completion', false)
  .action(async (options) => {
    try {
      console.log(`🚀 Starting immediate execution of job: ${options.jobId}`);
      console.log();

      const schedulerService = createSchedulerService();
      const runHistory = await schedulerService.runJobNow(options.jobId);

      console.log(`✅ Job execution started!`);
      console.log(`📋 Run ID: ${runHistory.id}`);
      console.log(`🕐 Started: ${formatDate(runHistory.started_at)}`);
      console.log(`📊 Status: ${runHistory.status}`);

      if (options.wait) {
        console.log('\n⏳ Waiting for job completion...');

        // Poll for completion (simplified implementation)
        let completed = false;
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max wait time

        while (!completed && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

          try {
            const status = await schedulerService.getJobStatus(options.jobId);

            if (status.recentRuns && status.recentRuns.length > 0) {
              const latestRun = status.recentRuns[0];

              if (latestRun.runId === runHistory.id) {
                if (latestRun.completedAt) {
                  completed = true;
                  console.log(`\n✅ Job completed!`);
                  console.log(`📊 Records Synced: ${latestRun.recordsSynced.toLocaleString()}`);
                  console.log(`📋 Status: ${latestRun.status}`);
                  console.log(`🕐 Completed: ${formatDate(latestRun.completedAt)}`);

                  const duration = new Date(latestRun.completedAt).getTime() - new Date(latestRun.startedAt).getTime();
                  console.log(`⏱️  Duration: ${formatDuration(duration)}`);
                }
              }
            }
          } catch (error) {
            // Continue waiting on status check errors
          }

          attempts++;
        }

        if (!completed) {
          console.log('\n⏰ Job is still running. Use "sync-scheduler job-status" to check progress.');
        }
      } else {
        console.log('\n💡 Use "sync-scheduler job-status --job-id ' + options.jobId + '" to check progress.');
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Job status command
program
  .command('job-status')
  .description('Get status of a synchronization job')
  .requiredOption('-j, --job-id <jobId>', 'Job ID to check')
  .option('-r, --runs <number>', 'Number of recent runs to show', '5')
  .action(async (options) => {
    try {
      const runsToShow = parseInt(options.runs);
      if (isNaN(runsToShow) || runsToShow < 1) {
        console.error('❌ Runs must be a positive number');
        process.exit(1);
      }

      console.log(`📊 Retrieving status for job: ${options.jobId}\n`);

      const schedulerService = createSchedulerService();
      const status = await schedulerService.getJobStatus(options.jobId);

      displayJob(status, true);

      if (status.is_currently_running) {
        console.log(`🔄 Job is currently running!`);
      }

      console.log(`🖥️  Scheduler Status: ${status.scheduler_status}`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Pause job command
program
  .command('pause-job')
  .description('Pause a scheduled synchronization job')
  .requiredOption('-j, --job-id <jobId>', 'Job ID to pause')
  .action(async (options) => {
    try {
      console.log(`⏸️  Pausing job: ${options.jobId}`);

      const schedulerService = createSchedulerService();
      const job = await schedulerService.pauseJob(options.jobId);

      console.log(`✅ Job paused successfully!`);
      console.log(`📋 Status: ${job.status}`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Resume job command
program
  .command('resume-job')
  .description('Resume a paused synchronization job')
  .requiredOption('-j, --job-id <jobId>', 'Job ID to resume')
  .action(async (options) => {
    try {
      console.log(`▶️  Resuming job: ${options.jobId}`);

      const schedulerService = createSchedulerService();
      const job = await schedulerService.resumeJob(options.jobId);

      console.log(`✅ Job resumed successfully!`);
      console.log(`📋 Status: ${job.status}`);

      if (job.next_run_at) {
        console.log(`⏰ Next Run: ${formatDate(job.next_run_at)}`);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Cancel job command
program
  .command('cancel-job')
  .description('Cancel a synchronization job')
  .requiredOption('-j, --job-id <jobId>', 'Job ID to cancel')
  .option('-f, --force', 'Force cancellation without confirmation', false)
  .action(async (options) => {
    try {
      if (!options.force) {
        console.log(`⚠️  Are you sure you want to cancel job ${options.jobId}?`);
        console.log('This action cannot be undone. Use --force to skip this confirmation.');
        process.exit(1);
      }

      console.log(`❌ Cancelling job: ${options.jobId}`);

      const schedulerService = createSchedulerService();
      const success = await schedulerService.cancelJob(options.jobId);

      if (success) {
        console.log(`✅ Job cancelled successfully!`);
      } else {
        console.log(`⚠️  Job cancellation may have failed. Check job status.`);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Scheduler stats command
program
  .command('stats')
  .description('Show scheduler statistics')
  .action(async (options) => {
    try {
      console.log('📈 Retrieving scheduler statistics...\n');

      const schedulerService = createSchedulerService();
      const stats = await schedulerService.getSchedulerStats();

      displayStats(stats);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Start scheduler daemon command
program
  .command('start')
  .description('Start the sync scheduler daemon')
  .option('-i, --interval <ms>', 'Check interval in milliseconds', '60000')
  .option('-c, --concurrent <number>', 'Max concurrent jobs', '3')
  .action(async (options) => {
    try {
      const interval = parseInt(options.interval);
      const concurrent = parseInt(options.concurrent);

      if (isNaN(interval) || interval < 1000) {
        console.error('❌ Interval must be at least 1000ms (1 second)');
        process.exit(1);
      }

      if (isNaN(concurrent) || concurrent < 1 || concurrent > 10) {
        console.error('❌ Concurrent jobs must be between 1 and 10');
        process.exit(1);
      }

      console.log(`🚀 Starting sync scheduler daemon...`);
      console.log(`⏱️  Check Interval: ${interval}ms`);
      console.log(`🔄 Max Concurrent: ${concurrent}`);
      console.log();

      const { sourceDb, targetDb } = initializeConnections();
      const schedulerService = new SyncSchedulerService(sourceDb, targetDb, {
        checkInterval: interval,
        maxConcurrentJobs: concurrent
      });

      await schedulerService.start();

      console.log(`✅ Scheduler started successfully!`);
      console.log(`💡 Press Ctrl+C to stop the scheduler.`);

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Stopping scheduler...');
        await schedulerService.stop();
        console.log('✅ Scheduler stopped gracefully.');
        process.exit(0);
      });

      // Keep the process alive
      process.stdin.resume();

    } catch (error) {
      handleError(error as Error);
    }
  });

// Cleanup command
program
  .command('cleanup')
  .description('Clean up old jobs and run history')
  .option('-d, --days <number>', 'Remove data older than this many days', '30')
  .action(async (options) => {
    try {
      const days = parseInt(options.days);
      if (isNaN(days) || days < 1) {
        console.error('❌ Days must be a positive number');
        process.exit(1);
      }

      console.log(`🧹 Cleaning up data older than ${days} days...`);

      const schedulerService = createSchedulerService();
      const result = await schedulerService.cleanup(days);

      console.log(`✅ Cleanup completed!`);
      console.log(`📊 Jobs Deleted: ${result.jobs_deleted}`);
      console.log(`📊 Runs Deleted: ${result.runs_deleted}`);
      console.log(`🕐 Cleanup Date: ${formatDate(result.cleanup_date)}`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { program };
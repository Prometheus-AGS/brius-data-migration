// Sync Scheduler Service
// Manages scheduled synchronization jobs with status tracking and execution coordination

import { Pool } from 'pg';
import { SynchronizationJobModel } from '../models/synchronization-job';
import { SyncRunHistoryModel } from '../models/sync-run-history';
import { DifferentialMigrationService } from './differential-migration-service';
import { SyncLoggerService, OperationLogger } from './sync-logger';
import {
  SynchronizationJob,
  SyncJobConfig,
  SyncJobResponse,
  JobStatus,
  JobType,
  RunType,
  RunStatus,
  ConflictResolution,
  DifferentialMigrationOptions,
  SyncRunHistory,
  MigrationError
} from '../types/migration-types';

export interface SchedulerConfig {
  checkInterval?: number; // milliseconds
  maxConcurrentJobs?: number;
  jobTimeout?: number; // milliseconds
  retryAttempts?: number;
  retryDelay?: number; // milliseconds
}

export interface JobExecutionContext {
  job: SynchronizationJob;
  runId: string;
  logger: OperationLogger;
  startTime: Date;
  abortController: AbortController;
}

export interface SchedulerStats {
  totalJobs: number;
  activeJobs: number;
  scheduledJobs: number;
  completedJobs: number;
  failedJobs: number;
  runningJobs: number;
  lastRunTime?: Date;
  uptime: number;
}

export class SyncSchedulerService {
  private jobModel: SynchronizationJobModel;
  private runHistoryModel: SyncRunHistoryModel;
  private migrationService: DifferentialMigrationService;
  private logger: SyncLoggerService;
  private config: Required<SchedulerConfig>;

  private isRunning: boolean = false;
  private schedulerTimer?: NodeJS.Timeout;
  private runningJobs: Map<string, JobExecutionContext> = new Map();
  private startTime: Date = new Date();

  constructor(
    private sourceDb: Pool,
    private targetDb: Pool,
    config: SchedulerConfig = {},
    projectRoot: string = process.cwd()
  ) {
    this.jobModel = new SynchronizationJobModel(targetDb);
    this.runHistoryModel = new SyncRunHistoryModel(targetDb);
    this.migrationService = new DifferentialMigrationService(sourceDb, targetDb, projectRoot);
    this.logger = new SyncLoggerService({
      logDir: `${projectRoot}/logs`,
      enableConsole: true,
      structuredFormat: true
    });

    this.config = {
      checkInterval: config.checkInterval || 60000, // 1 minute
      maxConcurrentJobs: config.maxConcurrentJobs || 3,
      jobTimeout: config.jobTimeout || 30 * 60 * 1000, // 30 minutes
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000 // 5 seconds
    };
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scheduler is already running');
    }

    this.isRunning = true;
    this.startTime = new Date();

    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'scheduler',
      'scheduler_start'
    );

    operationLogger.info('Starting sync scheduler', {
      check_interval: this.config.checkInterval,
      max_concurrent_jobs: this.config.maxConcurrentJobs,
      job_timeout: this.config.jobTimeout
    });

    // Start the scheduler loop
    this.scheduleNextCheck();

    operationLogger.info('Sync scheduler started successfully');
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'scheduler',
      'scheduler_stop'
    );

    operationLogger.info('Stopping sync scheduler', {
      running_jobs: this.runningJobs.size
    });

    this.isRunning = false;

    // Clear the timer
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = undefined;
    }

    // Cancel running jobs
    const cancelPromises = Array.from(this.runningJobs.values()).map(context => {
      context.abortController.abort();
      return this.cancelJobExecution(context, 'Scheduler shutdown');
    });

    await Promise.allSettled(cancelPromises);

    operationLogger.info('Sync scheduler stopped');
  }

  /**
   * Create a new scheduled sync job
   */
  async createJob(config: SyncJobConfig): Promise<SyncJobResponse> {
    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'job_creation',
      `create_${config.jobName}`
    );

    try {
      operationLogger.info('Creating new sync job', {
        job_name: config.jobName,
        schedule: config.schedule,
        entities: config.entities,
        conflict_resolution: config.conflictResolution,
        max_records: config.maxRecords
      });

      // Validate schedule format
      if (!SynchronizationJobModel.validateSchedule(config.schedule)) {
        throw new Error(`Invalid schedule format: ${config.schedule}`);
      }

      // Create the job
      const response = await this.jobModel.createFromConfig(config);

      operationLogger.info('Sync job created successfully', {
        job_id: response.jobId,
        next_run_at: response.nextRunAt
      });

      return response;
    } catch (error) {
      operationLogger.error('Failed to create sync job', error as Error, {
        job_name: config.jobName
      });
      throw new MigrationError(`Job creation failed: ${error.message}`);
    }
  }

  /**
   * Run a job immediately (manual execution)
   */
  async runJobNow(jobId: string): Promise<SyncRunHistory> {
    const job = await this.jobModel.findById(jobId);
    if (!job) {
      throw new MigrationError(`Job not found: ${jobId}`, undefined, jobId);
    }

    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'manual_execution',
      `manual_${jobId}`
    );

    operationLogger.info('Starting manual job execution', {
      job_id: jobId,
      job_name: job.job_name,
      entities: job.entities_to_sync
    });

    try {
      // Check if already running
      if (this.runningJobs.has(jobId)) {
        throw new Error(`Job ${jobId} is already running`);
      }

      // Execute the job
      const runHistory = await this.executeJob(job, RunType.MANUAL);

      operationLogger.info('Manual job execution completed', {
        job_id: jobId,
        run_id: runHistory.id,
        records_synced: runHistory.records_synced,
        status: runHistory.status
      });

      return runHistory;
    } catch (error) {
      operationLogger.error('Manual job execution failed', error as Error, {
        job_id: jobId
      });
      throw error;
    }
  }

  /**
   * Get job status with recent run history
   */
  async getJobStatus(jobId: string): Promise<any> {
    try {
      const status = await this.jobModel.getJobStatus(jobId);
      const isRunning = this.runningJobs.has(jobId);

      return {
        ...status,
        is_currently_running: isRunning,
        scheduler_status: this.isRunning ? 'running' : 'stopped'
      };
    } catch (error) {
      throw new MigrationError(`Failed to get job status: ${error.message}`, undefined, jobId);
    }
  }

  /**
   * List all jobs with optional filtering
   */
  async listJobs(status?: JobStatus, limit?: number): Promise<SynchronizationJob[]> {
    try {
      return await this.jobModel.list({
        status,
        limit: limit || 50
      });
    } catch (error) {
      throw new MigrationError(`Failed to list jobs: ${error.message}`);
    }
  }

  /**
   * Pause a scheduled job
   */
  async pauseJob(jobId: string): Promise<SynchronizationJob> {
    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'job_management',
      `pause_${jobId}`
    );

    try {
      operationLogger.info('Pausing job', { job_id: jobId });

      const job = await this.jobModel.update(jobId, {
        status: JobStatus.PAUSED,
        next_run_at: null
      });

      operationLogger.info('Job paused successfully', { job_id: jobId });
      return job;
    } catch (error) {
      operationLogger.error('Failed to pause job', error as Error, { job_id: jobId });
      throw new MigrationError(`Job pause failed: ${error.message}`, undefined, jobId);
    }
  }

  /**
   * Resume a paused job
   */
  async resumeJob(jobId: string): Promise<SynchronizationJob> {
    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'job_management',
      `resume_${jobId}`
    );

    try {
      operationLogger.info('Resuming job', { job_id: jobId });

      // Calculate next run time
      const nextRunAt = await this.jobModel.calculateNextRunTime(jobId);

      const job = await this.jobModel.update(jobId, {
        status: JobStatus.SCHEDULED,
        next_run_at: nextRunAt
      });

      operationLogger.info('Job resumed successfully', {
        job_id: jobId,
        next_run_at: nextRunAt
      });

      return job;
    } catch (error) {
      operationLogger.error('Failed to resume job', error as Error, { job_id: jobId });
      throw new MigrationError(`Job resume failed: ${error.message}`, undefined, jobId);
    }
  }

  /**
   * Cancel a job (stops execution and removes from schedule)
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'job_management',
      `cancel_${jobId}`
    );

    try {
      operationLogger.info('Cancelling job', { job_id: jobId });

      // Cancel running execution if exists
      const runningContext = this.runningJobs.get(jobId);
      if (runningContext) {
        await this.cancelJobExecution(runningContext, 'Job cancelled by user');
      }

      // Update job status
      const success = await this.jobModel.cancel(jobId);

      operationLogger.info('Job cancelled successfully', {
        job_id: jobId,
        success
      });

      return success;
    } catch (error) {
      operationLogger.error('Failed to cancel job', error as Error, { job_id: jobId });
      throw new MigrationError(`Job cancellation failed: ${error.message}`, undefined, jobId);
    }
  }

  /**
   * Get scheduler statistics
   */
  async getSchedulerStats(): Promise<SchedulerStats> {
    try {
      const jobStats = await this.jobModel.getStatistics();

      const stats: SchedulerStats = {
        totalJobs: 0,
        activeJobs: 0,
        scheduledJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        runningJobs: this.runningJobs.size,
        uptime: Date.now() - this.startTime.getTime()
      };

      // Aggregate job statistics
      for (const stat of jobStats) {
        stats.totalJobs += parseInt(stat.job_count);

        switch (stat.status) {
          case JobStatus.SCHEDULED:
            stats.scheduledJobs += parseInt(stat.job_count);
            break;
          case JobStatus.RUNNING:
            stats.activeJobs += parseInt(stat.job_count);
            break;
          case JobStatus.COMPLETED:
            stats.completedJobs += parseInt(stat.job_count);
            break;
          case JobStatus.FAILED:
            stats.failedJobs += parseInt(stat.job_count);
            break;
        }
      }

      // Get last run time from recent history
      const recentRuns = await this.runHistoryModel.getRecentRuns(1);
      if (recentRuns.length > 0) {
        stats.lastRunTime = recentRuns[0].started_at;
      }

      return stats;
    } catch (error) {
      throw new MigrationError(`Failed to get scheduler stats: ${error.message}`);
    }
  }

  /**
   * Main scheduler loop - checks for due jobs and executes them
   */
  private async checkAndExecuteJobs(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Skip if at max concurrent jobs
      if (this.runningJobs.size >= this.config.maxConcurrentJobs) {
        return;
      }

      // Get jobs that are due for execution
      const dueJobs = await this.jobModel.getDueJobs();

      for (const job of dueJobs) {
        if (this.runningJobs.size >= this.config.maxConcurrentJobs) {
          break;
        }

        // Skip if already running
        if (this.runningJobs.has(job.id)) {
          continue;
        }

        // Execute the job
        this.executeJobAsync(job, RunType.SCHEDULED);
      }
    } catch (error) {
      this.logger.error('Error in scheduler check', error as Error, {
        running_jobs: this.runningJobs.size
      });
    } finally {
      // Schedule next check
      this.scheduleNextCheck();
    }
  }

  /**
   * Schedule the next scheduler check
   */
  private scheduleNextCheck(): void {
    if (this.isRunning) {
      this.schedulerTimer = setTimeout(() => {
        this.checkAndExecuteJobs();
      }, this.config.checkInterval);
    }
  }

  /**
   * Execute a job asynchronously
   */
  private async executeJobAsync(job: SynchronizationJob, runType: RunType): Promise<void> {
    try {
      await this.executeJob(job, runType);
    } catch (error) {
      this.logger.error('Async job execution failed', error as Error, {
        job_id: job.id,
        job_name: job.job_name
      });
    }
  }

  /**
   * Execute a specific job
   */
  private async executeJob(job: SynchronizationJob, runType: RunType): Promise<SyncRunHistory> {
    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      job.entities_to_sync.join(','),
      `exec_${job.id}`
    );

    // Create run history entry
    const runHistory = await this.runHistoryModel.startRun(
      job.id,
      runType,
      job.entities_to_sync
    );

    // Create execution context
    const context: JobExecutionContext = {
      job,
      runId: runHistory.id,
      logger: operationLogger,
      startTime: new Date(),
      abortController: new AbortController()
    };

    // Track running job
    this.runningJobs.set(job.id, context);

    try {
      // Update job status to running
      await this.jobModel.update(job.id, { status: JobStatus.RUNNING });

      operationLogger.info('Starting job execution', {
        job_id: job.id,
        job_name: job.job_name,
        run_id: runHistory.id,
        run_type: runType,
        entities: job.entities_to_sync,
        max_records: job.max_records_per_batch
      });

      // Prepare migration options
      const migrationOptions: DifferentialMigrationOptions = {
        entities: job.entities_to_sync,
        batchSize: job.max_records_per_batch,
        dryRun: false,
        conflictResolution: job.conflict_resolution,
        skipValidation: false
      };

      // Execute differential migration
      const migrationResult = await this.migrationService.executeDifferentialMigration(
        migrationOptions
      );

      // Calculate performance metrics
      const duration = Date.now() - context.startTime.getTime();
      const performanceMetrics = {
        duration_ms: duration,
        records_per_second: migrationResult.totalProcessed > 0
          ? Math.round(migrationResult.totalProcessed / (duration / 1000))
          : 0,
        batch_count: Math.ceil(migrationResult.totalProcessed / job.max_records_per_batch),
        success_rate: migrationResult.totalProcessed > 0
          ? (migrationResult.successful / migrationResult.totalProcessed) * 100
          : 100
      };

      // Complete the run
      const completedRun = await this.runHistoryModel.completeRun(
        runHistory.id,
        migrationResult.successful,
        migrationResult.failed,
        performanceMetrics,
        migrationResult.errors.length > 0 ? migrationResult.errors[0].errorMessage : undefined
      );

      // Update job statistics
      await this.jobModel.updateRunStatistics(
        job.id,
        duration,
        migrationResult.successful,
        migrationResult.failed === 0
      );

      // Calculate and set next run time
      await this.jobModel.calculateNextRunTime(job.id);

      operationLogger.complete(
        migrationResult.totalProcessed,
        migrationResult.successful,
        migrationResult.failed
      );

      return completedRun;

    } catch (error) {
      // Handle execution failure
      const duration = Date.now() - context.startTime.getTime();

      await this.runHistoryModel.completeRun(
        runHistory.id,
        0,
        1,
        { duration_ms: duration },
        error.message
      );

      await this.jobModel.update(job.id, { status: JobStatus.FAILED });

      operationLogger.fail(error as Error, 0);

      throw error;
    } finally {
      // Clean up running job tracking
      this.runningJobs.delete(job.id);
    }
  }

  /**
   * Cancel a running job execution
   */
  private async cancelJobExecution(context: JobExecutionContext, reason: string): Promise<void> {
    try {
      // Abort the operation
      context.abortController.abort();

      // Update run history
      await this.runHistoryModel.cancelRun(context.runId, reason);

      // Update job status
      await this.jobModel.update(context.job.id, { status: JobStatus.CANCELLED });

      context.logger.info('Job execution cancelled', {
        job_id: context.job.id,
        run_id: context.runId,
        reason
      });
    } catch (error) {
      context.logger.error('Failed to cancel job execution', error as Error, {
        job_id: context.job.id,
        run_id: context.runId
      });
    }
  }

  /**
   * Cleanup old completed jobs and run history
   */
  async cleanup(olderThanDays: number = 30): Promise<any> {
    const operationLogger = this.logger.startOperation(
      'sync_operation' as any,
      'cleanup',
      `cleanup_${Date.now()}`
    );

    try {
      operationLogger.info('Starting scheduler cleanup', {
        older_than_days: olderThanDays
      });

      const [jobsDeleted, runsDeleted] = await Promise.all([
        this.jobModel.cleanup(olderThanDays),
        this.runHistoryModel.cleanup(olderThanDays)
      ]);

      const result = {
        jobs_deleted: jobsDeleted,
        runs_deleted: runsDeleted,
        cleanup_date: new Date()
      };

      operationLogger.info('Scheduler cleanup completed', result);

      return result;
    } catch (error) {
      operationLogger.error('Scheduler cleanup failed', error as Error);
      throw new MigrationError(`Cleanup failed: ${error.message}`);
    }
  }
}
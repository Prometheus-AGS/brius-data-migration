// Sync Scheduler Orchestrator
// Main entry point for scheduled synchronization operations
// Coordinates job management, execution scheduling, and monitoring

import { Pool } from 'pg';
import { DatabaseConnectionManager } from './lib/database-connections';
import { CheckpointManager } from './lib/checkpoint-manager';
import { BatchProcessorService } from './lib/batch-processor';
import { SyncSchedulerService, SchedulerConfig, JobExecutionContext, SchedulerStats } from './services/sync-scheduler-service';
import { SyncLoggerService, OperationLogger } from './services/sync-logger';
import {
  SynchronizationJob,
  SyncJobConfig,
  SyncJobResponse,
  JobStatus,
  JobType,
  RunStatus,
  ConflictResolution,
  SyncRunHistory,
  MigrationError
} from './types/migration-types';

export interface SyncSchedulerOrchestratorConfig {
  checkInterval?: number; // milliseconds
  maxConcurrentJobs?: number;
  jobTimeout?: number; // milliseconds
  retryAttempts?: number;
  retryDelay?: number; // milliseconds
  enableHealthMonitoring?: boolean;
  enableJobPersistence?: boolean;
  backgroundScheduling?: boolean;
}

export interface SchedulerOrchestrationContext {
  orchestratorId: string;
  config: SyncSchedulerOrchestratorConfig;
  logger: OperationLogger;
  dbManager: DatabaseConnectionManager;
  checkpointManager: CheckpointManager;
  schedulerService: SyncSchedulerService;
  startTime: Date;
  isRunning: boolean;
  activeJobs: Map<string, JobExecutionContext>;
  stats: SchedulerStats;
}

export interface JobCreateRequest {
  jobName: string;
  jobType: JobType;
  entities: string[];
  scheduleConfig: any; // Cron-like or simple schedule
  conflictResolution: ConflictResolution;
  maxRecordsPerBatch?: number;
  enabled?: boolean;
  metadata?: Record<string, any>;
}

export interface JobExecutionResult {
  jobId: string;
  runId: string;
  success: boolean;
  runStatus: RunStatus;
  executionTimeMs: number;
  recordsProcessed: number;
  errors: MigrationError[];
  nextRunAt?: Date;
}

export interface SchedulerOrchestrationResult {
  orchestratorId: string;
  totalJobsExecuted: number;
  successfulJobs: number;
  failedJobs: number;
  totalExecutionTime: number;
  errors: MigrationError[];
  stats: SchedulerStats;
}

export class SyncSchedulerOrchestrator {
  private dbManager: DatabaseConnectionManager;
  private checkpointManager: CheckpointManager;
  private logger: SyncLoggerService;
  private schedulerService: SyncSchedulerService;
  private context?: SchedulerOrchestrationContext;
  private backgroundTimer?: NodeJS.Timer;

  constructor(projectRoot: string = process.cwd()) {
    this.dbManager = new DatabaseConnectionManager();
    this.checkpointManager = new CheckpointManager(this.dbManager.getTargetPool());
    this.logger = new SyncLoggerService(projectRoot);

    this.schedulerService = new SyncSchedulerService(
      this.dbManager.getSourcePool(),
      this.dbManager.getTargetPool(),
      projectRoot
    );
  }

  /**
   * Start the sync scheduler with background job monitoring
   */
  async startScheduler(
    config: SyncSchedulerOrchestratorConfig = {}
  ): Promise<SchedulerOrchestrationContext> {
    const orchestratorId = this.generateOrchestratorId();
    const operationLogger = this.logger.createOperationLogger(orchestratorId);

    const context: SchedulerOrchestrationContext = {
      orchestratorId,
      config: this.mergeDefaultConfig(config),
      logger: operationLogger,
      dbManager: this.dbManager,
      checkpointManager: this.checkpointManager,
      schedulerService: this.schedulerService,
      startTime: new Date(),
      isRunning: false,
      activeJobs: new Map(),
      stats: this.initializeStats()
    };

    this.context = context;

    try {
      operationLogger.info('🚀 Starting sync scheduler orchestration', {
        orchestratorId,
        config: context.config,
        timestamp: context.startTime.toISOString()
      });

      // Test database connections
      await this.validateConnections(context);

      // Initialize scheduler service
      await this.schedulerService.initialize(context.config);

      // Start background scheduling if enabled
      if (context.config.backgroundScheduling) {
        await this.startBackgroundScheduling(context);
      }

      context.isRunning = true;

      operationLogger.info('✅ Sync scheduler orchestration started successfully', {
        orchestratorId,
        backgroundScheduling: context.config.backgroundScheduling,
        checkInterval: context.config.checkInterval
      });

      return context;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Failed to start sync scheduler orchestration', {
        error: errorMessage,
        orchestratorId
      });
      throw error;
    }
  }

  /**
   * Stop the sync scheduler and cleanup resources
   */
  async stopScheduler(): Promise<SchedulerOrchestrationResult> {
    if (!this.context) {
      throw new Error('Scheduler is not running');
    }

    const { context } = this;
    const { logger, orchestratorId, startTime, stats } = context;

    try {
      logger.info('🛑 Stopping sync scheduler orchestration', { orchestratorId });

      // Stop background scheduling
      if (this.backgroundTimer) {
        clearInterval(this.backgroundTimer);
        this.backgroundTimer = undefined;
      }

      // Wait for active jobs to complete or timeout
      await this.waitForActiveJobs(context, 30000); // 30 second timeout

      // Stop scheduler service
      await this.schedulerService.stop();

      context.isRunning = false;

      const result: SchedulerOrchestrationResult = {
        orchestratorId,
        totalJobsExecuted: stats.completedJobs + stats.failedJobs,
        successfulJobs: stats.completedJobs,
        failedJobs: stats.failedJobs,
        totalExecutionTime: Date.now() - startTime.getTime(),
        errors: [],
        stats
      };

      logger.info('✅ Sync scheduler orchestration stopped successfully', {
        orchestratorId,
        result
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('❌ Error stopping sync scheduler orchestration', {
        error: errorMessage,
        orchestratorId
      });
      throw error;
    }
  }

  /**
   * Create a new synchronization job
   */
  async createSyncJob(request: JobCreateRequest): Promise<SynchronizationJob> {
    if (!this.context) {
      throw new Error('Scheduler is not running. Call startScheduler() first.');
    }

    const { logger } = this.context;

    try {
      logger.info('📋 Creating new synchronization job', {
        jobName: request.jobName,
        jobType: request.jobType,
        entities: request.entities
      });

      const jobConfig: SyncJobConfig = {
        jobName: request.jobName,
        jobType: request.jobType,
        entities: request.entities,
        scheduleConfig: request.scheduleConfig,
        conflictResolution: request.conflictResolution,
        maxRecordsPerBatch: request.maxRecordsPerBatch || 500,
        metadata: request.metadata || {}
      };

      const job = await this.schedulerService.createJob(jobConfig);

      if (request.enabled !== false) {
        await this.schedulerService.enableJob(job.id);
      }

      logger.info('✅ Synchronization job created successfully', {
        jobId: job.id,
        jobName: job.job_name,
        nextRunAt: job.next_run_at
      });

      return job;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('❌ Failed to create synchronization job', {
        error: errorMessage,
        request
      });
      throw error;
    }
  }

  /**
   * Execute a synchronization job manually
   */
  async executeSyncJob(jobId: string, force: boolean = false): Promise<JobExecutionResult> {
    if (!this.context) {
      throw new Error('Scheduler is not running. Call startScheduler() first.');
    }

    const { logger } = this.context;

    try {
      logger.info('▶️ Executing synchronization job manually', { jobId, force });

      const response = await this.schedulerService.executeJob(jobId, { force });

      const result: JobExecutionResult = {
        jobId,
        runId: response.runId,
        success: response.success,
        runStatus: response.runStatus,
        executionTimeMs: response.executionTime,
        recordsProcessed: response.recordsProcessed,
        errors: response.errors || [],
        nextRunAt: response.nextRunAt
      };

      logger.info('✅ Synchronization job execution completed', {
        jobId,
        runId: result.runId,
        success: result.success,
        recordsProcessed: result.recordsProcessed
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('❌ Failed to execute synchronization job', {
        error: errorMessage,
        jobId
      });
      throw error;
    }
  }

  /**
   * Get status of synchronization jobs
   */
  async getJobStatus(jobId?: string): Promise<any> {
    try {
      if (jobId) {
        // Get specific job status
        const job = await this.schedulerService.getJob(jobId);
        const runHistory = await this.schedulerService.getJobRunHistory(jobId, 10);

        return {
          job,
          runHistory,
          isActive: job.status === JobStatus.RUNNING,
          lastRunStatus: runHistory.length > 0 ? runHistory[0].run_status : null
        };
      }

      // Get overall scheduler status
      const stats = await this.schedulerService.getSchedulerStats();
      const activeJobs = await this.schedulerService.getActiveJobs();

      return {
        schedulerStats: stats,
        activeJobs,
        totalActiveJobs: activeJobs.length,
        isSchedulerRunning: this.context?.isRunning || false
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get job status: ${errorMessage}`);
    }
  }

  /**
   * List all synchronization jobs
   */
  async listJobs(status?: JobStatus, jobType?: JobType): Promise<SynchronizationJob[]> {
    try {
      return await this.schedulerService.listJobs({ status, jobType });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to list jobs: ${errorMessage}`);
    }
  }

  /**
   * Pause/resume a synchronization job
   */
  async pauseJob(jobId: string): Promise<void> {
    if (!this.context) {
      throw new Error('Scheduler is not running');
    }

    try {
      this.context.logger.info('⏸️ Pausing synchronization job', { jobId });
      await this.schedulerService.pauseJob(jobId);
      this.context.logger.info('✅ Synchronization job paused', { jobId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.context.logger.error('❌ Failed to pause job', { error: errorMessage, jobId });
      throw error;
    }
  }

  async resumeJob(jobId: string): Promise<void> {
    if (!this.context) {
      throw new Error('Scheduler is not running');
    }

    try {
      this.context.logger.info('▶️ Resuming synchronization job', { jobId });
      await this.schedulerService.resumeJob(jobId);
      this.context.logger.info('✅ Synchronization job resumed', { jobId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.context.logger.error('❌ Failed to resume job', { error: errorMessage, jobId });
      throw error;
    }
  }

  /**
   * Delete a synchronization job
   */
  async deleteJob(jobId: string, force: boolean = false): Promise<void> {
    if (!this.context) {
      throw new Error('Scheduler is not running');
    }

    try {
      this.context.logger.info('🗑️ Deleting synchronization job', { jobId, force });
      await this.schedulerService.deleteJob(jobId, force);
      this.context.logger.info('✅ Synchronization job deleted', { jobId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.context.logger.error('❌ Failed to delete job', { error: errorMessage, jobId });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private mergeDefaultConfig(config: SyncSchedulerOrchestratorConfig): SyncSchedulerOrchestratorConfig {
    return {
      checkInterval: 60000, // 1 minute
      maxConcurrentJobs: 3,
      jobTimeout: 300000, // 5 minutes
      retryAttempts: 3,
      retryDelay: 5000, // 5 seconds
      enableHealthMonitoring: true,
      enableJobPersistence: true,
      backgroundScheduling: true,
      ...config
    };
  }

  private generateOrchestratorId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `sync_orchestrator_${timestamp}_${random}`;
  }

  private initializeStats(): SchedulerStats {
    return {
      totalJobs: 0,
      activeJobs: 0,
      scheduledJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      runningJobs: 0,
      uptime: 0
    };
  }

  private async validateConnections(context: SchedulerOrchestrationContext): Promise<void> {
    context.logger.info('🔌 Validating database connections');

    const sourceTest = await this.dbManager.testConnection('source');
    if (!sourceTest.success) {
      throw new Error(`Source database connection failed: ${sourceTest.error}`);
    }

    const targetTest = await this.dbManager.testConnection('target');
    if (!targetTest.success) {
      throw new Error(`Target database connection failed: ${targetTest.error}`);
    }

    context.logger.info('✅ Database connections validated', {
      sourceLatency: sourceTest.latency,
      targetLatency: targetTest.latency
    });
  }

  private async startBackgroundScheduling(context: SchedulerOrchestrationContext): Promise<void> {
    const { config, logger } = context;

    logger.info('⏰ Starting background job scheduling', {
      checkInterval: config.checkInterval
    });

    this.backgroundTimer = setInterval(async () => {
      try {
        await this.checkAndExecuteScheduledJobs(context);
      } catch (error) {
        logger.error('❌ Error in background job scheduling', { error });
      }
    }, config.checkInterval || 60000);
  }

  private async checkAndExecuteScheduledJobs(context: SchedulerOrchestrationContext): Promise<void> {
    try {
      // Get due jobs from scheduler service
      const dueJobs = await this.schedulerService.getDueJobs();

      for (const job of dueJobs) {
        if (context.activeJobs.size < (context.config.maxConcurrentJobs || 3)) {
          // Execute job asynchronously
          this.executeJobAsync(context, job).catch(error => {
            context.logger.error('❌ Async job execution failed', {
              jobId: job.id,
              error: error.message
            });
          });
        } else {
          context.logger.warn('⚠️ Max concurrent jobs reached, skipping job', {
            jobId: job.id,
            activeJobs: context.activeJobs.size
          });
        }
      }

      // Update stats
      context.stats = await this.schedulerService.getSchedulerStats();
      context.stats.uptime = Date.now() - context.startTime.getTime();

    } catch (error) {
      context.logger.error('❌ Error checking scheduled jobs', { error });
    }
  }

  private async executeJobAsync(context: SchedulerOrchestrationContext, job: SynchronizationJob): Promise<void> {
    const runId = this.generateRunId(job.id);
    const jobContext: JobExecutionContext = {
      job,
      runId,
      logger: context.logger,
      startTime: new Date(),
      abortController: new AbortController()
    };

    context.activeJobs.set(job.id, jobContext);

    try {
      context.logger.info('🔄 Starting background job execution', {
        jobId: job.id,
        runId,
        jobName: job.job_name
      });

      const response = await this.schedulerService.executeJob(job.id);

      context.logger.info('✅ Background job execution completed', {
        jobId: job.id,
        runId,
        success: response.success,
        recordsProcessed: response.recordsProcessed
      });

    } catch (error) {
      context.logger.error('❌ Background job execution failed', {
        jobId: job.id,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      context.activeJobs.delete(job.id);
    }
  }

  private generateRunId(jobId: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `run_${jobId}_${timestamp}_${random}`;
  }

  private async waitForActiveJobs(context: SchedulerOrchestrationContext, timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (context.activeJobs.size > 0 && (Date.now() - startTime) < timeoutMs) {
      context.logger.info('⏳ Waiting for active jobs to complete', {
        activeJobs: context.activeJobs.size,
        remainingTime: timeoutMs - (Date.now() - startTime)
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (context.activeJobs.size > 0) {
      context.logger.warn('⚠️ Timeout waiting for active jobs, forcing termination', {
        activeJobs: context.activeJobs.size
      });

      // Force abort remaining jobs
      for (const [jobId, jobContext] of context.activeJobs) {
        jobContext.abortController.abort();
        context.logger.warn('🛑 Forced abort for job', { jobId });
      }
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.context?.isRunning) {
      await this.stopScheduler();
    }

    await this.checkpointManager.cleanup();
    await this.dbManager.closeAll();
  }
}

// Factory function for easy instantiation
export function createSyncSchedulerOrchestrator(projectRoot?: string): SyncSchedulerOrchestrator {
  return new SyncSchedulerOrchestrator(projectRoot);
}

// Default export for CLI integration
export default SyncSchedulerOrchestrator;
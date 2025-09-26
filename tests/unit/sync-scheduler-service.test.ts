// Sync Scheduler Service Unit Tests
// Comprehensive test suite for SyncSchedulerService

import { Pool } from 'pg';
import { SyncSchedulerService, SchedulerConfig, SchedulerStats } from '../../src/services/sync-scheduler-service';
import { SynchronizationJobModel } from '../../src/models/synchronization-job';
import { SyncRunHistoryModel } from '../../src/models/sync-run-history';
import { DifferentialMigrationService } from '../../src/services/differential-migration-service';
import { SyncLoggerService } from '../../src/services/sync-logger';
import {
  SynchronizationJob,
  SyncJobConfig,
  SyncJobResponse,
  JobStatus,
  JobType,
  RunStatus,
  ConflictResolution,
  SyncRunHistory
} from '../../src/types/migration-types';

// Mock dependencies
jest.mock('../../src/models/synchronization-job');
jest.mock('../../src/models/sync-run-history');
jest.mock('../../src/services/differential-migration-service');
jest.mock('../../src/services/sync-logger');

const mockSourcePool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
} as unknown as Pool;

const mockTargetPool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn()
} as unknown as Pool;

describe('SyncSchedulerService', () => {
  let service: SyncSchedulerService;
  let mockJobModel: jest.Mocked<SynchronizationJobModel>;
  let mockRunHistoryModel: jest.Mocked<SyncRunHistoryModel>;
  let mockMigrationService: jest.Mocked<DifferentialMigrationService>;
  let mockLoggerService: jest.Mocked<SyncLoggerService>;

  const mockJob: SynchronizationJob = {
    id: 'job-uuid-123',
    job_name: 'test-sync-job',
    job_type: JobType.SCHEDULED_SYNC,
    schedule_config: { frequency: 'daily', time: '02:00' },
    entities_to_sync: ['offices', 'doctors'],
    sync_direction: 'source_to_target',
    conflict_resolution: ConflictResolution.SOURCE_WINS,
    max_records_per_batch: 1000,
    status: JobStatus.SCHEDULED,
    last_run_at: null,
    next_run_at: new Date('2023-01-02T02:00:00Z'),
    total_records_synced: 0,
    success_rate: 0,
    average_duration_ms: 0,
    created_at: new Date('2023-01-01T10:00:00Z'),
    updated_at: new Date('2023-01-01T10:00:00Z'),
    metadata: { test: 'config' }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockJobModel = new SynchronizationJobModel(mockTargetPool) as jest.Mocked<SynchronizationJobModel>;
    mockRunHistoryModel = new SyncRunHistoryModel(mockTargetPool) as jest.Mocked<SyncRunHistoryModel>;
    mockMigrationService = new DifferentialMigrationService(
      mockSourcePool,
      mockTargetPool
    ) as jest.Mocked<DifferentialMigrationService>;
    mockLoggerService = new SyncLoggerService({}) as jest.Mocked<SyncLoggerService>;

    // Mock implementations
    (SynchronizationJobModel as jest.Mock).mockReturnValue(mockJobModel);
    (SyncRunHistoryModel as jest.Mock).mockReturnValue(mockRunHistoryModel);
    (DifferentialMigrationService as jest.Mock).mockReturnValue(mockMigrationService);
    (SyncLoggerService as jest.Mock).mockReturnValue(mockLoggerService);

    mockLoggerService.startOperation = jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      complete: jest.fn()
    });

    service = new SyncSchedulerService(mockSourcePool, mockTargetPool);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const defaultService = new SyncSchedulerService(mockSourcePool, mockTargetPool);
      expect(defaultService).toBeDefined();
    });

    it('should initialize with custom configuration', () => {
      const customConfig: SchedulerConfig = {
        checkInterval: 30000,
        maxConcurrentJobs: 5,
        jobTimeout: 600000,
        retryAttempts: 5,
        retryDelay: 2000
      };

      const customService = new SyncSchedulerService(
        mockSourcePool,
        mockTargetPool,
        customConfig
      );

      expect(customService).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize scheduler with configuration', async () => {
      const config = {
        checkInterval: 30000,
        maxConcurrentJobs: 5
      };

      await service.initialize(config);

      expect(mockLoggerService.startOperation).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockLoggerService.startOperation = jest.fn().mockImplementation(() => {
        throw new Error('Logger initialization failed');
      });

      await expect(service.initialize({})).rejects.toThrow('Logger initialization failed');
    });
  });

  describe('createJob', () => {
    const jobConfig: SyncJobConfig = {
      jobName: 'test-sync-job',
      jobType: JobType.SCHEDULED_SYNC,
      entities: ['offices', 'doctors'],
      scheduleConfig: { frequency: 'daily', time: '02:00' },
      conflictResolution: ConflictResolution.SOURCE_WINS,
      maxRecordsPerBatch: 1000,
      metadata: { test: 'config' }
    };

    it('should create a new sync job successfully', async () => {
      mockJobModel.create.mockResolvedValue(mockJob);

      const result = await service.createJob(jobConfig);

      expect(mockJobModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          job_name: jobConfig.jobName,
          job_type: jobConfig.jobType,
          entities_to_sync: jobConfig.entities,
          schedule_config: jobConfig.scheduleConfig,
          conflict_resolution: jobConfig.conflictResolution,
          max_records_per_batch: jobConfig.maxRecordsPerBatch
        })
      );

      expect(result).toEqual(mockJob);
    });

    it('should handle job creation errors', async () => {
      mockJobModel.create.mockRejectedValue(new Error('Database error'));

      await expect(service.createJob(jobConfig)).rejects.toThrow('Database error');
    });

    it('should validate job configuration', async () => {
      const invalidConfig = {
        ...jobConfig,
        jobName: '', // Invalid empty name
      };

      mockJobModel.create.mockRejectedValue(new Error('Invalid job name'));

      await expect(service.createJob(invalidConfig)).rejects.toThrow();
    });
  });

  describe('executeJob', () => {
    const jobId = 'job-uuid-123';

    beforeEach(() => {
      mockJobModel.findById.mockResolvedValue(mockJob);
      mockMigrationService.executeDifferentialMigration.mockResolvedValue({
        operationId: 'op-123',
        success: true,
        stats: {
          recordsProcessed: 100,
          recordsSuccessful: 100,
          recordsFailed: 0,
          startTime: new Date(),
          endTime: new Date()
        },
        entitiesProcessed: ['offices', 'doctors']
      });
    });

    it('should execute job successfully', async () => {
      const mockRunHistory: SyncRunHistory = {
        id: 'run-uuid-123',
        job_id: jobId,
        run_id: 'run-123',
        run_type: 'scheduled',
        run_status: RunStatus.COMPLETED,
        started_at: new Date(),
        completed_at: new Date(),
        records_processed: 100,
        records_successful: 100,
        records_failed: 0,
        execution_time_ms: 5000,
        error_message: null,
        created_at: new Date(),
        metadata: {}
      };

      mockRunHistoryModel.create.mockResolvedValue(mockRunHistory);
      mockJobModel.update.mockResolvedValue({ ...mockJob, status: JobStatus.COMPLETED });

      const result = await service.executeJob(jobId);

      expect(mockJobModel.findById).toHaveBeenCalledWith(jobId);
      expect(mockMigrationService.executeDifferentialMigration).toHaveBeenCalled();
      expect(mockRunHistoryModel.create).toHaveBeenCalled();

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(100);
      expect(result.runStatus).toBe(RunStatus.COMPLETED);
    });

    it('should handle job execution failures', async () => {
      mockMigrationService.executeDifferentialMigration.mockRejectedValue(
        new Error('Migration failed')
      );

      const result = await service.executeJob(jobId);

      expect(result.success).toBe(false);
      expect(result.runStatus).toBe(RunStatus.FAILED);
      expect(result.errors).toContain(expect.objectContaining({
        message: expect.stringContaining('Migration failed')
      }));
    });

    it('should handle job not found', async () => {
      mockJobModel.findById.mockResolvedValue(null);

      await expect(service.executeJob(jobId)).rejects.toThrow('Job not found');
    });

    it('should handle job already running', async () => {
      const runningJob = { ...mockJob, status: JobStatus.RUNNING };
      mockJobModel.findById.mockResolvedValue(runningJob);

      await expect(service.executeJob(jobId)).rejects.toThrow('Job is already running');
    });

    it('should respect job timeout', async () => {
      jest.useFakeTimers();

      mockMigrationService.executeDifferentialMigration.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 60000)) // 1 minute delay
      );

      const executePromise = service.executeJob(jobId, { timeout: 30000 }); // 30 second timeout

      jest.advanceTimersByTime(30000);

      await expect(executePromise).rejects.toThrow('Job execution timeout');

      jest.useRealTimers();
    });
  });

  describe('listJobs', () => {
    const mockJobs = [mockJob, { ...mockJob, id: 'job-2', job_name: 'another-job' }];

    it('should list all jobs by default', async () => {
      mockJobModel.list.mockResolvedValue(mockJobs);

      const result = await service.listJobs({});

      expect(mockJobModel.list).toHaveBeenCalledWith({});
      expect(result).toEqual(mockJobs);
    });

    it('should filter jobs by status', async () => {
      const scheduledJobs = [mockJob];
      mockJobModel.list.mockResolvedValue(scheduledJobs);

      const result = await service.listJobs({ status: JobStatus.SCHEDULED });

      expect(mockJobModel.list).toHaveBeenCalledWith({ status: JobStatus.SCHEDULED });
      expect(result).toEqual(scheduledJobs);
    });

    it('should filter jobs by type', async () => {
      const scheduledJobs = [mockJob];
      mockJobModel.list.mockResolvedValue(scheduledJobs);

      const result = await service.listJobs({ jobType: JobType.SCHEDULED_SYNC });

      expect(mockJobModel.list).toHaveBeenCalledWith({ jobType: JobType.SCHEDULED_SYNC });
      expect(result).toEqual(scheduledJobs);
    });
  });

  describe('pauseJob and resumeJob', () => {
    const jobId = 'job-uuid-123';

    beforeEach(() => {
      mockJobModel.findById.mockResolvedValue(mockJob);
    });

    it('should pause job successfully', async () => {
      const pausedJob = { ...mockJob, status: JobStatus.PAUSED };
      mockJobModel.update.mockResolvedValue(pausedJob);

      await service.pauseJob(jobId);

      expect(mockJobModel.update).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: JobStatus.PAUSED })
      );
    });

    it('should resume job successfully', async () => {
      const pausedJob = { ...mockJob, status: JobStatus.PAUSED };
      const resumedJob = { ...mockJob, status: JobStatus.SCHEDULED };

      mockJobModel.findById.mockResolvedValue(pausedJob);
      mockJobModel.update.mockResolvedValue(resumedJob);

      await service.resumeJob(jobId);

      expect(mockJobModel.update).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: JobStatus.SCHEDULED })
      );
    });

    it('should handle pause/resume of non-existent job', async () => {
      mockJobModel.findById.mockResolvedValue(null);

      await expect(service.pauseJob(jobId)).rejects.toThrow('Job not found');
      await expect(service.resumeJob(jobId)).rejects.toThrow('Job not found');
    });
  });

  describe('deleteJob', () => {
    const jobId = 'job-uuid-123';

    it('should delete job successfully', async () => {
      mockJobModel.findById.mockResolvedValue(mockJob);
      mockJobModel.delete.mockResolvedValue(true);

      await service.deleteJob(jobId);

      expect(mockJobModel.delete).toHaveBeenCalledWith(jobId);
    });

    it('should prevent deletion of running job without force', async () => {
      const runningJob = { ...mockJob, status: JobStatus.RUNNING };
      mockJobModel.findById.mockResolvedValue(runningJob);

      await expect(service.deleteJob(jobId, false)).rejects.toThrow(
        'Cannot delete running job'
      );
    });

    it('should allow forced deletion of running job', async () => {
      const runningJob = { ...mockJob, status: JobStatus.RUNNING };
      mockJobModel.findById.mockResolvedValue(runningJob);
      mockJobModel.delete.mockResolvedValue(true);

      await service.deleteJob(jobId, true);

      expect(mockJobModel.delete).toHaveBeenCalledWith(jobId);
    });
  });

  describe('getSchedulerStats', () => {
    it('should return scheduler statistics', async () => {
      const mockJobStats = [
        { status: JobStatus.SCHEDULED, count: 3 },
        { status: JobStatus.RUNNING, count: 1 },
        { status: JobStatus.COMPLETED, count: 5 },
        { status: JobStatus.FAILED, count: 2 }
      ];

      mockJobModel.getJobStatistics.mockResolvedValue(mockJobStats);

      const stats = await service.getSchedulerStats();

      expect(stats).toEqual(expect.objectContaining({
        totalJobs: 11,
        activeJobs: 4, // scheduled + running
        scheduledJobs: 3,
        runningJobs: 1,
        completedJobs: 5,
        failedJobs: 2,
        uptime: expect.any(Number)
      }));
    });

    it('should handle empty statistics', async () => {
      mockJobModel.getJobStatistics.mockResolvedValue([]);

      const stats = await service.getSchedulerStats();

      expect(stats).toEqual(expect.objectContaining({
        totalJobs: 0,
        activeJobs: 0,
        scheduledJobs: 0,
        runningJobs: 0,
        completedJobs: 0,
        failedJobs: 0
      }));
    });
  });

  describe('getDueJobs', () => {
    it('should return jobs that are due for execution', async () => {
      const dueJob = {
        ...mockJob,
        next_run_at: new Date(Date.now() - 1000) // 1 second ago
      };

      mockJobModel.getDueJobs.mockResolvedValue([dueJob]);

      const dueJobs = await service.getDueJobs();

      expect(mockJobModel.getDueJobs).toHaveBeenCalled();
      expect(dueJobs).toEqual([dueJob]);
    });

    it('should return empty array when no jobs are due', async () => {
      mockJobModel.getDueJobs.mockResolvedValue([]);

      const dueJobs = await service.getDueJobs();

      expect(dueJobs).toEqual([]);
    });
  });

  describe('getJobRunHistory', () => {
    const jobId = 'job-uuid-123';
    const mockRunHistory: SyncRunHistory[] = [
      {
        id: 'run-1',
        job_id: jobId,
        run_id: 'run-001',
        run_type: 'scheduled',
        run_status: RunStatus.COMPLETED,
        started_at: new Date('2023-01-01T10:00:00Z'),
        completed_at: new Date('2023-01-01T10:05:00Z'),
        records_processed: 100,
        records_successful: 100,
        records_failed: 0,
        execution_time_ms: 300000,
        error_message: null,
        created_at: new Date(),
        metadata: {}
      }
    ];

    it('should return job run history', async () => {
      mockRunHistoryModel.list.mockResolvedValue(mockRunHistory);

      const history = await service.getJobRunHistory(jobId, 10);

      expect(mockRunHistoryModel.list).toHaveBeenCalledWith({
        jobId,
        limit: 10,
        orderBy: 'started_at',
        orderDirection: 'DESC'
      });

      expect(history).toEqual(mockRunHistory);
    });

    it('should handle empty run history', async () => {
      mockRunHistoryModel.list.mockResolvedValue([]);

      const history = await service.getJobRunHistory(jobId);

      expect(history).toEqual([]);
    });
  });

  describe('stop', () => {
    it('should stop scheduler gracefully', async () => {
      jest.useFakeTimers();

      // Start the service first
      await service.initialize({});

      // Mock running jobs
      const mockJobContext = {
        job: mockJob,
        runId: 'run-123',
        logger: mockLoggerService.startOperation('test', 'test', 'test'),
        startTime: new Date(),
        abortController: new AbortController()
      };

      // Add job to running jobs map (simulating running job)
      (service as any).runningJobs.set('job-123', mockJobContext);

      const stopPromise = service.stop();

      // Advance timers to simulate graceful shutdown timeout
      jest.advanceTimersByTime(10000);

      await stopPromise;

      expect((service as any).isRunning).toBe(false);

      jest.useRealTimers();
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle database connection failures gracefully', async () => {
      mockJobModel.list.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.listJobs({})).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid job configurations', async () => {
      const invalidConfig = {
        jobName: '',
        jobType: JobType.SCHEDULED_SYNC,
        entities: [],
        scheduleConfig: null,
        conflictResolution: ConflictResolution.SOURCE_WINS
      } as any;

      mockJobModel.create.mockRejectedValue(new Error('Invalid configuration'));

      await expect(service.createJob(invalidConfig)).rejects.toThrow('Invalid configuration');
    });

    it('should handle concurrent job execution attempts', async () => {
      mockJobModel.findById.mockResolvedValue(mockJob);

      // Start first execution
      const firstExecution = service.executeJob('job-123');

      // Try to start second execution immediately
      const secondExecution = service.executeJob('job-123');

      // First should succeed, second should fail
      await expect(firstExecution).resolves.toBeDefined();
      await expect(secondExecution).rejects.toThrow('Job is already running');
    });

    it('should handle job execution with missing dependencies', async () => {
      mockJobModel.findById.mockResolvedValue(mockJob);
      mockMigrationService.executeDifferentialMigration.mockRejectedValue(
        new Error('Required service unavailable')
      );

      const result = await service.executeJob('job-123');

      expect(result.success).toBe(false);
      expect(result.errors).toContain(expect.objectContaining({
        message: expect.stringContaining('Required service unavailable')
      }));
    });
  });
});
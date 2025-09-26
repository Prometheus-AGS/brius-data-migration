// Synchronization Job Model
// Handles scheduled and manual sync jobs with status tracking

import { Pool, PoolClient } from 'pg';
import {
  SynchronizationJob,
  JobType,
  SyncDirection,
  ConflictResolution,
  JobStatus,
  SyncJobConfig,
  SyncJobResponse,
  SyncRunSummary
} from '../types/migration-types';

export class SynchronizationJobModel {
  constructor(private db: Pool) {}

  /**
   * Create a new synchronization job
   */
  async create(job: Omit<SynchronizationJob, 'id' | 'created_at' | 'updated_at'>): Promise<SynchronizationJob> {
    const query = `
      INSERT INTO synchronization_jobs (
        job_name, job_type, schedule_config, entities_to_sync,
        sync_direction, conflict_resolution, max_records_per_batch,
        status, last_run_at, next_run_at, total_records_synced,
        success_rate, average_duration_ms, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const values = [
      job.job_name,
      job.job_type,
      JSON.stringify(job.schedule_config),
      JSON.stringify(job.entities_to_sync),
      job.sync_direction,
      job.conflict_resolution,
      job.max_records_per_batch,
      job.status,
      job.last_run_at,
      job.next_run_at,
      job.total_records_synced,
      job.success_rate,
      job.average_duration_ms,
      JSON.stringify(job.metadata)
    ];

    try {
      const result = await this.db.query(query, values);
      return this.mapRowToJob(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') { // Unique constraint violation
        throw new Error(`Synchronization job name '${job.job_name}' already exists`);
      }
      throw new Error(`Failed to create synchronization job: ${error.message}`);
    }
  }

  /**
   * Update an existing job
   */
  async update(id: string, updates: Partial<SynchronizationJob>): Promise<SynchronizationJob> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        if (key === 'schedule_config' || key === 'entities_to_sync' || key === 'metadata') {
          updateFields.push(`${key} = $${paramCount}`);
          values.push(JSON.stringify(value));
        } else {
          updateFields.push(`${key} = $${paramCount}`);
          values.push(value);
        }
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      throw new Error('No valid fields provided for update');
    }

    updateFields.push(`updated_at = NOW()`);

    const query = `
      UPDATE synchronization_jobs
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    values.push(id);

    try {
      const result = await this.db.query(query, values);
      if (result.rows.length === 0) {
        throw new Error(`Synchronization job not found: ${id}`);
      }
      return this.mapRowToJob(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to update synchronization job: ${error.message}`);
    }
  }

  /**
   * Find job by ID
   */
  async findById(id: string): Promise<SynchronizationJob | null> {
    const query = 'SELECT * FROM synchronization_jobs WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rows.length > 0 ? this.mapRowToJob(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find synchronization job: ${error.message}`);
    }
  }

  /**
   * Find job by name
   */
  async findByName(name: string): Promise<SynchronizationJob | null> {
    const query = 'SELECT * FROM synchronization_jobs WHERE job_name = $1';

    try {
      const result = await this.db.query(query, [name]);
      return result.rows.length > 0 ? this.mapRowToJob(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find synchronization job by name: ${error.message}`);
    }
  }

  /**
   * List jobs with optional filtering
   */
  async list(filters: {
    status?: JobStatus;
    jobType?: JobType;
    limit?: number;
    offset?: number;
  } = {}): Promise<SynchronizationJob[]> {
    let query = 'SELECT * FROM synchronization_jobs WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (filters.status) {
      query += ` AND status = $${paramCount}`;
      values.push(filters.status);
      paramCount++;
    }

    if (filters.jobType) {
      query += ` AND job_type = $${paramCount}`;
      values.push(filters.jobType);
      paramCount++;
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    if (filters.offset) {
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
    }

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToJob(row));
    } catch (error) {
      throw new Error(`Failed to list synchronization jobs: ${error.message}`);
    }
  }

  /**
   * Get jobs due for execution
   */
  async getDueJobs(): Promise<SynchronizationJob[]> {
    const query = `
      SELECT * FROM synchronization_jobs
      WHERE status = 'scheduled'
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
    `;

    try {
      const result = await this.db.query(query);
      return result.rows.map(row => this.mapRowToJob(row));
    } catch (error) {
      throw new Error(`Failed to get due jobs: ${error.message}`);
    }
  }

  /**
   * Update job run statistics
   */
  async updateRunStatistics(
    jobId: string,
    runDurationMs: number,
    recordsSynced: number,
    successful: boolean
  ): Promise<SynchronizationJob> {
    const job = await this.findById(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Calculate new success rate and average duration
    const totalRuns = Math.floor(job.total_records_synced / job.max_records_per_batch) + 1;
    const newSuccessRate = successful
      ? ((job.success_rate * (totalRuns - 1)) + 100) / totalRuns
      : (job.success_rate * (totalRuns - 1)) / totalRuns;

    const newAverageDuration = job.average_duration_ms === 0
      ? runDurationMs
      : Math.round((job.average_duration_ms * (totalRuns - 1) + runDurationMs) / totalRuns);

    return this.update(jobId, {
      last_run_at: new Date(),
      total_records_synced: job.total_records_synced + recordsSynced,
      success_rate: Math.round(newSuccessRate * 100) / 100,
      average_duration_ms: newAverageDuration,
      status: successful ? JobStatus.COMPLETED : JobStatus.FAILED
    });
  }

  /**
   * Calculate next run time based on schedule
   */
  async calculateNextRunTime(jobId: string): Promise<Date | null> {
    const job = await this.findById(jobId);
    if (!job || job.job_type !== JobType.SCHEDULED_SYNC) {
      return null;
    }

    const schedule = job.schedule_config as any;
    const now = new Date();
    let nextRun: Date;

    if (typeof schedule === 'string') {
      // Simple schedule formats
      switch (schedule.toLowerCase()) {
        case 'hourly':
          nextRun = new Date(now.getTime() + 60 * 60 * 1000);
          break;
        case 'daily':
          nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          // Parse custom intervals like '2h', '30m', '1d'
          const match = schedule.match(/^(\d+)([hmwd])$/);
          if (match) {
            const [, amount, unit] = match;
            const multipliers = { h: 60 * 60 * 1000, m: 60 * 1000, w: 7 * 24 * 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
            const interval = parseInt(amount) * multipliers[unit as keyof typeof multipliers];
            nextRun = new Date(now.getTime() + interval);
          } else {
            throw new Error(`Invalid schedule format: ${schedule}`);
          }
          break;
      }
    } else {
      // Complex schedule object (could implement cron-like functionality)
      nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Default to daily
    }

    // Update the job with the new next run time
    await this.update(jobId, { next_run_at: nextRun });
    return nextRun;
  }

  /**
   * Cancel a job
   */
  async cancel(id: string): Promise<boolean> {
    try {
      const updated = await this.update(id, {
        status: JobStatus.CANCELLED,
        next_run_at: null
      });
      return true;
    } catch (error) {
      throw new Error(`Failed to cancel job: ${error.message}`);
    }
  }

  /**
   * Delete a job
   */
  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM synchronization_jobs WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error(`Failed to delete synchronization job: ${error.message}`);
    }
  }

  /**
   * Get job status with recent run history
   */
  async getJobStatus(id: string): Promise<any> {
    const job = await this.findById(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    // Get recent run history
    const historyQuery = `
      SELECT id as run_id, started_at, completed_at, records_synced, status
      FROM sync_run_history
      WHERE job_id = $1
      ORDER BY started_at DESC
      LIMIT 10
    `;

    try {
      const historyResult = await this.db.query(historyQuery, [id]);
      const recentRuns: SyncRunSummary[] = historyResult.rows.map(row => ({
        runId: row.run_id,
        startedAt: new Date(row.started_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
        recordsSynced: parseInt(row.records_synced),
        status: row.status
      }));

      return {
        jobId: job.id,
        jobName: job.job_name,
        status: job.status,
        lastRunAt: job.last_run_at,
        nextRunAt: job.next_run_at,
        totalRecordsSynced: job.total_records_synced,
        successRate: job.success_rate,
        averageDuration: job.average_duration_ms,
        recentRuns
      };
    } catch (error) {
      throw new Error(`Failed to get job status: ${error.message}`);
    }
  }

  /**
   * Create job from config
   */
  async createFromConfig(config: SyncJobConfig): Promise<SyncJobResponse> {
    const nextRunAt = await this.parseScheduleToNextRun(config.schedule);

    const jobData: Omit<SynchronizationJob, 'id' | 'created_at' | 'updated_at'> = {
      job_name: config.jobName,
      job_type: JobType.SCHEDULED_SYNC,
      schedule_config: { schedule: config.schedule },
      entities_to_sync: config.entities,
      sync_direction: SyncDirection.SOURCE_TO_TARGET,
      conflict_resolution: config.conflictResolution,
      max_records_per_batch: config.maxRecords,
      status: JobStatus.SCHEDULED,
      last_run_at: undefined,
      next_run_at: nextRunAt,
      total_records_synced: 0,
      success_rate: 0.0,
      average_duration_ms: 0,
      metadata: { description: config.description || '' }
    };

    const createdJob = await this.create(jobData);

    return {
      jobId: createdJob.id,
      jobName: createdJob.job_name,
      status: createdJob.status,
      nextRunAt: createdJob.next_run_at,
      createdAt: createdJob.created_at
    };
  }

  /**
   * Get active jobs (scheduled, running, paused)
   */
  async getActiveJobs(): Promise<SynchronizationJob[]> {
    return this.list({
      status: JobStatus.SCHEDULED
    });
  }

  /**
   * Get job statistics
   */
  async getStatistics(): Promise<any> {
    const query = `
      SELECT
        job_type,
        status,
        COUNT(*) as job_count,
        AVG(success_rate) as avg_success_rate,
        AVG(average_duration_ms) as avg_duration,
        SUM(total_records_synced) as total_records
      FROM synchronization_jobs
      GROUP BY job_type, status
      ORDER BY job_type, status
    `;

    try {
      const result = await this.db.query(query);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get job statistics: ${error.message}`);
    }
  }

  /**
   * Cleanup old completed/failed jobs
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    const query = `
      DELETE FROM synchronization_jobs
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND updated_at < NOW() - INTERVAL '${olderThanDays} days'
    `;

    try {
      const result = await this.db.query(query);
      return result.rowCount;
    } catch (error) {
      throw new Error(`Failed to cleanup jobs: ${error.message}`);
    }
  }

  /**
   * Execute job operations within a transaction
   */
  async withTransaction<T>(operation: (client: PoolClient, model: SynchronizationJobModel) => Promise<T>): Promise<T> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');
      const transactionModel = new SynchronizationJobModel(client as any);
      const result = await operation(client, transactionModel);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Parse schedule string to next run date
   */
  private async parseScheduleToNextRun(schedule: string): Promise<Date> {
    const now = new Date();
    let nextRun: Date;

    switch (schedule.toLowerCase()) {
      case 'hourly':
        nextRun = new Date(now.getTime() + 60 * 60 * 1000);
        break;
      case 'daily':
        nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        // Parse custom intervals like '2h', '30m', '1d'
        const match = schedule.match(/^(\d+)([hmwd])$/);
        if (match) {
          const [, amount, unit] = match;
          const multipliers = {
            h: 60 * 60 * 1000,      // hours
            m: 60 * 1000,           // minutes
            w: 7 * 24 * 60 * 60 * 1000,  // weeks
            d: 24 * 60 * 60 * 1000       // days
          };
          const interval = parseInt(amount) * multipliers[unit as keyof typeof multipliers];
          nextRun = new Date(now.getTime() + interval);
        } else {
          throw new Error(`Invalid schedule format: ${schedule}`);
        }
        break;
    }

    return nextRun;
  }

  /**
   * Validate schedule format
   */
  static validateSchedule(schedule: string): boolean {
    const validFormats = ['hourly', 'daily', 'weekly'];
    if (validFormats.includes(schedule.toLowerCase())) {
      return true;
    }

    // Check custom interval format
    const customMatch = schedule.match(/^(\d+)([hmwd])$/);
    if (customMatch) {
      const amount = parseInt(customMatch[1]);
      const unit = customMatch[2];

      // Validate reasonable limits
      if (unit === 'm' && (amount < 1 || amount > 1440)) return false; // 1 minute to 24 hours
      if (unit === 'h' && (amount < 1 || amount > 168)) return false;   // 1 hour to 1 week
      if (unit === 'd' && (amount < 1 || amount > 365)) return false;   // 1 day to 1 year
      if (unit === 'w' && (amount < 1 || amount > 52)) return false;    // 1 week to 1 year

      return true;
    }

    return false;
  }

  /**
   * Map database row to SynchronizationJob object
   */
  private mapRowToJob(row: any): SynchronizationJob {
    return {
      id: row.id,
      job_name: row.job_name,
      job_type: row.job_type as JobType,
      schedule_config: typeof row.schedule_config === 'string'
        ? JSON.parse(row.schedule_config)
        : row.schedule_config,
      entities_to_sync: typeof row.entities_to_sync === 'string'
        ? JSON.parse(row.entities_to_sync)
        : row.entities_to_sync,
      sync_direction: row.sync_direction as SyncDirection,
      conflict_resolution: row.conflict_resolution as ConflictResolution,
      max_records_per_batch: parseInt(row.max_records_per_batch),
      status: row.status as JobStatus,
      last_run_at: row.last_run_at ? new Date(row.last_run_at) : undefined,
      next_run_at: row.next_run_at ? new Date(row.next_run_at) : undefined,
      total_records_synced: parseInt(row.total_records_synced),
      success_rate: parseFloat(row.success_rate),
      average_duration_ms: parseInt(row.average_duration_ms),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    };
  }
}
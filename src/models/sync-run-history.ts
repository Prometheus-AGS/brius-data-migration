// Sync Run History Model
// Handles detailed history of individual sync runs for monitoring and troubleshooting

import { Pool, PoolClient } from 'pg';
import {
  SyncRunHistory,
  RunType,
  RunStatus,
  SyncRunSummary
} from '../types/migration-types';

export class SyncRunHistoryModel {
  constructor(private db: Pool) {}

  /**
   * Create a new sync run history entry
   */
  async create(run: Omit<SyncRunHistory, 'id' | 'created_at'>): Promise<SyncRunHistory> {
    const query = `
      INSERT INTO sync_run_history (
        job_id, run_type, started_at, completed_at, records_synced,
        records_failed, status, error_summary, performance_metrics,
        entities_processed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      run.job_id,
      run.run_type,
      run.started_at,
      run.completed_at,
      run.records_synced,
      run.records_failed,
      run.status,
      run.error_summary,
      JSON.stringify(run.performance_metrics),
      JSON.stringify(run.entities_processed)
    ];

    try {
      const result = await this.db.query(query, values);
      return this.mapRowToRun(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to create sync run history: ${error.message}`);
    }
  }

  /**
   * Update an existing run
   */
  async update(id: string, updates: Partial<SyncRunHistory>): Promise<SyncRunHistory> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        if (key === 'performance_metrics' || key === 'entities_processed') {
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

    const query = `
      UPDATE sync_run_history
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    values.push(id);

    try {
      const result = await this.db.query(query, values);
      if (result.rows.length === 0) {
        throw new Error(`Sync run history not found: ${id}`);
      }
      return this.mapRowToRun(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to update sync run history: ${error.message}`);
    }
  }

  /**
   * Find run by ID
   */
  async findById(id: string): Promise<SyncRunHistory | null> {
    const query = 'SELECT * FROM sync_run_history WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rows.length > 0 ? this.mapRowToRun(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find sync run history: ${error.message}`);
    }
  }

  /**
   * Get runs by job ID
   */
  async findByJobId(
    jobId: string,
    limit: number = 20,
    status?: RunStatus
  ): Promise<SyncRunHistory[]> {
    let query = 'SELECT * FROM sync_run_history WHERE job_id = $1';
    const values = [jobId];
    let paramCount = 2;

    if (status) {
      query += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }

    query += ` ORDER BY started_at DESC LIMIT $${paramCount}`;
    values.push(limit);

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToRun(row));
    } catch (error) {
      throw new Error(`Failed to find runs by job ID: ${error.message}`);
    }
  }

  /**
   * Get recent runs across all jobs
   */
  async getRecentRuns(
    limit: number = 50,
    status?: RunStatus,
    runType?: RunType
  ): Promise<SyncRunHistory[]> {
    let query = 'SELECT * FROM sync_run_history WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (status) {
      query += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }

    if (runType) {
      query += ` AND run_type = $${paramCount}`;
      values.push(runType);
      paramCount++;
    }

    query += ` ORDER BY started_at DESC LIMIT $${paramCount}`;
    values.push(limit);

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToRun(row));
    } catch (error) {
      throw new Error(`Failed to get recent runs: ${error.message}`);
    }
  }

  /**
   * Start a new sync run
   */
  async startRun(
    jobId: string,
    runType: RunType,
    entitiesProcessed: string[] = []
  ): Promise<SyncRunHistory> {
    const runData: Omit<SyncRunHistory, 'id' | 'created_at'> = {
      job_id: jobId,
      run_type: runType,
      started_at: new Date(),
      completed_at: undefined,
      records_synced: 0,
      records_failed: 0,
      status: RunStatus.RUNNING,
      error_summary: undefined,
      performance_metrics: {},
      entities_processed: entitiesProcessed
    };

    return this.create(runData);
  }

  /**
   * Complete a sync run
   */
  async completeRun(
    runId: string,
    recordsSynced: number,
    recordsFailed: number,
    performanceMetrics: Record<string, any> = {},
    errorSummary?: string
  ): Promise<SyncRunHistory> {
    const status = recordsFailed > 0 ? RunStatus.FAILED : RunStatus.COMPLETED;

    return this.update(runId, {
      completed_at: new Date(),
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      status,
      error_summary: errorSummary,
      performance_metrics: performanceMetrics
    });
  }

  /**
   * Cancel a running sync
   */
  async cancelRun(runId: string, reason?: string): Promise<SyncRunHistory> {
    return this.update(runId, {
      completed_at: new Date(),
      status: RunStatus.CANCELLED,
      error_summary: reason || 'Cancelled by user'
    });
  }

  /**
   * Get run summaries for a job
   */
  async getRunSummaries(jobId: string, limit: number = 10): Promise<SyncRunSummary[]> {
    const runs = await this.findByJobId(jobId, limit);

    return runs.map(run => ({
      runId: run.id,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      recordsSynced: run.records_synced,
      status: run.status
    }));
  }

  /**
   * Get performance metrics for analysis
   */
  async getPerformanceMetrics(
    jobId?: string,
    timeRangeDays: number = 30
  ): Promise<any> {
    let query = `
      SELECT
        job_id,
        run_type,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms,
        AVG(records_synced) as avg_records_synced,
        AVG(records_failed) as avg_records_failed,
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_runs
      FROM sync_run_history
      WHERE completed_at IS NOT NULL
        AND started_at > NOW() - INTERVAL '${timeRangeDays} days'
    `;
    const values: any[] = [];

    if (jobId) {
      query += ' AND job_id = $1';
      values.push(jobId);
    }

    query += ' GROUP BY job_id, run_type ORDER BY job_id, run_type';

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => ({
        job_id: row.job_id,
        run_type: row.run_type,
        avg_duration_ms: Math.round(parseFloat(row.avg_duration_ms || '0')),
        avg_records_synced: Math.round(parseFloat(row.avg_records_synced || '0')),
        avg_records_failed: Math.round(parseFloat(row.avg_records_failed || '0')),
        total_runs: parseInt(row.total_runs),
        successful_runs: parseInt(row.successful_runs),
        failed_runs: parseInt(row.failed_runs),
        success_rate: (parseInt(row.successful_runs) / parseInt(row.total_runs)) * 100
      }));
    } catch (error) {
      throw new Error(`Failed to get performance metrics: ${error.message}`);
    }
  }

  /**
   * Get recent activity for dashboard
   */
  async getRecentActivity(limit: number = 20): Promise<any[]> {
    const query = `
      SELECT
        srh.id,
        srh.job_id,
        sj.job_name,
        srh.run_type,
        srh.started_at,
        srh.completed_at,
        srh.records_synced,
        srh.records_failed,
        srh.status,
        EXTRACT(EPOCH FROM (srh.completed_at - srh.started_at)) * 1000 as duration_ms
      FROM sync_run_history srh
      JOIN synchronization_jobs sj ON srh.job_id = sj.id
      WHERE srh.started_at > NOW() - INTERVAL '7 days'
      ORDER BY srh.started_at DESC
      LIMIT $1
    `;

    try {
      const result = await this.db.query(query, [limit]);
      return result.rows.map(row => ({
        run_id: row.id,
        job_id: row.job_id,
        job_name: row.job_name,
        run_type: row.run_type,
        started_at: row.started_at,
        completed_at: row.completed_at,
        records_synced: parseInt(row.records_synced),
        records_failed: parseInt(row.records_failed),
        status: row.status,
        duration_ms: row.duration_ms ? Math.round(parseFloat(row.duration_ms)) : null
      }));
    } catch (error) {
      throw new Error(`Failed to get recent activity: ${error.message}`);
    }
  }

  /**
   * Get failure analysis
   */
  async getFailureAnalysis(jobId?: string, timeRangeDays: number = 7): Promise<any> {
    let query = `
      SELECT
        job_id,
        error_summary,
        COUNT(*) as failure_count,
        MAX(started_at) as last_failure,
        AVG(records_synced) as avg_records_before_failure
      FROM sync_run_history
      WHERE status = 'failed'
        AND started_at > NOW() - INTERVAL '${timeRangeDays} days'
    `;
    const values: any[] = [];

    if (jobId) {
      query += ' AND job_id = $1';
      values.push(jobId);
    }

    query += ' GROUP BY job_id, error_summary ORDER BY last_failure DESC';

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => ({
        job_id: row.job_id,
        error_summary: row.error_summary,
        failure_count: parseInt(row.failure_count),
        last_failure: row.last_failure,
        avg_records_before_failure: Math.round(parseFloat(row.avg_records_before_failure || '0'))
      }));
    } catch (error) {
      throw new Error(`Failed to get failure analysis: ${error.message}`);
    }
  }

  /**
   * Cleanup old run history
   */
  async cleanup(olderThanDays: number = 60): Promise<number> {
    const query = `
      DELETE FROM sync_run_history
      WHERE completed_at < NOW() - INTERVAL '${olderThanDays} days'
        OR (completed_at IS NULL AND started_at < NOW() - INTERVAL '1 day')
    `;

    try {
      const result = await this.db.query(query);
      return result.rowCount;
    } catch (error) {
      throw new Error(`Failed to cleanup run history: ${error.message}`);
    }
  }

  /**
   * Get daily sync statistics
   */
  async getDailyStatistics(days: number = 7): Promise<any[]> {
    const query = `
      SELECT
        DATE(started_at) as sync_date,
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
        SUM(records_synced) as total_records_synced,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms
      FROM sync_run_history
      WHERE started_at >= NOW() - INTERVAL '${days} days'
        AND completed_at IS NOT NULL
      GROUP BY DATE(started_at)
      ORDER BY sync_date DESC
    `;

    try {
      const result = await this.db.query(query);
      return result.rows.map(row => ({
        sync_date: row.sync_date,
        total_runs: parseInt(row.total_runs),
        successful_runs: parseInt(row.successful_runs),
        failed_runs: parseInt(row.failed_runs),
        total_records_synced: parseInt(row.total_records_synced || '0'),
        avg_duration_ms: row.avg_duration_ms ? Math.round(parseFloat(row.avg_duration_ms)) : 0,
        success_rate: (parseInt(row.successful_runs) / parseInt(row.total_runs)) * 100
      }));
    } catch (error) {
      throw new Error(`Failed to get daily statistics: ${error.message}`);
    }
  }

  /**
   * Get the last successful run for a job
   */
  async getLastSuccessfulRun(jobId: string): Promise<SyncRunHistory | null> {
    const query = `
      SELECT * FROM sync_run_history
      WHERE job_id = $1 AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `;

    try {
      const result = await this.db.query(query, [jobId]);
      return result.rows.length > 0 ? this.mapRowToRun(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to get last successful run: ${error.message}`);
    }
  }

  /**
   * Get running/active sync operations
   */
  async getActiveSyncs(): Promise<SyncRunHistory[]> {
    const query = `
      SELECT * FROM sync_run_history
      WHERE status = 'running'
        AND started_at > NOW() - INTERVAL '4 hours'
      ORDER BY started_at DESC
    `;

    try {
      const result = await this.db.query(query);
      return result.rows.map(row => this.mapRowToRun(row));
    } catch (error) {
      throw new Error(`Failed to get active syncs: ${error.message}`);
    }
  }

  /**
   * Update performance metrics for a run
   */
  async updatePerformanceMetrics(
    runId: string,
    metrics: Record<string, any>
  ): Promise<SyncRunHistory> {
    return this.update(runId, {
      performance_metrics: metrics
    });
  }

  /**
   * Record run progress (for long-running operations)
   */
  async recordProgress(
    runId: string,
    recordsProcessed: number,
    entitiesCompleted: string[],
    currentEntity?: string
  ): Promise<SyncRunHistory> {
    const metrics = {
      records_processed: recordsProcessed,
      entities_completed: entitiesCompleted,
      current_entity: currentEntity,
      progress_updated_at: new Date()
    };

    return this.update(runId, {
      records_synced: recordsProcessed,
      performance_metrics: metrics
    });
  }

  /**
   * Get performance trends for monitoring
   */
  async getPerformanceTrends(
    jobId?: string,
    timeRangeDays: number = 30
  ): Promise<any[]> {
    let query = `
      SELECT
        DATE_TRUNC('day', started_at) as trend_date,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms,
        AVG(records_synced::float / EXTRACT(EPOCH FROM (completed_at - started_at))) as records_per_second,
        COUNT(*) as runs_count,
        SUM(records_synced) as total_records
      FROM sync_run_history
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND started_at >= NOW() - INTERVAL '${timeRangeDays} days'
    `;
    const values: any[] = [];

    if (jobId) {
      query += ' AND job_id = $1';
      values.push(jobId);
    }

    query += `
      GROUP BY DATE_TRUNC('day', started_at)
      ORDER BY trend_date DESC
    `;

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => ({
        date: row.trend_date,
        avg_duration_ms: row.avg_duration_ms ? Math.round(parseFloat(row.avg_duration_ms)) : 0,
        records_per_second: row.records_per_second ? Math.round(parseFloat(row.records_per_second)) : 0,
        runs_count: parseInt(row.runs_count),
        total_records: parseInt(row.total_records || '0')
      }));
    } catch (error) {
      throw new Error(`Failed to get performance trends: ${error.message}`);
    }
  }

  /**
   * Map database row to SyncRunHistory object
   */
  private mapRowToRun(row: any): SyncRunHistory {
    return {
      id: row.id,
      job_id: row.job_id,
      run_type: row.run_type as RunType,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      records_synced: parseInt(row.records_synced),
      records_failed: parseInt(row.records_failed),
      status: row.status as RunStatus,
      error_summary: row.error_summary,
      performance_metrics: typeof row.performance_metrics === 'string'
        ? JSON.parse(row.performance_metrics)
        : row.performance_metrics,
      entities_processed: typeof row.entities_processed === 'string'
        ? JSON.parse(row.entities_processed)
        : row.entities_processed,
      created_at: new Date(row.created_at)
    };
  }
}
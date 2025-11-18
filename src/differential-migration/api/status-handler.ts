/**
 * Status and Control API Handler
 * Implements GET /api/migration/status/{sessionId} and control endpoints
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { ProgressTracker, type ProgressSnapshot, type ProgressAlert, type PerformanceMetrics } from '../services/progress-tracker';
import { MigrationExecutor } from '../services/migration-executor';
import { v4 as uuidv4 } from 'uuid';

// Request/Response interfaces
export interface MigrationStatusResponse {
  success: boolean;
  data?: {
    sessionId: string;
    overallStatus: 'RUNNING' | 'COMPLETED' | 'PAUSED' | 'FAILED' | 'STARTING';
    overallProgress: {
      percentage: number;
      recordsProcessed: number;
      totalRecords: number;
      recordsRemaining: number;
    };
    entities: Array<{
      entityType: string;
      status: string;
      progress: number;
      recordsProcessed: number;
      totalRecords: number;
      throughput: number;
      elapsedTime: string;
      remainingTime?: string;
      estimatedCompletion?: string;
      currentBatch?: {
        batchNumber: number;
        batchSize: number;
        batchProgress: number;
      };
    }>;
    performance: {
      averageThroughput: number;
      peakThroughput: number;
      totalMemoryUsage: number;
      averageMemoryUsage: number;
      totalElapsedTime: number;
      estimatedTotalCompletion?: string;
    };
    performanceMetrics?: {
      throughput: {
        current: number;
        average: number;
        peak: number;
        minimum: number;
      };
      efficiency: {
        cpuEfficiency: number;
        memoryEfficiency: number;
        overallScore: number;
      };
      timing: {
        averageBatchTimeMs: number;
        fastestBatchMs: number;
        slowestBatchMs: number;
      };
    };
    alerts: Array<{
      alertId: string;
      severity: 'debug' | 'info' | 'warning' | 'error';
      type: string;
      entityType?: string;
      message: string;
      timestamp: string;
      age: string;
    }>;
    lastUpdate: string;
    recommendations?: string[];
  };
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    retryable?: boolean;
    retryAfter?: number;
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
    refreshInterval?: number;
  };
}

export interface SessionListResponse {
  success: boolean;
  data: {
    sessions: Array<{
      sessionId: string;
      status: string;
      startTime: string;
      lastUpdate: string;
      progress: {
        percentage: number;
        entitiesActive: number;
        entitiesCompleted: number;
        totalEntities: number;
      };
      statusUrl: string;
    }>;
    meta: {
      totalSessions: number;
      activeSessions: number;
      pausedSessions: number;
      completedSessions: number;
      message?: string;
    };
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
  };
}

export interface ControlActionResponse {
  success: boolean;
  data?: {
    sessionId: string;
    action: 'pause' | 'resume';
    status: string;
    checkpointId?: string;
    resumedFromBatch?: number;
    pausedAt?: string;
    resumedAt?: string;
    message: string;
    statusUrl?: string;
    resumeInstructions?: {
      endpoint: string;
      method: string;
      description: string;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    retryable?: boolean;
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
  };
}

/**
 * StatusHandler Implementation
 *
 * Provides REST API endpoints for migration status monitoring and control
 * operations with real-time updates and comprehensive error handling.
 */
export class StatusHandler {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private progressTracker: ProgressTracker | null = null;
  private migrationExecutor: MigrationExecutor | null = null;

  constructor(sourcePool: Pool, destinationPool: Pool) {
    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
  }

  /**
   * Handles GET /api/migration/status/{sessionId} requests
   */
  async handleGetStatus(req: Request, res: Response): Promise<void> {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();
    const sessionId = req.params.sessionId;

    try {
      // Validate session ID format
      if (!sessionId || !this.isValidUUID(sessionId)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SESSION_ID',
            message: 'Invalid session ID format',
            details: {
              providedId: sessionId,
              expectedFormat: 'UUID v4 (e.g., 550e8400-e29b-41d4-a716-446655440000)'
            }
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      // Initialize services
      await this.initializeServices();

      // Get progress data for session
      const progressData = await this.getSessionProgress(sessionId);
      if (progressData.length === 0) {
        res.status(404).json({
          success: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Migration session not found: ${sessionId}`,
            details: {
              sessionId,
              suggestions: [
                'Verify the session ID is correct',
                'Check if the migration has expired or been cleaned up',
                'Use GET /api/migration/sessions to list active sessions'
              ]
            }
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      // Get alerts for session
      const alerts = await this.progressTracker!.getActiveAlerts();

      // Check for Server-Sent Events request
      if (req.headers.accept === 'text/event-stream') {
        await this.handleSSEConnection(req, res, sessionId);
        return;
      }

      // Format and send JSON response
      const response = this.formatStatusResponse(progressData, alerts, sessionId, requestId, timestamp, req.query.verbose === 'true');
      res.status(200).json(response);

    } catch (error) {
      const errorResponse = this.formatStatusErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Handles GET /api/migration/sessions requests
   */
  async handleListSessions(req: Request, res: Response): Promise<void> {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    try {
      // Initialize services
      await this.initializeServices();

      // Get all progress data
      const allProgress = await this.progressTracker!.getAllProgress();

      if (allProgress.length === 0) {
        res.status(200).json({
          success: true,
          data: {
            sessions: [],
            meta: {
              totalSessions: 0,
              message: 'No active migration sessions found'
            }
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      // Group by session and build summaries
      const sessionGroups = this.groupProgressBySession(allProgress);
      const sessions = Array.from(sessionGroups.entries()).map(([sessionId, progressList]) => {
        const totalRecords = progressList.reduce((sum, p) => sum + p.progress.totalRecords, 0);
        const recordsProcessed = progressList.reduce((sum, p) => sum + p.progress.recordsProcessed, 0);
        const progressPercentage = totalRecords > 0 ? Math.round((recordsProcessed / totalRecords) * 100) : 0;

        const entitiesActive = progressList.filter(p => p.status === 'running').length;
        const entitiesCompleted = progressList.filter(p => p.status === 'completed').length;
        const totalEntities = progressList.length;

        return {
          sessionId,
          status: this.determineSessionStatus(progressList),
          startTime: new Date(Math.min(...progressList.map(p => p.timing.startTime.getTime()))).toISOString(),
          lastUpdate: new Date(Math.max(...progressList.map(p => p.timestamp.getTime()))).toISOString(),
          progress: {
            percentage: progressPercentage,
            entitiesActive,
            entitiesCompleted,
            totalEntities
          },
          statusUrl: `/api/migration/status/${sessionId}`
        };
      });

      const response: SessionListResponse = {
        success: true,
        data: {
          sessions,
          meta: {
            totalSessions: sessions.length,
            activeSessions: sessions.filter(s => s.status === 'running').length,
            pausedSessions: sessions.filter(s => s.status === 'paused').length,
            completedSessions: sessions.filter(s => s.status === 'completed').length
          }
        },
        meta: {
          apiVersion: '1.0.0',
          requestId,
          timestamp
        }
      };

      res.status(200).json(response);

    } catch (error) {
      const errorResponse = this.formatStatusErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Handles POST /api/migration/pause/{sessionId} requests
   */
  async handlePauseMigration(req: Request, res: Response): Promise<void> {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();
    const sessionId = req.params.sessionId;

    try {
      // Validate session ID
      if (!sessionId || !this.isValidUUID(sessionId)) {
        res.status(400).json(this.createControlErrorResponse(
          'INVALID_SESSION_ID',
          'Invalid session ID format',
          requestId,
          timestamp
        ));
        return;
      }

      // Initialize services
      await this.initializeServices();

      // Check session exists and is running
      const progressData = await this.getSessionProgress(sessionId);
      if (progressData.length === 0) {
        res.status(404).json(this.createControlErrorResponse(
          'SESSION_NOT_FOUND',
          `Migration session not found: ${sessionId}`,
          requestId,
          timestamp
        ));
        return;
      }

      const sessionStatus = this.determineSessionStatus(progressData);
      if (sessionStatus === 'paused') {
        res.status(200).json({
          success: true,
          data: {
            sessionId,
            action: 'pause' as const,
            status: 'paused',
            message: 'Session is already paused'
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      if (sessionStatus !== 'running') {
        res.status(409).json(this.createControlErrorResponse(
          'INVALID_STATE_TRANSITION',
          'Cannot pause migration in current state',
          requestId,
          timestamp,
          {
            currentStatus: sessionStatus,
            allowedStates: ['running'],
            action: 'pause'
          }
        ));
        return;
      }

      // Execute pause
      if (!this.migrationExecutor) {
        throw new Error('Migration executor not initialized');
      }

      const result = await this.migrationExecutor.pauseExecution();

      if (result.success) {
        const response: ControlActionResponse = {
          success: true,
          data: {
            sessionId,
            action: 'pause',
            status: 'paused',
            checkpointId: result.checkpointId,
            pausedAt: timestamp,
            message: 'Migration paused successfully',
            resumeInstructions: {
              endpoint: `/api/migration/resume/${sessionId}`,
              method: 'POST',
              description: 'Use this endpoint to resume the migration from the current checkpoint'
            }
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        };

        res.status(200).json(response);
      } else {
        res.status(500).json(this.createControlErrorResponse(
          'PAUSE_FAILED',
          'Failed to pause migration',
          requestId,
          timestamp
        ));
      }

    } catch (error) {
      const errorResponse = this.formatStatusErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Handles POST /api/migration/resume/{sessionId} requests
   */
  async handleResumeMigration(req: Request, res: Response): Promise<void> {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();
    const sessionId = req.params.sessionId;

    try {
      // Validate session ID
      if (!sessionId || !this.isValidUUID(sessionId)) {
        res.status(400).json(this.createControlErrorResponse(
          'INVALID_SESSION_ID',
          'Invalid session ID format',
          requestId,
          timestamp
        ));
        return;
      }

      // Initialize services
      await this.initializeServices();

      // Check session exists and is paused
      const progressData = await this.getSessionProgress(sessionId);
      if (progressData.length === 0) {
        res.status(404).json(this.createControlErrorResponse(
          'SESSION_NOT_FOUND',
          `Migration session not found: ${sessionId}`,
          requestId,
          timestamp
        ));
        return;
      }

      const sessionStatus = this.determineSessionStatus(progressData);
      if (sessionStatus === 'running') {
        res.status(200).json({
          success: true,
          data: {
            sessionId,
            action: 'resume' as const,
            status: 'running',
            message: 'Session is already running'
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      if (sessionStatus !== 'paused') {
        res.status(409).json(this.createControlErrorResponse(
          'INVALID_STATE_TRANSITION',
          'Cannot resume migration in current state',
          requestId,
          timestamp,
          {
            currentStatus: sessionStatus,
            allowedStates: ['paused'],
            action: 'resume'
          }
        ));
        return;
      }

      // Find checkpoint for resumption
      const checkpointId = await this.findLatestCheckpoint(sessionId);
      if (!checkpointId) {
        res.status(500).json(this.createControlErrorResponse(
          'CHECKPOINT_NOT_FOUND',
          'Cannot resume migration without valid checkpoint',
          requestId,
          timestamp
        ));
        return;
      }

      // Execute resume
      if (!this.migrationExecutor) {
        throw new Error('Migration executor not initialized');
      }

      const result = await this.migrationExecutor.resumeExecution(checkpointId);

      if (result.success) {
        const response: ControlActionResponse = {
          success: true,
          data: {
            sessionId,
            action: 'resume',
            status: 'running',
            resumedFromBatch: result.resumedFromBatch,
            resumedAt: timestamp,
            message: 'Migration resumed successfully',
            statusUrl: `/api/migration/status/${sessionId}`
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        };

        res.status(200).json(response);
      } else {
        res.status(500).json(this.createControlErrorResponse(
          'RESUME_FAILED',
          'Failed to resume migration',
          requestId,
          timestamp
        ));
      }

    } catch (error) {
      const errorResponse = this.formatStatusErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Handles Server-Sent Events connection for real-time updates
   */
  private async handleSSEConnection(req: Request, res: Response, sessionId: string): Promise<void> {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      sessionId,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Subscribe to real-time updates
    let unsubscribe: (() => void) | null = null;
    if (this.progressTracker) {
      unsubscribe = this.progressTracker.subscribeToUpdates((update) => {
        if (update.sessionId === sessionId) {
          const sseData = {
            type: update.updateType,
            sessionId: update.sessionId,
            entityType: update.entityType,
            data: update.data,
            timestamp: update.timestamp.toISOString()
          };

          res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        }
      });
    }

    // Handle client disconnect
    req.on('close', () => {
      if (unsubscribe) {
        unsubscribe();
      }
      res.end();
    });

    // Send periodic heartbeat
    const heartbeatInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      })}\n\n`);
    }, 30000); // Every 30 seconds

    // Clean up on connection close
    req.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  }

  /**
   * Gets progress data for a specific session
   */
  private async getSessionProgress(sessionId: string): Promise<ProgressSnapshot[]> {
    if (!this.progressTracker) {
      throw new Error('Progress tracker not initialized');
    }

    const allProgress = await this.progressTracker.getAllProgress();
    return allProgress.filter(p => p.sessionId === sessionId);
  }

  /**
   * Formats status response
   */
  private formatStatusResponse(
    progressData: ProgressSnapshot[],
    alerts: ProgressAlert[],
    sessionId: string,
    requestId: string,
    timestamp: string,
    verbose: boolean
  ): MigrationStatusResponse {
    // Calculate overall progress
    const totalRecords = progressData.reduce((sum, p) => sum + p.progress.totalRecords, 0);
    const recordsProcessed = progressData.reduce((sum, p) => sum + p.progress.recordsProcessed, 0);
    const recordsRemaining = totalRecords - recordsProcessed;
    const overallPercentage = totalRecords > 0 ? Math.round((recordsProcessed / totalRecords) * 100) : 0;

    // Determine overall status
    const overallStatus = this.determineSessionStatus(progressData);

    // Format entity details
    const entities = progressData.map(p => ({
      entityType: p.entityType,
      status: this.getStatusText(p.status),
      progress: Math.round(p.progress.percentageComplete),
      recordsProcessed: p.progress.recordsProcessed,
      totalRecords: p.progress.totalRecords,
      throughput: p.performance.recordsPerSecond,
      elapsedTime: this.formatDuration(p.timing.elapsedTimeMs),
      remainingTime: p.timing.remainingTimeMs ? this.formatDuration(p.timing.remainingTimeMs) : undefined,
      estimatedCompletion: p.timing.estimatedCompletionTime?.toISOString(),
      currentBatch: {
        batchNumber: p.currentBatch.batchNumber,
        batchSize: p.currentBatch.batchSize,
        batchProgress: Math.round(p.currentBatch.batchProgress * 100)
      }
    }));

    // Calculate performance metrics
    const activeSessions = progressData.filter(p => p.status === 'running');
    const averageThroughput = activeSessions.length > 0
      ? Math.round(activeSessions.reduce((sum, p) => sum + p.performance.recordsPerSecond, 0) / activeSessions.length)
      : 0;
    const peakThroughput = Math.max(...progressData.map(p => p.performance.recordsPerSecond));
    const totalMemoryUsage = progressData.reduce((sum, p) => sum + p.performance.memoryUsageMb, 0);
    const averageMemoryUsage = Math.round(totalMemoryUsage / progressData.length);
    const totalElapsedTime = progressData.reduce((sum, p) => sum + p.timing.elapsedTimeMs, 0);

    // Format alerts
    const formattedAlerts = alerts.slice(0, 10).map(alert => ({
      alertId: alert.alertId,
      severity: alert.severity,
      type: alert.type,
      entityType: alert.entityType,
      message: alert.message,
      timestamp: alert.timestamp.toISOString(),
      age: this.calculateAge(alert.timestamp)
    }));

    // Build response
    const data: MigrationStatusResponse['data'] = {
      sessionId,
      overallStatus,
      overallProgress: {
        percentage: overallPercentage,
        recordsProcessed,
        totalRecords,
        recordsRemaining
      },
      entities,
      performance: {
        averageThroughput,
        peakThroughput,
        totalMemoryUsage,
        averageMemoryUsage,
        totalElapsedTime,
        estimatedTotalCompletion: this.calculateEstimatedCompletion(progressData)
      },
      alerts: formattedAlerts,
      lastUpdate: new Date(Math.max(...progressData.map(p => p.timestamp.getTime()))).toISOString()
    };

    // Include detailed metrics if verbose
    if (verbose && this.progressTracker) {
      const performanceMetrics = await this.progressTracker.calculatePerformanceMetrics('overall');
      data.performanceMetrics = {
        throughput: performanceMetrics.throughput,
        efficiency: {
          cpuEfficiency: Math.round(performanceMetrics.efficiency.cpuEfficiency * 100),
          memoryEfficiency: Math.round(performanceMetrics.efficiency.memoryEfficiency * 100),
          overallScore: performanceMetrics.efficiency.overallScore
        },
        timing: performanceMetrics.timing
      };
    }

    // Add recommendations based on status
    data.recommendations = this.generateStatusRecommendations(progressData, alerts);

    return {
      success: true,
      data,
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp,
        refreshInterval: 5000
      }
    };
  }

  /**
   * Initialize required services
   */
  private async initializeServices(): Promise<void> {
    if (!this.progressTracker) {
      this.progressTracker = new ProgressTracker(
        this.sourcePool,
        this.destinationPool,
        uuidv4()
      );
    }

    if (!this.migrationExecutor) {
      this.migrationExecutor = new MigrationExecutor(
        this.sourcePool,
        this.destinationPool,
        uuidv4(),
        {
          batchSize: 1000,
          maxRetryAttempts: 3,
          checkpointInterval: 10,
          parallelEntityLimit: 3,
          timeoutMs: 300000,
          enableValidation: true
        }
      );
    }
  }

  /**
   * Helper methods
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private determineSessionStatus(progressData: ProgressSnapshot[]): MigrationStatusResponse['data']['overallStatus'] {
    if (progressData.every(p => p.status === 'completed')) return 'COMPLETED';
    if (progressData.some(p => p.status === 'failed')) return 'FAILED';
    if (progressData.some(p => p.status === 'paused')) return 'PAUSED';
    if (progressData.some(p => p.status === 'running')) return 'RUNNING';
    return 'STARTING';
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'completed': return 'completed';
      case 'running': return 'running';
      case 'paused': return 'paused';
      case 'failed': return 'failed';
      case 'starting': return 'starting';
      default: return 'unknown';
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private calculateAge(timestamp: Date): string {
    const ageMs = Date.now() - timestamp.getTime();
    const ageMinutes = Math.floor(ageMs / 60000);

    if (ageMinutes < 1) return 'just now';
    if (ageMinutes < 60) return `${ageMinutes}m ago`;
    const ageHours = Math.floor(ageMinutes / 60);
    return `${ageHours}h ${ageMinutes % 60}m ago`;
  }

  private calculateEstimatedCompletion(progressData: ProgressSnapshot[]): string | undefined {
    const runningEntities = progressData.filter(p => p.status === 'running' && p.timing.estimatedCompletionTime);
    if (runningEntities.length === 0) return undefined;

    const latestCompletion = Math.max(
      ...runningEntities.map(p => p.timing.estimatedCompletionTime!.getTime())
    );
    return new Date(latestCompletion).toISOString();
  }

  private groupProgressBySession(progressData: ProgressSnapshot[]): Map<string, ProgressSnapshot[]> {
    const sessions = new Map<string, ProgressSnapshot[]>();
    for (const progress of progressData) {
      if (!sessions.has(progress.sessionId)) {
        sessions.set(progress.sessionId, []);
      }
      sessions.get(progress.sessionId)!.push(progress);
    }
    return sessions;
  }

  private async findLatestCheckpoint(sessionId: string): Promise<string | null> {
    // In real implementation, query database for latest checkpoint
    return `checkpoint_${sessionId}_${Date.now()}`;
  }

  private generateStatusRecommendations(progressData: ProgressSnapshot[], alerts: ProgressAlert[]): string[] {
    const recommendations: string[] = [];
    const overallStatus = this.determineSessionStatus(progressData);

    switch (overallStatus) {
      case 'RUNNING':
        recommendations.push('Migration is progressing normally');
        if (alerts.some(a => a.severity === 'warning')) {
          recommendations.push('Monitor warnings for potential performance issues');
        }
        break;
      case 'PAUSED':
        recommendations.push('Migration is paused - use resume endpoint to continue');
        break;
      case 'FAILED':
        recommendations.push('Review error logs and fix issues before retrying');
        break;
      case 'COMPLETED':
        recommendations.push('Migration completed successfully');
        break;
      default:
        recommendations.push('Check migration logs for detailed information');
    }

    return recommendations;
  }

  private createControlErrorResponse(
    code: string,
    message: string,
    requestId: string,
    timestamp: string,
    details?: any
  ): ControlActionResponse {
    return {
      success: false,
      error: {
        code,
        message,
        details,
        timestamp,
        retryable: ['SESSION_NOT_FOUND', 'INVALID_SESSION_ID'].includes(code) ? false : true
      },
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp
      }
    };
  }

  private formatStatusErrorResponse(error: any, requestId: string, timestamp: string): {
    status: number;
    body: MigrationStatusResponse;
  } {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    let code: string;
    let status: number;

    if (errorMessage.includes('connection')) {
      code = 'SERVICE_UNAVAILABLE';
      status = 503;
    } else if (errorMessage.includes('timeout')) {
      code = 'REQUEST_TIMEOUT';
      status = 504;
    } else {
      code = 'STATUS_CHECK_FAILED';
      status = 500;
    }

    return {
      status,
      body: {
        success: false,
        error: {
          code,
          message: 'Status service temporarily unavailable',
          details: errorMessage,
          retryable: true,
          retryAfter: status === 503 ? 60 : undefined
        },
        meta: {
          apiVersion: '1.0.0',
          requestId,
          timestamp
        }
      }
    };
  }
}

/**
 * Factory function for creating status handler with database pools
 */
export function createStatusHandler(sourcePool: Pool, destinationPool: Pool): StatusHandler {
  return new StatusHandler(sourcePool, destinationPool);
}

/**
 * Express route handler functions
 */

export async function getStatusRoute(req: Request, res: Response): Promise<void> {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD
  });

  const destinationPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  const handler = new StatusHandler(sourcePool, destinationPool);

  try {
    await handler.handleGetStatus(req, res);
  } finally {
    await sourcePool.end();
    await destinationPool.end();
  }
}

export async function pauseMigrationRoute(req: Request, res: Response): Promise<void> {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD
  });

  const destinationPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  const handler = new StatusHandler(sourcePool, destinationPool);

  try {
    await handler.handlePauseMigration(req, res);
  } finally {
    await sourcePool.end();
    await destinationPool.end();
  }
}

export async function resumeMigrationRoute(req: Request, res: Response): Promise<void> {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD
  });

  const destinationPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  const handler = new StatusHandler(sourcePool, destinationPool);

  try {
    await handler.handleResumeMigration(req, res);
  } finally {
    await sourcePool.end();
    await destinationPool.end();
  }
}

export async function listSessionsRoute(req: Request, res: Response): Promise<void> {
  const sourcePool = new Pool({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD
  });

  const destinationPool = new Pool({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '54322'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD
  });

  const handler = new StatusHandler(sourcePool, destinationPool);

  try {
    await handler.handleListSessions(req, res);
  } finally {
    await sourcePool.end();
    await destinationPool.end();
  }
}
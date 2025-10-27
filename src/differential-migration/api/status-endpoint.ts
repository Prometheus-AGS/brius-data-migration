/**
 * Status and Control API Endpoints
 *
 * Implements GET /api/migration/status/{sessionId} and control endpoints
 * (pause, resume) with real-time monitoring capabilities
 */

import { Request, Response } from 'express';
import { Pool, PoolConfig } from 'pg';
import { ProgressTracker } from '../services/progress-tracker';
import { MigrationExecutor } from '../services/migration-executor';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Response interfaces matching OpenAPI schema
interface MigrationStatusResponse {
  sessionId: string;
  overallStatus: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  entitiesPending: string[];
  entitiesRunning: string[];
  entitiesCompleted: string[];
  entitiesFailed: string[];
  totalRecordsProcessed: number;
  totalRecordsRemaining: number;
  progressPercentage: number;
  estimatedCompletion?: string;
  performanceMetrics: PerformanceMetrics;
  errors: MigrationError[];
}

interface PerformanceMetrics {
  recordsPerSecond: number;
  averageBatchTime: number;
  memoryUsage: number;
  connectionPoolStatus: {
    sourceConnections: number;
    destinationConnections: number;
    activeQueries: number;
  };
}

interface MigrationError {
  entityType: string;
  errorType: 'connection' | 'validation' | 'transformation' | 'constraint';
  message: string;
  recordId?: string;
  timestamp: string;
  retryable: boolean;
}

interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    requestId: string;
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
  };
}

// Database configuration
const sourceDbConfig: PoolConfig = {
  host: process.env.SOURCE_DB_HOST || 'localhost',
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME || 'source_db',
  user: process.env.SOURCE_DB_USER || 'postgres',
  password: process.env.SOURCE_DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

const destinationDbConfig: PoolConfig = {
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '54322'),
  database: process.env.TARGET_DB_NAME || 'postgres',
  user: process.env.TARGET_DB_USER || 'postgres',
  password: process.env.TARGET_DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

// Session management (in production, would use Redis or database)
const sessionTrackers = new Map<string, ProgressTracker>();
const sessionExecutors = new Map<string, MigrationExecutor>();

/**
 * Validate session ID format
 */
function validateSessionId(sessionId: string): { isValid: boolean; error?: string } {
  if (!sessionId) {
    return { isValid: false, error: 'Session ID is required' };
  }

  if (!sessionId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return { isValid: false, error: 'Session ID must be a valid UUID' };
  }

  return { isValid: true };
}

/**
 * Get or create progress tracker for session
 */
async function getProgressTracker(sessionId: string): Promise<ProgressTracker | null> {
  if (!sessionTrackers.has(sessionId)) {
    // In a full implementation, this would restore tracker state from persistence
    // For now, return null if session not found
    return null;
  }

  return sessionTrackers.get(sessionId)!;
}

/**
 * Create standardized API response
 */
function createAPIResponse<T>(
  success: boolean,
  data?: T,
  error?: { code: string; message: string; details?: any },
  requestId: string = crypto.randomUUID()
): APIResponse<T> {
  const timestamp = new Date().toISOString();

  return {
    success,
    data,
    error: error ? {
      ...error,
      timestamp,
      requestId
    } : undefined,
    meta: {
      apiVersion: '1.0.0',
      requestId,
      timestamp
    }
  };
}

/**
 * GET /api/migration/status/{sessionId}
 * Retrieve current status of migration session
 */
export async function handleGetMigrationStatus(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;

  try {
    // Validate session ID
    const validation = validateSessionId(sessionId);
    if (!validation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: validation.error!,
          details: {
            providedId: sessionId,
            expectedFormat: 'UUID v4 (e.g., 550e8400-e29b-41d4-a716-446655440000)'
          }
        },
        requestId
      ));
      return;
    }

    // Get progress tracker
    const progressTracker = await getProgressTracker(sessionId);
    if (!progressTracker) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
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
        requestId
      ));
      return;
    }

    // Get all progress data
    const allProgress = await progressTracker.getAllProgress();
    const activeAlerts = await progressTracker.getActiveAlerts();

    // Calculate overall status
    const entityStatuses = allProgress.map(p => p.status);
    const overallStatus = entityStatuses.every(s => s === 'completed') ? 'completed' :
                          entityStatuses.some(s => s === 'failed') ? 'failed' :
                          entityStatuses.some(s => s === 'paused') ? 'paused' :
                          entityStatuses.some(s => s === 'running') ? 'running' : 'pending';

    // Categorize entities by status
    const entitiesPending = allProgress.filter(p => p.status === 'pending').map(p => p.entityType);
    const entitiesRunning = allProgress.filter(p => p.status === 'running').map(p => p.entityType);
    const entitiesCompleted = allProgress.filter(p => p.status === 'completed').map(p => p.entityType);
    const entitiesFailed = allProgress.filter(p => p.status === 'failed').map(p => p.entityType);

    // Calculate aggregated metrics
    const totalRecordsProcessed = allProgress.reduce((sum, p) => sum + p.progress.recordsProcessed, 0);
    const totalRecordsRemaining = allProgress.reduce((sum, p) => sum + p.progress.recordsRemaining, 0);
    const totalRecords = totalRecordsProcessed + totalRecordsRemaining;
    const progressPercentage = totalRecords > 0 ? (totalRecordsProcessed / totalRecords) * 100 : 0;

    // Calculate performance metrics
    const performanceMetrics: PerformanceMetrics = {
      recordsPerSecond: allProgress.reduce((sum, p) => sum + p.performance.recordsPerSecond, 0) / Math.max(1, allProgress.length),
      averageBatchTime: allProgress.reduce((sum, p) => sum + p.performance.averageBatchTimeMs, 0) / Math.max(1, allProgress.length),
      memoryUsage: allProgress.reduce((sum, p) => sum + p.performance.memoryUsageMb, 0),
      connectionPoolStatus: {
        sourceConnections: 10, // Would be retrieved from actual pool status
        destinationConnections: 8,
        activeQueries: entitiesRunning.length
      }
    };

    // Transform errors from alerts
    const errors: MigrationError[] = activeAlerts
      .filter(alert => alert.severity === 'error')
      .map(alert => ({
        entityType: alert.entityType,
        errorType: alert.type.includes('connection') ? 'connection' as const :
                   alert.type.includes('validation') ? 'validation' as const :
                   alert.type.includes('constraint') ? 'constraint' as const :
                   'transformation' as const,
        message: alert.message,
        recordId: alert.details?.recordId,
        timestamp: alert.timestamp.toISOString(),
        retryable: !alert.type.includes('constraint')
      }));

    // Calculate estimated completion
    let estimatedCompletion: string | undefined;
    if (overallStatus === 'running' && totalRecordsRemaining > 0) {
      const avgThroughput = performanceMetrics.recordsPerSecond;
      const remainingTimeMs = (totalRecordsRemaining / avgThroughput) * 1000;
      estimatedCompletion = new Date(Date.now() + remainingTimeMs).toISOString();
    }

    // Prepare response
    const statusResponse: MigrationStatusResponse = {
      sessionId,
      overallStatus,
      entitiesPending,
      entitiesRunning,
      entitiesCompleted,
      entitiesFailed,
      totalRecordsProcessed,
      totalRecordsRemaining,
      progressPercentage: Math.round(progressPercentage * 100) / 100, // Round to 2 decimal places
      estimatedCompletion,
      performanceMetrics,
      errors
    };

    console.log(`📊 Status retrieved for session: ${sessionId}`);
    console.log(`   Overall Status: ${overallStatus}`);
    console.log(`   Progress: ${progressPercentage.toFixed(1)}%`);
    console.log(`   Active Entities: ${entitiesRunning.length}`);

    res.status(200).json(createAPIResponse(true, statusResponse, undefined, requestId));

  } catch (error) {
    console.error(`❌ Failed to retrieve status for session: ${sessionId}`);
    console.error(`   Error: ${error.message}`);

    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'STATUS_RETRIEVAL_FAILED',
        message: 'Failed to retrieve migration status',
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * POST /api/migration/pause/{sessionId}
 * Pause running migration and save checkpoint
 */
export async function handlePauseMigration(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;

  try {
    // Validate session ID
    const validation = validateSessionId(sessionId);
    if (!validation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: validation.error!
        },
        requestId
      ));
      return;
    }

    // Get migration executor
    const executor = sessionExecutors.get(sessionId);
    if (!executor) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SESSION_NOT_FOUND',
          message: `Migration session not found: ${sessionId}`
        },
        requestId
      ));
      return;
    }

    // Get current progress to check status
    const progressTracker = await getProgressTracker(sessionId);
    if (!progressTracker) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SESSION_NOT_FOUND',
          message: `Migration session not found: ${sessionId}`
        },
        requestId
      ));
      return;
    }

    const allProgress = await progressTracker.getAllProgress();
    const currentStatus = allProgress.some(p => p.status === 'running') ? 'running' :
                         allProgress.every(p => p.status === 'completed') ? 'completed' : 'unknown';

    if (currentStatus !== 'running') {
      res.status(409).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_STATE_TRANSITION',
          message: 'Cannot pause migration in current state',
          details: {
            currentStatus,
            allowedStates: ['running'],
            action: 'pause'
          }
        },
        requestId
      ));
      return;
    }

    // Attempt to pause migration
    const pauseResult = await executor.pauseExecution();

    if (pauseResult.success) {
      const pausedAt = new Date().toISOString();

      console.log(`⏸️  Migration paused: ${sessionId}`);
      console.log(`   Checkpoint ID: ${pauseResult.checkpointId}`);
      console.log(`   Paused At: ${pausedAt}`);

      res.status(200).json(createAPIResponse(
        true,
        {
          sessionId,
          action: 'pause',
          status: 'paused',
          checkpointId: pauseResult.checkpointId,
          pausedAt,
          message: 'Migration paused successfully',
          resumeInstructions: {
            endpoint: `/api/migration/resume/${sessionId}`,
            method: 'POST',
            description: 'Use this endpoint to resume the migration from the current checkpoint'
          }
        },
        undefined,
        requestId
      ));
    } else {
      res.status(500).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'PAUSE_FAILED',
          message: 'Failed to pause migration',
          details: 'Migration could not be paused at this time',
          retryable: true,
          retryAfter: 30
        },
        requestId
      ));
    }

  } catch (error) {
    console.error(`❌ Failed to pause migration: ${sessionId}`);
    console.error(`   Error: ${error.message}`);

    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'PAUSE_OPERATION_FAILED',
        message: 'Pause operation encountered an error',
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * POST /api/migration/resume/{sessionId}
 * Resume paused migration from last checkpoint
 */
export async function handleResumeMigration(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;

  try {
    // Validate session ID
    const validation = validateSessionId(sessionId);
    if (!validation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: validation.error!
        },
        requestId
      ));
      return;
    }

    // Get migration executor
    const executor = sessionExecutors.get(sessionId);
    if (!executor) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SESSION_NOT_FOUND',
          message: `Migration session not found: ${sessionId}`
        },
        requestId
      ));
      return;
    }

    // Get current progress to check status
    const progressTracker = await getProgressTracker(sessionId);
    if (!progressTracker) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SESSION_NOT_FOUND',
          message: `Migration session not found: ${sessionId}`
        },
        requestId
      ));
      return;
    }

    const allProgress = await progressTracker.getAllProgress();
    const currentStatus = allProgress.some(p => p.status === 'paused') ? 'paused' :
                         allProgress.some(p => p.status === 'running') ? 'running' : 'unknown';

    if (currentStatus !== 'paused') {
      res.status(409).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_STATE_TRANSITION',
          message: 'Cannot resume migration in current state',
          details: {
            currentStatus,
            allowedStates: ['paused'],
            action: 'resume'
          }
        },
        requestId
      ));
      return;
    }

    // Attempt to resume migration
    const resumeResult = await executor.resumeExecution();

    if (resumeResult.success) {
      const resumedAt = new Date().toISOString();

      console.log(`▶️  Migration resumed: ${sessionId}`);
      console.log(`   Resumed From Batch: ${resumeResult.resumedFromBatch}`);
      console.log(`   Resumed At: ${resumedAt}`);

      res.status(200).json(createAPIResponse(
        true,
        {
          sessionId,
          action: 'resume',
          status: 'running',
          resumedFromBatch: resumeResult.resumedFromBatch,
          resumedAt,
          message: 'Migration resumed successfully',
          statusUrl: `/api/migration/status/${sessionId}`
        },
        undefined,
        requestId
      ));
    } else {
      res.status(500).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'RESUME_FAILED',
          message: 'Failed to resume migration',
          details: 'Migration could not be resumed at this time'
        },
        requestId
      ));
    }

  } catch (error) {
    // Handle specific resume errors
    let errorCode = 'RESUME_OPERATION_FAILED';
    let errorMessage = 'Resume operation encountered an error';

    if (error.message.includes('checkpoint')) {
      errorCode = 'CHECKPOINT_NOT_FOUND';
      errorMessage = 'Cannot resume migration without valid checkpoint';
    }

    console.error(`❌ Failed to resume migration: ${sessionId}`);
    console.error(`   Error: ${error.message}`);

    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: errorCode,
        message: errorMessage,
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * POST /api/migration/cancel/{sessionId}
 * Cancel running migration and clean up resources
 */
export async function handleCancelMigration(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;

  try {
    // Validate session ID
    const validation = validateSessionId(sessionId);
    if (!validation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: validation.error!
        },
        requestId
      ));
      return;
    }

    // Get migration executor and progress tracker
    const executor = sessionExecutors.get(sessionId);
    const progressTracker = sessionTrackers.get(sessionId);

    if (!executor || !progressTracker) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SESSION_NOT_FOUND',
          message: `Migration session not found: ${sessionId}`
        },
        requestId
      ));
      return;
    }

    // Stop tracking and cleanup
    await progressTracker.stop();

    // Clean up session tracking
    sessionTrackers.delete(sessionId);
    sessionExecutors.delete(sessionId);

    const cancelledAt = new Date().toISOString();

    console.log(`❌ Migration cancelled: ${sessionId}`);
    console.log(`   Cancelled At: ${cancelledAt}`);

    res.status(200).json(createAPIResponse(
      true,
      {
        sessionId,
        action: 'cancel',
        status: 'cancelled',
        cancelledAt,
        message: 'Migration cancelled and resources cleaned up'
      },
      undefined,
      requestId
    ));

  } catch (error) {
    console.error(`❌ Failed to cancel migration: ${sessionId}`);
    console.error(`   Error: ${error.message}`);

    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'CANCEL_OPERATION_FAILED',
        message: 'Cancel operation encountered an error',
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * GET /api/migration/status/{sessionId}/stream
 * Server-Sent Events endpoint for real-time status updates
 */
export async function handleStatusStream(req: Request, res: Response): Promise<void> {
  const sessionId = req.params.sessionId;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  try {
    const progressTracker = await getProgressTracker(sessionId);
    if (!progressTracker) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: { code: 'SESSION_NOT_FOUND', message: `Session ${sessionId} not found` }
      })}\n\n`);
      res.end();
      return;
    }

    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      sessionId,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Subscribe to progress updates
    const unsubscribe = progressTracker.subscribeToUpdates((update) => {
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        sessionId,
        entityType: update.entityType,
        data: update.data,
        timestamp: update.timestamp.toISOString()
      })}\n\n`);
    });

    // Handle client disconnect
    req.on('close', () => {
      console.log(`📡 SSE client disconnected for session: ${sessionId}`);
      unsubscribe();
    });

    // Send periodic heartbeats
    const heartbeatInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      })}\n\n`);
    }, 30000);

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: {
        code: 'STREAM_SETUP_FAILED',
        message: 'Failed to setup status stream',
        details: error.message
      }
    })}\n\n`);
    res.end();
  }
}

/**
 * Middleware for request logging
 */
export function logStatusRequest(req: Request, res: Response, next: Function): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  console.log(`📊 Status Request: ${requestId}`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Path: ${req.path}`);
  console.log(`   Session ID: ${req.params.sessionId || 'none'}`);

  // Add response time tracking
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`   Response: ${res.statusCode} (${duration}ms)`);
  });

  next();
}

// Export configurations for testing
export { sourceDbConfig, destinationDbConfig, sessionTrackers, sessionExecutors };
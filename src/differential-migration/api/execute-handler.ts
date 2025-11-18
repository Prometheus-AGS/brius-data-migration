/**
 * Migration Execution API Handler
 * Implements POST /api/migration/execute endpoint with MigrationExecutor integration
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { MigrationExecutor, type ExecutionConfig, type MigrationTask, type MigrationExecutionResult } from '../services/migration-executor';
import { DifferentialDetector, type DetectionResult } from '../services/differential-detector';
import { v4 as uuidv4 } from 'uuid';

// Request/Response interfaces matching OpenAPI schema
export interface MigrationExecutionRequest {
  analysisId: string;
  entities?: string[];
  batchSize?: number;
  parallel?: boolean;
  maxConcurrent?: number;
  dryRun?: boolean;
  enableValidation?: boolean;
  resumeFromCheckpoint?: string;
  resumeFromBatch?: number;
  asyncMode?: boolean;
}

export interface MigrationExecutionResponse {
  success: boolean;
  data?: {
    executionId: string;
    sessionId: string;
    status: 'completed' | 'partial' | 'failed' | 'paused' | 'simulated' | 'queued';
    dryRun?: boolean;
    resumed?: boolean;
    asyncMode?: boolean;
    summary: {
      entitiesProcessed: string[];
      entitiesFailed: string[];
      totalRecordsProcessed: number;
      totalRecordsFailed: number;
      successRate: string;
    };
    performance: {
      totalDurationMs: number;
      averageThroughput: number;
      peakMemoryUsageMb: number;
    };
    batchResults?: Array<{
      batchId: string;
      entityType: string;
      status: 'success' | 'partial_success' | 'failed';
      processedRecords: number;
      failedRecords: number;
      successRate: string;
      performance: {
        durationMs: number;
        recordsPerSecond: number;
        memoryUsageMb: number;
      };
      errors?: Array<{
        recordId: string;
        errorType: string;
        message: string;
        retryable: boolean;
      }>;
    }>;
    checkpoints: string[];
    recovery?: {
      isRecoverable: boolean;
      resumeFromCheckpoint?: string;
      resumeFromBatch?: number;
      actions: string[];
    };
    dependencyResolution?: {
      requestedOrder: string[];
      executionOrder: string[][];
      reordered: boolean;
      reason?: string;
    };
    simulation?: {
      wouldProcess: number;
      estimatedDuration: string;
      estimatedMemoryUsage: string;
      dependencyOrder: string[];
      batchConfiguration: {
        totalBatches: number;
        recordsPerBatch: number;
        parallelExecutions: number;
      };
    };
    resumption?: {
      fromCheckpoint: string;
      fromBatch: number;
      resumedAt: string;
      recoveredRecords: number;
    };
    partialResults?: {
      completedEntities: number;
      failedEntities: number;
      totalEntities: number;
      completionPercentage: number;
    };
    statusUrl: string;
    logsUrl: string;
    retryUrl?: string;
    nextSteps?: string[];
  };
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    retryable?: boolean;
    retryAfter?: number;
    suggestions?: string[];
    validationSummary?: {
      totalValidated: number;
      successfulMatches: number;
      failedMatches: number;
      matchPercentage: number;
    };
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
  };
}

// Active migrations tracking to prevent conflicts
const activeMigrations = new Map<string, string>();

/**
 * ExecuteHandler Implementation
 *
 * Provides REST API endpoint for migration execution with comprehensive
 * session management, validation, and async processing support.
 */
export class ExecuteHandler {
  private sourcePool: Pool;
  private destinationPool: Pool;

  constructor(sourcePool: Pool, destinationPool: Pool) {
    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
  }

  /**
   * Handles POST /api/migration/execute requests
   */
  async handleMigrationExecution(req: Request, res: Response): Promise<void> {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    try {
      // Validate request
      const validationResult = this.validateRequest(req.body);
      if (!validationResult.isValid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: validationResult.errors,
            timestamp
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      const request = req.body as MigrationExecutionRequest;

      // Check for concurrent migrations
      if (activeMigrations.has(request.analysisId)) {
        res.status(409).json({
          success: false,
          error: {
            code: 'MIGRATION_IN_PROGRESS',
            message: 'Another migration is already running',
            details: {
              conflictingAnalysisId: request.analysisId,
              activeSessionId: activeMigrations.get(request.analysisId)
            },
            suggestions: [
              'Wait for current migration to complete',
              'Check migration status using the status endpoint',
              'Cancel current migration if necessary'
            ]
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      // Load analysis data
      const analysisData = await this.loadAnalysisData(request.analysisId);
      if (!analysisData || analysisData.length === 0) {
        res.status(404).json({
          success: false,
          error: {
            code: 'ANALYSIS_NOT_FOUND',
            message: `Analysis data not found for ID: ${request.analysisId}`,
            suggestions: [
              'Verify the analysis ID is correct',
              'Run differential analysis first to generate data',
              'Check if the analysis has expired'
            ]
          },
          meta: {
            apiVersion: '1.0.0',
            requestId,
            timestamp
          }
        });
        return;
      }

      // Handle async mode for large migrations
      if (request.asyncMode || this.shouldUseAsyncMode(request, analysisData)) {
        const asyncResponse = await this.handleAsyncExecution(request, requestId, timestamp);
        res.status(202).json(asyncResponse);
        return;
      }

      // Execute migration
      const sessionId = uuidv4();
      activeMigrations.set(request.analysisId, sessionId);

      try {
        const result = await this.executeMigration(request, analysisData, sessionId);

        // Format and send response
        const response = this.formatSuccessResponse(result, request, requestId, timestamp);

        // Determine response status based on migration result
        if (result.overallStatus === 'completed') {
          res.status(200).json(response);
        } else if (result.overallStatus === 'partial') {
          res.status(200).json(response); // Partial success is still 200
        } else if (result.overallStatus === 'paused') {
          res.status(200).json(response);
        } else {
          res.status(200).json({ ...response, success: false });
        }

      } finally {
        // Clean up active migrations tracking
        activeMigrations.delete(request.analysisId);
      }

    } catch (error) {
      // Clean up tracking on error
      activeMigrations.delete(req.body?.analysisId);

      const errorResponse = this.formatErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Validates migration execution request
   */
  validateRequest(body: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if body exists
    if (!body || typeof body !== 'object') {
      errors.push('Request body is required');
      return { isValid: false, errors };
    }

    // Validate analysisId (required)
    if (!body.analysisId || typeof body.analysisId !== 'string') {
      errors.push('analysisId is required and must be a string');
    } else if (!this.isValidUUID(body.analysisId)) {
      errors.push('analysisId must be a valid UUID');
    }

    // Validate optional parameters
    if (body.entities !== undefined) {
      if (!Array.isArray(body.entities)) {
        errors.push('entities must be an array if provided');
      } else if (body.entities.length === 0) {
        errors.push('entities array cannot be empty if provided');
      }
    }

    if (body.batchSize !== undefined) {
      if (typeof body.batchSize !== 'number' || body.batchSize < 1 || body.batchSize > 5000) {
        errors.push('batchSize must be a number between 1 and 5000');
      }
    }

    if (body.maxConcurrent !== undefined) {
      if (typeof body.maxConcurrent !== 'number' || body.maxConcurrent < 1 || body.maxConcurrent > 10) {
        errors.push('maxConcurrent must be a number between 1 and 10');
      }
    }

    // Validate boolean flags
    const booleanFields = ['parallel', 'dryRun', 'enableValidation', 'asyncMode'];
    for (const field of booleanFields) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') {
        errors.push(`${field} must be a boolean if provided`);
      }
    }

    // Validate checkpoint parameters
    if (body.resumeFromCheckpoint !== undefined && !this.isValidUUID(body.resumeFromCheckpoint)) {
      errors.push('resumeFromCheckpoint must be a valid UUID if provided');
    }

    if (body.resumeFromBatch !== undefined) {
      if (typeof body.resumeFromBatch !== 'number' || body.resumeFromBatch < 1) {
        errors.push('resumeFromBatch must be a positive number if provided');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Loads analysis data for migration execution
   */
  private async loadAnalysisData(analysisId: string): Promise<DetectionResult[] | null> {
    try {
      // In real implementation, this would load from database or cache
      // For now, simulate loading analysis data
      console.log(`Loading analysis data for ID: ${analysisId}`);

      // Mock analysis data
      const mockAnalysisData: DetectionResult[] = [
        {
          analysisId: analysisId,
          entityType: 'doctors',
          analysisTimestamp: new Date(),
          baselineTimestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
          detectionMethod: 'timestamp_with_hash',
          totalRecordsAnalyzed: 5000,
          changesDetected: Array.from({ length: 50 }, (_, i) => ({
            recordId: `doctor_${i + 1}`,
            changeType: 'new' as const,
            sourceTimestamp: new Date(),
            contentHash: `hash_${i + 1}`,
            metadata: {
              sourceTable: 'dispatch_doctors',
              destinationTable: 'doctors',
              confidence: 0.95
            }
          })),
          summary: {
            newRecords: 45,
            modifiedRecords: 5,
            deletedRecords: 0,
            totalChanges: 50,
            changePercentage: 1.0
          },
          performance: {
            analysisDurationMs: 15000,
            recordsPerSecond: 333,
            queriesExecuted: 8
          },
          recommendations: ['Migration recommended for detected changes']
        }
      ];

      return mockAnalysisData;

    } catch (error) {
      console.error('Failed to load analysis data:', error);
      return null;
    }
  }

  /**
   * Executes migration based on analysis data
   */
  private async executeMigration(
    request: MigrationExecutionRequest,
    analysisData: DetectionResult[],
    sessionId: string
  ): Promise<MigrationExecutionResult> {
    // Build execution configuration
    const executionConfig: ExecutionConfig = {
      batchSize: request.batchSize || 1000,
      maxRetryAttempts: 3,
      checkpointInterval: 10,
      parallelEntityLimit: request.maxConcurrent || 3,
      timeoutMs: 300000,
      enableValidation: request.enableValidation !== false,
      validationSampleSize: 100,
      enablePerformanceMonitoring: true
    };

    // Initialize MigrationExecutor
    const executor = new MigrationExecutor(
      this.sourcePool,
      this.destinationPool,
      sessionId,
      executionConfig
    );

    // Build migration tasks from analysis data
    const migrationTasks = this.buildMigrationTasks(request, analysisData, sessionId);

    // Handle resumption if requested
    if (request.resumeFromCheckpoint) {
      const resumeResult = await executor.resumeExecution(request.resumeFromCheckpoint);
      if (!resumeResult.success) {
        throw new Error('Failed to resume from checkpoint');
      }
    }

    // Execute migration
    const result = await executor.executeMigrationTasks(migrationTasks);

    return result;
  }

  /**
   * Builds migration tasks from analysis data
   */
  private buildMigrationTasks(
    request: MigrationExecutionRequest,
    analysisData: DetectionResult[],
    sessionId: string
  ): MigrationTask[] {
    const tasks: MigrationTask[] = [];

    // Filter entities to migrate
    const entitiesToMigrate = request.entities || analysisData.map(a => a.entityType);

    for (const entityType of entitiesToMigrate) {
      const analysis = analysisData.find(a => a.entityType === entityType);
      if (!analysis) {
        continue;
      }

      // Extract record IDs from changes detected
      const recordIds = analysis.changesDetected.map(change => change.recordId);
      if (recordIds.length === 0) {
        continue;
      }

      const task: MigrationTask = {
        entityType,
        recordIds,
        priority: this.getEntityPriority(entityType),
        dependencies: this.getEntityDependencies(entityType),
        estimatedDurationMs: Math.ceil(
          (recordIds.length / analysis.performance.recordsPerSecond) * 1000
        ),
        metadata: {
          sourceTable: `dispatch_${entityType}`,
          destinationTable: entityType,
          totalRecords: recordIds.length,
          migrationMethod: 'differential',
          checkpointId: request.resumeFromCheckpoint
        }
      };

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Determines if async processing should be used
   */
  private shouldUseAsyncMode(request: MigrationExecutionRequest, analysisData: DetectionResult[]): boolean {
    const totalChanges = analysisData.reduce((sum, a) => sum + a.summary.totalChanges, 0);
    const hasLargeDataset = totalChanges > 10000;
    const hasAllEntities = request.entities?.includes('all') || analysisData.length > 10;
    const requestedAsync = request.asyncMode === true;

    return requestedAsync || hasLargeDataset || hasAllEntities;
  }

  /**
   * Handles async migration execution
   */
  private async handleAsyncExecution(
    request: MigrationExecutionRequest,
    requestId: string,
    timestamp: string
  ): Promise<MigrationExecutionResponse> {
    const executionId = uuidv4();
    const sessionId = uuidv4();

    // Start background processing (in real implementation, this would use a job queue)
    console.log(`Starting async migration execution: ${executionId}`);

    // Estimate completion time
    const estimatedDurationMs = this.estimateExecutionTime(request);
    const estimatedCompletionTime = new Date(Date.now() + estimatedDurationMs).toISOString();

    return {
      success: true,
      data: {
        executionId,
        sessionId,
        status: 'queued',
        asyncMode: true,
        summary: {
          entitiesProcessed: [],
          entitiesFailed: [],
          totalRecordsProcessed: 0,
          totalRecordsFailed: 0,
          successRate: '0%'
        },
        performance: {
          totalDurationMs: 0,
          averageThroughput: 0,
          peakMemoryUsageMb: 0
        },
        checkpoints: [],
        statusUrl: `/api/migration/status/${sessionId}`,
        logsUrl: `/api/migration/logs/${sessionId}`
      },
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp
      }
    };
  }

  /**
   * Formats successful migration response
   */
  private formatSuccessResponse(
    result: MigrationExecutionResult,
    request: MigrationExecutionRequest,
    requestId: string,
    timestamp: string
  ): MigrationExecutionResponse {
    const successRate = result.totalRecordsProcessed + result.totalRecordsFailed > 0
      ? (result.totalRecordsProcessed / (result.totalRecordsProcessed + result.totalRecordsFailed) * 100).toFixed(2)
      : '0.00';

    const data: MigrationExecutionResponse['data'] = {
      executionId: result.executionId,
      sessionId: result.sessionId,
      status: result.overallStatus,
      dryRun: request.dryRun,
      resumed: !!request.resumeFromCheckpoint,
      summary: {
        entitiesProcessed: result.entitiesProcessed,
        entitiesFailed: result.entitiesFailed,
        totalRecordsProcessed: result.totalRecordsProcessed,
        totalRecordsFailed: result.totalRecordsFailed,
        successRate: `${successRate}%`
      },
      performance: {
        totalDurationMs: result.executionSummary.totalDurationMs,
        averageThroughput: result.executionSummary.averageThroughput,
        peakMemoryUsageMb: result.executionSummary.peakMemoryUsageMb
      },
      checkpoints: result.checkpoints,
      statusUrl: `/api/migration/status/${result.sessionId}`,
      logsUrl: `/api/migration/logs/${result.sessionId}`
    };

    // Include batch results if available
    if (result.batchResults && result.batchResults.length > 0) {
      data.batchResults = result.batchResults.map(batch => ({
        batchId: batch.batchId,
        entityType: batch.entityType,
        status: batch.status,
        processedRecords: batch.processedRecords,
        failedRecords: batch.failedRecords,
        successRate: batch.processedRecords + batch.failedRecords > 0
          ? `${(batch.processedRecords / (batch.processedRecords + batch.failedRecords) * 100).toFixed(2)}%`
          : '0%',
        performance: {
          durationMs: batch.performance.durationMs,
          recordsPerSecond: batch.performance.recordsPerSecond,
          memoryUsageMb: batch.performance.memoryUsageMb
        },
        errors: batch.errors.length > 0 ? batch.errors : undefined
      }));
    }

    // Include recovery information if needed
    if (result.recovery.isRecoverable) {
      data.recovery = {
        isRecoverable: result.recovery.isRecoverable,
        resumeFromCheckpoint: result.recovery.lastCheckpointId,
        resumeFromBatch: result.recovery.resumeFromBatch,
        actions: result.recovery.recommendedActions
      };

      if (result.overallStatus === 'failed') {
        data.retryUrl = `/api/migration/execute?resumeFrom=${result.recovery.lastCheckpointId}`;
      }
    }

    // Include resumption details if applicable
    if (request.resumeFromCheckpoint) {
      data.resumption = {
        fromCheckpoint: request.resumeFromCheckpoint,
        fromBatch: request.resumeFromBatch || 1,
        resumedAt: timestamp,
        recoveredRecords: result.totalRecordsProcessed
      };
    }

    // Include partial results summary
    if (result.overallStatus === 'partial') {
      const totalEntities = result.entitiesProcessed.length + result.entitiesFailed.length;
      data.partialResults = {
        completedEntities: result.entitiesProcessed.length,
        failedEntities: result.entitiesFailed.length,
        totalEntities,
        completionPercentage: Math.round((result.entitiesProcessed.length / totalEntities) * 100)
      };

      data.nextSteps = [
        'Review failed records in the entities that had issues',
        'Resume migration to complete remaining records',
        'Monitor status for completion updates'
      ];
    }

    return {
      success: result.overallStatus !== 'failed',
      data,
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp
      }
    };
  }

  /**
   * Formats error response
   */
  private formatErrorResponse(error: any, requestId: string, timestamp: string): {
    status: number;
    body: MigrationExecutionResponse;
  } {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    let code: string;
    let status: number;
    let retryable = false;
    let retryAfter: number | undefined;

    if (errorMessage.includes('memory') || errorMessage.includes('resource')) {
      code = 'RESOURCE_EXHAUSTED';
      status = 507;
      retryable = true;
      retryAfter = 3600; // 1 hour
    } else if (errorMessage.includes('connection')) {
      code = 'DATABASE_CONNECTION_ERROR';
      status = 500;
      retryable = true;
    } else if (errorMessage.includes('checkpoint')) {
      code = 'CHECKPOINT_ERROR';
      status = 500;
      retryable = true;
    } else if (errorMessage.includes('validation')) {
      code = 'PRE_VALIDATION_FAILED';
      status = 400;
      retryable = false;
    } else {
      code = 'EXECUTION_FAILED';
      status = 500;
      retryable = true;
    }

    const suggestions = this.getErrorSuggestions(code);

    return {
      status,
      body: {
        success: false,
        error: {
          code,
          message: this.getErrorMessage(code),
          details: errorMessage,
          timestamp,
          retryable,
          retryAfter,
          suggestions
        },
        meta: {
          apiVersion: '1.0.0',
          requestId,
          timestamp
        }
      }
    };
  }

  /**
   * Gets user-friendly error message
   */
  private getErrorMessage(code: string): string {
    switch (code) {
      case 'RESOURCE_EXHAUSTED':
        return 'Migration failed due to resource constraints';
      case 'DATABASE_CONNECTION_ERROR':
        return 'Failed to connect to database for migration';
      case 'CHECKPOINT_ERROR':
        return 'Failed to create or load migration checkpoint';
      case 'PRE_VALIDATION_FAILED':
        return 'Migration validation failed';
      case 'EXECUTION_FAILED':
        return 'Migration execution failed';
      default:
        return 'Migration could not be completed';
    }
  }

  /**
   * Gets error-specific suggestions
   */
  private getErrorSuggestions(code: string): string[] {
    switch (code) {
      case 'RESOURCE_EXHAUSTED':
        return [
          'Reduce batch size to lower memory usage',
          'Process fewer entities concurrently',
          'Increase server memory allocation',
          'Consider splitting migration into smaller chunks'
        ];
      case 'DATABASE_CONNECTION_ERROR':
        return [
          'Check database connection parameters',
          'Verify database is accessible',
          'Check network connectivity',
          'Ensure sufficient connection pool size'
        ];
      case 'CHECKPOINT_ERROR':
        return [
          'Check database permissions for checkpoint table',
          'Verify checkpoint storage is accessible',
          'Consider starting fresh migration without resume'
        ];
      default:
        return [
          'Check migration logs for detailed error information',
          'Verify data integrity and dependencies',
          'Contact support if the issue persists'
        ];
    }
  }

  /**
   * Estimates execution time for planning
   */
  private estimateExecutionTime(request: MigrationExecutionRequest): number {
    const baseTime = 60000; // 1 minute base
    const perEntityTime = 30000; // 30 seconds per entity
    const validationMultiplier = request.enableValidation !== false ? 1.5 : 1;

    const entityCount = request.entities?.length || 5; // Default estimate
    return (baseTime + (perEntityTime * entityCount)) * validationMultiplier;
  }

  /**
   * Gets entity priority for execution ordering
   */
  private getEntityPriority(entityType: string): 'high' | 'medium' | 'low' {
    const highPriority = ['offices', 'doctors', 'patients'];
    const mediumPriority = ['orders', 'cases', 'messages'];

    if (highPriority.includes(entityType)) return 'high';
    if (mediumPriority.includes(entityType)) return 'medium';
    return 'low';
  }

  /**
   * Gets entity dependencies for proper execution order
   */
  private getEntityDependencies(entityType: string): string[] {
    const dependencies: Record<string, string[]> = {
      offices: [],
      doctors: ['offices'],
      doctor_offices: ['doctors', 'offices'],
      patients: ['doctors'],
      orders: ['patients'],
      cases: ['orders'],
      files: [],
      case_files: ['cases', 'files'],
      messages: ['cases'],
      message_files: ['messages', 'files'],
      jaw: ['patients'],
      dispatch_records: [],
      system_messages: [],
      message_attachments: ['messages'],
      technician_roles: ['doctors'],
      order_cases: ['orders', 'cases'],
      purchases: ['orders'],
      treatment_discussions: ['cases'],
      template_view_groups: [],
      template_view_roles: ['template_view_groups']
    };

    return dependencies[entityType] || [];
  }

  /**
   * Validates UUID format
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}

/**
 * Factory function for creating execute handler with database pools
 */
export function createExecuteHandler(sourcePool: Pool, destinationPool: Pool): ExecuteHandler {
  return new ExecuteHandler(sourcePool, destinationPool);
}

/**
 * Express route handler function
 */
export async function migrationExecuteRoute(req: Request, res: Response): Promise<void> {
  // In real implementation, you would inject database pools via middleware or dependency injection
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

  const handler = new ExecuteHandler(sourcePool, destinationPool);

  try {
    await handler.handleMigrationExecution(req, res);
  } finally {
    // Cleanup connections
    await sourcePool.end();
    await destinationPool.end();
  }
}
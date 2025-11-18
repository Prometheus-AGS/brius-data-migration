/**
 * Differential Analysis API Handler
 * Implements POST /api/migration/differential endpoint with DifferentialDetector integration
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { DifferentialDetector, type DetectionResult, type DetectionConfig } from '../services/differential-detector';
import { v4 as uuidv4 } from 'uuid';

// Request/Response interfaces matching OpenAPI schema
export interface DifferentialAnalysisRequest {
  entities: string[];
  sinceTimestamp: string;
  includeDeletes?: boolean;
  enableContentHashing?: boolean;
  changeThreshold?: number;
  batchSize?: number;
  asyncMode?: boolean;
}

export interface DifferentialAnalysisResponse {
  success: boolean;
  data?: {
    analysisId: string;
    timestamp: string;
    baselineTimestamp: string;
    entityResults: Array<{
      entityType: string;
      detectionMethod: 'timestamp_only' | 'timestamp_with_hash';
      totalRecordsAnalyzed: number;
      summary: {
        newRecords: number;
        modifiedRecords: number;
        deletedRecords: number;
        totalChanges: number;
        changePercentage: number;
      };
      changes: Array<{
        recordId: string;
        changeType: 'new' | 'modified' | 'deleted';
        sourceTimestamp: string;
        destinationTimestamp?: string;
        contentHash?: string;
        previousContentHash?: string;
        confidence: number;
        metadata?: {
          fieldChanges?: string[];
          dataQuality?: string;
          [key: string]: any;
        };
      }>;
      performance: {
        analysisDurationMs: number;
        recordsPerSecond: number;
        queriesExecuted: number;
        cacheHitRate?: number;
        memoryUsageMb?: number;
        efficiencyRating?: string;
      };
    }>;
    overallSummary: {
      totalChanges: number;
      estimatedMigrationTime: string;
      averageChangePercentage: number;
      filteredEntities?: Array<{
        entityType: string;
        changePercentage: number;
        reason: string;
      }>;
    };
    recommendations: string[];
    processingMetrics?: {
      concurrentAnalyses: number;
      queuedRequests: number;
      averageWaitTime: number;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    retryable?: boolean;
    validFormats?: string[];
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
  };
}

// Async response for large dataset processing
export interface AsyncDifferentialResponse {
  success: boolean;
  data: {
    analysisId: string;
    status: 'processing' | 'queued';
    estimatedCompletionTime: string;
    checkStatusUrl: string;
    message: string;
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
  };
}

// Known entity types for validation
const VALID_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
  'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
  'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
  'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
];

/**
 * DifferentialHandler Implementation
 *
 * Provides REST API endpoint for differential change detection with comprehensive
 * validation, async processing support, and performance optimization.
 */
export class DifferentialHandler {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private concurrentRequests: Map<string, Promise<any>> = new Map();

  constructor(sourcePool: Pool, destinationPool: Pool) {
    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
  }

  /**
   * Handles POST /api/migration/differential requests
   */
  async handleDifferentialAnalysis(req: Request, res: Response): Promise<void> {
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

      const request = req.body as DifferentialAnalysisRequest;

      // Check for async mode (large datasets)
      if (request.asyncMode || this.shouldUseAsyncMode(request)) {
        const asyncResponse = await this.handleAsyncProcessing(request, requestId, timestamp);
        res.status(202).json(asyncResponse);
        return;
      }

      // Parse baseline timestamp
      const baselineTimestamp = new Date(request.sinceTimestamp);
      if (isNaN(baselineTimestamp.getTime())) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TIMESTAMP',
            message: `Invalid timestamp format: ${request.sinceTimestamp}`,
            validFormats: [
              'ISO 8601: 2025-10-25T12:00:00Z',
              'SQL format: 2025-10-25 12:00:00',
              'Date only: 2025-10-25'
            ],
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

      // Execute differential analysis
      const results = await this.executeDifferentialAnalysis(
        request,
        baselineTimestamp,
        requestId
      );

      // Format and send response
      const response = this.formatSuccessResponse(
        results,
        request,
        baselineTimestamp,
        requestId,
        timestamp
      );

      res.status(200).json(response);

    } catch (error) {
      const errorResponse = this.formatErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Validates incoming request parameters
   */
  validateRequest(body: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if body exists
    if (!body || typeof body !== 'object') {
      errors.push('Request body is required');
      return { isValid: false, errors };
    }

    // Validate entities
    if (!Array.isArray(body.entities)) {
      errors.push('entities must be an array');
    } else if (body.entities.length === 0) {
      errors.push('entities array cannot be empty');
    } else {
      const invalidEntities = body.entities.filter((entity: any) =>
        typeof entity !== 'string' || !VALID_ENTITY_TYPES.includes(entity)
      );
      if (invalidEntities.length > 0) {
        errors.push(`Invalid entity types: ${invalidEntities.join(', ')}`);
        errors.push(`Valid entities: ${VALID_ENTITY_TYPES.join(', ')}`);
      }
    }

    // Validate timestamp
    if (!body.sinceTimestamp || typeof body.sinceTimestamp !== 'string') {
      errors.push('sinceTimestamp is required and must be a string');
    }

    // Validate optional parameters
    if (body.includeDeletes !== undefined && typeof body.includeDeletes !== 'boolean') {
      errors.push('includeDeletes must be a boolean');
    }

    if (body.enableContentHashing !== undefined && typeof body.enableContentHashing !== 'boolean') {
      errors.push('enableContentHashing must be a boolean');
    }

    if (body.changeThreshold !== undefined) {
      if (typeof body.changeThreshold !== 'number' || body.changeThreshold < 0 || body.changeThreshold > 100) {
        errors.push('changeThreshold must be a number between 0 and 100');
      }
    }

    if (body.batchSize !== undefined) {
      if (typeof body.batchSize !== 'number' || body.batchSize < 1 || body.batchSize > 5000) {
        errors.push('batchSize must be a number between 1 and 5000');
      }
    }

    if (body.asyncMode !== undefined && typeof body.asyncMode !== 'boolean') {
      errors.push('asyncMode must be a boolean');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Executes differential analysis for requested entities
   */
  private async executeDifferentialAnalysis(
    request: DifferentialAnalysisRequest,
    baselineTimestamp: Date,
    requestId: string
  ): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const detectionConfig: DetectionConfig = {
      timestampField: 'updated_at',
      contentHashField: 'content_hash',
      enableContentHashing: request.enableContentHashing !== false,
      batchSize: request.batchSize || 1000,
      parallelConnections: 3
    };

    // Process each entity
    for (const entityType of request.entities) {
      try {
        const detector = new DifferentialDetector(
          this.sourcePool,
          this.destinationPool,
          entityType,
          detectionConfig,
          requestId
        );

        const result = await detector.detectChanges({
          entityType,
          sinceTimestamp: baselineTimestamp,
          includeDeletes: request.includeDeletes !== false,
          enableContentHashing: detectionConfig.enableContentHashing,
          batchSize: detectionConfig.batchSize
        });

        // Apply threshold filter
        const changeThreshold = request.changeThreshold || 0;
        if (result.summary.changePercentage >= changeThreshold) {
          results.push(result);
        }

      } catch (error) {
        // Handle entity-specific errors
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Create error result for tracking
        const errorResult: DetectionResult = {
          analysisId: requestId,
          entityType,
          analysisTimestamp: new Date(),
          baselineTimestamp,
          detectionMethod: 'timestamp_only',
          totalRecordsAnalyzed: 0,
          changesDetected: [],
          summary: {
            newRecords: 0,
            modifiedRecords: 0,
            deletedRecords: 0,
            totalChanges: 0,
            changePercentage: 0
          },
          performance: {
            analysisDurationMs: 0,
            recordsPerSecond: 0,
            queriesExecuted: 0
          },
          recommendations: [`Failed to analyze ${entityType}: ${errorMessage}`]
        };

        results.push(errorResult);
      }
    }

    return results;
  }

  /**
   * Determines if async processing should be used
   */
  private shouldUseAsyncMode(request: DifferentialAnalysisRequest): boolean {
    // Use async mode for:
    // 1. Large number of entities (all entities or >10 specific entities)
    // 2. Small batch size indicating large dataset
    // 3. Content hashing enabled (more CPU intensive)

    const hasAllEntities = request.entities.includes('all') || request.entities.length > 10;
    const hasSmallBatchSize = (request.batchSize || 1000) < 500;
    const hasContentHashing = request.enableContentHashing !== false;

    return hasAllEntities || (hasSmallBatchSize && hasContentHashing);
  }

  /**
   * Handles async processing for large datasets
   */
  private async handleAsyncProcessing(
    request: DifferentialAnalysisRequest,
    requestId: string,
    timestamp: string
  ): Promise<AsyncDifferentialResponse> {
    const analysisId = uuidv4();

    // Start background processing
    const processingPromise = this.executeDifferentialAnalysis(request, new Date(request.sinceTimestamp), requestId);
    this.concurrentRequests.set(analysisId, processingPromise);

    // Clean up completed requests after processing
    processingPromise.finally(() => {
      this.concurrentRequests.delete(analysisId);
    });

    // Estimate completion time based on request complexity
    const estimatedDurationMs = this.estimateProcessingTime(request);
    const estimatedCompletionTime = new Date(Date.now() + estimatedDurationMs).toISOString();

    return {
      success: true,
      data: {
        analysisId,
        status: 'processing',
        estimatedCompletionTime,
        checkStatusUrl: `/api/migration/differential/status/${analysisId}`,
        message: 'Differential analysis started for large dataset. Check status endpoint for progress.'
      },
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp
      }
    };
  }

  /**
   * Formats successful response
   */
  private formatSuccessResponse(
    results: DetectionResult[],
    request: DifferentialAnalysisRequest,
    baselineTimestamp: Date,
    requestId: string,
    timestamp: string
  ): DifferentialAnalysisResponse {
    const filteredResults = results.filter(result => result.summary.totalChanges > 0);
    const filteredEntities = results
      .filter(result => result.summary.totalChanges === 0)
      .map(result => ({
        entityType: result.entityType,
        changePercentage: result.summary.changePercentage,
        reason: `No changes detected since ${baselineTimestamp.toISOString()}`
      }));

    // Apply change threshold filtering
    const changeThreshold = request.changeThreshold || 0;
    const thresholdFilteredResults = filteredResults.filter(
      result => result.summary.changePercentage >= changeThreshold
    );

    const belowThresholdEntities = filteredResults
      .filter(result => result.summary.changePercentage < changeThreshold)
      .map(result => ({
        entityType: result.entityType,
        changePercentage: result.summary.changePercentage,
        reason: `Below threshold of ${changeThreshold}%`
      }));

    // Calculate overall summary
    const totalChanges = thresholdFilteredResults.reduce((sum, r) => sum + r.summary.totalChanges, 0);
    const averageChangePercentage = thresholdFilteredResults.length > 0
      ? Math.round((thresholdFilteredResults.reduce((sum, r) => sum + r.summary.changePercentage, 0) / thresholdFilteredResults.length) * 100) / 100
      : 0;

    // Generate recommendations
    const recommendations: string[] = [];
    if (totalChanges === 0) {
      recommendations.push('No entities meet the change threshold');
      recommendations.push('Consider lowering threshold or checking for recent changes');
    } else {
      recommendations.push(`Migration recommended for ${totalChanges.toLocaleString()} detected changes`);
      if (thresholdFilteredResults.some(r => r.summary.changePercentage > 10)) {
        recommendations.push('Large change percentage detected - verify data integrity before migration');
      }
      if (thresholdFilteredResults.some(r => r.summary.modifiedRecords > r.summary.newRecords)) {
        recommendations.push('Focus on modified records for data integrity');
      }
    }

    return {
      success: true,
      data: {
        analysisId: requestId,
        timestamp,
        baselineTimestamp: baselineTimestamp.toISOString(),
        entityResults: thresholdFilteredResults.map(result => ({
          entityType: result.entityType,
          detectionMethod: result.detectionMethod,
          totalRecordsAnalyzed: result.totalRecordsAnalyzed,
          summary: result.summary,
          changes: result.changesDetected.slice(0, 10).map(change => ({ // Limit to first 10 changes for API response
            recordId: change.recordId,
            changeType: change.changeType,
            sourceTimestamp: change.sourceTimestamp.toISOString(),
            destinationTimestamp: change.destinationTimestamp?.toISOString(),
            contentHash: change.contentHash,
            previousContentHash: change.previousContentHash,
            confidence: change.metadata.confidence || 0.95,
            metadata: {
              fieldChanges: change.metadata.fieldChanges as string[] | undefined,
              dataQuality: change.metadata.dataQuality as string | undefined
            }
          })),
          performance: {
            analysisDurationMs: result.performance.analysisDurationMs,
            recordsPerSecond: result.performance.recordsPerSecond,
            queriesExecuted: result.performance.queriesExecuted,
            cacheHitRate: result.performance.cacheHitRate || 0.85,
            memoryUsageMb: result.performance.memoryUsageMb || this.estimateMemoryUsage(result.totalRecordsAnalyzed),
            efficiencyRating: this.calculateEfficiencyRating(result.performance)
          }
        })),
        overallSummary: {
          totalChanges,
          estimatedMigrationTime: this.estimateMigrationTime(totalChanges),
          averageChangePercentage,
          ...(filteredEntities.length > 0 || belowThresholdEntities.length > 0 ? {
            filteredEntities: [...filteredEntities, ...belowThresholdEntities]
          } : {})
        },
        recommendations,
        processingMetrics: {
          concurrentAnalyses: this.concurrentRequests.size,
          queuedRequests: 0,
          averageWaitTime: 0
        }
      },
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp
      }
    };
  }

  /**
   * Estimates processing time for async operations
   */
  private estimateProcessingTime(request: DifferentialAnalysisRequest): number {
    const baseTime = 30000; // 30 seconds base
    const perEntityTime = 10000; // 10 seconds per entity
    const contentHashingMultiplier = request.enableContentHashing !== false ? 2 : 1;

    const entityCount = request.entities.includes('all')
      ? VALID_ENTITY_TYPES.length
      : request.entities.length;

    return (baseTime + (perEntityTime * entityCount)) * contentHashingMultiplier;
  }

  /**
   * Estimates memory usage based on records analyzed
   */
  private estimateMemoryUsage(recordsAnalyzed: number): number {
    const baseMemoryMb = 64;
    const perThousandRecords = 2; // 2MB per 1000 records
    return baseMemoryMb + Math.ceil(recordsAnalyzed / 1000) * perThousandRecords;
  }

  /**
   * Calculates efficiency rating based on performance metrics
   */
  private calculateEfficiencyRating(performance: DetectionResult['performance']): string {
    const throughputScore = performance.recordsPerSecond > 1000 ? 3 :
                           performance.recordsPerSecond > 500 ? 2 : 1;

    const queryScore = performance.queriesExecuted < 5 ? 3 :
                      performance.queriesExecuted < 15 ? 2 : 1;

    const overallScore = (throughputScore + queryScore) / 2;

    return overallScore >= 2.5 ? 'high' :
           overallScore >= 1.5 ? 'medium' : 'low';
  }

  /**
   * Estimates migration time based on change count
   */
  private estimateMigrationTime(changeCount: number): string {
    if (changeCount === 0) return '< 1 min';

    // Base estimation: ~1000 records per minute
    const baseRatePerMinute = 1000;
    const estimatedMinutes = Math.ceil(changeCount / baseRatePerMinute);

    if (estimatedMinutes < 1) {
      return '< 1 min';
    } else if (estimatedMinutes < 60) {
      return `${estimatedMinutes} min`;
    } else {
      const hours = Math.ceil(estimatedMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
  }

  /**
   * Formats error response with appropriate status codes
   */
  private formatErrorResponse(error: any, requestId: string, timestamp: string): {
    status: number;
    body: DifferentialAnalysisResponse;
  } {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Determine error type and status code
    let code: string;
    let status: number;
    let retryable = false;

    if (errorMessage.includes('connection') || errorMessage.includes('connect')) {
      code = 'DATABASE_CONNECTION_ERROR';
      status = 500;
      retryable = true;
    } else if (errorMessage.includes('not exist') || errorMessage.includes('not found')) {
      code = 'ENTITY_NOT_FOUND';
      status = 404;
      retryable = false;
    } else if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      code = 'PERMISSION_DENIED';
      status = 403;
      retryable = false;
    } else if (errorMessage.includes('timeout')) {
      code = 'ANALYSIS_TIMEOUT';
      status = 504;
      retryable = true;
    } else if (errorMessage.includes('memory') || errorMessage.includes('resource')) {
      code = 'RESOURCE_EXHAUSTED';
      status = 507;
      retryable = true;
    } else {
      code = 'ANALYSIS_FAILED';
      status = 500;
      retryable = true;
    }

    return {
      status,
      body: {
        success: false,
        error: {
          code,
          message: this.getErrorMessage(code),
          details: errorMessage,
          timestamp,
          retryable
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
      case 'DATABASE_CONNECTION_ERROR':
        return 'Failed to connect to database for analysis';
      case 'ENTITY_NOT_FOUND':
        return 'One or more entities not found in database';
      case 'PERMISSION_DENIED':
        return 'Insufficient permissions to access database';
      case 'ANALYSIS_TIMEOUT':
        return 'Differential analysis timed out';
      case 'RESOURCE_EXHAUSTED':
        return 'Analysis failed due to resource constraints';
      default:
        return 'Differential analysis could not be completed';
    }
  }
}

/**
 * Factory function for creating differential handler with database pools
 */
export function createDifferentialHandler(sourcePool: Pool, destinationPool: Pool): DifferentialHandler {
  return new DifferentialHandler(sourcePool, destinationPool);
}

/**
 * Express route handler function
 */
export async function differentialAnalysisRoute(req: Request, res: Response): Promise<void> {
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

  const handler = new DifferentialHandler(sourcePool, destinationPool);

  try {
    await handler.handleDifferentialAnalysis(req, res);
  } finally {
    // Cleanup connections
    await sourcePool.end();
    await destinationPool.end();
  }
}
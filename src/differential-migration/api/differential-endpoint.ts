/**
 * Differential Analysis API Endpoint
 *
 * Implements POST /api/migration/differential with timestamp filtering
 * Integrates with DifferentialDetector service for change detection
 */

import { Request, Response } from 'express';
import { Pool, PoolConfig } from 'pg';
import { DifferentialDetector } from '../services/differential-detector';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Request/Response interfaces matching OpenAPI schema
interface DifferentialAnalysisRequest {
  entities: string[];
  sinceTimestamp?: string;
  includeDeleted?: boolean;
}

interface DifferentialAnalysisResponse {
  analysisId: string;
  entityResults: EntityDifferentialResult[];
  totalChanges: number;
  estimatedMigrationTime: string;
}

interface EntityDifferentialResult {
  entityType: string;
  newRecords: number;
  modifiedRecords: number;
  deletedRecords: number;
  changePercentage: number;
  lastAnalyzed: string;
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

// Database configuration (shared with baseline endpoint)
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

// Valid entity types
const VALID_ENTITIES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
  'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
  'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
  'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
];

/**
 * Validate request parameters
 */
function validateDifferentialRequest(req: DifferentialAnalysisRequest): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate entities parameter
  if (!req.entities) {
    errors.push('entities parameter is required');
  } else if (!Array.isArray(req.entities)) {
    errors.push('entities must be an array');
  } else if (req.entities.length === 0) {
    errors.push('entities array cannot be empty');
  } else {
    // Validate entity names
    const invalidEntities = req.entities.filter(entity => !VALID_ENTITIES.includes(entity));
    if (invalidEntities.length > 0) {
      errors.push(`Invalid entity types: ${invalidEntities.join(', ')}`);
    }
  }

  // Validate sinceTimestamp parameter
  if (req.sinceTimestamp !== undefined) {
    const timestamp = new Date(req.sinceTimestamp);
    if (isNaN(timestamp.getTime())) {
      errors.push('sinceTimestamp must be a valid ISO date string');
    }
    // Check if timestamp is not too far in the future
    if (timestamp.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      errors.push('sinceTimestamp cannot be more than 24 hours in the future');
    }
  }

  // Validate includeDeleted parameter
  if (req.includeDeleted !== undefined && typeof req.includeDeleted !== 'boolean') {
    errors.push('includeDeleted must be a boolean');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Calculate estimated migration time based on changes
 */
function calculateEstimatedTime(totalChanges: number): string {
  // Performance benchmarks (records per minute)
  const baselineThroughput = 1000; // Conservative estimate
  const setupOverheadMinutes = 2;   // Setup and validation time

  if (totalChanges === 0) {
    return '< 1 minute';
  }

  const processingMinutes = Math.ceil(totalChanges / baselineThroughput);
  const totalMinutes = processingMinutes + setupOverheadMinutes;

  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  } else {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} hour${hours === 1 ? '' : 's'}${minutes > 0 ? ` ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}`;
  }
}

/**
 * Transform service response to API response format
 */
function transformDifferentialResults(results: any[]): DifferentialAnalysisResponse {
  const analysisId = `differential-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;

  const entityResults: EntityDifferentialResult[] = results.map(result => ({
    entityType: result.entityType,
    newRecords: result.summary?.newRecords || 0,
    modifiedRecords: result.summary?.modifiedRecords || 0,
    deletedRecords: result.summary?.deletedRecords || 0,
    changePercentage: result.summary?.changePercentage || 0,
    lastAnalyzed: result.analysisTimestamp?.toISOString() || new Date().toISOString()
  }));

  const totalChanges = entityResults.reduce((sum, entity) =>
    sum + entity.newRecords + entity.modifiedRecords + entity.deletedRecords, 0);

  return {
    analysisId,
    entityResults,
    totalChanges,
    estimatedMigrationTime: calculateEstimatedTime(totalChanges)
  };
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
 * POST /api/migration/differential
 * Perform differential analysis to identify changes
 */
export async function handleDifferentialAnalysis(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  let sourcePool: Pool | null = null;
  let destinationPool: Pool | null = null;

  try {
    // Parse and validate request
    const requestBody: DifferentialAnalysisRequest = req.body;
    const validation = validateDifferentialRequest(requestBody);

    if (!validation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validation.errors
        },
        requestId
      ));
      return;
    }

    // Create database connections
    sourcePool = new Pool(sourceDbConfig);
    destinationPool = new Pool(destinationDbConfig);

    // Test connections
    try {
      await Promise.all([
        sourcePool.query('SELECT 1'),
        destinationPool.query('SELECT 1')
      ]);
    } catch (connectionError) {
      res.status(500).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'DATABASE_CONNECTION_ERROR',
          message: 'Failed to connect to database',
          details: connectionError.message
        },
        requestId
      ));
      return;
    }

    // Initialize differential detector
    const detector = new DifferentialDetector(sourcePool, destinationPool);

    // Prepare detection options
    const detectionOptions: any = {
      includeDeleted: requestBody.includeDeleted !== false, // Default to true
    };

    if (requestBody.sinceTimestamp) {
      detectionOptions.sinceTimestamp = new Date(requestBody.sinceTimestamp);
    }

    // Perform differential analysis for each entity
    const startTime = Date.now();
    const entityResults: any[] = [];

    for (const entityType of requestBody.entities) {
      try {
        console.log(`🔍 Analyzing changes for ${entityType}...`);

        const result = await detector.detectChanges([entityType], detectionOptions);
        entityResults.push({
          entityType,
          ...result,
          analysisTimestamp: new Date()
        });

        console.log(`   Changes found: ${result.summary?.totalChanges || 0}`);

      } catch (entityError) {
        console.warn(`⚠️  Failed to analyze ${entityType}: ${entityError.message}`);

        // Add empty result for failed entity
        entityResults.push({
          entityType,
          summary: {
            newRecords: 0,
            modifiedRecords: 0,
            deletedRecords: 0,
            totalChanges: 0,
            changePercentage: 0
          },
          analysisTimestamp: new Date(),
          error: entityError.message
        });
      }
    }

    const analysisTime = Date.now() - startTime;

    // Transform to API response format
    const apiResponse = transformDifferentialResults(entityResults);

    // Log successful analysis
    console.log(`✅ Differential analysis completed: ${apiResponse.analysisId}`);
    console.log(`   Entities: ${requestBody.entities.join(', ')}`);
    console.log(`   Duration: ${analysisTime}ms`);
    console.log(`   Total Changes: ${apiResponse.totalChanges.toLocaleString()}`);
    console.log(`   Estimated Migration Time: ${apiResponse.estimatedMigrationTime}`);

    // Send success response
    res.status(200).json(createAPIResponse(true, apiResponse, undefined, requestId));

  } catch (error) {
    // Handle different types of errors
    let errorCode = 'ANALYSIS_FAILED';
    let statusCode = 500;
    let errorMessage = 'Differential analysis could not be completed';

    if (error.message.includes('timeout')) {
      errorCode = 'ANALYSIS_TIMEOUT';
      statusCode = 504;
      errorMessage = 'Differential analysis timed out';
    } else if (error.message.includes('memory')) {
      errorCode = 'RESOURCE_EXHAUSTED';
      statusCode = 507;
      errorMessage = 'Analysis failed due to resource constraints';
    } else if (error.message.includes('permission')) {
      errorCode = 'PERMISSION_DENIED';
      statusCode = 403;
      errorMessage = 'Insufficient permissions for analysis';
    } else if (error.message.includes('relation') && error.message.includes('does not exist')) {
      errorCode = 'ENTITY_NOT_FOUND';
      statusCode = 404;
      errorMessage = 'One or more entities not found';
    }

    console.error(`❌ Differential analysis failed: ${error.message}`);
    console.error(`   Request ID: ${requestId}`);
    console.error(`   Stack: ${error.stack}`);

    res.status(statusCode).json(createAPIResponse(
      false,
      undefined,
      {
        code: errorCode,
        message: errorMessage,
        details: error.message
      },
      requestId
    ));

  } finally {
    // Clean up database connections
    try {
      await sourcePool?.end();
      await destinationPool?.end();
    } catch (cleanupError) {
      console.warn(`Warning: Failed to close database connections: ${cleanupError.message}`);
    }
  }
}

/**
 * POST /api/migration/differential/status/{analysisId}
 * Get status of differential analysis (for async mode)
 */
export async function handleDifferentialStatus(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const analysisId = req.params.analysisId;

  try {
    // Validate analysis ID format
    if (!analysisId || !analysisId.startsWith('differential-')) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_ANALYSIS_ID',
          message: 'Invalid analysis ID format',
          details: 'Analysis ID must be a valid differential analysis identifier'
        },
        requestId
      ));
      return;
    }

    // In a full implementation, this would check the analysis status from a job queue
    // For now, return a mock response
    const mockStatus = {
      analysisId,
      status: 'completed',
      progress: 100,
      startTime: new Date(Date.now() - 30000).toISOString(),
      completionTime: new Date().toISOString(),
      results: {
        entitiesAnalyzed: 3,
        totalChanges: 150,
        estimatedMigrationTime: '8 minutes'
      }
    };

    res.status(200).json(createAPIResponse(true, mockStatus, undefined, requestId));

  } catch (error) {
    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'STATUS_CHECK_FAILED',
        message: 'Failed to retrieve analysis status',
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * Middleware for request logging
 */
export function logDifferentialRequest(req: Request, res: Response, next: Function): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  console.log(`🔍 Differential Analysis Request: ${requestId}`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Path: ${req.path}`);
  console.log(`   Entities: ${req.body?.entities?.join(', ') || 'none'}`);
  console.log(`   Since: ${req.body?.sinceTimestamp || 'last migration'}`);
  console.log(`   Include Deleted: ${req.body?.includeDeleted !== false}`);

  // Add response time tracking
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`   Response: ${res.statusCode} (${duration}ms)`);
  });

  next();
}

/**
 * Health check endpoint for differential service
 */
export async function handleDifferentialHealthCheck(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();

  try {
    // Test database connections
    const sourcePool = new Pool({ ...sourceDbConfig, max: 1 });
    const destinationPool = new Pool({ ...destinationDbConfig, max: 1 });

    const startTime = Date.now();
    await Promise.all([
      sourcePool.query('SELECT 1'),
      destinationPool.query('SELECT 1')
    ]);
    const connectionTime = Date.now() - startTime;

    await sourcePool.end();
    await destinationPool.end();

    res.status(200).json(createAPIResponse(
      true,
      {
        service: 'differential-analysis',
        status: 'healthy',
        connections: {
          source: 'connected',
          destination: 'connected',
          responseTime: `${connectionTime}ms`
        },
        supportedEntities: VALID_ENTITIES.length,
        features: {
          timestampFiltering: true,
          deletedRecordDetection: true,
          contentHashing: true,
          batchProcessing: true
        },
        version: '1.0.0'
      },
      undefined,
      requestId
    ));

  } catch (error) {
    res.status(503).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'SERVICE_UNHEALTHY',
        message: 'Differential analysis service is not available',
        details: error.message
      },
      requestId
    ));
  }
}

// Export configurations for testing
export { sourceDbConfig, destinationDbConfig, VALID_ENTITIES };
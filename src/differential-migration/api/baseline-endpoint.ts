/**
 * Baseline Analysis API Endpoint
 *
 * Implements POST /api/migration/baseline with OpenAPI schema validation
 * Integrates with BaselineAnalyzer service for database comparison
 */

import { Request, Response } from 'express';
import { Pool, PoolConfig } from 'pg';
import { BaselineAnalyzer } from '../services/baseline-analyzer';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Request/Response interfaces matching OpenAPI schema
interface BaselineAnalysisRequest {
  entities: string[];
  includeMapping?: boolean;
}

interface BaselineAnalysisResponse {
  analysisId: string;
  timestamp: string;
  entitySummary: EntityAnalysisSummary[];
  overallStatus: 'complete' | 'partial' | 'failed';
  totalRecords: number;
  migrationGaps: MigrationGap[];
}

interface EntityAnalysisSummary {
  entityType: string;
  sourceCount: number;
  destinationCount: number;
  mappingCount: number;
  lastMigrationTimestamp?: string;
  status: 'synced' | 'behind' | 'ahead' | 'missing';
}

interface MigrationGap {
  entityType: string;
  missingRecords: number;
  orphanedMappings: number;
  inconsistentData: number;
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
function validateBaselineRequest(req: BaselineAnalysisRequest): { isValid: boolean; errors: string[] } {
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

  // Validate includeMapping parameter
  if (req.includeMapping !== undefined && typeof req.includeMapping !== 'boolean') {
    errors.push('includeMapping must be a boolean');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Transform service response to API response format
 */
function transformBaselineReport(report: any): BaselineAnalysisResponse {
  return {
    analysisId: report.analysisId,
    timestamp: report.generatedAt.toISOString(),
    entitySummary: report.entityResults.map((result: any) => ({
      entityType: result.entityType,
      sourceCount: result.sourceCount,
      destinationCount: result.destinationCount,
      mappingCount: result.mappingCount || result.destinationCount,
      lastMigrationTimestamp: result.lastMigrationTimestamp?.toISOString(),
      status: result.recordGap === 0 ? 'synced' :
              result.recordGap > 0 ? 'behind' :
              result.recordGap < 0 ? 'ahead' : 'missing'
    })),
    overallStatus: report.overallStatus === 'gaps_detected' ? 'partial' :
                   report.overallStatus === 'critical_issues' ? 'failed' : 'complete',
    totalRecords: report.summary?.totalSourceRecords || 0,
    migrationGaps: report.entityResults
      .filter((result: any) => result.recordGap > 0)
      .map((result: any) => ({
        entityType: result.entityType,
        missingRecords: result.recordGap,
        orphanedMappings: 0, // Would be calculated from mapping validation
        inconsistentData: 0   // Would be calculated from validation results
      }))
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
 * POST /api/migration/baseline
 * Analyze current migration baseline
 */
export async function handleBaselineAnalysis(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  let sourcePool: Pool | null = null;
  let destinationPool: Pool | null = null;

  try {
    // Parse and validate request
    const requestBody: BaselineAnalysisRequest = req.body;
    const validation = validateBaselineRequest(requestBody);

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

    // Initialize baseline analyzer
    const analyzer = new BaselineAnalyzer(sourcePool, destinationPool);
    const analysisId = `baseline-${Date.now()}-${requestId.split('-')[0]}`;

    // Perform baseline analysis
    const startTime = Date.now();
    const report = await analyzer.generateBaselineReport(
      requestBody.entities,
      analysisId
    );
    const analysisTime = Date.now() - startTime;

    // Transform to API response format
    const apiResponse = transformBaselineReport(report);

    // Log successful analysis
    console.log(`✅ Baseline analysis completed: ${analysisId}`);
    console.log(`   Entities: ${requestBody.entities.join(', ')}`);
    console.log(`   Duration: ${analysisTime}ms`);
    console.log(`   Status: ${apiResponse.overallStatus}`);
    console.log(`   Total Records: ${apiResponse.totalRecords.toLocaleString()}`);

    // Send success response
    res.status(200).json(createAPIResponse(true, apiResponse, undefined, requestId));

  } catch (error) {
    // Handle different types of errors
    let errorCode = 'ANALYSIS_FAILED';
    let statusCode = 500;
    let errorMessage = 'Baseline analysis could not be completed';

    if (error.message.includes('timeout')) {
      errorCode = 'ANALYSIS_TIMEOUT';
      statusCode = 504;
      errorMessage = 'Baseline analysis timed out';
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

    console.error(`❌ Baseline analysis failed: ${error.message}`);
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
 * Middleware for request logging
 */
export function logBaselineRequest(req: Request, res: Response, next: Function): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  console.log(`📊 Baseline Analysis Request: ${requestId}`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Path: ${req.path}`);
  console.log(`   Entities: ${req.body?.entities?.join(', ') || 'none'}`);
  console.log(`   Include Mapping: ${req.body?.includeMapping || false}`);

  // Add response time tracking
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`   Response: ${res.statusCode} (${duration}ms)`);
  });

  next();
}

/**
 * Health check endpoint for baseline service
 */
export async function handleBaselineHealthCheck(req: Request, res: Response): Promise<void> {
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
        service: 'baseline-analysis',
        status: 'healthy',
        connections: {
          source: 'connected',
          destination: 'connected',
          responseTime: `${connectionTime}ms`
        },
        supportedEntities: VALID_ENTITIES.length,
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
        message: 'Baseline analysis service is not available',
        details: error.message
      },
      requestId
    ));
  }
}

// Export database configs for testing
export { sourceDbConfig, destinationDbConfig, VALID_ENTITIES };
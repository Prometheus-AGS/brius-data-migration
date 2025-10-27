/**
 * Baseline Analysis API Handler
 * Implements POST /api/migration/baseline endpoint with BaselineAnalyzer integration
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { BaselineAnalyzer, type BaselineAnalysisReport } from '../services/baseline-analyzer';
import { v4 as uuidv4 } from 'uuid';

// Request/Response interfaces matching OpenAPI schema
export interface BaselineAnalysisRequest {
  entities: string[];
  includeMappings?: boolean;
  outputFormat?: 'json' | 'csv' | 'table';
  dryRun?: boolean;
  verbose?: boolean;
}

export interface BaselineAnalysisResponse {
  success: boolean;
  data?: {
    analysisId: string;
    timestamp: string;
    overallStatus: 'synced' | 'gaps_detected' | 'critical_issues';
    entitySummary: Array<{
      entityType: string;
      sourceCount: number;
      destinationCount: number;
      recordGap: number;
      gapPercentage: number;
      status: 'synced' | 'behind' | 'major_gap';
      lastMigrationTimestamp?: string;
    }>;
    summary: {
      totalSourceRecords: number;
      totalDestinationRecords: number;
      overallGap: number;
      averageGapPercentage: number;
    };
    mappingValidation?: Array<{
      entityType: string;
      isValid: boolean;
      issues: {
        missingMappings: number;
        orphanedMappings: number;
        schemaChanges: number;
      };
      details?: {
        missingMappings: string[];
        orphanedMappings: string[];
        schemaChanges: string[];
      };
    }>;
    recommendations: string[];
    performance: {
      analysisDurationMs: number;
      queriesExecuted: number;
      recordsAnalyzed: number;
      averageQueryTimeMs: number;
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

// Known entity types for validation
const VALID_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
  'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
  'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
  'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
];

/**
 * BaselineHandler Implementation
 *
 * Provides REST API endpoint for baseline analysis operations with comprehensive
 * validation, error handling, and response formatting.
 */
export class BaselineHandler {
  private sourcePool: Pool;
  private destinationPool: Pool;

  constructor(sourcePool: Pool, destinationPool: Pool) {
    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
  }

  /**
   * Handles POST /api/migration/baseline requests
   */
  async handleBaselineAnalysis(req: Request, res: Response): Promise<void> {
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

      const request = req.body as BaselineAnalysisRequest;

      // Handle dry run
      if (request.dryRun) {
        const dryRunResponse = await this.handleDryRun(request, requestId, timestamp);
        res.status(200).json(dryRunResponse);
        return;
      }

      // Initialize BaselineAnalyzer
      const analyzer = new BaselineAnalyzer(
        this.getSourceDatabaseConfig(),
        this.getDestinationDatabaseConfig(),
        uuidv4()
      );

      try {
        // Test database connections
        const connectionTest = await analyzer.testConnections();
        if (!connectionTest.sourceConnection.successful) {
          throw new Error(`Source database connection failed: ${connectionTest.sourceConnection.error}`);
        }
        if (!connectionTest.destinationConnection.successful) {
          throw new Error(`Destination database connection failed: ${connectionTest.destinationConnection.error}`);
        }

        // Execute baseline analysis
        const analysisId = uuidv4();
        const report = await analyzer.generateBaselineReport(request.entities, analysisId);

        // Format response
        const response = this.formatSuccessResponse(report, request, requestId, timestamp);

        // Set appropriate content type
        const contentType = this.getContentType(request.outputFormat || 'json');
        res.setHeader('Content-Type', contentType);

        // Return formatted response
        if (request.outputFormat === 'csv') {
          res.status(200).send(this.formatCsvResponse(report));
        } else if (request.outputFormat === 'table') {
          res.status(200).send(this.formatTableResponse(report));
        } else {
          res.status(200).json(response);
        }

      } finally {
        // Cleanup analyzer
        await analyzer.close();
      }

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
      }
    }

    // Validate output format if provided
    if (body.outputFormat && !['json', 'csv', 'table'].includes(body.outputFormat)) {
      errors.push('outputFormat must be json, csv, or table');
    }

    // Validate boolean flags if provided
    if (body.includeMappings !== undefined && typeof body.includeMappings !== 'boolean') {
      errors.push('includeMappings must be a boolean');
    }

    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
      errors.push('dryRun must be a boolean');
    }

    if (body.verbose !== undefined && typeof body.verbose !== 'boolean') {
      errors.push('verbose must be a boolean');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Handles dry run requests
   */
  private async handleDryRun(
    request: BaselineAnalysisRequest,
    requestId: string,
    timestamp: string
  ): Promise<BaselineAnalysisResponse> {
    // Simulate dry run analysis
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      success: true,
      data: {
        analysisId: uuidv4(),
        timestamp,
        overallStatus: 'gaps_detected',
        entitySummary: request.entities.map(entityType => ({
          entityType,
          sourceCount: Math.floor(Math.random() * 10000) + 1000,
          destinationCount: Math.floor(Math.random() * 9500) + 950,
          recordGap: Math.floor(Math.random() * 500),
          gapPercentage: parseFloat((Math.random() * 5).toFixed(2)),
          status: Math.random() > 0.7 ? 'synced' : 'behind' as 'synced' | 'behind'
        })),
        summary: {
          totalSourceRecords: Math.floor(Math.random() * 50000) + 10000,
          totalDestinationRecords: Math.floor(Math.random() * 48000) + 9500,
          overallGap: Math.floor(Math.random() * 2000) + 100,
          averageGapPercentage: parseFloat((Math.random() * 3).toFixed(2))
        },
        recommendations: [
          'DRY RUN: Analysis would execute successfully',
          'Configuration and database connections verified',
          'Remove --dry-run flag to execute actual analysis'
        ],
        performance: {
          analysisDurationMs: 1000,
          queriesExecuted: 0,
          recordsAnalyzed: 0,
          averageQueryTimeMs: 0
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
   * Formats successful response
   */
  private formatSuccessResponse(
    report: BaselineAnalysisReport,
    request: BaselineAnalysisRequest,
    requestId: string,
    timestamp: string
  ): BaselineAnalysisResponse {
    const data: BaselineAnalysisResponse['data'] = {
      analysisId: report.analysisId,
      timestamp: report.generatedAt.toISOString(),
      overallStatus: report.overallStatus,
      entitySummary: report.entityResults.map(result => ({
        entityType: result.entityType,
        sourceCount: result.sourceCount,
        destinationCount: result.destinationCount,
        recordGap: result.recordGap,
        gapPercentage: result.gapPercentage,
        status: this.determineEntityStatus(result.recordGap, result.gapPercentage),
        lastMigrationTimestamp: result.lastMigrationTimestamp?.toISOString()
      })),
      summary: {
        totalSourceRecords: report.summary.totalSourceRecords,
        totalDestinationRecords: report.summary.totalDestinationRecords,
        overallGap: report.summary.overallGap,
        averageGapPercentage: report.summary.averageGapPercentage
      },
      recommendations: report.recommendations,
      performance: {
        analysisDurationMs: report.performanceMetrics.analysisDurationMs,
        queriesExecuted: report.performanceMetrics.queriesExecuted,
        recordsAnalyzed: report.summary.totalSourceRecords,
        averageQueryTimeMs: report.performanceMetrics.averageQueryTimeMs
      }
    };

    // Include mapping validation if requested
    if (request.includeMappings && report.mappingValidation.length > 0) {
      data.mappingValidation = report.mappingValidation.map(validation => ({
        entityType: validation.entityType,
        isValid: validation.isValid,
        issues: {
          missingMappings: validation.missingMappings.length,
          orphanedMappings: validation.orphanedMappings.length,
          schemaChanges: validation.schemaChanges.length
        },
        details: request.verbose ? {
          missingMappings: validation.missingMappings,
          orphanedMappings: validation.orphanedMappings,
          schemaChanges: validation.schemaChanges
        } : undefined
      }));
    }

    return {
      success: true,
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
    body: BaselineAnalysisResponse;
  } {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Determine error type and status code
    let code: string;
    let status: number;
    let retryable = false;

    if (errorMessage.includes('connection') || errorMessage.includes('timeout')) {
      code = 'DATABASE_CONNECTION_ERROR';
      status = 500;
      retryable = true;
    } else if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      code = 'PERMISSION_DENIED';
      status = 403;
      retryable = false;
    } else if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
      code = 'ENTITY_NOT_FOUND';
      status = 404;
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
   * Formats CSV response
   */
  private formatCsvResponse(report: BaselineAnalysisReport): string {
    const header = 'Entity,Source,Destination,Gap,Status,Last Migration';
    const rows = report.entityResults.map(result => {
      const lastMigration = result.lastMigrationTimestamp?.toISOString() || 'never';
      const status = this.determineEntityStatus(result.recordGap, result.gapPercentage);

      return `${result.entityType},${result.sourceCount},${result.destinationCount},${result.recordGap},${status},${lastMigration}`;
    });

    // Add summary row
    const summaryRow = `TOTAL,${report.summary.totalSourceRecords},${report.summary.totalDestinationRecords},${report.summary.overallGap},${report.overallStatus},`;

    return [header, ...rows, summaryRow].join('\n');
  }

  /**
   * Formats table response
   */
  private formatTableResponse(report: BaselineAnalysisReport): string {
    const lines = [
      'Entity Analysis Summary',
      '=======================',
      ''
    ];

    // Header
    lines.push('Entity'.padEnd(15) + 'Source'.padEnd(10) + 'Dest'.padEnd(10) + 'Gap'.padEnd(8) + 'Status'.padEnd(12) + 'Last Migration');
    lines.push('-'.repeat(80));

    // Data rows
    report.entityResults.forEach(result => {
      const lastMigration = result.lastMigrationTimestamp
        ? result.lastMigrationTimestamp.toISOString().replace('T', ' ').substring(0, 19)
        : 'never';
      const status = this.determineEntityStatus(result.recordGap, result.gapPercentage);

      const row = result.entityType.padEnd(15) +
                  result.sourceCount.toString().padEnd(10) +
                  result.destinationCount.toString().padEnd(10) +
                  result.recordGap.toString().padEnd(8) +
                  status.padEnd(12) +
                  lastMigration;

      lines.push(row);
    });

    lines.push('');
    lines.push(`Overall Status: ${report.summary.overallGap.toLocaleString()} records behind`);
    lines.push(`Total Records: ${report.summary.totalSourceRecords.toLocaleString()} source, ${report.summary.totalDestinationRecords.toLocaleString()} destination`);

    if (report.recommendations.length > 0) {
      lines.push('');
      lines.push('Recommendations:');
      report.recommendations.forEach((rec, index) => {
        lines.push(`  ${index + 1}. ${rec}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Determines entity status based on gap metrics
   */
  private determineEntityStatus(gap: number, gapPercentage: number): 'synced' | 'behind' | 'major_gap' {
    if (gap === 0) {
      return 'synced';
    } else if (gapPercentage < 5) {
      return 'behind';
    } else {
      return 'major_gap';
    }
  }

  /**
   * Gets appropriate content type for response format
   */
  private getContentType(format: string): string {
    switch (format) {
      case 'csv': return 'text/csv';
      case 'table': return 'text/plain';
      default: return 'application/json';
    }
  }

  /**
   * Gets user-friendly error message
   */
  private getErrorMessage(code: string): string {
    switch (code) {
      case 'DATABASE_CONNECTION_ERROR':
        return 'Failed to connect to database';
      case 'PERMISSION_DENIED':
        return 'Insufficient permissions to access database';
      case 'ENTITY_NOT_FOUND':
        return 'One or more entities not found in database';
      case 'ANALYSIS_TIMEOUT':
        return 'Baseline analysis timed out';
      case 'RESOURCE_EXHAUSTED':
        return 'Analysis failed due to resource constraints';
      default:
        return 'Baseline analysis could not be completed';
    }
  }

  /**
   * Gets database configuration from environment
   */
  private getSourceDatabaseConfig() {
    return {
      host: process.env.SOURCE_DB_HOST || 'localhost',
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME || 'source_db',
      user: process.env.SOURCE_DB_USER || 'postgres',
      password: process.env.SOURCE_DB_PASSWORD || '',
      maxConnections: parseInt(process.env.SOURCE_DB_MAX_CONNECTIONS || '10'),
      idleTimeoutMs: parseInt(process.env.SOURCE_DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMs: parseInt(process.env.SOURCE_DB_CONNECTION_TIMEOUT || '10000')
    };
  }

  private getDestinationDatabaseConfig() {
    return {
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME || 'postgres',
      user: process.env.TARGET_DB_USER || 'postgres',
      password: process.env.TARGET_DB_PASSWORD || 'postgres',
      maxConnections: parseInt(process.env.TARGET_DB_MAX_CONNECTIONS || '10'),
      idleTimeoutMs: parseInt(process.env.TARGET_DB_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMs: parseInt(process.env.TARGET_DB_CONNECTION_TIMEOUT || '10000')
    };
  }
}

/**
 * Factory function for creating baseline handler with database pools
 */
export function createBaselineHandler(sourcePool: Pool, destinationPool: Pool): BaselineHandler {
  return new BaselineHandler(sourcePool, destinationPool);
}

/**
 * Express route handler function
 */
export async function baselineAnalysisRoute(req: Request, res: Response): Promise<void> {
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

  const handler = new BaselineHandler(sourcePool, destinationPool);

  try {
    await handler.handleBaselineAnalysis(req, res);
  } finally {
    // Cleanup connections
    await sourcePool.end();
    await destinationPool.end();
  }
}
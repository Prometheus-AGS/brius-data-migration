/**
 * Migration Logs API Handler
 * Implements GET /api/migration/logs/{sessionId} endpoint with structured log retrieval
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

// Request/Response interfaces matching OpenAPI schema
export interface MigrationLogsRequest {
  level?: 'debug' | 'info' | 'warn' | 'error';
  limit?: number;
  offset?: number;
  startTime?: string;
  endTime?: string;
  entityType?: string;
  format?: 'json' | 'text';
  download?: boolean;
}

export interface MigrationLogsResponse {
  success: boolean;
  data?: {
    sessionId: string;
    totalLogs: number;
    filteredLogs: number;
    logs: Array<{
      logId: string;
      timestamp: string;
      level: 'debug' | 'info' | 'warn' | 'error';
      entityType?: string;
      batchNumber?: number;
      message: string;
      details?: any;
      performance?: {
        durationMs?: number;
        recordsProcessed?: number;
        memoryUsageMb?: number;
      };
      context?: {
        sessionId: string;
        requestId?: string;
        userId?: string;
        [key: string]: any;
      };
    }>;
    pagination: {
      limit: number;
      offset: number;
      hasMore: boolean;
      totalPages: number;
      currentPage: number;
    };
    filters: {
      level?: string;
      entityType?: string;
      timeRange?: {
        startTime: string;
        endTime: string;
      };
    };
    downloadUrl?: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    retryable?: boolean;
    suggestions?: string[];
  };
  meta: {
    apiVersion: string;
    requestId: string;
    timestamp: string;
    responseTime?: number;
  };
}

// Log entry structure for parsing
interface LogEntry {
  logId: string;
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  sessionId: string;
  entityType?: string;
  batchNumber?: number;
  message: string;
  details?: any;
  performance?: {
    durationMs?: number;
    recordsProcessed?: number;
    memoryUsageMb?: number;
  };
  context?: any;
}

/**
 * LogsHandler Implementation
 *
 * Provides REST API endpoint for migration log retrieval with filtering,
 * pagination, format conversion, and download support.
 */
export class LogsHandler {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private logDirectory: string;

  constructor(sourcePool: Pool, destinationPool: Pool, logDirectory?: string) {
    this.sourcePool = sourcePool;
    this.destinationPool = destinationPool;
    this.logDirectory = logDirectory || process.env.MIGRATION_LOG_DIR || './logs';
  }

  /**
   * Handles GET /api/migration/logs/{sessionId} requests
   */
  async handleLogsRetrieval(req: Request, res: Response): Promise<void> {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();
    const startTime = Date.now();
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
            },
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

      // Validate query parameters
      const validationResult = this.validateQuery(req.query);
      if (!validationResult.isValid) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_QUERY_PARAMETERS',
            message: 'Invalid query parameters',
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

      const queryParams = req.query as MigrationLogsRequest;

      // Check if session exists
      const sessionExists = await this.checkSessionExists(sessionId);
      if (!sessionExists) {
        res.status(404).json({
          success: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Migration session not found: ${sessionId}`,
            details: {
              sessionId,
              suggestions: [
                'Verify the session ID is correct',
                'Check if the migration session has been cleaned up',
                'Use GET /api/migration/sessions to list active sessions'
              ]
            },
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

      // Handle download request
      if (queryParams.download) {
        await this.handleLogDownload(req, res, sessionId, queryParams, requestId, timestamp);
        return;
      }

      // Retrieve and filter logs
      const logs = await this.retrieveLogs(sessionId, queryParams);

      // Handle text format response
      if (queryParams.format === 'text') {
        const textLogs = this.formatLogsAsText(logs.entries);
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(textLogs);
        return;
      }

      // Format JSON response
      const response = this.formatLogsResponse(
        logs,
        sessionId,
        queryParams,
        requestId,
        timestamp,
        Date.now() - startTime
      );

      res.status(200).json(response);

    } catch (error) {
      const errorResponse = this.formatErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Validates query parameters
   */
  validateQuery(query: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate level
    if (query.level && !['debug', 'info', 'warn', 'error'].includes(query.level)) {
      errors.push('level must be one of: debug, info, warn, error');
    }

    // Validate limit
    if (query.limit !== undefined) {
      const limit = parseInt(query.limit);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        errors.push('limit must be a number between 1 and 1000');
      }
    }

    // Validate offset
    if (query.offset !== undefined) {
      const offset = parseInt(query.offset);
      if (isNaN(offset) || offset < 0) {
        errors.push('offset must be a non-negative number');
      }
    }

    // Validate timestamps
    if (query.startTime && isNaN(Date.parse(query.startTime))) {
      errors.push('startTime must be a valid ISO timestamp');
    }

    if (query.endTime && isNaN(Date.parse(query.endTime))) {
      errors.push('endTime must be a valid ISO timestamp');
    }

    // Validate format
    if (query.format && !['json', 'text'].includes(query.format)) {
      errors.push('format must be either json or text');
    }

    // Validate boolean flags
    if (query.download !== undefined && typeof query.download !== 'boolean' && query.download !== 'true' && query.download !== 'false') {
      errors.push('download must be a boolean');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Checks if session exists in the database or has logs
   */
  private async checkSessionExists(sessionId: string): Promise<boolean> {
    try {
      // Check in database first
      const dbCheck = await this.destinationPool.query(
        'SELECT COUNT(*) as count FROM migration_control WHERE session_id = $1',
        [sessionId]
      );

      if (parseInt(dbCheck.rows[0].count) > 0) {
        return true;
      }

      // Check if log files exist for session
      const logFiles = await this.findLogFilesForSession(sessionId);
      return logFiles.length > 0;

    } catch (error) {
      console.error('Error checking session existence:', error);
      return false;
    }
  }

  /**
   * Retrieves and filters logs for session
   */
  private async retrieveLogs(
    sessionId: string,
    params: MigrationLogsRequest
  ): Promise<{ entries: LogEntry[]; totalCount: number; filteredCount: number }> {
    const logs: LogEntry[] = [];

    // First, try to get logs from database
    const dbLogs = await this.getLogsFromDatabase(sessionId, params);
    logs.push(...dbLogs);

    // Then, get logs from files
    const fileLogs = await this.getLogsFromFiles(sessionId, params);
    logs.push(...fileLogs);

    // Remove duplicates and sort by timestamp
    const uniqueLogs = this.deduplicateLogs(logs);
    const sortedLogs = uniqueLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply filters
    const filteredLogs = this.applyLogFilters(sortedLogs, params);

    // Apply pagination
    const limit = params.limit || 100;
    const offset = params.offset || 0;
    const paginatedLogs = filteredLogs.slice(offset, offset + limit);

    return {
      entries: paginatedLogs,
      totalCount: sortedLogs.length,
      filteredCount: filteredLogs.length
    };
  }

  /**
   * Gets logs from database tables
   */
  private async getLogsFromDatabase(sessionId: string, params: MigrationLogsRequest): Promise<LogEntry[]> {
    try {
      let query = `
        SELECT
          mc.id as log_id,
          mc.created_at as timestamp,
          'info' as level,
          mc.session_id,
          mc.entity_type,
          mc.batch_number,
          CASE
            WHEN mc.status = 'completed' THEN 'Batch completed successfully'
            WHEN mc.status = 'failed' THEN COALESCE(mc.error_message, 'Batch processing failed')
            WHEN mc.status = 'running' THEN 'Batch processing started'
            ELSE 'Batch status: ' || mc.status
          END as message,
          json_build_object(
            'status', mc.status,
            'recordsProcessed', mc.records_processed,
            'recordsFailed', mc.records_failed,
            'errorMessage', mc.error_message,
            'errorDetails', mc.error_details
          ) as details,
          json_build_object(
            'durationMs', EXTRACT(EPOCH FROM (mc.completed_at - mc.started_at)) * 1000,
            'recordsProcessed', mc.records_processed
          ) as performance,
          json_build_object(
            'sessionId', mc.session_id,
            'batchId', mc.id
          ) as context
        FROM migration_control mc
        WHERE mc.session_id = $1
      `;

      const queryParams = [sessionId];

      if (params.entityType) {
        query += ' AND mc.entity_type = $' + (queryParams.length + 1);
        queryParams.push(params.entityType);
      }

      if (params.startTime) {
        query += ' AND mc.created_at >= $' + (queryParams.length + 1);
        queryParams.push(params.startTime);
      }

      if (params.endTime) {
        query += ' AND mc.created_at <= $' + (queryParams.length + 1);
        queryParams.push(params.endTime);
      }

      query += ' ORDER BY mc.created_at DESC';

      const result = await this.destinationPool.query(query, queryParams);

      return result.rows.map(row => ({
        logId: row.log_id,
        timestamp: new Date(row.timestamp),
        level: row.level as 'info',
        sessionId: row.session_id,
        entityType: row.entity_type,
        batchNumber: row.batch_number,
        message: row.message,
        details: row.details,
        performance: row.performance,
        context: row.context
      }));

    } catch (error) {
      console.error('Error retrieving database logs:', error);
      return [];
    }
  }

  /**
   * Gets logs from log files
   */
  private async getLogsFromFiles(sessionId: string, params: MigrationLogsRequest): Promise<LogEntry[]> {
    try {
      const logFiles = await this.findLogFilesForSession(sessionId);
      const logs: LogEntry[] = [];

      for (const filePath of logFiles) {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const parsedLogs = this.parseLogFile(fileContent, sessionId);
        logs.push(...parsedLogs);
      }

      return logs;

    } catch (error) {
      console.error('Error reading log files:', error);
      return [];
    }
  }

  /**
   * Finds log files for a specific session
   */
  private async findLogFilesForSession(sessionId: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logDirectory);
      const logFiles = files.filter(file =>
        file.includes(sessionId) && (file.endsWith('.log') || file.endsWith('.json'))
      );

      return logFiles.map(file => path.join(this.logDirectory, file));

    } catch (error) {
      console.error('Error finding log files:', error);
      return [];
    }
  }

  /**
   * Parses log file content
   */
  private parseLogFile(content: string, sessionId: string): LogEntry[] {
    const logs: LogEntry[] = [];
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        // Try to parse as JSON first
        const jsonLog = JSON.parse(line);
        if (jsonLog.sessionId === sessionId || jsonLog.session_id === sessionId) {
          logs.push(this.normalizeLogEntry(jsonLog));
        }
      } catch {
        // Try to parse as structured text log
        const textLog = this.parseTextLogLine(line, sessionId);
        if (textLog) {
          logs.push(textLog);
        }
      }
    }

    return logs;
  }

  /**
   * Normalizes log entry from various sources
   */
  private normalizeLogEntry(log: any): LogEntry {
    return {
      logId: log.logId || log.id || uuidv4(),
      timestamp: new Date(log.timestamp || log.created_at || Date.now()),
      level: log.level || 'info',
      sessionId: log.sessionId || log.session_id,
      entityType: log.entityType || log.entity_type,
      batchNumber: log.batchNumber || log.batch_number,
      message: log.message || log.msg || 'Log entry',
      details: log.details || log.data,
      performance: log.performance || log.perf,
      context: log.context || { sessionId: log.sessionId || log.session_id }
    };
  }

  /**
   * Parses text-format log line
   */
  private parseTextLogLine(line: string, sessionId: string): LogEntry | null {
    // Basic regex for common log formats
    const logRegex = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)\s+\[?(\w+)\]?\s+(.*)/;
    const match = line.match(logRegex);

    if (match && line.includes(sessionId)) {
      return {
        logId: uuidv4(),
        timestamp: new Date(match[1]),
        level: (match[2]?.toLowerCase() || 'info') as 'debug' | 'info' | 'warn' | 'error',
        sessionId,
        message: match[3] || line,
        context: { sessionId }
      };
    }

    return null;
  }

  /**
   * Removes duplicate log entries
   */
  private deduplicateLogs(logs: LogEntry[]): LogEntry[] {
    const seen = new Set<string>();
    return logs.filter(log => {
      const key = `${log.timestamp.getTime()}_${log.message}_${log.sessionId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Applies filters to log entries
   */
  private applyLogFilters(logs: LogEntry[], params: MigrationLogsRequest): LogEntry[] {
    return logs.filter(log => {
      // Level filter
      if (params.level && log.level !== params.level) {
        return false;
      }

      // Entity type filter
      if (params.entityType && log.entityType !== params.entityType) {
        return false;
      }

      // Time range filter
      if (params.startTime && log.timestamp < new Date(params.startTime)) {
        return false;
      }

      if (params.endTime && log.timestamp > new Date(params.endTime)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Handles log download requests
   */
  private async handleLogDownload(
    req: Request,
    res: Response,
    sessionId: string,
    params: MigrationLogsRequest,
    requestId: string,
    timestamp: string
  ): Promise<void> {
    try {
      const logs = await this.retrieveLogs(sessionId, { ...params, limit: 10000 });
      const filename = `migration-logs-${sessionId}-${new Date().toISOString().split('T')[0]}.log`;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const logContent = logs.entries.map(log => {
        const logLine = `${log.timestamp.toISOString()} [${log.level.toUpperCase()}] ${log.entityType ? `[${log.entityType}]` : ''} ${log.message}`;
        if (log.details) {
          return `${logLine}\n  Details: ${JSON.stringify(log.details, null, 2)}`;
        }
        return logLine;
      }).join('\n');

      res.status(200).send(logContent);

    } catch (error) {
      const errorResponse = this.formatErrorResponse(error, requestId, timestamp);
      res.status(errorResponse.status).json(errorResponse.body);
    }
  }

  /**
   * Formats logs as plain text
   */
  private formatLogsAsText(logs: LogEntry[]): string {
    return logs.map(log => {
      let line = `${log.timestamp.toISOString()} [${log.level.toUpperCase()}]`;

      if (log.entityType) {
        line += ` [${log.entityType}]`;
      }

      if (log.batchNumber !== undefined) {
        line += ` [Batch ${log.batchNumber}]`;
      }

      line += ` ${log.message}`;

      if (log.details) {
        line += `\n  Details: ${JSON.stringify(log.details)}`;
      }

      if (log.performance) {
        line += `\n  Performance: ${JSON.stringify(log.performance)}`;
      }

      return line;
    }).join('\n\n');
  }

  /**
   * Formats successful logs response
   */
  private formatLogsResponse(
    logs: { entries: LogEntry[]; totalCount: number; filteredCount: number },
    sessionId: string,
    params: MigrationLogsRequest,
    requestId: string,
    timestamp: string,
    responseTime: number
  ): MigrationLogsResponse {
    const limit = params.limit || 100;
    const offset = params.offset || 0;
    const totalPages = Math.ceil(logs.filteredCount / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    const data: MigrationLogsResponse['data'] = {
      sessionId,
      totalLogs: logs.totalCount,
      filteredLogs: logs.filteredCount,
      logs: logs.entries.map(log => ({
        logId: log.logId,
        timestamp: log.timestamp.toISOString(),
        level: log.level,
        entityType: log.entityType,
        batchNumber: log.batchNumber,
        message: log.message,
        details: log.details,
        performance: log.performance,
        context: log.context
      })),
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < logs.filteredCount,
        totalPages,
        currentPage
      },
      filters: {
        ...(params.level && { level: params.level }),
        ...(params.entityType && { entityType: params.entityType }),
        ...((params.startTime || params.endTime) && {
          timeRange: {
            startTime: params.startTime || '',
            endTime: params.endTime || ''
          }
        })
      }
    };

    if (params.download) {
      data.downloadUrl = `/api/migration/logs/${sessionId}?download=true&format=${params.format || 'text'}`;
    }

    return {
      success: true,
      data,
      meta: {
        apiVersion: '1.0.0',
        requestId,
        timestamp,
        responseTime
      }
    };
  }

  /**
   * Formats error response with appropriate status codes
   */
  private formatErrorResponse(error: any, requestId: string, timestamp: string): {
    status: number;
    body: MigrationLogsResponse;
  } {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    let code: string;
    let status: number;
    let retryable = false;
    let suggestions: string[] = [];

    if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      code = 'LOG_ACCESS_DENIED';
      status = 403;
      retryable = false;
      suggestions = [
        'Check file system permissions for log directory',
        'Verify database access permissions',
        'Ensure service account has read access to logs'
      ];
    } else if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
      code = 'LOG_FILES_NOT_FOUND';
      status = 404;
      retryable = false;
      suggestions = [
        'Check if log files exist for this session',
        'Verify log directory configuration',
        'Session may be too old and logs rotated'
      ];
    } else if (errorMessage.includes('timeout')) {
      code = 'LOG_RETRIEVAL_TIMEOUT';
      status = 504;
      retryable = true;
      suggestions = [
        'Try reducing the time range or limit',
        'Use pagination to retrieve logs in smaller chunks',
        'Consider downloading logs instead of viewing online'
      ];
    } else if (errorMessage.includes('memory') || errorMessage.includes('resource')) {
      code = 'LOG_PROCESSING_ERROR';
      status = 507;
      retryable = true;
      suggestions = [
        'Reduce the number of logs requested',
        'Use more specific filters to limit results',
        'Try downloading logs in smaller batches'
      ];
    } else {
      code = 'LOG_RETRIEVAL_FAILED';
      status = 500;
      retryable = true;
      suggestions = [
        'Check migration logs directory accessibility',
        'Verify database connectivity',
        'Try again with different parameters'
      ];
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
          retryable,
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
      case 'LOG_ACCESS_DENIED':
        return 'Insufficient permissions to access migration logs';
      case 'LOG_FILES_NOT_FOUND':
        return 'Migration logs not found for the specified session';
      case 'LOG_RETRIEVAL_TIMEOUT':
        return 'Log retrieval operation timed out';
      case 'LOG_PROCESSING_ERROR':
        return 'Log processing failed due to resource constraints';
      default:
        return 'Migration logs could not be retrieved';
    }
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
 * Factory function for creating logs handler with database pools
 */
export function createLogsHandler(sourcePool: Pool, destinationPool: Pool, logDirectory?: string): LogsHandler {
  return new LogsHandler(sourcePool, destinationPool, logDirectory);
}

/**
 * Express route handler function
 */
export async function logsRetrievalRoute(req: Request, res: Response): Promise<void> {
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

  const logDirectory = process.env.MIGRATION_LOG_DIR || './logs';
  const handler = new LogsHandler(sourcePool, destinationPool, logDirectory);

  try {
    await handler.handleLogsRetrieval(req, res);
  } finally {
    // Cleanup connections
    await sourcePool.end();
    await destinationPool.end();
  }
}
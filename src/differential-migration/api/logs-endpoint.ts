/**
 * Logs Retrieval API Endpoint
 *
 * Implements GET /api/migration/logs/{sessionId} with filtering, pagination, and export functionality
 * Provides access to detailed migration execution logs and debugging information
 */

import { Request, Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Response interfaces matching OpenAPI schema
interface MigrationLogsResponse {
  sessionId: string;
  logs: LogEntry[];
  totalCount: number;
  hasMore: boolean;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  entityType?: string;
  operationType?: string;
  message: string;
  context?: any;
  recordId?: string;
}

interface LogQueryParams {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  entityType?: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
  format?: 'json' | 'text' | 'csv';
  export?: boolean;
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

// Log storage configuration
const LOG_BASE_DIR = process.env.LOG_DIR || '/tmp/migration-logs';
const MAX_LOG_ENTRIES = parseInt(process.env.MAX_LOG_ENTRIES || '1000');

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
 * Validate query parameters
 */
function validateLogQueryParams(params: LogQueryParams): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate logLevel
  if (params.logLevel && !['debug', 'info', 'warn', 'error'].includes(params.logLevel)) {
    errors.push('logLevel must be one of: debug, info, warn, error');
  }

  // Validate limit
  if (params.limit !== undefined) {
    if (typeof params.limit !== 'number' || params.limit < 1 || params.limit > 1000) {
      errors.push('limit must be a number between 1 and 1000');
    }
  }

  // Validate offset
  if (params.offset !== undefined) {
    if (typeof params.offset !== 'number' || params.offset < 0) {
      errors.push('offset must be a non-negative number');
    }
  }

  // Validate timestamp parameters
  if (params.since && isNaN(new Date(params.since).getTime())) {
    errors.push('since must be a valid ISO timestamp');
  }

  if (params.until && isNaN(new Date(params.until).getTime())) {
    errors.push('until must be a valid ISO timestamp');
  }

  // Validate format
  if (params.format && !['json', 'text', 'csv'].includes(params.format)) {
    errors.push('format must be one of: json, text, csv');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Load logs from file storage
 */
async function loadLogsFromStorage(sessionId: string): Promise<LogEntry[]> {
  const logFile = path.join(LOG_BASE_DIR, `${sessionId}.jsonl`);

  try {
    const logContent = await fs.readFile(logFile, 'utf-8');
    const logLines = logContent.trim().split('\n').filter(line => line.trim());

    const logs: LogEntry[] = logLines.map((line, index) => {
      try {
        const logData = JSON.parse(line);
        return {
          id: logData.id || `log-${index}`,
          timestamp: logData.timestamp || new Date().toISOString(),
          level: logData.level || 'info',
          entityType: logData.entityType,
          operationType: logData.operationType,
          message: logData.message || line,
          context: logData.context,
          recordId: logData.recordId
        };
      } catch (parseError) {
        // Handle malformed log entries
        return {
          id: `log-${index}`,
          timestamp: new Date().toISOString(),
          level: 'info' as const,
          message: line,
          context: { parseError: parseError.message }
        };
      }
    });

    return logs;

  } catch (error) {
    if (error.code === 'ENOENT') {
      // Log file doesn't exist yet
      return [];
    }
    throw new Error(`Failed to load logs: ${error.message}`);
  }
}

/**
 * Filter logs based on query parameters
 */
function filterLogs(logs: LogEntry[], params: LogQueryParams): LogEntry[] {
  let filteredLogs = [...logs];

  // Filter by log level
  if (params.logLevel) {
    const levelPriority = { debug: 0, info: 1, warn: 2, error: 3 };
    const minLevel = levelPriority[params.logLevel];
    filteredLogs = filteredLogs.filter(log => levelPriority[log.level] >= minLevel);
  }

  // Filter by entity type
  if (params.entityType) {
    filteredLogs = filteredLogs.filter(log => log.entityType === params.entityType);
  }

  // Filter by timestamp range
  if (params.since) {
    const sinceDate = new Date(params.since);
    filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= sinceDate);
  }

  if (params.until) {
    const untilDate = new Date(params.until);
    filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= untilDate);
  }

  // Sort by timestamp (most recent first)
  filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return filteredLogs;
}

/**
 * Apply pagination to logs
 */
function paginateLogs(logs: LogEntry[], limit: number = 100, offset: number = 0): {
  paginatedLogs: LogEntry[];
  hasMore: boolean;
} {
  const startIndex = offset;
  const endIndex = offset + limit;
  const paginatedLogs = logs.slice(startIndex, endIndex);
  const hasMore = logs.length > endIndex;

  return { paginatedLogs, hasMore };
}

/**
 * Format logs for different output formats
 */
function formatLogs(logs: LogEntry[], format: string): string {
  switch (format) {
    case 'text':
      return logs.map(log => {
        const timestamp = new Date(log.timestamp).toLocaleString();
        const entityPart = log.entityType ? `[${log.entityType}] ` : '';
        const operationPart = log.operationType ? `${log.operationType}: ` : '';
        return `${timestamp} [${log.level.toUpperCase()}] ${entityPart}${operationPart}${log.message}`;
      }).join('\n');

    case 'csv':
      const csvHeaders = 'timestamp,level,entityType,operationType,message,recordId';
      const csvRows = logs.map(log => {
        const escapeCsv = (value: string) => `"${(value || '').replace(/"/g, '""')}"`;
        return [
          escapeCsv(log.timestamp),
          escapeCsv(log.level),
          escapeCsv(log.entityType || ''),
          escapeCsv(log.operationType || ''),
          escapeCsv(log.message),
          escapeCsv(log.recordId || '')
        ].join(',');
      });
      return [csvHeaders, ...csvRows].join('\n');

    case 'json':
    default:
      return JSON.stringify(logs, null, 2);
  }
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
 * GET /api/migration/logs/{sessionId}
 * Retrieve execution logs for migration session
 */
export async function handleGetMigrationLogs(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;
  const queryParams: LogQueryParams = {
    logLevel: req.query.logLevel as any,
    entityType: req.query.entityType as string,
    limit: parseInt(req.query.limit as string) || 100,
    offset: parseInt(req.query.offset as string) || 0,
    since: req.query.since as string,
    until: req.query.until as string,
    format: (req.query.format as string) || 'json',
    export: req.query.export === 'true'
  };

  try {
    // Validate session ID
    const sessionValidation = validateSessionId(sessionId);
    if (!sessionValidation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: sessionValidation.error!
        },
        requestId
      ));
      return;
    }

    // Validate query parameters
    const paramValidation = validateLogQueryParams(queryParams);
    if (!paramValidation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'Invalid query parameters',
          details: paramValidation.errors
        },
        requestId
      ));
      return;
    }

    // Load logs from storage
    const allLogs = await loadLogsFromStorage(sessionId);

    if (allLogs.length === 0) {
      // Check if session exists but has no logs yet
      res.status(200).json(createAPIResponse(
        true,
        {
          sessionId,
          logs: [],
          totalCount: 0,
          hasMore: false,
          message: 'No logs available for this session yet'
        },
        undefined,
        requestId
      ));
      return;
    }

    // Apply filters
    const filteredLogs = filterLogs(allLogs, queryParams);

    // Apply pagination
    const { paginatedLogs, hasMore } = paginateLogs(filteredLogs, queryParams.limit, queryParams.offset);

    // Handle export requests
    if (queryParams.export) {
      const filename = `migration-logs-${sessionId}-${Date.now()}.${queryParams.format === 'csv' ? 'csv' : 'txt'}`;
      const formattedLogs = formatLogs(filteredLogs, queryParams.format!);

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type',
        queryParams.format === 'csv' ? 'text/csv' :
        queryParams.format === 'text' ? 'text/plain' :
        'application/json'
      );

      res.send(formattedLogs);
      return;
    }

    // Prepare response data
    const responseData: MigrationLogsResponse = {
      sessionId,
      logs: paginatedLogs,
      totalCount: filteredLogs.length,
      hasMore
    };

    console.log(`📋 Logs retrieved for session: ${sessionId}`);
    console.log(`   Total Logs: ${allLogs.length}`);
    console.log(`   Filtered: ${filteredLogs.length}`);
    console.log(`   Returned: ${paginatedLogs.length}`);
    console.log(`   Format: ${queryParams.format}`);

    // Send response
    res.status(200).json(createAPIResponse(true, responseData, undefined, requestId));

  } catch (error) {
    // Handle different types of errors
    let errorCode = 'LOG_RETRIEVAL_FAILED';
    let statusCode = 500;
    let errorMessage = 'Failed to retrieve migration logs';

    if (error.message.includes('ENOENT')) {
      errorCode = 'SESSION_LOGS_NOT_FOUND';
      statusCode = 404;
      errorMessage = 'No logs found for this migration session';
    } else if (error.message.includes('EACCES')) {
      errorCode = 'LOG_ACCESS_DENIED';
      statusCode = 403;
      errorMessage = 'Insufficient permissions to access logs';
    } else if (error.message.includes('load logs')) {
      errorCode = 'LOG_STORAGE_ERROR';
      statusCode = 500;
      errorMessage = 'Failed to load logs from storage';
    }

    console.error(`❌ Failed to retrieve logs for session: ${sessionId}`);
    console.error(`   Error: ${error.message}`);
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
  }
}

/**
 * GET /api/migration/logs/{sessionId}/stats
 * Get log statistics and summary for session
 */
export async function handleGetLogStats(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;

  try {
    // Validate session ID
    const sessionValidation = validateSessionId(sessionId);
    if (!sessionValidation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: sessionValidation.error!
        },
        requestId
      ));
      return;
    }

    // Load all logs
    const allLogs = await loadLogsFromStorage(sessionId);

    if (allLogs.length === 0) {
      res.status(404).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SESSION_LOGS_NOT_FOUND',
          message: 'No logs found for this session'
        },
        requestId
      ));
      return;
    }

    // Calculate statistics
    const stats = {
      sessionId,
      totalEntries: allLogs.length,
      logLevels: {
        debug: allLogs.filter(log => log.level === 'debug').length,
        info: allLogs.filter(log => log.level === 'info').length,
        warn: allLogs.filter(log => log.level === 'warn').length,
        error: allLogs.filter(log => log.level === 'error').length
      },
      entities: (() => {
        const entityCounts: Record<string, number> = {};
        allLogs.forEach(log => {
          if (log.entityType) {
            entityCounts[log.entityType] = (entityCounts[log.entityType] || 0) + 1;
          }
        });
        return entityCounts;
      })(),
      operations: (() => {
        const operationCounts: Record<string, number> = {};
        allLogs.forEach(log => {
          if (log.operationType) {
            operationCounts[log.operationType] = (operationCounts[log.operationType] || 0) + 1;
          }
        });
        return operationCounts;
      })(),
      timeRange: {
        earliest: allLogs.reduce((earliest, log) =>
          new Date(log.timestamp) < new Date(earliest.timestamp) ? log : earliest
        ).timestamp,
        latest: allLogs.reduce((latest, log) =>
          new Date(log.timestamp) > new Date(latest.timestamp) ? log : latest
        ).timestamp
      },
      summary: {
        errorRate: (allLogs.filter(log => log.level === 'error').length / allLogs.length) * 100,
        warningRate: (allLogs.filter(log => log.level === 'warn').length / allLogs.length) * 100,
        mostActiveEntity: Object.entries((() => {
          const entityCounts: Record<string, number> = {};
          allLogs.forEach(log => {
            if (log.entityType) {
              entityCounts[log.entityType] = (entityCounts[log.entityType] || 0) + 1;
            }
          });
          return entityCounts;
        })()).reduce((max, [entity, count]) => count > (max[1] || 0) ? [entity, count] : max, ['', 0])[0] || 'none',
        avgLogsPerMinute: (() => {
          if (allLogs.length < 2) return 0;
          const timeSpanMs = new Date(allLogs[allLogs.length - 1].timestamp).getTime() -
                           new Date(allLogs[0].timestamp).getTime();
          return Math.round((allLogs.length / (timeSpanMs / 60000)) * 100) / 100;
        })()
      }
    };

    res.status(200).json(createAPIResponse(true, stats, undefined, requestId));

  } catch (error) {
    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'LOG_STATS_FAILED',
        message: 'Failed to calculate log statistics',
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * GET /api/migration/logs/{sessionId}/search
 * Search logs with advanced filtering
 */
export async function handleLogSearch(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();
  const sessionId = req.params.sessionId;
  const searchQuery = req.query.q as string;
  const searchType = req.query.type as string || 'message'; // 'message', 'recordId', 'context'
  const caseSensitive = req.query.caseSensitive === 'true';

  try {
    // Validate session ID
    const sessionValidation = validateSessionId(sessionId);
    if (!sessionValidation.isValid) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'INVALID_SESSION_ID',
          message: sessionValidation.error!
        },
        requestId
      ));
      return;
    }

    if (!searchQuery) {
      res.status(400).json(createAPIResponse(
        false,
        undefined,
        {
          code: 'SEARCH_QUERY_REQUIRED',
          message: 'Search query parameter "q" is required'
        },
        requestId
      ));
      return;
    }

    // Load logs
    const allLogs = await loadLogsFromStorage(sessionId);

    // Perform search
    const searchResults = allLogs.filter(log => {
      const searchText = caseSensitive ? searchQuery : searchQuery.toLowerCase();

      switch (searchType) {
        case 'recordId':
          const recordId = caseSensitive ? (log.recordId || '') : (log.recordId || '').toLowerCase();
          return recordId.includes(searchText);

        case 'context':
          const contextStr = JSON.stringify(log.context || {});
          const contextText = caseSensitive ? contextStr : contextStr.toLowerCase();
          return contextText.includes(searchText);

        case 'message':
        default:
          const message = caseSensitive ? log.message : log.message.toLowerCase();
          return message.includes(searchText);
      }
    });

    // Apply pagination
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const { paginatedLogs, hasMore } = paginateLogs(searchResults, limit, offset);

    const response = {
      sessionId,
      searchQuery,
      searchType,
      caseSensitive,
      results: {
        logs: paginatedLogs,
        totalMatches: searchResults.length,
        returned: paginatedLogs.length,
        hasMore
      },
      summary: {
        searchTimeMs: Date.now() - parseInt(requestId.split('-')[0], 16), // Approximate
        matchRate: Math.round((searchResults.length / allLogs.length) * 10000) / 100, // Percentage
        totalScanned: allLogs.length
      }
    };

    console.log(`🔍 Log search completed for session: ${sessionId}`);
    console.log(`   Query: "${searchQuery}" (${searchType})`);
    console.log(`   Matches: ${searchResults.length} of ${allLogs.length}`);

    res.status(200).json(createAPIResponse(true, response, undefined, requestId));

  } catch (error) {
    res.status(500).json(createAPIResponse(
      false,
      undefined,
      {
        code: 'LOG_SEARCH_FAILED',
        message: 'Failed to search logs',
        details: error.message
      },
      requestId
    ));
  }
}

/**
 * Middleware for request logging
 */
export function logLogsRequest(req: Request, res: Response, next: Function): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  console.log(`📋 Logs Request: ${requestId}`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Path: ${req.path}`);
  console.log(`   Session ID: ${req.params.sessionId || 'none'}`);

  if (req.query.logLevel) console.log(`   Log Level: ${req.query.logLevel}`);
  if (req.query.entityType) console.log(`   Entity Type: ${req.query.entityType}`);
  if (req.query.limit) console.log(`   Limit: ${req.query.limit}`);
  if (req.query.export) console.log(`   Export: ${req.query.format || 'json'}`);

  // Add response time tracking
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`   Response: ${res.statusCode} (${duration}ms)`);
  });

  next();
}

/**
 * Health check endpoint for logs service
 */
export async function handleLogsHealthCheck(req: Request, res: Response): Promise<void> {
  const requestId = crypto.randomUUID();

  try {
    // Check log directory accessibility
    const logDirStats = await fs.stat(LOG_BASE_DIR).catch(() => null);
    const logDirExists = logDirStats?.isDirectory() || false;

    // Calculate log statistics
    let totalLogFiles = 0;
    let totalLogSize = 0;

    if (logDirExists) {
      try {
        const logFiles = await fs.readdir(LOG_BASE_DIR);
        totalLogFiles = logFiles.filter(file => file.endsWith('.jsonl')).length;

        // Calculate total log size (approximate)
        for (const file of logFiles) {
          const filePath = path.join(LOG_BASE_DIR, file);
          const fileStats = await fs.stat(filePath);
          totalLogSize += fileStats.size;
        }
      } catch (dirError) {
        console.warn('Could not read log directory:', dirError.message);
      }
    }

    res.status(200).json(createAPIResponse(
      true,
      {
        service: 'migration-logs',
        status: logDirExists ? 'healthy' : 'degraded',
        logStorage: {
          directory: LOG_BASE_DIR,
          accessible: logDirExists,
          totalFiles: totalLogFiles,
          totalSizeMB: Math.round(totalLogSize / 1024 / 1024 * 100) / 100
        },
        features: {
          filtering: true,
          pagination: true,
          search: true,
          export: true,
          formats: ['json', 'text', 'csv']
        },
        limits: {
          maxEntriesPerRequest: MAX_LOG_ENTRIES,
          maxSearchResults: 1000,
          supportedLevels: ['debug', 'info', 'warn', 'error']
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
        message: 'Logs service is not available',
        details: error.message
      },
      requestId
    ));
  }
}

// Export configurations for testing
export { LOG_BASE_DIR, MAX_LOG_ENTRIES };
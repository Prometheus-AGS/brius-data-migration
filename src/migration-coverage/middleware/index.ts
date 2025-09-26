/**
 * Middleware Configuration
 *
 * Central middleware setup for the Migration Coverage API.
 */

import { Application, Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../config/database';
import { CoverageCalculator } from '../services/coverage-calculator';
import { DataValidator } from '../services/data-validator';
import { MigrationScriptAnalyzer } from '../services/migration-script-analyzer';
import { ReportGenerator } from '../services/report-generator';

// Extend Express Request interface to include custom properties
declare global {
  namespace Express {
    interface Request {
      services?: {
        coverageCalculator: CoverageCalculator;
        dataValidator: DataValidator;
        scriptAnalyzer: MigrationScriptAnalyzer;
        reportGenerator: ReportGenerator;
      };
      database?: {
        source: any;
        target: any;
      };
      startTime?: number;
    }
  }
}

/**
 * Setup all middleware for the application
 */
export async function setupMiddleware(
  app: Application,
  databaseManager: DatabaseManager
): Promise<void> {
  // Initialize services
  const coverageCalculator = new CoverageCalculator();
  const dataValidator = new DataValidator(
    databaseManager.getSourcePool(),
    databaseManager.getTargetPool()
  );
  const scriptAnalyzer = new MigrationScriptAnalyzer();
  const reportGenerator = new ReportGenerator(coverageCalculator);

  // Request timing middleware
  app.use(requestTimingMiddleware);

  // Services injection middleware
  app.use(servicesMiddleware(coverageCalculator, dataValidator, scriptAnalyzer, reportGenerator));

  // Database injection middleware
  app.use(databaseMiddleware(databaseManager));

  // Request validation middleware
  app.use(requestValidationMiddleware);

  // Response formatting middleware
  app.use(responseFormattingMiddleware);

  // Request logging middleware
  app.use(requestLoggingMiddleware);

  console.log('Middleware setup completed');
}

/**
 * Request timing middleware
 */
function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.startTime = Date.now();
  next();
}

/**
 * Services injection middleware
 */
function servicesMiddleware(
  coverageCalculator: CoverageCalculator,
  dataValidator: DataValidator,
  scriptAnalyzer: MigrationScriptAnalyzer,
  reportGenerator: ReportGenerator
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.services = {
      coverageCalculator,
      dataValidator,
      scriptAnalyzer,
      reportGenerator
    };
    next();
  };
}

/**
 * Database injection middleware
 */
function databaseMiddleware(databaseManager: DatabaseManager) {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.database = {
      source: databaseManager.getSourcePool(),
      target: databaseManager.getTargetPool()
    };
    next();
  };
}

/**
 * Request validation middleware
 */
function requestValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Validate Content-Type for POST/PUT requests
  if (['POST', 'PUT'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Content-Type must be application/json for POST/PUT requests',
        timestamp: new Date().toISOString()
      });
      return;
    }
  }

  // Validate request size
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) { // 10MB
    res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body exceeds maximum size of 10MB',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Validate query parameters
  if (req.query) {
    const validationErrors = validateQueryParameters(req);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid query parameters',
        details: validationErrors,
        timestamp: new Date().toISOString()
      });
      return;
    }
  }

  next();
}

/**
 * Response formatting middleware
 */
function responseFormattingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Add standard headers
  res.setHeader('X-API-Version', process.env.npm_package_version || '1.0.0');
  res.setHeader('X-Powered-By', 'Migration Coverage API');

  // Override res.json to add standard fields
  const originalJson = res.json;
  res.json = function(data: any) {
    // Add timing information if available
    if (req.startTime) {
      const responseTime = Date.now() - req.startTime;
      res.setHeader('X-Response-Time', `${responseTime}ms`);

      // Add timing to response if it's an object
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        data.responseTime = responseTime;
      }
    }

    // Add timestamp to response if it's an object and doesn't have one
    if (data && typeof data === 'object' && !Array.isArray(data) && !data.timestamp) {
      data.timestamp = new Date().toISOString();
    }

    return originalJson.call(this, data);
  };

  next();
}

/**
 * Request logging middleware
 */
function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] as string;
  const startTime = Date.now();

  // Log request start
  console.log(`[${requestId}] ${req.method} ${req.path} - Started`);

  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const statusText = statusCode >= 400 ? 'ERROR' : statusCode >= 300 ? 'REDIRECT' : 'SUCCESS';

    console.log(`[${requestId}] ${req.method} ${req.path} - ${statusText} ${statusCode} (${duration}ms)`);

    // Log slow requests
    if (duration > 5000) {
      console.warn(`[${requestId}] SLOW REQUEST: ${req.method} ${req.path} took ${duration}ms`);
    }

    // Log errors
    if (statusCode >= 400) {
      console.error(`[${requestId}] ERROR: ${req.method} ${req.path} returned ${statusCode}`);
    }
  });

  next();
}

/**
 * Validate query parameters
 */
function validateQueryParameters(req: Request): string[] {
  const errors: string[] = [];
  const query = req.query;

  // Common parameter validations
  if (query.page) {
    const page = parseInt(query.page as string, 10);
    if (isNaN(page) || page < 1) {
      errors.push('page must be a positive integer');
    } else if (page > 1000) {
      errors.push('page cannot exceed 1000');
    }
  }

  if (query.limit) {
    const limit = parseInt(query.limit as string, 10);
    if (isNaN(limit) || limit < 1) {
      errors.push('limit must be a positive integer');
    } else if (limit > 200) {
      errors.push('limit cannot exceed 200');
    }
  }

  if (query.minSuccessRate) {
    const rate = parseFloat(query.minSuccessRate as string);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      errors.push('minSuccessRate must be a number between 0 and 100');
    }
  }

  if (query.minRecords) {
    const records = parseInt(query.minRecords as string, 10);
    if (isNaN(records) || records < 0) {
      errors.push('minRecords must be a non-negative integer');
    }
  }

  // Route-specific validations
  if (req.path.includes('/scripts/status')) {
    if (query.sortBy) {
      const validSortFields = ['name', 'status', 'domain', 'category', 'successRate', 'lastExecuted'];
      if (!validSortFields.includes(query.sortBy as string)) {
        errors.push(`sortBy must be one of: ${validSortFields.join(', ')}`);
      }
    }

    if (query.sortOrder) {
      const validSortOrders = ['asc', 'desc'];
      if (!validSortOrders.includes(query.sortOrder as string)) {
        errors.push(`sortOrder must be one of: ${validSortOrders.join(', ')}`);
      }
    }
  }

  if (req.path.includes('/entities/performance')) {
    if (query.sortBy) {
      const validSortFields = ['successRate', 'totalRecords', 'migratedRecords', 'entityName', 'lastMigrated'];
      if (!validSortFields.includes(query.sortBy as string)) {
        errors.push(`sortBy must be one of: ${validSortFields.join(', ')}`);
      }
    }
  }

  if (req.path.includes('/reports/generate')) {
    if (query.type) {
      const validTypes = ['comprehensive', 'coverage', 'validation', 'executive', 'detailed'];
      if (!validTypes.includes(query.type as string)) {
        errors.push(`type must be one of: ${validTypes.join(', ')}`);
      }
    }

    if (query.format) {
      const validFormats = ['json', 'html', 'markdown', 'csv'];
      if (!validFormats.includes(query.format as string)) {
        errors.push(`format must be one of: ${validFormats.join(', ')}`);
      }
    }
  }

  return errors;
}

/**
 * Health check middleware - bypasses most validations
 */
export function healthCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Minimal middleware for health checks
  req.startTime = Date.now();
  next();
}

/**
 * API key authentication middleware (optional)
 */
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;

  // Skip if no API key is configured
  if (!apiKey) {
    next();
    return;
  }

  const requestApiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!requestApiKey || requestApiKey !== apiKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required',
      timestamp: new Date().toISOString()
    });
    return;
  }

  next();
}

/**
 * Development-only middleware
 */
export function developmentMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'development') {
    res.status(404).json({
      error: 'Not Found',
      message: 'Development endpoint not available in production',
      timestamp: new Date().toISOString()
    });
    return;
  }

  next();
}
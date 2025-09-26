/**
 * Error Handler Middleware
 *
 * Centralized error handling for the Migration Coverage API.
 */

import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  error: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.headers['x-request-id'] as string;
  const timestamp = new Date().toISOString();

  // Log the error
  console.error(`[${requestId}] Error in ${req.method} ${req.path}:`, error);

  // Determine status code
  let statusCode = error.statusCode || 500;
  let errorType = 'Internal Server Error';
  let message = error.message || 'An unexpected error occurred';
  let details = error.details;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorType = 'Validation Error';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorType = 'Bad Request';
    message = 'Invalid data format';
  } else if (error.code === 'ECONNREFUSED') {
    statusCode = 503;
    errorType = 'Service Unavailable';
    message = 'Database connection refused';
  } else if (error.code === 'ETIMEDOUT') {
    statusCode = 504;
    errorType = 'Gateway Timeout';
    message = 'Request timeout';
  } else if (error.code === '23505') { // PostgreSQL unique violation
    statusCode = 409;
    errorType = 'Conflict';
    message = 'Resource already exists';
  } else if (error.code === '23503') { // PostgreSQL foreign key violation
    statusCode = 400;
    errorType = 'Bad Request';
    message = 'Invalid reference to related resource';
  } else if (error.code === '42P01') { // PostgreSQL undefined table
    statusCode = 500;
    errorType = 'Internal Server Error';
    message = 'Database schema issue';
  } else if (error.message.includes('JWT')) {
    statusCode = 401;
    errorType = 'Unauthorized';
    message = 'Invalid authentication token';
  } else if (error.message.includes('permission')) {
    statusCode = 403;
    errorType = 'Forbidden';
    message = 'Insufficient permissions';
  }

  // Don't expose internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'An internal server error occurred';
    details = undefined; // Hide internal details
  }

  // Create error response
  const errorResponse: any = {
    error: errorType,
    message,
    timestamp,
    requestId,
    path: req.path,
    method: req.method
  };

  // Add details if available
  if (details) {
    errorResponse.details = details;
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  // Add response time if available
  if (req.startTime) {
    errorResponse.responseTime = Date.now() - req.startTime;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] as string;

  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString(),
    requestId,
    availableEndpoints: [
      'GET /health',
      'GET /coverage/summary',
      'GET /scripts/status',
      'GET /domains/coverage',
      'GET /entities/performance',
      'POST /validation/run',
      'GET /validation/results/:id',
      'GET /reports/generate',
      'GET /docs'
    ]
  });
}

/**
 * Async error wrapper
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create API error
 */
export function createApiError(
  message: string,
  statusCode: number = 500,
  code?: string,
  details?: any
): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

/**
 * Validation error helper
 */
export function createValidationError(
  message: string,
  details?: any
): ApiError {
  return createApiError(message, 400, 'VALIDATION_ERROR', details);
}

/**
 * Not found error helper
 */
export function createNotFoundError(
  resource: string,
  id?: string
): ApiError {
  const message = id
    ? `${resource} with ID ${id} not found`
    : `${resource} not found`;
  return createApiError(message, 404, 'NOT_FOUND');
}

/**
 * Database error helper
 */
export function createDatabaseError(
  operation: string,
  originalError?: Error
): ApiError {
  const message = `Database error during ${operation}`;
  return createApiError(
    message,
    500,
    'DATABASE_ERROR',
    originalError ? { original: originalError.message } : undefined
  );
}

/**
 * Service unavailable error helper
 */
export function createServiceUnavailableError(
  service: string
): ApiError {
  return createApiError(
    `${service} service is currently unavailable`,
    503,
    'SERVICE_UNAVAILABLE'
  );
}

/**
 * Rate limit error helper
 */
export function createRateLimitError(): ApiError {
  return createApiError(
    'Too many requests, please try again later',
    429,
    'RATE_LIMIT_EXCEEDED'
  );
}

/**
 * Timeout error helper
 */
export function createTimeoutError(
  operation: string,
  timeout: number
): ApiError {
  return createApiError(
    `${operation} timed out after ${timeout}ms`,
    504,
    'TIMEOUT',
    { timeout, operation }
  );
}
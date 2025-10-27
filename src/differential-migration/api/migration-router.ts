/**
 * Migration API Router
 *
 * Express router integrating all differential migration API endpoints
 * Provides comprehensive REST API for migration operations
 */

import { Router } from 'express';
import {
  handleBaselineAnalysis,
  logBaselineRequest,
  handleBaselineHealthCheck
} from './baseline-endpoint';
import {
  handleDifferentialAnalysis,
  handleDifferentialStatus,
  logDifferentialRequest,
  handleDifferentialHealthCheck
} from './differential-endpoint';
import {
  handleMigrationExecution,
  handleGetSessions,
  logExecutionRequest,
  handleExecutionHealthCheck
} from './execute-endpoint';
import {
  handleGetMigrationStatus,
  handlePauseMigration,
  handleResumeMigration,
  handleCancelMigration,
  handleStatusStream,
  logStatusRequest
} from './status-endpoint';
import {
  handleGetMigrationLogs,
  handleGetLogStats,
  handleLogSearch,
  logLogsRequest,
  handleLogsHealthCheck
} from './logs-endpoint';

// Create router
const migrationRouter = Router();

// Request body parsing middleware
migrationRouter.use((req, res, next) => {
  // Ensure JSON parsing for POST requests
  if (req.method === 'POST' && !req.body) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST_BODY',
        message: 'Request body must be valid JSON'
      }
    });
  }
  next();
});

// Health check endpoints
migrationRouter.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      service: 'differential-migration-api',
      status: 'healthy',
      version: '1.0.0',
      endpoints: [
        'POST /api/migration/baseline',
        'POST /api/migration/differential',
        'POST /api/migration/execute',
        'GET  /api/migration/status/{sessionId}',
        'POST /api/migration/pause/{sessionId}',
        'POST /api/migration/resume/{sessionId}',
        'POST /api/migration/cancel/{sessionId}',
        'GET  /api/migration/logs/{sessionId}',
        'GET  /api/migration/sessions'
      ]
    }
  });
});

migrationRouter.get('/baseline/health', handleBaselineHealthCheck);
migrationRouter.get('/differential/health', handleDifferentialHealthCheck);
migrationRouter.get('/execute/health', handleExecutionHealthCheck);
migrationRouter.get('/logs/health', handleLogsHealthCheck);

// Baseline Analysis Endpoints
migrationRouter.post('/baseline',
  logBaselineRequest,
  handleBaselineAnalysis
);

// Differential Analysis Endpoints
migrationRouter.post('/differential',
  logDifferentialRequest,
  handleDifferentialAnalysis
);

migrationRouter.get('/differential/status/:analysisId',
  logDifferentialRequest,
  handleDifferentialStatus
);

// Migration Execution Endpoints
migrationRouter.post('/execute',
  logExecutionRequest,
  handleMigrationExecution
);

migrationRouter.get('/sessions',
  logExecutionRequest,
  handleGetSessions
);

// Migration Status and Control Endpoints
migrationRouter.get('/status/:sessionId',
  logStatusRequest,
  handleGetMigrationStatus
);

migrationRouter.get('/status/:sessionId/stream',
  logStatusRequest,
  handleStatusStream
);

migrationRouter.post('/pause/:sessionId',
  logStatusRequest,
  handlePauseMigration
);

migrationRouter.post('/resume/:sessionId',
  logStatusRequest,
  handleResumeMigration
);

migrationRouter.post('/cancel/:sessionId',
  logStatusRequest,
  handleCancelMigration
);

// Logs Retrieval Endpoints
migrationRouter.get('/logs/:sessionId',
  logLogsRequest,
  handleGetMigrationLogs
);

migrationRouter.get('/logs/:sessionId/stats',
  logLogsRequest,
  handleGetLogStats
);

migrationRouter.get('/logs/:sessionId/search',
  logLogsRequest,
  handleLogSearch
);

// Error handling middleware
migrationRouter.use((error: Error, req: any, res: any, next: any) => {
  console.error(`API Error: ${error.message}`);
  console.error(`Request: ${req.method} ${req.path}`);
  console.error(`Stack: ${error.stack}`);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId: req.requestId || 'unknown',
      timestamp: new Date().toISOString()
    },
    meta: {
      apiVersion: '1.0.0',
      requestId: req.requestId || 'unknown',
      timestamp: new Date().toISOString()
    }
  });
});

// 404 handler for unknown endpoints
migrationRouter.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
      availableEndpoints: [
        'POST /api/migration/baseline',
        'POST /api/migration/differential',
        'POST /api/migration/execute',
        'GET  /api/migration/status/{sessionId}',
        'POST /api/migration/pause/{sessionId}',
        'POST /api/migration/resume/{sessionId}',
        'GET  /api/migration/logs/{sessionId}'
      ]
    },
    meta: {
      apiVersion: '1.0.0',
      requestId: req.requestId || 'unknown',
      timestamp: new Date().toISOString()
    }
  });
});

export default migrationRouter;
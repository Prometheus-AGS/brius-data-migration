/**
 * Demo Server for Differential Migration API
 *
 * Starts Express server to demonstrate the API endpoints we just built
 */

import express, { Request } from 'express';
import cors from 'cors';
import migrationRouter from './src/differential-migration/api/migration-router';

// Extend Request interface to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  next();
});

// Mount migration API router
app.use('/api/migration', migrationRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Differential Migration API Server',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      baseline: 'POST /api/migration/baseline',
      differential: 'POST /api/migration/differential',
      execute: 'POST /api/migration/execute',
      status: 'GET /api/migration/status/{sessionId}',
      logs: 'GET /api/migration/logs/{sessionId}',
      health: 'GET /api/migration/health'
    },
    documentation: 'Visit /api/migration/health for service health check'
  });
});

// Global error handler
app.use((error: Error, req: any, res: any, next: any) => {
  console.error('Server Error:', error);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Server encountered an unexpected error',
      timestamp: new Date().toISOString()
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Differential Migration API Server running on http://localhost:${PORT}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/api/migration/health`);
  console.log(`📋 API Documentation available at health endpoint`);
  console.log(`🔍 Try: curl http://localhost:${PORT}/api/migration/health`);
});

export default app;
/**
 * Express Server Setup
 *
 * Main Express server configuration for the Migration Coverage API.
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Server } from 'http';
import * as dotenv from 'dotenv';

import { databaseManager } from './config/database';
import { setupMiddleware } from './middleware';
import { setupRoutes } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

// Load environment variables
dotenv.config();

export class MigrationCoverageServer {
  private app: Application;
  private server: Server | null = null;
  private readonly port: number;
  private readonly environment: string;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3000', 10);
    this.environment = process.env.NODE_ENV || 'development';

    this.setupBasicMiddleware();
  }

  /**
   * Initialize and start the server
   */
  public async start(): Promise<void> {
    try {
      console.log('Starting Migration Coverage API server...');
      console.log(`Environment: ${this.environment}`);
      console.log(`Port: ${this.port}`);

      // Initialize database connections
      await databaseManager.initialize();

      // Setup application middleware
      await this.setupApplicationMiddleware();

      // Setup routes
      this.setupApplicationRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Start server
      await this.startServer();

      console.log(`Migration Coverage API server started successfully on port ${this.port}`);
      console.log(`Health check available at: http://localhost:${this.port}/health`);
      console.log(`API documentation at: http://localhost:${this.port}/docs`);
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }

  /**
   * Stop the server gracefully
   */
  public async stop(): Promise<void> {
    console.log('Stopping Migration Coverage API server...');

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(async (error) => {
        if (error) {
          console.error('Error stopping server:', error);
          reject(error);
          return;
        }

        try {
          // Close database connections
          await databaseManager.close();
          console.log('Migration Coverage API server stopped successfully');
          resolve();
        } catch (dbError) {
          console.error('Error closing database connections:', dbError);
          reject(dbError);
        }
      });
    });
  }

  /**
   * Get the Express application instance
   */
  public getApp(): Application {
    return this.app;
  }

  /**
   * Get server health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    environment: string;
    version: string;
    database: any;
  }> {
    const dbHealth = await databaseManager.getHealthStatus();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!dbHealth.source.connected || !dbHealth.target.connected) {
      status = 'unhealthy';
    } else if (dbHealth.source.error || dbHealth.target.error) {
      status = 'degraded';
    }

    return {
      status,
      uptime: process.uptime(),
      environment: this.environment,
      version: process.env.npm_package_version || '1.0.0',
      database: dbHealth
    };
  }

  private setupBasicMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"]
        }
      },
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    const corsOptions = {
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:8080'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
      maxAge: 86400 // 24 hours
    };
    this.app.use(cors(corsOptions));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: this.environment === 'development' ? 1000 : 100, // Requests per window
      message: {
        error: 'Too Many Requests',
        message: 'Too many requests from this IP, please try again later',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req: Request) => {
        // Skip rate limiting for health checks
        return req.path === '/health';
      }
    });
    this.app.use(limiter);

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Response compression
    this.app.use(compression({
      filter: (req: Request, res: Response) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      threshold: 1024 // Only compress responses larger than 1KB
    }));

    // Request logging
    if (this.environment === 'development') {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined', {
        skip: (req: Request, res: Response) => {
          // Skip logging for health checks in production
          return req.path === '/health' && res.statusCode < 400;
        }
      }));
    }

    // Request ID middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.headers['x-request-id'] = req.headers['x-request-id'] ||
        `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      res.setHeader('X-Request-ID', req.headers['x-request-id'] as string);
      next();
    });

    // Response time header
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        res.setHeader('X-Response-Time', `${responseTime}ms`);
      });
      next();
    });
  }

  private async setupApplicationMiddleware(): Promise<void> {
    try {
      // Setup custom middleware
      await setupMiddleware(this.app, databaseManager);
      console.log('Application middleware setup completed');
    } catch (error) {
      console.error('Failed to setup application middleware:', error);
      throw error;
    }
  }

  private setupApplicationRoutes(): void {
    try {
      // Setup API routes
      setupRoutes(this.app, databaseManager);

      // Root endpoint
      this.app.get('/', (req: Request, res: Response) => {
        res.json({
          name: 'Migration Coverage API',
          version: process.env.npm_package_version || '1.0.0',
          environment: this.environment,
          uptime: process.uptime(),
          endpoints: [
            'GET /health - Health check',
            'GET /coverage/summary - Coverage summary',
            'GET /scripts/status - Script status',
            'GET /domains/coverage - Domain coverage',
            'GET /entities/performance - Entity performance',
            'POST /validation/run - Run validation',
            'GET /validation/results/:id - Validation results',
            'GET /reports/generate - Generate reports',
            'GET /docs - API documentation'
          ],
          timestamp: new Date().toISOString()
        });
      });

      // API documentation endpoint
      this.app.get('/docs', (req: Request, res: Response) => {
        res.json({
          openapi: '3.0.3',
          info: {
            title: 'Migration Coverage API',
            version: process.env.npm_package_version || '1.0.0',
            description: 'Comprehensive API for tracking and validating database migration coverage'
          },
          servers: [
            {
              url: `http://localhost:${this.port}`,
              description: 'Development server'
            }
          ],
          paths: {
            '/health': {
              get: {
                summary: 'Health check endpoint',
                responses: {
                  200: { description: 'System is healthy' },
                  503: { description: 'System is unhealthy' }
                }
              }
            },
            '/coverage/summary': {
              get: {
                summary: 'Get migration coverage summary',
                responses: {
                  200: { description: 'Coverage summary data' }
                }
              }
            },
            '/scripts/status': {
              get: {
                summary: 'Get migration scripts status',
                parameters: [
                  { name: 'domain', in: 'query', schema: { type: 'string' } },
                  { name: 'category', in: 'query', schema: { type: 'string' } },
                  { name: 'status', in: 'query', schema: { type: 'string' } },
                  { name: 'page', in: 'query', schema: { type: 'integer' } },
                  { name: 'limit', in: 'query', schema: { type: 'integer' } }
                ],
                responses: {
                  200: { description: 'Scripts status data' }
                }
              }
            }
            // Additional endpoints would be documented here
          }
        });
      });

      console.log('Application routes setup completed');
    } catch (error) {
      console.error('Failed to setup application routes:', error);
      throw error;
    }
  }

  private setupErrorHandling(): void {
    // 404 handler (must be after all routes)
    this.app.use(notFoundHandler);

    // Global error handler (must be last)
    this.app.use(errorHandler);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    // Graceful shutdown handling
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully');
      await this.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully');
      await this.stop();
      process.exit(0);
    });

    console.log('Error handling setup completed');
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      this.server.on('error', (error: Error) => {
        console.error('Server error:', error);
        reject(error);
      });
    });
  }
}

// Export singleton instance
export const migrationCoverageServer = new MigrationCoverageServer();

// Start server if this file is run directly
if (require.main === module) {
  migrationCoverageServer.start().catch((error) => {
    console.error('Failed to start Migration Coverage API server:', error);
    process.exit(1);
  });
}
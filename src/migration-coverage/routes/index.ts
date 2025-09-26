/**
 * Route Registration
 *
 * Central route setup for the Migration Coverage API.
 */

import { Application, Router } from 'express';
import { DatabaseManager } from '../config/database';
import { CoverageCalculator } from '../services/coverage-calculator';
import { DataValidator } from '../services/data-validator';
import { MigrationScriptAnalyzer } from '../services/migration-script-analyzer';
import { ReportGenerator } from '../services/report-generator';

// Import controllers
import { CoverageController } from '../controllers/coverage-controller';
import { ScriptsController } from '../controllers/scripts-controller';
import { DomainsController } from '../controllers/domains-controller';
import { EntitiesController } from '../controllers/entities-controller';
import { ValidationController } from '../controllers/validation-controller';
import { ReportsController } from '../controllers/reports-controller';
import { HealthController } from '../controllers/health-controller';

// Import middleware
import { asyncHandler } from '../middleware/error-handler';
import { healthCheckMiddleware, apiKeyMiddleware, developmentMiddleware } from '../middleware';

/**
 * Setup all routes for the application
 */
export function setupRoutes(
  app: Application,
  databaseManager: DatabaseManager
): void {
  console.log('Setting up API routes...');

  // Initialize services
  const coverageCalculator = new CoverageCalculator();
  const dataValidator = new DataValidator(
    databaseManager.getSourcePool(),
    databaseManager.getTargetPool()
  );
  const scriptAnalyzer = new MigrationScriptAnalyzer();
  const reportGenerator = new ReportGenerator(coverageCalculator);

  // Initialize controllers
  const coverageController = new CoverageController(
    coverageCalculator,
    scriptAnalyzer,
    databaseManager.getTargetPool()
  );

  const scriptsController = new ScriptsController(
    scriptAnalyzer,
    coverageCalculator,
    databaseManager.getTargetPool()
  );

  const domainsController = new DomainsController(
    coverageCalculator,
    dataValidator,
    databaseManager.getTargetPool()
  );

  const entitiesController = new EntitiesController(
    coverageCalculator,
    dataValidator,
    databaseManager.getTargetPool()
  );

  const validationController = new ValidationController(
    dataValidator,
    coverageCalculator,
    reportGenerator,
    databaseManager.getTargetPool()
  );

  const reportsController = new ReportsController(
    reportGenerator,
    coverageCalculator,
    dataValidator,
    scriptAnalyzer,
    databaseManager.getTargetPool()
  );

  const healthController = new HealthController(
    databaseManager.getTargetPool(),
    coverageCalculator,
    dataValidator,
    scriptAnalyzer,
    reportGenerator
  );

  // Create API router
  const apiRouter = Router();

  // Apply API key middleware to all API routes (if configured)
  if (process.env.API_KEY) {
    apiRouter.use(apiKeyMiddleware);
    console.log('API key authentication enabled');
  }

  // Coverage routes
  apiRouter.get('/coverage/summary',
    asyncHandler(coverageController.getCoverageSummary.bind(coverageController))
  );

  // Scripts routes
  apiRouter.get('/scripts/status',
    asyncHandler(scriptsController.getScriptsStatus.bind(scriptsController))
  );

  // Domains routes
  apiRouter.get('/domains/coverage',
    asyncHandler(domainsController.getDomainsCoverage.bind(domainsController))
  );

  // Entities routes
  apiRouter.get('/entities/performance',
    asyncHandler(entitiesController.getEntitiesPerformance.bind(entitiesController))
  );

  // Validation routes
  apiRouter.post('/validation/run',
    asyncHandler(validationController.runValidation.bind(validationController))
  );

  apiRouter.get('/validation/results/:id',
    asyncHandler(validationController.getValidationResults.bind(validationController))
  );

  // Reports routes
  apiRouter.get('/reports/generate',
    asyncHandler(reportsController.generateReports.bind(reportsController))
  );

  // Mount API router
  app.use('/api/v1', apiRouter);
  app.use('/', apiRouter); // Also mount at root for convenience

  // Health check route (special case - minimal middleware)
  app.get('/health',
    healthCheckMiddleware,
    asyncHandler(healthController.getHealth.bind(healthController))
  );

  // Development routes
  if (process.env.NODE_ENV === 'development') {
    setupDevelopmentRoutes(app, databaseManager, {
      coverageCalculator,
      dataValidator,
      scriptAnalyzer,
      reportGenerator
    });
  }

  console.log('API routes setup completed');
  logRegisteredRoutes();
}

/**
 * Setup development-only routes
 */
function setupDevelopmentRoutes(
  app: Application,
  databaseManager: DatabaseManager,
  services: {
    coverageCalculator: CoverageCalculator;
    dataValidator: DataValidator;
    scriptAnalyzer: MigrationScriptAnalyzer;
    reportGenerator: ReportGenerator;
  }
): void {
  const devRouter = Router();
  devRouter.use(developmentMiddleware);

  // Database status endpoint
  devRouter.get('/dev/database/status', asyncHandler(async (req, res) => {
    const status = await databaseManager.getHealthStatus();
    const stats = await databaseManager.getDatabaseStats();

    res.json({
      connection: status,
      statistics: stats,
      pools: {
        source: {
          totalCount: databaseManager.getSourcePool().totalCount,
          idleCount: databaseManager.getSourcePool().idleCount,
          waitingCount: databaseManager.getSourcePool().waitingCount
        },
        target: {
          totalCount: databaseManager.getTargetPool().totalCount,
          idleCount: databaseManager.getTargetPool().idleCount,
          waitingCount: databaseManager.getTargetPool().waitingCount
        }
      }
    });
  }));

  // Service diagnostics endpoint
  devRouter.get('/dev/services/diagnostics', asyncHandler(async (req, res) => {
    const startTime = Date.now();

    // Test each service
    const diagnostics = {
      coverageCalculator: {
        status: 'unknown',
        responseTime: 0,
        error: null as any
      },
      dataValidator: {
        status: 'unknown',
        responseTime: 0,
        error: null as any
      },
      scriptAnalyzer: {
        status: 'unknown',
        responseTime: 0,
        error: null as any
      },
      reportGenerator: {
        status: 'unknown',
        responseTime: 0,
        error: null as any
      }
    };

    // Test coverage calculator
    try {
      const calcStart = Date.now();
      services.coverageCalculator.calculateOverallCoverage();
      diagnostics.coverageCalculator.status = 'healthy';
      diagnostics.coverageCalculator.responseTime = Date.now() - calcStart;
    } catch (error) {
      diagnostics.coverageCalculator.status = 'error';
      diagnostics.coverageCalculator.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test script analyzer
    try {
      const analyzerStart = Date.now();
      await services.scriptAnalyzer.analyzeAllScripts({ includeTests: false });
      diagnostics.scriptAnalyzer.status = 'healthy';
      diagnostics.scriptAnalyzer.responseTime = Date.now() - analyzerStart;
    } catch (error) {
      diagnostics.scriptAnalyzer.status = 'error';
      diagnostics.scriptAnalyzer.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test data validator
    try {
      const validatorStart = Date.now();
      await services.dataValidator.validateCrossEntityConsistency();
      diagnostics.dataValidator.status = 'healthy';
      diagnostics.dataValidator.responseTime = Date.now() - validatorStart;
    } catch (error) {
      diagnostics.dataValidator.status = 'error';
      diagnostics.dataValidator.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test report generator
    try {
      const reportStart = Date.now();
      const coverageReport = services.coverageCalculator.generateCoverageReport();
      await services.reportGenerator.generateCoverageReport(coverageReport, { format: 'json' });
      diagnostics.reportGenerator.status = 'healthy';
      diagnostics.reportGenerator.responseTime = Date.now() - reportStart;
    } catch (error) {
      diagnostics.reportGenerator.status = 'error';
      diagnostics.reportGenerator.error = error instanceof Error ? error.message : 'Unknown error';
    }

    res.json({
      overallTime: Date.now() - startTime,
      services: diagnostics
    });
  }));

  // Configuration dump endpoint
  devRouter.get('/dev/config', asyncHandler(async (req, res) => {
    res.json({
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      port: process.env.PORT || 3000,
      database: {
        source: {
          host: process.env.SOURCE_DB_HOST,
          port: process.env.SOURCE_DB_PORT,
          database: process.env.SOURCE_DB_NAME,
          user: process.env.SOURCE_DB_USER,
          ssl: process.env.SOURCE_DB_SSL
        },
        target: {
          host: process.env.TARGET_DB_HOST,
          port: process.env.TARGET_DB_PORT,
          database: process.env.TARGET_DB_NAME,
          user: process.env.TARGET_DB_USER,
          ssl: process.env.TARGET_DB_SSL
        }
      },
      features: {
        apiKeyEnabled: !!process.env.API_KEY,
        corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*'],
        rateLimitEnabled: true
      },
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  }));

  // Test data endpoint
  devRouter.get('/dev/test-data', asyncHandler(async (req, res) => {
    const type = req.query.type as string || 'all';

    const testData: any = {};

    if (type === 'all' || type === 'scripts') {
      testData.scripts = await services.scriptAnalyzer.analyzeAllScripts({
        includeTests: false,
        includeValidation: false,
        scanForDependencies: false
      });
    }

    if (type === 'all' || type === 'coverage') {
      testData.coverage = services.coverageCalculator.calculateOverallCoverage();
      testData.domainCoverage = services.coverageCalculator.calculateDomainCoverageDetails();
    }

    if (type === 'all' || type === 'entities') {
      testData.entities = services.coverageCalculator.calculateEntityCoverage();
    }

    res.json({
      type,
      generatedAt: new Date().toISOString(),
      data: testData
    });
  }));

  // Mount development router
  app.use('/dev', devRouter);

  console.log('Development routes setup completed');
}

/**
 * Log all registered routes
 */
function logRegisteredRoutes(): void {
  console.log('Registered API endpoints:');
  console.log('  GET  /health                    - Health check');
  console.log('  GET  /coverage/summary          - Coverage summary');
  console.log('  GET  /scripts/status            - Scripts status');
  console.log('  GET  /domains/coverage          - Domain coverage');
  console.log('  GET  /entities/performance      - Entity performance');
  console.log('  POST /validation/run            - Run validation');
  console.log('  GET  /validation/results/:id    - Validation results');
  console.log('  GET  /reports/generate          - Generate reports');
  console.log('  GET  /docs                      - API documentation');

  if (process.env.NODE_ENV === 'development') {
    console.log('Development endpoints:');
    console.log('  GET  /dev/database/status       - Database diagnostics');
    console.log('  GET  /dev/services/diagnostics  - Service diagnostics');
    console.log('  GET  /dev/config                - Configuration dump');
    console.log('  GET  /dev/test-data             - Test data generation');
  }
}
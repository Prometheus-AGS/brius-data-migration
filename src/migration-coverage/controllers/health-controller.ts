/**
 * Health Controller
 *
 * Handles system health check and status endpoints.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CoverageCalculator } from '../services/coverage-calculator';
import { DataValidator } from '../services/data-validator';
import { MigrationScriptAnalyzer } from '../services/migration-script-analyzer';
import { ReportGenerator } from '../services/report-generator';

export class HealthController {
  private readonly dbPool: Pool;
  private readonly coverageCalculator: CoverageCalculator;
  private readonly dataValidator: DataValidator;
  private readonly scriptAnalyzer: MigrationScriptAnalyzer;
  private readonly reportGenerator: ReportGenerator;

  constructor(
    dbPool: Pool,
    coverageCalculator: CoverageCalculator,
    dataValidator: DataValidator,
    scriptAnalyzer: MigrationScriptAnalyzer,
    reportGenerator: ReportGenerator
  ) {
    this.dbPool = dbPool;
    this.coverageCalculator = coverageCalculator;
    this.dataValidator = dataValidator;
    this.scriptAnalyzer = scriptAnalyzer;
    this.reportGenerator = reportGenerator;
  }

  /**
   * GET /health
   * Returns system health status and component availability
   */
  public async getHealth(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();
      const includeDetails = req.query.includeDetails === 'true';

      // Check all system components
      const healthChecks = await this.performHealthChecks(includeDetails);

      // Calculate overall health status
      const overallStatus = this.calculateOverallStatus(healthChecks);

      // Get system metrics
      const systemMetrics = await this.getSystemMetrics();

      const response = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        components: healthChecks,
        systemMetrics,
        responseTime: Date.now() - startTime
      };

      // Validate response structure
      this.validateHealthResponse(response);

      // Set appropriate HTTP status code
      const httpStatus = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;

      res.status(httpStatus).json(response);
    } catch (error) {
      console.error('Health check failed:', error);

      // Even if health check fails, we should return a response
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        error: 'Health check system failure',
        message: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now()
      });
    }
  }

  private async performHealthChecks(includeDetails: boolean): Promise<Array<{
    component: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime: number;
    details?: any;
    error?: string;
  }>> {
    const checks = [
      { name: 'database', check: () => this.checkDatabase() },
      { name: 'coverageCalculator', check: () => this.checkCoverageCalculator() },
      { name: 'dataValidator', check: () => this.checkDataValidator() },
      { name: 'scriptAnalyzer', check: () => this.checkScriptAnalyzer() },
      { name: 'reportGenerator', check: () => this.checkReportGenerator() },
      { name: 'memoryUsage', check: () => this.checkMemoryUsage() },
      { name: 'diskSpace', check: () => this.checkDiskSpace() }
    ];

    const results = await Promise.allSettled(
      checks.map(async ({ name, check }) => {
        const startTime = Date.now();
        try {
          const result = await check();
          const responseTime = Date.now() - startTime;

          return {
            component: name,
            status: result.status,
            responseTime,
            ...(includeDetails && result.details ? { details: result.details } : {}),
            ...(result.error ? { error: result.error } : {})
          };
        } catch (error) {
          return {
            component: name,
            status: 'unhealthy' as const,
            responseTime: Date.now() - startTime,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    return results.map(result =>
      result.status === 'fulfilled' ? result.value : {
        component: 'unknown',
        status: 'unhealthy' as const,
        responseTime: 0,
        error: 'Health check promise rejected'
      }
    );
  }

  private async checkDatabase(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      const client = await this.dbPool.connect();

      try {
        // Test basic connectivity
        const result = await client.query('SELECT 1 as test, NOW() as timestamp');

        // Test migration-specific tables
        const tablesExist = await client.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name IN ('migration_mappings', 'migration_control')
        `);

        const connectionCount = await client.query(`
          SELECT count(*) as active_connections
          FROM pg_stat_activity
          WHERE state = 'active'
        `);

        const details = {
          connected: true,
          serverTime: result.rows[0].timestamp,
          migrationTablesFound: tablesExist.rows.length,
          activeConnections: parseInt(connectionCount.rows[0].active_connections)
        };

        // Determine status based on results
        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

        if (tablesExist.rows.length < 2) {
          status = 'degraded'; // Migration tables missing
        }

        if (details.activeConnections > 90) {
          status = 'degraded'; // High connection usage
        }

        return { status, details };
      } finally {
        client.release();
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Database connection failed'
      };
    }
  }

  private async checkCoverageCalculator(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      const startTime = Date.now();
      const coverage = this.coverageCalculator.calculateOverallCoverage();
      const responseTime = Date.now() - startTime;

      const details = {
        overallCoverage: coverage.overall,
        domainsAnalyzed: coverage.byDomain.size,
        categoriesAnalyzed: coverage.byCategory.size,
        responseTime
      };

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (responseTime > 5000) {
        status = 'degraded'; // Slow response
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Coverage calculator failed'
      };
    }
  }

  private async checkDataValidator(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      const startTime = Date.now();

      // Test with a simple validation
      const crossEntityResults = await this.dataValidator.validateCrossEntityConsistency();
      const responseTime = Date.now() - startTime;

      const details = {
        validationRulesExecuted: crossEntityResults.length,
        passedValidations: crossEntityResults.filter(r => r.passed).length,
        responseTime
      };

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (responseTime > 10000) {
        status = 'degraded'; // Very slow response
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Data validator failed'
      };
    }
  }

  private async checkScriptAnalyzer(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      const startTime = Date.now();

      // Test script analysis
      const scripts = await this.scriptAnalyzer.analyzeAllScripts({
        includeTests: false,
        includeValidation: false,
        scanForDependencies: false
      });

      const responseTime = Date.now() - startTime;

      const details = {
        scriptsAnalyzed: scripts.length,
        averageComplexity: scripts.length > 0
          ? scripts.reduce((sum, s) => sum + s.complexityScore, 0) / scripts.length
          : 0,
        responseTime
      };

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (responseTime > 15000) {
        status = 'degraded'; // Very slow response
      }

      if (scripts.length === 0) {
        status = 'degraded'; // No scripts found
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Script analyzer failed'
      };
    }
  }

  private async checkReportGenerator(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      const startTime = Date.now();

      // Test report generation with minimal data
      const coverageReport = this.coverageCalculator.generateCoverageReport();
      const report = await this.reportGenerator.generateCoverageReport(coverageReport, {
        format: 'json',
        includeCharts: false,
        includeDetails: false
      });

      const responseTime = Date.now() - startTime;

      const details = {
        reportGenerated: true,
        reportSize: report.length,
        responseTime
      };

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (responseTime > 5000) {
        status = 'degraded'; // Slow response
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Report generator failed'
      };
    }
  }

  private async checkMemoryUsage(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      const memUsage = process.memoryUsage();
      const mbUsed = Math.round(memUsage.heapUsed / 1024 / 1024);
      const mbTotal = Math.round(memUsage.heapTotal / 1024 / 1024);
      const usagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      const details = {
        heapUsed: `${mbUsed} MB`,
        heapTotal: `${mbTotal} MB`,
        usagePercent: Math.round(usagePercent * 100) / 100,
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      };

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (usagePercent > 90) {
        status = 'unhealthy'; // Critical memory usage
      } else if (usagePercent > 75) {
        status = 'degraded'; // High memory usage
      }

      return { status, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Memory check failed'
      };
    }
  }

  private async checkDiskSpace(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details?: any;
    error?: string;
  }> {
    try {
      // Simple disk space check using fs stats
      const fs = require('fs').promises;
      const stats = await fs.stat('./');

      const details = {
        available: 'Unknown', // Would need platform-specific implementation
        checkTime: new Date().toISOString()
      };

      // For now, assume healthy since we can't easily check disk space cross-platform
      return { status: 'healthy', details };
    } catch (error) {
      return {
        status: 'degraded',
        error: 'Could not check disk space',
        details: { reason: 'Cross-platform disk space checking not implemented' }
      };
    }
  }

  private async getSystemMetrics(): Promise<{
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuUsage: any;
    memoryUsage: any;
    processId: number;
  }> {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();

    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      memoryUsage: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      processId: process.pid
    };
  }

  private calculateOverallStatus(healthChecks: Array<{
    component: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
  }>): 'healthy' | 'degraded' | 'unhealthy' {
    const unhealthyCount = healthChecks.filter(check => check.status === 'unhealthy').length;
    const degradedCount = healthChecks.filter(check => check.status === 'degraded').length;

    // If any critical components are unhealthy, system is unhealthy
    const criticalComponents = ['database'];
    const criticalUnhealthy = healthChecks.some(check =>
      criticalComponents.includes(check.component) && check.status === 'unhealthy'
    );

    if (criticalUnhealthy || unhealthyCount > 2) {
      return 'unhealthy';
    }

    if (unhealthyCount > 0 || degradedCount > 1) {
      return 'degraded';
    }

    return 'healthy';
  }

  private validateHealthResponse(response: any): void {
    // Validate top-level structure
    const requiredFields = ['status', 'timestamp', 'uptime', 'version', 'environment', 'components', 'systemMetrics', 'responseTime'];

    for (const field of requiredFields) {
      if (!(field in response)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate status
    const validStatuses = ['healthy', 'degraded', 'unhealthy'];
    if (!validStatuses.includes(response.status)) {
      throw new Error(`Invalid status: ${response.status}`);
    }

    // Validate timestamp
    if (isNaN(Date.parse(response.timestamp))) {
      throw new Error('timestamp must be a valid ISO timestamp');
    }

    // Validate uptime
    if (typeof response.uptime !== 'number' || response.uptime < 0) {
      throw new Error('uptime must be a non-negative number');
    }

    // Validate version
    if (typeof response.version !== 'string') {
      throw new Error('version must be a string');
    }

    // Validate environment
    if (typeof response.environment !== 'string') {
      throw new Error('environment must be a string');
    }

    // Validate components array
    if (!Array.isArray(response.components)) {
      throw new Error('components must be an array');
    }

    response.components.forEach((component: any, index: number) => {
      const requiredComponentFields = ['component', 'status', 'responseTime'];

      requiredComponentFields.forEach(field => {
        if (!(field in component)) {
          throw new Error(`Missing required component field at index ${index}: ${field}`);
        }
      });

      if (!validStatuses.includes(component.status)) {
        throw new Error(`Invalid component status at index ${index}: ${component.status}`);
      }

      if (typeof component.responseTime !== 'number' || component.responseTime < 0) {
        throw new Error(`Component responseTime at index ${index} must be a non-negative number`);
      }
    });

    // Validate system metrics
    if (!response.systemMetrics || typeof response.systemMetrics !== 'object') {
      throw new Error('systemMetrics must be an object');
    }

    const requiredMetricsFields = ['nodeVersion', 'platform', 'arch', 'cpuUsage', 'memoryUsage', 'processId'];
    requiredMetricsFields.forEach(field => {
      if (!(field in response.systemMetrics)) {
        throw new Error(`Missing required systemMetrics field: ${field}`);
      }
    });

    // Validate response time
    if (typeof response.responseTime !== 'number' || response.responseTime < 0) {
      throw new Error('responseTime must be a non-negative number');
    }
  }
}
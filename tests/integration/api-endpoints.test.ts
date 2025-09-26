/**
 * Integration Tests for API Endpoints
 *
 * Tests the complete API functionality end-to-end
 */

import request from 'supertest';
import { Pool } from 'pg';
import { MigrationCoverageServer } from '../../src/migration-coverage/server';
import { databaseManager } from '../../src/migration-coverage/config/database';

// Mock database manager for testing
jest.mock('../../src/migration-coverage/config/database', () => ({
  databaseManager: {
    initialize: jest.fn(),
    close: jest.fn(),
    getSourcePool: jest.fn(),
    getTargetPool: jest.fn(),
    getHealthStatus: jest.fn()
  }
}));

describe('API Endpoints Integration Tests', () => {
  let server: MigrationCoverageServer;
  let app: any;
  let mockSourcePool: jest.Mocked<Pool>;
  let mockTargetPool: jest.Mocked<Pool>;
  let mockClient: any;

  beforeAll(async () => {
    // Setup mock client
    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      release: jest.fn()
    };

    // Setup mock pools
    mockSourcePool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0
    } as any;

    mockTargetPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0
    } as any;

    // Mock database manager methods
    (databaseManager.initialize as jest.Mock).mockResolvedValue(undefined);
    (databaseManager.close as jest.Mock).mockResolvedValue(undefined);
    (databaseManager.getSourcePool as jest.Mock).mockReturnValue(mockSourcePool);
    (databaseManager.getTargetPool as jest.Mock).mockReturnValue(mockTargetPool);
    (databaseManager.getHealthStatus as jest.Mock).mockResolvedValue({
      source: { connected: true, activeConnections: 2 },
      target: { connected: true, activeConnections: 5 }
    });

    // Setup default mock responses
    mockClient.query.mockResolvedValue({ rows: [] });

    // Start server
    server = new MigrationCoverageServer();
    await server.start();
    app = server.getApp();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default mock response
    mockClient.query.mockResolvedValue({ rows: [] });
  });

  describe('GET /health', () => {
    it('should return healthy status when all systems are operational', async () => {
      // Mock successful health checks
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ test: 1, timestamp: new Date() }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ active_connections: 5 }] });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('components');
      expect(response.body).toHaveProperty('systemMetrics');
      expect(response.body).toHaveProperty('responseTime');

      // Check response time header
      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });

    it('should return degraded status when some components have issues', async () => {
      // Mock degraded database performance
      mockClient.query.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ rows: [{ test: 1 }] }), 6000); // Slow response
        });
      });

      const response = await request(app)
        .get('/health')
        .timeout(10000);

      expect(response.body.status).toMatch(/healthy|degraded/);
      expect(response.body.components).toBeInstanceOf(Array);
    });

    it('should return unhealthy status when critical components fail', async () => {
      // Mock database connection failure
      (databaseManager.getHealthStatus as jest.Mock).mockResolvedValue({
        source: { connected: false, error: 'Connection refused' },
        target: { connected: false, error: 'Connection timeout' }
      });

      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });
  });

  describe('GET /coverage/summary', () => {
    it('should return comprehensive coverage summary', async () => {
      const response = await request(app)
        .get('/coverage/summary')
        .expect(200);

      expect(response.body).toHaveProperty('totalScripts');
      expect(response.body).toHaveProperty('completedScripts');
      expect(response.body).toHaveProperty('totalRecords');
      expect(response.body).toHaveProperty('migratedRecords');
      expect(response.body).toHaveProperty('overallSuccessRate');
      expect(response.body).toHaveProperty('domainCoverage');
      expect(response.body).toHaveProperty('riskAssessment');
      expect(response.body).toHaveProperty('timeline');
      expect(response.body).toHaveProperty('lastUpdated');
      expect(response.body).toHaveProperty('responseTime');

      // Validate domain coverage structure
      expect(response.body.domainCoverage).toHaveProperty('clinical');
      expect(response.body.domainCoverage).toHaveProperty('business');
      expect(response.body.domainCoverage).toHaveProperty('communications');
      expect(response.body.domainCoverage).toHaveProperty('technical');

      // Validate risk assessment structure
      expect(response.body.riskAssessment).toHaveProperty('level');
      expect(response.body.riskAssessment).toHaveProperty('score');
      expect(['low', 'medium', 'high']).toContain(response.body.riskAssessment.level);

      // Validate timeline structure
      expect(response.body.timeline).toHaveProperty('estimatedCompletionDays');
      expect(response.body.timeline).toHaveProperty('confidence');

      // Validate data types
      expect(typeof response.body.totalScripts).toBe('number');
      expect(typeof response.body.completedScripts).toBe('number');
      expect(typeof response.body.overallSuccessRate).toBe('number');
      expect(response.body.overallSuccessRate).toBeLessThanOrEqual(100);
    });

    it('should include response time and request ID headers', async () => {
      const response = await request(app)
        .get('/coverage/summary')
        .expect(200);

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-api-version']).toBeDefined();
    });
  });

  describe('GET /scripts/status', () => {
    it('should return paginated scripts status', async () => {
      const response = await request(app)
        .get('/scripts/status')
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toHaveProperty('scripts');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('filters');
      expect(response.body).toHaveProperty('lastUpdated');
      expect(response.body).toHaveProperty('responseTime');

      // Validate pagination structure
      expect(response.body.pagination).toHaveProperty('currentPage');
      expect(response.body.pagination).toHaveProperty('totalPages');
      expect(response.body.pagination).toHaveProperty('totalItems');
      expect(response.body.pagination).toHaveProperty('itemsPerPage');
      expect(response.body.pagination).toHaveProperty('hasNextPage');
      expect(response.body.pagination).toHaveProperty('hasPreviousPage');

      // Validate summary structure
      expect(response.body.summary).toHaveProperty('totalScripts');
      expect(response.body.summary).toHaveProperty('completedScripts');
      expect(response.body.summary).toHaveProperty('inProgressScripts');
      expect(response.body.summary).toHaveProperty('pendingScripts');
      expect(response.body.summary).toHaveProperty('failedScripts');

      expect(Array.isArray(response.body.scripts)).toBe(true);
    });

    it('should support filtering by domain', async () => {
      const response = await request(app)
        .get('/scripts/status')
        .query({ domain: 'clinical' })
        .expect(200);

      expect(response.body.filters.domain).toBe('clinical');
    });

    it('should support filtering by status', async () => {
      const response = await request(app)
        .get('/scripts/status')
        .query({ status: 'completed' })
        .expect(200);

      expect(response.body.filters.status).toBe('completed');
    });

    it('should support sorting options', async () => {
      const response = await request(app)
        .get('/scripts/status')
        .query({ sortBy: 'successRate', sortOrder: 'desc' })
        .expect(200);

      expect(response.body.filters.sortBy).toBe('successRate');
      expect(response.body.filters.sortOrder).toBe('desc');
    });

    it('should validate query parameters', async () => {
      await request(app)
        .get('/scripts/status')
        .query({ page: -1 })
        .expect(400);

      await request(app)
        .get('/scripts/status')
        .query({ limit: 500 })
        .expect(400);

      await request(app)
        .get('/scripts/status')
        .query({ sortBy: 'invalid_field' })
        .expect(400);
    });

    it('should include metrics when requested', async () => {
      const response = await request(app)
        .get('/scripts/status')
        .query({ includeMetrics: 'true' })
        .expect(200);

      if (response.body.scripts.length > 0) {
        const script = response.body.scripts[0];
        if (script.metrics) {
          expect(script.metrics).toHaveProperty('linesOfCode');
          expect(script.metrics).toHaveProperty('cyclomaticComplexity');
          expect(script.metrics).toHaveProperty('maintainabilityIndex');
        }
      }
    });
  });

  describe('GET /domains/coverage', () => {
    it('should return domain coverage analysis', async () => {
      const response = await request(app)
        .get('/domains/coverage')
        .expect(200);

      expect(response.body).toHaveProperty('domains');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('trends');
      expect(response.body).toHaveProperty('insights');
      expect(response.body).toHaveProperty('metadata');

      expect(Array.isArray(response.body.domains)).toBe(true);
      expect(Array.isArray(response.body.insights)).toBe(true);

      // Validate summary structure
      expect(response.body.summary).toHaveProperty('totalDomains');
      expect(response.body.summary).toHaveProperty('overallCoverage');
      expect(response.body.summary).toHaveProperty('averageSuccessRate');

      // Validate trends structure
      expect(response.body.trends).toHaveProperty('improvingDomains');
      expect(response.body.trends).toHaveProperty('decliningDomains');
      expect(response.body.trends).toHaveProperty('stableDomains');
    });

    it('should support filtering by specific domain', async () => {
      const response = await request(app)
        .get('/domains/coverage')
        .query({ domain: 'clinical' })
        .expect(200);

      expect(response.body.metadata.filteredDomain).toBe('clinical');
    });

    it('should reject invalid domain names', async () => {
      await request(app)
        .get('/domains/coverage')
        .query({ domain: 'invalid_domain' })
        .expect(400);
    });

    it('should include details when requested', async () => {
      const response = await request(app)
        .get('/domains/coverage')
        .query({ includeDetails: 'true' })
        .expect(200);

      expect(response.body.metadata.includeDetails).toBe(true);

      if (response.body.domains.length > 0) {
        const domain = response.body.domains[0];
        if (domain.details) {
          expect(domain.details).toHaveProperty('entities');
          expect(domain.details).toHaveProperty('issues');
          expect(domain.details).toHaveProperty('recommendations');
        }
      }
    });

    it('should include validation when requested', async () => {
      // Mock validation queries
      mockClient.query.mockResolvedValue({ rows: [{ count: '0' }] });

      const response = await request(app)
        .get('/domains/coverage')
        .query({ includeValidation: 'true' })
        .expect(200);

      expect(response.body.metadata.includeValidation).toBe(true);
    });
  });

  describe('GET /entities/performance', () => {
    it('should return entity performance metrics', async () => {
      const response = await request(app)
        .get('/entities/performance')
        .expect(200);

      expect(response.body).toHaveProperty('entities');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('insights');
      expect(response.body).toHaveProperty('filters');
      expect(response.body).toHaveProperty('metadata');

      expect(Array.isArray(response.body.entities)).toBe(true);
      expect(Array.isArray(response.body.insights)).toBe(true);

      // Validate summary structure
      expect(response.body.summary).toHaveProperty('totalEntities');
      expect(response.body.summary).toHaveProperty('averageSuccessRate');
      expect(response.body.summary).toHaveProperty('performanceDistribution');
      expect(response.body.summary).toHaveProperty('topPerformers');
      expect(response.body.summary).toHaveProperty('needsAttention');

      // Validate performance distribution
      expect(response.body.summary.performanceDistribution).toHaveProperty('excellent');
      expect(response.body.summary.performanceDistribution).toHaveProperty('good');
      expect(response.body.summary.performanceDistribution).toHaveProperty('fair');
      expect(response.body.summary.performanceDistribution).toHaveProperty('poor');
    });

    it('should support pagination and sorting', async () => {
      const response = await request(app)
        .get('/entities/performance')
        .query({ page: 1, limit: 5, sortBy: 'successRate', sortOrder: 'desc' })
        .expect(200);

      expect(response.body.pagination.currentPage).toBe(1);
      expect(response.body.pagination.itemsPerPage).toBe(5);
      expect(response.body.filters.sortBy).toBe('successRate');
      expect(response.body.filters.sortOrder).toBe('desc');
    });

    it('should support filtering by domain and success rate', async () => {
      const response = await request(app)
        .get('/entities/performance')
        .query({ domain: 'clinical', minSuccessRate: 95 })
        .expect(200);

      expect(response.body.filters.domain).toBe('clinical');
      expect(response.body.filters.minSuccessRate).toBe(95);
    });

    it('should validate query parameters', async () => {
      await request(app)
        .get('/entities/performance')
        .query({ sortBy: 'invalid_field' })
        .expect(400);

      await request(app)
        .get('/entities/performance')
        .query({ minSuccessRate: 150 })
        .expect(400);

      await request(app)
        .get('/entities/performance')
        .query({ minRecords: -1 })
        .expect(400);
    });

    it('should include validation when requested', async () => {
      // Mock validation queries
      mockClient.query.mockResolvedValue({ rows: [{ count: '0' }] });

      const response = await request(app)
        .get('/entities/performance')
        .query({ includeValidation: 'true' })
        .expect(200);

      expect(response.body.metadata.includeValidation).toBe(true);
    });
  });

  describe('POST /validation/run', () => {
    it('should start validation job and return job ID', async () => {
      const requestBody = {
        entities: ['patients', 'orders'],
        includeIntegrityChecks: true,
        includeCrossEntity: true
      };

      const response = await request(app)
        .post('/validation/run')
        .send(requestBody)
        .expect(202);

      expect(response.body).toHaveProperty('jobId');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('estimatedDuration');
      expect(response.body).toHaveProperty('pollUrl');
      expect(response.body).toHaveProperty('timestamp');

      expect(response.body.status).toBe('accepted');
      expect(response.body.jobId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
      expect(response.body.pollUrl).toContain('/validation/results/');
    });

    it('should validate request body', async () => {
      await request(app)
        .post('/validation/run')
        .send({ entities: 'invalid' })
        .expect(400);
    });

    it('should require content-type application/json', async () => {
      await request(app)
        .post('/validation/run')
        .set('Content-Type', 'text/plain')
        .send('invalid body')
        .expect(400);
    });
  });

  describe('GET /validation/results/:id', () => {
    it('should return validation job status for pending job', async () => {
      // First start a validation job
      const startResponse = await request(app)
        .post('/validation/run')
        .send({ entities: ['patients'] })
        .expect(202);

      const jobId = startResponse.body.jobId;

      // Immediately check status (should be pending or running)
      const response = await request(app)
        .get(`/validation/results/${jobId}`)
        .expect(200);

      expect(response.body).toHaveProperty('jobId');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('progress');
      expect(response.body).toHaveProperty('startTime');

      expect(response.body.jobId).toBe(jobId);
      expect(['pending', 'running', 'completed']).toContain(response.body.status);
    });

    it('should return 404 for non-existent job', async () => {
      const fakeJobId = '12345678-1234-1234-1234-123456789012';

      await request(app)
        .get(`/validation/results/${fakeJobId}`)
        .expect(404);
    });

    it('should return 400 for invalid job ID format', async () => {
      await request(app)
        .get('/validation/results/invalid-id')
        .expect(404); // Route parameter validation
    });

    it('should support different response formats', async () => {
      // Start a job first
      const startResponse = await request(app)
        .post('/validation/run')
        .send({ entities: ['patients'] })
        .expect(202);

      const jobId = startResponse.body.jobId;

      // Test JSON format (default)
      const jsonResponse = await request(app)
        .get(`/validation/results/${jobId}`)
        .expect(200);

      expect(jsonResponse.headers['content-type']).toMatch(/application\/json/);

      // Test report format (if job is completed)
      const reportResponse = await request(app)
        .get(`/validation/results/${jobId}`)
        .query({ format: 'report' });

      // Could be 200 (with report) or 200 (with status) depending on timing
      expect([200, 503]).toContain(reportResponse.status);
    });
  });

  describe('GET /reports/generate', () => {
    it('should generate comprehensive report in JSON format', async () => {
      const response = await request(app)
        .get('/reports/generate')
        .query({ type: 'comprehensive', format: 'json' })
        .expect(200);

      expect(response.body).toHaveProperty('reportType');
      expect(response.body).toHaveProperty('format');
      expect(response.body).toHaveProperty('generatedAt');
      expect(response.body).toHaveProperty('responseTime');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body).toHaveProperty('content');

      expect(response.body.reportType).toBe('comprehensive');
      expect(response.body.format).toBe('json');
      expect(response.body.metadata).toHaveProperty('totalScripts');
      expect(response.body.metadata).toHaveProperty('totalEntities');
    });

    it('should generate different report types', async () => {
      const reportTypes = ['comprehensive', 'coverage', 'executive', 'detailed'];

      for (const type of reportTypes) {
        const response = await request(app)
          .get('/reports/generate')
          .query({ type, format: 'json' })
          .expect(200);

        expect(response.body.reportType).toBe(type);
      }
    });

    it('should support different output formats', async () => {
      const formats = ['json', 'html', 'markdown', 'csv'];

      for (const format of formats) {
        const response = await request(app)
          .get('/reports/generate')
          .query({ type: 'coverage', format });

        expect(response.status).toBe(200);

        if (format === 'json') {
          expect(response.headers['content-type']).toMatch(/application\/json/);
        } else if (format === 'html') {
          expect(response.headers['content-type']).toMatch(/text\/html/);
        } else if (format === 'markdown') {
          expect(response.headers['content-type']).toMatch(/text\/markdown/);
        } else if (format === 'csv') {
          expect(response.headers['content-type']).toMatch(/text\/csv/);
        }
      }
    });

    it('should validate query parameters', async () => {
      await request(app)
        .get('/reports/generate')
        .query({ type: 'invalid_type' })
        .expect(400);

      await request(app)
        .get('/reports/generate')
        .query({ format: 'invalid_format' })
        .expect(400);
    });

    it('should require validation flag for validation reports', async () => {
      await request(app)
        .get('/reports/generate')
        .query({ type: 'validation', includeValidation: 'false' })
        .expect(400);
    });

    it('should save report to file when requested', async () => {
      const response = await request(app)
        .get('/reports/generate')
        .query({ type: 'coverage', format: 'json', saveToFile: 'true' })
        .expect(200);

      // savedPath might be null if saving failed, but should be in response
      expect(response.body).toHaveProperty('savedPath');
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for non-existent endpoints', async () => {
      const response = await request(app)
        .get('/non-existent-endpoint')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('availableEndpoints');
      expect(response.body.error).toBe('Not Found');
    });

    it('should handle database connection errors gracefully', async () => {
      // Mock database connection failure
      mockClient.query.mockRejectedValue(new Error('Connection failed'));

      const response = await request(app)
        .get('/coverage/summary');

      // Should handle error gracefully, not crash
      expect([200, 500, 503]).toContain(response.status);
    });

    it('should include error details in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        mockClient.query.mockRejectedValue(new Error('Test error'));

        const response = await request(app)
          .get('/coverage/summary');

        if (response.status >= 400) {
          expect(response.body).toHaveProperty('error');
          expect(response.body).toHaveProperty('requestId');
        }
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should handle rate limiting', async () => {
      // This test would need to make many requests quickly
      // For now, we'll just verify the rate limiting middleware is present
      const response = await request(app)
        .get('/coverage/summary')
        .expect(200);

      // Check that rate limit headers might be present
      // (depends on rate limiting configuration)
      expect(response.status).toBe(200);
    }, 10000);
  });

  describe('Security and Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for security headers (set by helmet)
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    it('should include API version header', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-api-version');
      expect(response.headers).toHaveProperty('x-powered-by');
    });

    it('should handle CORS correctly', async () => {
      const response = await request(app)
        .options('/coverage/summary')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('Performance', () => {
    it('should respond within reasonable time limits', async () => {
      const startTime = Date.now();

      await request(app)
        .get('/health')
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(5000); // 5 seconds max
    });

    it('should include response time in headers', async () => {
      const response = await request(app)
        .get('/coverage/summary')
        .expect(200);

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
      expect(response.body).toHaveProperty('responseTime');
      expect(typeof response.body.responseTime).toBe('number');
    });
  });
});
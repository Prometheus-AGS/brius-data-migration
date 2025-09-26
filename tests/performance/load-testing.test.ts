/**
 * Performance and Load Testing
 *
 * Tests the API performance under various load conditions
 */

import request from 'supertest';
import { performance } from 'perf_hooks';
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

describe('Performance and Load Tests', () => {
  let server: MigrationCoverageServer;
  let app: any;
  let mockSourcePool: jest.Mocked<Pool>;
  let mockTargetPool: jest.Mocked<Pool>;
  let mockClient: any;

  beforeAll(async () => {
    // Setup mock client with realistic response times
    mockClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation(() => {
        // Simulate database query time (10-100ms)
        const delay = Math.random() * 90 + 10;
        return new Promise(resolve => {
          setTimeout(() => resolve({ rows: [] }), delay);
        });
      }),
      release: jest.fn()
    };

    // Setup mock pools
    mockSourcePool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0
    } as any;

    mockTargetPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      totalCount: 20,
      idleCount: 10,
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
  });

  describe('Response Time Performance', () => {
    it('should respond to health checks within 100ms', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = performance.now();

        await request(app)
          .get('/health')
          .expect(200);

        const end = performance.now();
        measurements.push(end - start);
      }

      const averageTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length;
      const maxTime = Math.max(...measurements);

      expect(averageTime).toBeLessThan(100); // Average under 100ms
      expect(maxTime).toBeLessThan(500); // No request over 500ms

      console.log(`Health check - Average: ${averageTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`);
    });

    it('should respond to coverage summary within 2 seconds', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();

        const response = await request(app)
          .get('/coverage/summary')
          .expect(200);

        const end = performance.now();
        measurements.push(end - start);

        // Verify response time is also tracked in the response
        expect(response.body.responseTime).toBeLessThan(2000);
      }

      const averageTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length;
      const maxTime = Math.max(...measurements);

      expect(averageTime).toBeLessThan(2000); // Average under 2 seconds
      expect(maxTime).toBeLessThan(5000); // No request over 5 seconds

      console.log(`Coverage summary - Average: ${averageTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`);
    });

    it('should handle scripts status requests efficiently', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();

        await request(app)
          .get('/scripts/status')
          .query({ limit: 20 })
          .expect(200);

        const end = performance.now();
        measurements.push(end - start);
      }

      const averageTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length;

      expect(averageTime).toBeLessThan(3000); // Average under 3 seconds

      console.log(`Scripts status - Average: ${averageTime.toFixed(2)}ms`);
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple concurrent health check requests', async () => {
      const concurrentRequests = 20;
      const promises: Promise<any>[] = [];

      const startTime = performance.now();

      // Launch concurrent requests
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          request(app)
            .get('/health')
            .expect(200)
        );
      }

      const responses = await Promise.all(promises);
      const endTime = performance.now();

      const totalTime = endTime - startTime;

      // All requests should complete
      expect(responses).toHaveLength(concurrentRequests);

      // Should handle concurrency efficiently (not take concurrentRequests * single_request_time)
      expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds

      console.log(`${concurrentRequests} concurrent health checks completed in ${totalTime.toFixed(2)}ms`);
    });

    it('should handle mixed concurrent requests', async () => {
      const requests = [
        // Mix of different endpoint types
        request(app).get('/health'),
        request(app).get('/coverage/summary'),
        request(app).get('/scripts/status').query({ limit: 10 }),
        request(app).get('/domains/coverage'),
        request(app).get('/entities/performance').query({ limit: 10 }),
        request(app).get('/health'),
        request(app).get('/coverage/summary'),
        request(app).get('/scripts/status').query({ limit: 5 })
      ];

      const startTime = performance.now();
      const responses = await Promise.all(requests);
      const endTime = performance.now();

      const totalTime = endTime - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds

      console.log(`${requests.length} mixed concurrent requests completed in ${totalTime.toFixed(2)}ms`);
    });

    it('should maintain performance under sustained load', async () => {
      const duration = 10000; // 10 seconds
      const requestInterval = 100; // 100ms between requests
      const requests: Promise<any>[] = [];
      const startTime = performance.now();

      // Generate sustained load
      const intervalId = setInterval(() => {
        if (performance.now() - startTime < duration) {
          requests.push(
            request(app)
              .get('/health')
              .expect(200)
          );
        }
      }, requestInterval);

      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, duration));
      clearInterval(intervalId);

      // Wait for all requests to complete
      const responses = await Promise.all(requests);

      expect(responses.length).toBeGreaterThan(50); // Should have made many requests

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      console.log(`Sustained load test: ${responses.length} requests over ${duration}ms`);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should not leak memory during repeated requests', async () => {
      const initialMemory = process.memoryUsage();

      // Make many requests to test for memory leaks
      for (let i = 0; i < 100; i++) {
        await request(app)
          .get('/health')
          .expect(200);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const heapGrowthMB = heapGrowth / (1024 * 1024);

      // Memory growth should be reasonable (less than 10MB for 100 requests)
      expect(heapGrowthMB).toBeLessThan(10);

      console.log(`Memory growth after 100 requests: ${heapGrowthMB.toFixed(2)}MB`);
      console.log(`Heap used: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    });

    it('should handle large response payloads efficiently', async () => {
      const startMemory = process.memoryUsage();

      // Request endpoints that might return larger payloads
      const responses = await Promise.all([
        request(app).get('/scripts/status').query({ limit: 200 }),
        request(app).get('/entities/performance').query({ limit: 200, includeValidation: 'true' }),
        request(app).get('/domains/coverage').query({ includeDetails: 'true' })
      ]);

      const endMemory = process.memoryUsage();

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      const memoryGrowth = (endMemory.heapUsed - startMemory.heapUsed) / (1024 * 1024);
      expect(memoryGrowth).toBeLessThan(50); // Less than 50MB growth

      console.log(`Memory growth for large payloads: ${memoryGrowth.toFixed(2)}MB`);
    });
  });

  describe('Database Connection Performance', () => {
    it('should efficiently manage database connections', async () => {
      // Track connection usage
      let maxConnections = 0;
      let connectionCalls = 0;

      const originalConnect = mockTargetPool.connect;
      mockTargetPool.connect = jest.fn().mockImplementation(async () => {
        connectionCalls++;
        maxConnections = Math.max(maxConnections, connectionCalls);
        const client = await originalConnect();

        // Simulate connection being released
        setTimeout(() => {
          connectionCalls--;
        }, 100);

        return client;
      });

      // Make concurrent requests that require database access
      const requests = Array(10).fill(0).map(() =>
        request(app).get('/coverage/summary').expect(200)
      );

      await Promise.all(requests);

      // Should not have opened excessive connections
      expect(maxConnections).toBeLessThan(15); // Should use connection pooling

      console.log(`Max concurrent database connections: ${maxConnections}`);
    });

    it('should handle database query timeouts gracefully', async () => {
      // Mock slow database queries
      mockClient.query.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ rows: [] }), 1000); // 1 second delay
        });
      });

      const startTime = performance.now();

      const response = await request(app)
        .get('/coverage/summary')
        .timeout(5000); // 5 second timeout

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      // Should handle the delay but still respond
      expect([200, 503]).toContain(response.status);
      expect(responseTime).toBeGreaterThan(1000); // Should reflect the delay
      expect(responseTime).toBeLessThan(5000); // But not timeout

      console.log(`Slow query response time: ${responseTime.toFixed(2)}ms`);
    });
  });

  describe('Validation Performance', () => {
    it('should handle validation job creation efficiently', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();

        const response = await request(app)
          .post('/validation/run')
          .send({
            entities: ['patients', 'orders'],
            includeIntegrityChecks: true,
            includeCrossEntity: true
          })
          .expect(202);

        const end = performance.now();
        measurements.push(end - start);

        expect(response.body.jobId).toBeDefined();
      }

      const averageTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length;

      // Job creation should be fast (just creates job, doesn't run validation)
      expect(averageTime).toBeLessThan(500); // Under 500ms

      console.log(`Validation job creation - Average: ${averageTime.toFixed(2)}ms`);
    });

    it('should handle multiple concurrent validation job creations', async () => {
      const concurrentJobs = 5;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < concurrentJobs; i++) {
        promises.push(
          request(app)
            .post('/validation/run')
            .send({
              entities: [`entity_${i}`],
              includeIntegrityChecks: true
            })
            .expect(202)
        );
      }

      const responses = await Promise.all(promises);

      // All jobs should be created successfully
      expect(responses).toHaveLength(concurrentJobs);

      // Each should have unique job ID
      const jobIds = responses.map(r => r.body.jobId);
      const uniqueJobIds = new Set(jobIds);
      expect(uniqueJobIds.size).toBe(concurrentJobs);

      console.log(`Created ${concurrentJobs} concurrent validation jobs`);
    });
  });

  describe('Report Generation Performance', () => {
    it('should generate reports efficiently', async () => {
      const reportTypes = ['coverage', 'executive', 'detailed'];
      const measurements: Record<string, number> = {};

      for (const type of reportTypes) {
        const start = performance.now();

        const response = await request(app)
          .get('/reports/generate')
          .query({ type, format: 'json' })
          .expect(200);

        const end = performance.now();
        measurements[type] = end - start;

        expect(response.body.reportType).toBe(type);
      }

      // Report generation should be reasonable
      Object.entries(measurements).forEach(([type, time]) => {
        expect(time).toBeLessThan(5000); // Under 5 seconds
        console.log(`${type} report generation: ${time.toFixed(2)}ms`);
      });
    });

    it('should handle concurrent report generation', async () => {
      const requests = [
        request(app).get('/reports/generate').query({ type: 'coverage', format: 'json' }),
        request(app).get('/reports/generate').query({ type: 'executive', format: 'json' }),
        request(app).get('/reports/generate').query({ type: 'detailed', format: 'json' })
      ];

      const startTime = performance.now();
      const responses = await Promise.all(requests);
      const endTime = performance.now();

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(10000); // Under 10 seconds for all

      console.log(`3 concurrent reports generated in ${totalTime.toFixed(2)}ms`);
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle errors quickly without resource leaks', async () => {
      // Test 404 errors
      const measurements: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = performance.now();

        await request(app)
          .get('/non-existent-endpoint')
          .expect(404);

        const end = performance.now();
        measurements.push(end - start);
      }

      const averageTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length;

      // Error responses should be fast
      expect(averageTime).toBeLessThan(100); // Under 100ms

      console.log(`404 error handling - Average: ${averageTime.toFixed(2)}ms`);
    });

    it('should handle validation errors efficiently', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();

        await request(app)
          .get('/scripts/status')
          .query({ page: -1 }) // Invalid parameter
          .expect(400);

        const end = performance.now();
        measurements.push(end - start);
      }

      const averageTime = measurements.reduce((sum, time) => sum + time, 0) / measurements.length;

      // Validation errors should be fast
      expect(averageTime).toBeLessThan(200); // Under 200ms

      console.log(`Validation error handling - Average: ${averageTime.toFixed(2)}ms`);
    });
  });

  describe('Throughput Testing', () => {
    it('should maintain reasonable throughput under load', async () => {
      const testDuration = 5000; // 5 seconds
      const maxConcurrentRequests = 10;
      let completedRequests = 0;
      let activeRequests = 0;

      const startTime = performance.now();

      const makeRequest = async (): Promise<void> => {
        if (activeRequests >= maxConcurrentRequests) return;
        if (performance.now() - startTime >= testDuration) return;

        activeRequests++;

        try {
          await request(app).get('/health').expect(200);
          completedRequests++;
        } catch (error) {
          // Handle errors but continue
        } finally {
          activeRequests--;

          // Schedule next request if test is still running
          if (performance.now() - startTime < testDuration) {
            setImmediate(makeRequest);
          }
        }
      };

      // Start initial batch of requests
      const initialPromises = Array(maxConcurrentRequests).fill(0).map(() => makeRequest());
      await Promise.all(initialPromises);

      // Wait for test to complete
      while (performance.now() - startTime < testDuration || activeRequests > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const actualDuration = performance.now() - startTime;
      const throughput = (completedRequests / actualDuration) * 1000; // requests per second

      expect(completedRequests).toBeGreaterThan(20); // Should handle at least 20 requests
      expect(throughput).toBeGreaterThan(5); // At least 5 requests per second

      console.log(`Throughput test: ${completedRequests} requests in ${actualDuration.toFixed(2)}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} requests/second`);
    });
  });
});
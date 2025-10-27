/**
 * DatabaseComparator Library Tests
 * Tests connection pooling, query optimization, and result comparison functionality
 */

import { Pool, PoolClient } from 'pg';
import { DatabaseComparator, type ConnectionConfig, type ComparisonQuery, type ComparisonResult, type QueryOptimization, type ConnectionPoolStats } from '../../../src/differential-migration/lib/database-comparator';

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0
  }))
}));

describe('DatabaseComparator', () => {
  let comparator: DatabaseComparator;
  let mockSourcePool: jest.Mocked<Pool>;
  let mockDestinationPool: jest.Mocked<Pool>;
  let mockClient: jest.Mocked<PoolClient>;

  const sourceConfig: ConnectionConfig = {
    host: 'source-host',
    port: 5432,
    database: 'source_db',
    user: 'source_user',
    password: 'source_pass',
    maxConnections: 10,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 10000
  };

  const destinationConfig: ConnectionConfig = {
    host: 'dest-host',
    port: 5432,
    database: 'dest_db',
    user: 'dest_user',
    password: 'dest_pass',
    maxConnections: 10,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 10000
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    } as any;

    mockSourcePool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn(),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0
    } as any;

    mockDestinationPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn(),
      end: jest.fn(),
      totalCount: 10,
      idleCount: 5,
      waitingCount: 0
    } as any;

    (Pool as jest.MockedClass<typeof Pool>)
      .mockReturnValueOnce(mockSourcePool)
      .mockReturnValueOnce(mockDestinationPool);

    comparator = new DatabaseComparator(sourceConfig, destinationConfig);
  });

  describe('Connection Management', () => {
    test('should create pools with correct configuration', () => {
      expect(Pool).toHaveBeenCalledTimes(2);
      expect(Pool).toHaveBeenCalledWith({
        host: 'source-host',
        port: 5432,
        database: 'source_db',
        user: 'source_user',
        password: 'source_pass',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      });
    });

    test('should test database connections successfully', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }] });

      const result = await comparator.testConnections();

      expect(result.source.isConnected).toBe(true);
      expect(result.destination.isConnected).toBe(true);
      expect(result.source.latencyMs).toBeGreaterThan(0);
      expect(result.destination.latencyMs).toBeGreaterThan(0);
    });

    test('should handle connection failures gracefully', async () => {
      mockSourcePool.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await comparator.testConnections();

      expect(result.source.isConnected).toBe(false);
      expect(result.source.error).toBe('Connection failed');
    });

    test('should get connection pool statistics', async () => {
      const stats = await comparator.getConnectionStats();

      expect(stats.source.totalConnections).toBe(10);
      expect(stats.source.idleConnections).toBe(5);
      expect(stats.source.waitingConnections).toBe(0);
      expect(stats.destination.totalConnections).toBe(10);
    });
  });

  describe('Query Execution', () => {
    test('should execute source query with parameters', async () => {
      const mockResult = { rows: [{ id: 1, name: 'test' }], rowCount: 1 };
      mockClient.query.mockResolvedValue(mockResult);

      const result = await comparator.executeSourceQuery(
        'SELECT * FROM users WHERE id = $1',
        [123]
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1',
        [123]
      );
      expect(result).toEqual(mockResult);
    });

    test('should execute destination query with parameters', async () => {
      const mockResult = { rows: [{ id: 'uuid', name: 'test', legacy_id: 123 }], rowCount: 1 };
      mockClient.query.mockResolvedValue(mockResult);

      const result = await comparator.executeDestinationQuery(
        'SELECT * FROM users WHERE legacy_id = $1',
        [123]
      );

      expect(result).toEqual(mockResult);
    });

    test('should execute parallel queries efficiently', async () => {
      const sourceResult = { rows: [{ count: 1000 }] };
      const destResult = { rows: [{ count: 950 }] };

      mockClient.query
        .mockResolvedValueOnce(sourceResult)
        .mockResolvedValueOnce(destResult);

      const queries: ComparisonQuery[] = [
        {
          name: 'source_count',
          database: 'source',
          query: 'SELECT COUNT(*) as count FROM users',
          params: []
        },
        {
          name: 'dest_count',
          database: 'destination',
          query: 'SELECT COUNT(*) as count FROM users',
          params: []
        }
      ];

      const results = await comparator.executeParallelQueries(queries);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('source_count');
      expect(results[0].rows).toEqual([{ count: 1000 }]);
      expect(results[1].name).toBe('dest_count');
      expect(results[1].rows).toEqual([{ count: 950 }]);
    });

    test('should handle query errors appropriately', async () => {
      mockClient.query.mockRejectedValue(new Error('Query failed'));

      await expect(
        comparator.executeSourceQuery('INVALID SQL')
      ).rejects.toThrow('Query failed');
    });
  });

  describe('Record Comparison', () => {
    test('should compare record counts accurately', async () => {
      const sourceResult = { rows: [{ count: '1500' }] };
      const destResult = { rows: [{ count: '1450' }] };

      mockClient.query
        .mockResolvedValueOnce(sourceResult)
        .mockResolvedValueOnce(destResult);

      const comparison = await comparator.compareRecordCounts(
        'dispatch_users',
        'users'
      );

      expect(comparison.sourceCount).toBe(1500);
      expect(comparison.destinationCount).toBe(1450);
      expect(comparison.gap).toBe(50);
      expect(comparison.gapPercentage).toBe(3.33);
    });

    test('should compare record sets with detailed analysis', async () => {
      const sourceRecords = [
        { id: 1, name: 'John', email: 'john@example.com' },
        { id: 2, name: 'Jane', email: 'jane@example.com' }
      ];
      const destRecords = [
        { id: 'uuid1', name: 'John', email: 'john@example.com', legacy_id: 1 }
      ];

      const comparison = await comparator.compareRecordSets(
        sourceRecords,
        destRecords,
        'id',
        'legacy_id'
      );

      expect(comparison.totalSourceRecords).toBe(2);
      expect(comparison.totalDestinationRecords).toBe(1);
      expect(comparison.matchingRecords).toBe(1);
      expect(comparison.missingInDestination).toEqual([2]);
      expect(comparison.orphanedInDestination).toEqual([]);
      expect(comparison.matchPercentage).toBe(50);
    });

    test('should identify schema differences between tables', async () => {
      const sourceSchema = {
        rows: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
          { column_name: 'name', data_type: 'character varying', is_nullable: 'YES' },
          { column_name: 'created_at', data_type: 'timestamp without time zone', is_nullable: 'NO' }
        ]
      };

      const destSchema = {
        rows: [
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
          { column_name: 'name', data_type: 'character varying', is_nullable: 'YES' },
          { column_name: 'legacy_id', data_type: 'integer', is_nullable: 'YES' },
          { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' }
        ]
      };

      mockClient.query
        .mockResolvedValueOnce(sourceSchema)
        .mockResolvedValueOnce(destSchema);

      const differences = await comparator.compareSchemas(
        'dispatch_users',
        'users'
      );

      expect(differences.sourceTable).toBe('dispatch_users');
      expect(differences.destinationTable).toBe('users');
      expect(differences.columnDifferences).toHaveLength(2);

      const idDiff = differences.columnDifferences.find(d => d.columnName === 'id');
      expect(idDiff?.differenceType).toBe('type_changed');
      expect(idDiff?.sourceType).toBe('integer');
      expect(idDiff?.destinationType).toBe('uuid');
    });
  });

  describe('Query Optimization', () => {
    test('should analyze query performance', async () => {
      const explainResult = {
        rows: [
          { 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..15.00 rows=1000 width=64)' }
        ]
      };

      mockClient.query.mockResolvedValue(explainResult);

      const analysis = await comparator.analyzeQueryPerformance(
        'SELECT * FROM users WHERE created_at > $1',
        [new Date('2024-01-01')],
        'source'
      );

      expect(analysis.query).toContain('SELECT * FROM users');
      expect(analysis.executionPlan).toHaveLength(1);
      expect(analysis.hasSeqScan).toBe(true);
      expect(analysis.estimatedCost).toBe(15.00);
      expect(analysis.estimatedRows).toBe(1000);
    });

    test('should generate index recommendations', async () => {
      const tableStats = {
        rows: [
          { table_name: 'users', row_count: 50000, table_size: '10 MB' }
        ]
      };

      const indexStats = {
        rows: [
          { column_name: 'email', null_frac: 0.0, n_distinct: 45000 },
          { column_name: 'created_at', null_frac: 0.0, n_distinct: 30000 }
        ]
      };

      mockClient.query
        .mockResolvedValueOnce(tableStats)
        .mockResolvedValueOnce(indexStats);

      const recommendations = await comparator.getIndexRecommendations(
        'users',
        'source'
      );

      expect(recommendations.tableName).toBe('users');
      expect(recommendations.recommendations).toHaveLength(2);
      expect(recommendations.recommendations[0].columnName).toBe('email');
      expect(recommendations.recommendations[0].indexType).toBe('unique');
      expect(recommendations.recommendations[0].priority).toBe('high');
    });

    test('should optimize batch query sizes', () => {
      const smallTableOptimization = comparator.optimizeBatchSize(
        1000,   // totalRecords
        100     // currentBatchSize
      );

      expect(smallTableOptimization.recommendedBatchSize).toBe(250);
      expect(smallTableOptimization.reasoning).toContain('Small dataset');

      const largeTableOptimization = comparator.optimizeBatchSize(
        1000000,  // totalRecords
        100       // currentBatchSize
      );

      expect(largeTableOptimization.recommendedBatchSize).toBeGreaterThan(100);
      expect(largeTableOptimization.reasoning).toContain('Large dataset');
    });
  });

  describe('Performance Monitoring', () => {
    test('should track query execution times', async () => {
      mockClient.query.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve({ rows: [], rowCount: 0 }), 100)
        )
      );

      const startTime = Date.now();
      await comparator.executeSourceQuery('SELECT 1');
      const endTime = Date.now();

      const metrics = await comparator.getPerformanceMetrics();

      expect(metrics.totalQueries).toBe(1);
      expect(metrics.averageExecutionTimeMs).toBeGreaterThan(90);
      expect(metrics.slowestQueryMs).toBeGreaterThan(90);
    });

    test('should identify slow queries', async () => {
      // Simulate slow query
      mockClient.query.mockImplementation(() =>
        new Promise(resolve =>
          setTimeout(() => resolve({ rows: [], rowCount: 0 }), 2000)
        )
      );

      await comparator.executeSourceQuery('SELECT * FROM large_table');

      const slowQueries = await comparator.getSlowQueries(1000); // threshold 1 second

      expect(slowQueries).toHaveLength(1);
      expect(slowQueries[0].query).toContain('SELECT * FROM large_table');
      expect(slowQueries[0].executionTimeMs).toBeGreaterThan(1000);
    });

    test('should monitor connection pool health', async () => {
      const health = await comparator.getConnectionPoolHealth();

      expect(health.source.isHealthy).toBe(true);
      expect(health.source.utilizationPercentage).toBe(50); // 5 idle out of 10 total
      expect(health.destination.isHealthy).toBe(true);
      expect(health.destination.utilizationPercentage).toBe(50);
    });
  });

  describe('Cleanup and Resource Management', () => {
    test('should close all connections properly', async () => {
      await comparator.close();

      expect(mockSourcePool.end).toHaveBeenCalled();
      expect(mockDestinationPool.end).toHaveBeenCalled();
    });

    test('should handle cleanup errors gracefully', async () => {
      mockSourcePool.end.mockRejectedValue(new Error('Cleanup failed'));

      // Should not throw
      await expect(comparator.close()).resolves.toBeUndefined();
    });
  });

  describe('Configuration Validation', () => {
    test('should validate connection configuration', () => {
      const validConfig: ConnectionConfig = {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass'
      };

      const validation = DatabaseComparator.validateConfig(validConfig);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should reject invalid configuration', () => {
      const invalidConfig = {
        host: '',
        port: -1,
        database: '',
        user: '',
        password: ''
      } as ConnectionConfig;

      const validation = DatabaseComparator.validateConfig(invalidConfig);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('host is required');
      expect(validation.errors).toContain('port must be between 1 and 65535');
      expect(validation.errors).toContain('database is required');
      expect(validation.errors).toContain('user is required');
      expect(validation.errors).toContain('password is required');
    });

    test('should validate optional configuration parameters', () => {
      const configWithDefaults: ConnectionConfig = {
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        maxConnections: 50
      };

      const validation = DatabaseComparator.validateConfig(configWithDefaults);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('maxConnections must be between 1 and 20');
    });
  });
});
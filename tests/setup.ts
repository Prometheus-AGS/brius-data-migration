/**
 * Jest Test Setup
 * Configures the test environment for migration coverage API tests
 */

import * as dotenv from 'dotenv';
import { Client } from 'pg';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Global test configuration
jest.setTimeout(30000);

// Global test variables for differential migration testing
let testSourceDbClient: Client | null = null;
let testTargetDbClient: Client | null = null;

// Global test helpers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toHaveValidApiResponse(): R;
    }
  }
}

// Custom matchers
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },

  toHaveValidApiResponse(received: any) {
    const hasStatus = typeof received.status === 'number';
    const hasHeaders = typeof received.headers === 'object';
    const hasBody = received.body !== undefined;

    const pass = hasStatus && hasHeaders && hasBody;

    if (pass) {
      return {
        message: () => `expected response not to have valid API structure`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected response to have valid API structure (status, headers, body)`,
        pass: false,
      };
    }
  },
});

// Test database configuration
export const TEST_CONFIG = {
  database: {
    source: {
      host: process.env.TEST_SOURCE_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_SOURCE_DB_PORT || '5432'),
      database: process.env.TEST_SOURCE_DB_NAME || 'test_source',
      user: process.env.TEST_SOURCE_DB_USER || 'postgres',
      password: process.env.TEST_SOURCE_DB_PASSWORD || 'test',
    },
    target: {
      host: process.env.TEST_TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_TARGET_DB_PORT || '5432'),
      database: process.env.TEST_TARGET_DB_NAME || 'test_target',
      user: process.env.TEST_TARGET_DB_USER || 'postgres',
      password: process.env.TEST_TARGET_DB_PASSWORD || 'test',
    },
  },
  api: {
    port: parseInt(process.env.TEST_API_PORT || '3001'),
    baseUrl: process.env.TEST_API_BASE_URL || 'http://localhost:3001',
  },
};

// Mock data helpers
export const createMockMigrationScript = (overrides = {}) => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'office-migration.ts',
  category: 'core',
  dataDomain: 'business',
  sourceTable: 'dispatch_office',
  targetTable: 'offices',
  recordCount: 7853,
  successRate: 0.9999,
  status: 'complete',
  lastExecuted: new Date().toISOString(),
  ...overrides,
});

export const createMockCoverageSummary = (overrides = {}) => ({
  totalScripts: 43,
  completedScripts: 43,
  totalRecords: 1200000,
  migratedRecords: 1188000,
  overallSuccessRate: 0.99,
  domainCoverage: {
    clinical: 0.995,
    business: 0.998,
    communications: 0.987,
    technical: 0.992,
  },
  ...overrides,
});

// Database connection setup/teardown for differential migration tests
beforeAll(async () => {
  // Initialize test database connections for differential migration tests
  if (process.env.TEST_SOURCE_DB_HOST) {
    testSourceDbClient = new Client({
      host: process.env.TEST_SOURCE_DB_HOST,
      port: parseInt(process.env.TEST_SOURCE_DB_PORT || '5432'),
      user: process.env.TEST_SOURCE_DB_USER,
      password: process.env.TEST_SOURCE_DB_PASSWORD,
      database: process.env.TEST_SOURCE_DB_NAME,
    });

    try {
      await testSourceDbClient.connect();
      console.log('✅ Test source database connection established');
    } catch (error) {
      console.warn('⚠️  Test source database connection failed');
      testSourceDbClient = null;
    }
  }

  if (process.env.TEST_TARGET_DB_HOST) {
    testTargetDbClient = new Client({
      host: process.env.TEST_TARGET_DB_HOST,
      port: parseInt(process.env.TEST_TARGET_DB_PORT || '5432'),
      user: process.env.TEST_TARGET_DB_USER,
      password: process.env.TEST_TARGET_DB_PASSWORD,
      database: process.env.TEST_TARGET_DB_NAME,
    });

    try {
      await testTargetDbClient.connect();
      console.log('✅ Test target database connection established');
    } catch (error) {
      console.warn('⚠️  Test target database connection failed');
      testTargetDbClient = null;
    }
  }
});

afterAll(async () => {
  // Close database connections
  if (testSourceDbClient) {
    await testSourceDbClient.end();
    testSourceDbClient = null;
  }
  if (testTargetDbClient) {
    await testTargetDbClient.end();
    testTargetDbClient = null;
  }
});

// Differential migration test utilities
export const diffMigrationTestUtils = {
  getSourceDbClient: () => testSourceDbClient,
  getTargetDbClient: () => testTargetDbClient,
  isDatabaseTestingAvailable: () => testSourceDbClient !== null && testTargetDbClient !== null,

  generateTestUUID: (): string => {
    return 'test-' + Math.random().toString(36).substr(2, 9);
  },

  createTestCheckpointData: (overrides: any = {}) => ({
    entity_type: 'test_entity',
    migration_run_id: 'test_run_123',
    last_processed_id: 'test_record_100',
    batch_position: 5,
    records_processed: 500,
    records_remaining: 1000,
    checkpoint_data: { batch_info: 'test data' },
    ...overrides
  }),

  createTestAnalysisResult: (overrides: any = {}) => ({
    entity_type: 'test_entity',
    source_record_count: 1500,
    destination_record_count: 1400,
    new_records: ['record1', 'record2', 'record3'],
    modified_records: ['record4', 'record5'],
    deleted_records: ['record6'],
    last_migration_timestamp: new Date('2025-10-25T10:00:00Z'),
    analysis_metadata: { analysis_version: '1.0.0' },
    ...overrides
  }),

  createTestMigrationStatus: (overrides: any = {}) => ({
    migration_session_id: diffMigrationTestUtils.generateTestUUID(),
    overall_status: 'running',
    entities_pending: ['entity1', 'entity2'],
    entities_running: ['entity3'],
    entities_completed: ['entity4'],
    entities_failed: [],
    total_records_processed: 750,
    total_records_remaining: 250,
    started_at: new Date(),
    ...overrides
  })
};

console.log('🧪 Test environment initialized for Migration Coverage API and Differential Migration');
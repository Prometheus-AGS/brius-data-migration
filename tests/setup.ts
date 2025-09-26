/**
 * Jest Test Setup
 * Configures the test environment for migration coverage API tests
 */

import * as dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Global test configuration
jest.setTimeout(30000);

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

console.log('🧪 Test environment initialized for Migration Coverage API');
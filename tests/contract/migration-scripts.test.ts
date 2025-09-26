/**
 * Contract Test: GET /scripts
 *
 * This test validates the API contract for the migration scripts listing endpoint.
 * It MUST FAIL until the actual endpoint is implemented.
 */

import request from 'supertest';
import { TEST_CONFIG } from '../setup';

describe('Contract: GET /scripts', () => {
  const apiUrl = TEST_CONFIG.api.baseUrl;

  describe('GET /api/scripts', () => {
    it('should return 200 with paginated migration scripts list', async () => {
      const response = await request(apiUrl)
        .get('/api/scripts')
        .expect('Content-Type', /json/)
        .expect(200);

      // Validate response structure matches OpenAPI MigrationScriptList schema
      expect(response.body).toHaveProperty('scripts');
      expect(response.body).toHaveProperty('pagination');

      // Validate scripts array
      expect(Array.isArray(response.body.scripts)).toBe(true);

      // Validate pagination structure
      expect(response.body.pagination).toHaveProperty('page');
      expect(response.body.pagination).toHaveProperty('limit');
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('totalPages');

      expect(typeof response.body.pagination.page).toBe('number');
      expect(typeof response.body.pagination.limit).toBe('number');
      expect(typeof response.body.pagination.total).toBe('number');
      expect(typeof response.body.pagination.totalPages).toBe('number');

      expect(response.body.pagination.page).toBeGreaterThanOrEqual(1);
      expect(response.body.pagination.limit).toBeGreaterThanOrEqual(1);
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(0);
      expect(response.body.pagination.totalPages).toBeGreaterThanOrEqual(0);

      // Validate individual script structure
      response.body.scripts.forEach((script: any) => {
        expect(script).toHaveProperty('id');
        expect(script).toHaveProperty('name');
        expect(script).toHaveProperty('category');
        expect(script).toHaveProperty('dataDomain');
        expect(script).toHaveProperty('status');
        expect(script).toHaveProperty('recordCount');
        expect(script).toHaveProperty('successRate');

        expect(script.id).toBeValidUUID();
        expect(typeof script.name).toBe('string');
        expect(script.name).toMatch(/\.ts$/); // Should end with .ts
        expect(['core', 'communications', 'business', 'specialized', 'system', 'critical_fix'])
          .toContain(script.category);
        expect(['clinical', 'business', 'communications', 'technical']).toContain(script.dataDomain);
        expect(['not_started', 'in_progress', 'complete', 'failed', 'rollback_required'])
          .toContain(script.status);
        expect(typeof script.recordCount).toBe('number');
        expect(typeof script.successRate).toBe('number');

        expect(script.recordCount).toBeGreaterThanOrEqual(0);
        expect(script.successRate).toBeGreaterThanOrEqual(0);
        expect(script.successRate).toBeLessThanOrEqual(1);
      });
    });

    it('should handle pagination parameters correctly', async () => {
      // Test default pagination
      const defaultResponse = await request(apiUrl)
        .get('/api/scripts')
        .expect(200);

      expect(defaultResponse.body.pagination.page).toBe(1);
      expect(defaultResponse.body.pagination.limit).toBe(20); // Default from OpenAPI

      // Test custom pagination
      const customResponse = await request(apiUrl)
        .get('/api/scripts?page=2&limit=10')
        .expect(200);

      expect(customResponse.body.pagination.page).toBe(2);
      expect(customResponse.body.pagination.limit).toBe(10);
      expect(customResponse.body.scripts.length).toBeLessThanOrEqual(10);
    });

    it('should filter by category correctly', async () => {
      const categories = ['core', 'communications', 'business', 'specialized', 'system', 'critical_fix'];

      for (const category of categories) {
        const response = await request(apiUrl)
          .get(`/api/scripts?category=${category}`)
          .expect(200);

        // All returned scripts should have the requested category
        response.body.scripts.forEach((script: any) => {
          expect(script.category).toBe(category);
        });
      }
    });

    it('should filter by status correctly', async () => {
      const statuses = ['not_started', 'in_progress', 'complete', 'failed', 'rollback_required'];

      for (const status of statuses) {
        const response = await request(apiUrl)
          .get(`/api/scripts?status=${status}`)
          .expect(200);

        // All returned scripts should have the requested status
        response.body.scripts.forEach((script: any) => {
          expect(script.status).toBe(status);
        });
      }
    });

    it('should handle combined filters', async () => {
      const response = await request(apiUrl)
        .get('/api/scripts?category=core&status=complete&page=1&limit=5')
        .expect(200);

      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.scripts.length).toBeLessThanOrEqual(5);

      response.body.scripts.forEach((script: any) => {
        expect(script.category).toBe('core');
        expect(script.status).toBe('complete');
      });
    });

    it('should validate pagination limits', async () => {
      // Test maximum limit
      const maxLimitResponse = await request(apiUrl)
        .get('/api/scripts?limit=100')
        .expect(200);

      expect(maxLimitResponse.body.pagination.limit).toBe(100);

      // Test limit exceeding maximum (should be capped at 100)
      const exceedingLimitResponse = await request(apiUrl)
        .get('/api/scripts?limit=150')
        .expect(200);

      expect(exceedingLimitResponse.body.pagination.limit).toBe(100);

      // Test minimum values
      const minResponse = await request(apiUrl)
        .get('/api/scripts?page=1&limit=1')
        .expect(200);

      expect(minResponse.body.pagination.page).toBe(1);
      expect(minResponse.body.pagination.limit).toBe(1);
    });

    it('should handle invalid parameters gracefully', async () => {
      // Invalid category
      const invalidCategoryResponse = await request(apiUrl)
        .get('/api/scripts?category=invalid')
        .expect(200); // Should return empty results, not error

      expect(Array.isArray(invalidCategoryResponse.body.scripts)).toBe(true);

      // Invalid pagination values
      const invalidPageResponse = await request(apiUrl)
        .get('/api/scripts?page=0&limit=0')
        .expect(400); // Should return validation error

      expect(invalidPageResponse.body).toHaveProperty('code');
      expect(invalidPageResponse.body).toHaveProperty('message');
    });

    it('should have reasonable performance', async () => {
      const startTime = Date.now();

      await request(apiUrl)
        .get('/api/scripts')
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should respond within 3 seconds
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Optional Fields Validation', () => {
    it('should include optional fields when available', async () => {
      const response = await request(apiUrl)
        .get('/api/scripts')
        .expect(200);

      if (response.body.scripts.length > 0) {
        const script = response.body.scripts[0];

        // Optional fields that may be present
        const optionalFields = ['sourceTable', 'targetTable', 'lastExecuted'];

        optionalFields.forEach(field => {
          if (script.hasOwnProperty(field)) {
            if (field === 'lastExecuted') {
              expect(new Date(script[field]).getTime()).not.toBeNaN();
            } else {
              expect(typeof script[field]).toBe('string');
            }
          }
        });
      }
    });
  });

  describe('Contract Validation', () => {
    it('should match OpenAPI MigrationScriptList schema exactly', async () => {
      const response = await request(apiUrl)
        .get('/api/scripts')
        .expect(200);

      // Required top-level fields
      const requiredFields = ['scripts', 'pagination'];
      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });

      // Ensure no extra top-level fields
      const responseFields = Object.keys(response.body);
      const extraFields = responseFields.filter(field => !requiredFields.includes(field));
      expect(extraFields).toEqual([]);
    });

    it('should validate MigrationScript schema in scripts array', async () => {
      const response = await request(apiUrl)
        .get('/api/scripts')
        .expect(200);

      if (response.body.scripts.length > 0) {
        const script = response.body.scripts[0];

        // Required fields from MigrationScript schema
        const scriptRequiredFields = [
          'id',
          'name',
          'category',
          'dataDomain',
          'status',
          'recordCount',
          'successRate'
        ];

        scriptRequiredFields.forEach(field => {
          expect(script).toHaveProperty(field);
        });
      }
    });

    it('should validate Pagination schema', async () => {
      const response = await request(apiUrl)
        .get('/api/scripts')
        .expect(200);

      const paginationRequiredFields = ['page', 'limit', 'total', 'totalPages'];
      paginationRequiredFields.forEach(field => {
        expect(response.body.pagination).toHaveProperty(field);
      });

      // Ensure no extra pagination fields
      const paginationFields = Object.keys(response.body.pagination);
      const extraPaginationFields = paginationFields.filter(field => !paginationRequiredFields.includes(field));
      expect(extraPaginationFields).toEqual([]);
    });
  });
});

/**
 * IMPORTANT: This test MUST FAIL until the actual implementation is created.
 * The test validates the contract defined in the OpenAPI specification.
 *
 * Expected behavior when run before implementation:
 * - Tests should fail with connection refused or 404 errors
 * - This validates that we're following TDD principles
 *
 * Expected behavior after implementation:
 * - All tests should pass
 * - Pagination should work correctly with default and custom parameters
 * - Filtering by category and status should work as specified
 * - Response should match the exact OpenAPI specification
 */
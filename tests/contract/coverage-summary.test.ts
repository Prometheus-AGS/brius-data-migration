/**
 * Contract Test: GET /coverage/summary
 *
 * This test validates the API contract for the coverage summary endpoint.
 * It MUST FAIL until the actual endpoint is implemented.
 */

import request from 'supertest';
import { TEST_CONFIG } from '../setup';

describe('Contract: GET /coverage/summary', () => {
  const apiUrl = TEST_CONFIG.api.baseUrl;

  describe('GET /api/coverage/summary', () => {
    it('should return 200 with valid coverage summary structure', async () => {
      const response = await request(apiUrl)
        .get('/api/coverage/summary')
        .expect('Content-Type', /json/)
        .expect(200);

      // Validate response structure matches OpenAPI spec
      expect(response.body).toHaveProperty('totalScripts');
      expect(response.body).toHaveProperty('completedScripts');
      expect(response.body).toHaveProperty('totalRecords');
      expect(response.body).toHaveProperty('migratedRecords');
      expect(response.body).toHaveProperty('overallSuccessRate');
      expect(response.body).toHaveProperty('domainCoverage');

      // Validate data types
      expect(typeof response.body.totalScripts).toBe('number');
      expect(typeof response.body.completedScripts).toBe('number');
      expect(typeof response.body.totalRecords).toBe('number');
      expect(typeof response.body.migratedRecords).toBe('number');
      expect(typeof response.body.overallSuccessRate).toBe('number');
      expect(typeof response.body.domainCoverage).toBe('object');

      // Validate constraints
      expect(response.body.totalScripts).toBeGreaterThanOrEqual(0);
      expect(response.body.completedScripts).toBeLessThanOrEqual(response.body.totalScripts);
      expect(response.body.overallSuccessRate).toBeGreaterThanOrEqual(0);
      expect(response.body.overallSuccessRate).toBeLessThanOrEqual(1);
      expect(response.body.migratedRecords).toBeLessThanOrEqual(response.body.totalRecords);

      // Validate domain coverage structure
      expect(response.body.domainCoverage).toHaveProperty('clinical');
      expect(response.body.domainCoverage).toHaveProperty('business');
      expect(response.body.domainCoverage).toHaveProperty('communications');
      expect(response.body.domainCoverage).toHaveProperty('technical');

      // Validate domain coverage ranges
      expect(response.body.domainCoverage.clinical).toBeGreaterThanOrEqual(0);
      expect(response.body.domainCoverage.clinical).toBeLessThanOrEqual(1);
      expect(response.body.domainCoverage.business).toBeGreaterThanOrEqual(0);
      expect(response.body.domainCoverage.business).toBeLessThanOrEqual(1);
      expect(response.body.domainCoverage.communications).toBeGreaterThanOrEqual(0);
      expect(response.body.domainCoverage.communications).toBeLessThanOrEqual(1);
      expect(response.body.domainCoverage.technical).toBeGreaterThanOrEqual(0);
      expect(response.body.domainCoverage.technical).toBeLessThanOrEqual(1);
    });

    it('should handle server errors gracefully', async () => {
      // This test simulates a server error scenario
      // The actual endpoint should return 500 with proper error structure
      const response = await request(apiUrl)
        .get('/api/coverage/summary?simulate_error=true')
        .expect('Content-Type', /json/);

      if (response.status === 500) {
        expect(response.body).toHaveProperty('code');
        expect(response.body).toHaveProperty('message');
        expect(typeof response.body.code).toBe('string');
        expect(typeof response.body.message).toBe('string');
      }
    });

    it('should return consistent data structure on multiple calls', async () => {
      const response1 = await request(apiUrl)
        .get('/api/coverage/summary')
        .expect(200);

      const response2 = await request(apiUrl)
        .get('/api/coverage/summary')
        .expect(200);

      // Structure should be identical
      expect(Object.keys(response1.body).sort()).toEqual(Object.keys(response2.body).sort());
      expect(Object.keys(response1.body.domainCoverage).sort())
        .toEqual(Object.keys(response2.body.domainCoverage).sort());
    });

    it('should have reasonable performance', async () => {
      const startTime = Date.now();

      await request(apiUrl)
        .get('/api/coverage/summary')
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should respond within 5 seconds
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Contract Validation', () => {
    it('should match OpenAPI schema exactly', async () => {
      const response = await request(apiUrl)
        .get('/api/coverage/summary')
        .expect(200);

      // This test ensures the response matches the OpenAPI CoverageSummary schema
      const requiredFields = [
        'totalScripts',
        'completedScripts',
        'totalRecords',
        'migratedRecords',
        'overallSuccessRate',
        'domainCoverage'
      ];

      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });

      // Ensure no extra fields are present (strict contract compliance)
      const responseFields = Object.keys(response.body);
      const extraFields = responseFields.filter(field => !requiredFields.includes(field));
      expect(extraFields).toEqual([]);
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
 * - Response should match the exact OpenAPI specification
 * - Performance should be within acceptable limits
 */
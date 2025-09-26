/**
 * Contract Test: GET /scripts/{scriptId}/metrics
 *
 * This test validates the API contract for script-specific metrics endpoint.
 * It MUST FAIL until the actual endpoint is implemented.
 */

import request from 'supertest';
import { TEST_CONFIG } from '../setup';

describe('Contract: GET /scripts/{scriptId}/metrics', () => {
  const apiUrl = TEST_CONFIG.api.baseUrl;
  const validScriptId = '123e4567-e89b-12d3-a456-426614174000';
  const invalidScriptId = 'invalid-uuid';
  const notFoundScriptId = '999e9999-e99b-99d9-a999-999999999999';

  describe('GET /api/scripts/{scriptId}/metrics', () => {
    it('should return 200 with valid metrics for existing script', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect('Content-Type', /json/)
        .expect(200);

      // Validate response structure matches OpenAPI MigrationMetrics schema
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('scriptId');
      expect(response.body).toHaveProperty('executionDate');
      expect(response.body).toHaveProperty('recordsProcessed');
      expect(response.body).toHaveProperty('recordsSuccessful');
      expect(response.body).toHaveProperty('recordsFailed');
      expect(response.body).toHaveProperty('recordsSkipped');
      expect(response.body).toHaveProperty('executionTimeMs');
      expect(response.body).toHaveProperty('throughputPerSecond');

      // Validate data types
      expect(response.body.id).toBeValidUUID();
      expect(response.body.scriptId).toBeValidUUID();
      expect(typeof response.body.executionDate).toBe('string');
      expect(typeof response.body.recordsProcessed).toBe('number');
      expect(typeof response.body.recordsSuccessful).toBe('number');
      expect(typeof response.body.recordsFailed).toBe('number');
      expect(typeof response.body.recordsSkipped).toBe('number');
      expect(typeof response.body.executionTimeMs).toBe('number');
      expect(typeof response.body.throughputPerSecond).toBe('number');

      // Validate script ID matches request
      expect(response.body.scriptId).toBe(validScriptId);

      // Validate date format (ISO 8601)
      expect(new Date(response.body.executionDate).getTime()).not.toBeNaN();

      // Validate constraints
      expect(response.body.recordsProcessed).toBeGreaterThanOrEqual(0);
      expect(response.body.recordsSuccessful).toBeGreaterThanOrEqual(0);
      expect(response.body.recordsFailed).toBeGreaterThanOrEqual(0);
      expect(response.body.recordsSkipped).toBeGreaterThanOrEqual(0);
      expect(response.body.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(response.body.throughputPerSecond).toBeGreaterThanOrEqual(0);

      // Validate logical constraints
      expect(response.body.recordsSuccessful + response.body.recordsFailed + response.body.recordsSkipped)
        .toBeLessThanOrEqual(response.body.recordsProcessed);

      // Calculate and validate throughput consistency
      if (response.body.executionTimeMs > 0) {
        const expectedThroughput = (response.body.recordsProcessed / response.body.executionTimeMs) * 1000;
        expect(Math.abs(response.body.throughputPerSecond - expectedThroughput))
          .toBeLessThan(1); // Allow for rounding differences
      }
    });

    it('should include optional fields when available', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      // Optional fields that may be present
      const optionalFields = ['entityId', 'errorDetails'];

      optionalFields.forEach(field => {
        if (response.body.hasOwnProperty(field)) {
          if (field === 'entityId') {
            expect(response.body[field]).toBeValidUUID();
          } else if (field === 'errorDetails') {
            expect(typeof response.body[field]).toBe('object');
          }
        }
      });
    });

    it('should return 404 for non-existent script', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${notFoundScriptId}/metrics`)
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(typeof response.body.code).toBe('string');
      expect(typeof response.body.message).toBe('string');
    });

    it('should return 400 for invalid UUID format', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${invalidScriptId}/metrics`)
        .expect('Content-Type', /json/)
        .expect(400);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toMatch(/uuid|invalid|format/i);
    });

    it('should handle server errors gracefully', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics?simulate_error=true`)
        .expect('Content-Type', /json/);

      if (response.status === 500) {
        expect(response.body).toHaveProperty('code');
        expect(response.body).toHaveProperty('message');
      }
    });

    it('should return consistent data on multiple calls', async () => {
      const response1 = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      const response2 = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      // Core metrics should be identical (assuming no new executions)
      expect(response1.body.id).toBe(response2.body.id);
      expect(response1.body.scriptId).toBe(response2.body.scriptId);
      expect(response1.body.recordsProcessed).toBe(response2.body.recordsProcessed);
      expect(response1.body.recordsSuccessful).toBe(response2.body.recordsSuccessful);
      expect(response1.body.recordsFailed).toBe(response2.body.recordsFailed);
    });

    it('should have reasonable performance', async () => {
      const startTime = Date.now();

      await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should respond within 2 seconds
      expect(duration).toBeLessThan(2000);
    });

    it('should validate error details structure when present', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      if (response.body.errorDetails) {
        expect(typeof response.body.errorDetails).toBe('object');

        // Common error detail fields that might be present
        const possibleErrorFields = ['errors', 'warnings', 'failedRecords', 'lastError'];

        Object.keys(response.body.errorDetails).forEach(field => {
          // Should contain reasonable field names
          expect(field).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
        });
      }
    });
  });

  describe('Path Parameter Validation', () => {
    it('should validate scriptId parameter format', async () => {
      const invalidIds = [
        'not-a-uuid',
        '123',
        '',
        'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', // Invalid characters
        '123e4567-e89b-12d3-a456', // Too short
        '123e4567-e89b-12d3-a456-426614174000-extra', // Too long
      ];

      for (const invalidId of invalidIds) {
        const response = await request(apiUrl)
          .get(`/api/scripts/${invalidId}/metrics`)
          .expect('Content-Type', /json/);

        expect([400, 404]).toContain(response.status);
        expect(response.body).toHaveProperty('code');
        expect(response.body).toHaveProperty('message');
      }
    });

    it('should handle URL encoding in scriptId', async () => {
      const encodedId = encodeURIComponent(validScriptId);

      const response = await request(apiUrl)
        .get(`/api/scripts/${encodedId}/metrics`)
        .expect(200);

      expect(response.body.scriptId).toBe(validScriptId);
    });

    it('should handle special characters in path', async () => {
      const specialCases = [
        '123e4567-e89b-12d3-a456-426614174000%20',
        '123e4567-e89b-12d3-a456-426614174000/',
        '123e4567-e89b-12d3-a456-426614174000?extra=param',
      ];

      for (const specialCase of specialCases) {
        await request(apiUrl)
          .get(`/api/scripts/${specialCase}/metrics`)
          .expect(res => {
            expect([400, 404]).toContain(res.status);
          });
      }
    });
  });

  describe('Contract Validation', () => {
    it('should match OpenAPI MigrationMetrics schema exactly', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      // Required fields from OpenAPI schema
      const requiredFields = [
        'id',
        'scriptId',
        'executionDate',
        'recordsProcessed',
        'recordsSuccessful',
        'recordsFailed',
        'recordsSkipped',
        'executionTimeMs',
        'throughputPerSecond'
      ];

      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });

      // Optional fields
      const optionalFields = ['entityId', 'errorDetails'];

      // Ensure only expected fields are present
      const responseFields = Object.keys(response.body);
      const allowedFields = [...requiredFields, ...optionalFields];
      const unexpectedFields = responseFields.filter(field => !allowedFields.includes(field));
      expect(unexpectedFields).toEqual([]);
    });

    it('should validate numeric field ranges', async () => {
      const response = await request(apiUrl)
        .get(`/api/scripts/${validScriptId}/metrics`)
        .expect(200);

      // All count fields should be non-negative integers
      const countFields = [
        'recordsProcessed',
        'recordsSuccessful',
        'recordsFailed',
        'recordsSkipped',
        'executionTimeMs'
      ];

      countFields.forEach(field => {
        expect(response.body[field]).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(response.body[field])).toBe(true);
      });

      // Throughput should be non-negative number (can be decimal)
      expect(response.body.throughputPerSecond).toBeGreaterThanOrEqual(0);
      expect(typeof response.body.throughputPerSecond).toBe('number');
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
 * - Valid UUID should return 200 with metrics data
 * - Invalid UUID should return 400 with validation error
 * - Non-existent script should return 404 with error message
 * - Response should match the exact OpenAPI specification
 * - Metrics calculations should be mathematically consistent
 */
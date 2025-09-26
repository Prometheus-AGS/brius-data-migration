/**
 * Contract Test: GET /coverage/domain/{domain}
 *
 * This test validates the API contract for domain-specific coverage endpoint.
 * It MUST FAIL until the actual endpoint is implemented.
 */

import request from 'supertest';
import { TEST_CONFIG } from '../setup';

describe('Contract: GET /coverage/domain/{domain}', () => {
  const apiUrl = TEST_CONFIG.api.baseUrl;
  const validDomains = ['clinical', 'business', 'communications', 'technical'];

  describe('GET /api/coverage/domain/{domain}', () => {
    validDomains.forEach(domain => {
      it(`should return 200 with valid domain coverage for ${domain}`, async () => {
        const response = await request(apiUrl)
          .get(`/api/coverage/domain/${domain}`)
          .expect('Content-Type', /json/)
          .expect(200);

        // Validate response structure matches OpenAPI DomainCoverage schema
        expect(response.body).toHaveProperty('domain');
        expect(response.body).toHaveProperty('totalEntities');
        expect(response.body).toHaveProperty('migratedEntities');
        expect(response.body).toHaveProperty('coveragePercentage');
        expect(response.body).toHaveProperty('entities');

        // Validate data types
        expect(typeof response.body.domain).toBe('string');
        expect(typeof response.body.totalEntities).toBe('number');
        expect(typeof response.body.migratedEntities).toBe('number');
        expect(typeof response.body.coveragePercentage).toBe('number');
        expect(Array.isArray(response.body.entities)).toBe(true);

        // Validate domain value
        expect(response.body.domain).toBe(domain);

        // Validate constraints
        expect(response.body.totalEntities).toBeGreaterThanOrEqual(0);
        expect(response.body.migratedEntities).toBeGreaterThanOrEqual(0);
        expect(response.body.migratedEntities).toBeLessThanOrEqual(response.body.totalEntities);
        expect(response.body.coveragePercentage).toBeGreaterThanOrEqual(0);
        expect(response.body.coveragePercentage).toBeLessThanOrEqual(1);

        // Validate entities array structure
        response.body.entities.forEach((entity: any) => {
          expect(entity).toHaveProperty('id');
          expect(entity).toHaveProperty('name');
          expect(entity).toHaveProperty('domainId');
          expect(entity).toHaveProperty('totalRecords');
          expect(entity).toHaveProperty('migratedRecords');
          expect(entity).toHaveProperty('failedRecords');

          expect(entity.id).toBeValidUUID();
          expect(typeof entity.name).toBe('string');
          expect(entity.domainId).toBeValidUUID();
          expect(typeof entity.totalRecords).toBe('number');
          expect(typeof entity.migratedRecords).toBe('number');
          expect(typeof entity.failedRecords).toBe('number');

          expect(entity.totalRecords).toBeGreaterThanOrEqual(0);
          expect(entity.migratedRecords).toBeGreaterThanOrEqual(0);
          expect(entity.failedRecords).toBeGreaterThanOrEqual(0);
          expect(entity.migratedRecords + entity.failedRecords).toBeLessThanOrEqual(entity.totalRecords);
        });
      });
    });

    it('should return 404 for invalid domain', async () => {
      const response = await request(apiUrl)
        .get('/api/coverage/domain/invalid-domain')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(typeof response.body.code).toBe('string');
      expect(typeof response.body.message).toBe('string');
    });

    it('should handle server errors gracefully', async () => {
      const response = await request(apiUrl)
        .get('/api/coverage/domain/clinical?simulate_error=true')
        .expect('Content-Type', /json/);

      if (response.status === 500) {
        expect(response.body).toHaveProperty('code');
        expect(response.body).toHaveProperty('message');
      }
    });

    it('should return consistent data for same domain on multiple calls', async () => {
      const domain = 'clinical';

      const response1 = await request(apiUrl)
        .get(`/api/coverage/domain/${domain}`)
        .expect(200);

      const response2 = await request(apiUrl)
        .get(`/api/coverage/domain/${domain}`)
        .expect(200);

      // Core metrics should be consistent
      expect(response1.body.domain).toBe(response2.body.domain);
      expect(response1.body.totalEntities).toBe(response2.body.totalEntities);
      expect(response1.body.migratedEntities).toBe(response2.body.migratedEntities);
      expect(response1.body.coveragePercentage).toBe(response2.body.coveragePercentage);
    });

    it('should have reasonable performance for all domains', async () => {
      for (const domain of validDomains) {
        const startTime = Date.now();

        await request(apiUrl)
          .get(`/api/coverage/domain/${domain}`)
          .expect(200);

        const endTime = Date.now();
        const duration = endTime - startTime;

        // Should respond within 3 seconds per domain
        expect(duration).toBeLessThan(3000);
      }
    });
  });

  describe('Path Parameter Validation', () => {
    it('should validate domain parameter against enum values', async () => {
      const invalidDomains = ['invalid', 'test', '', 'CLINICAL', 'Business'];

      for (const invalidDomain of invalidDomains) {
        const response = await request(apiUrl)
          .get(`/api/coverage/domain/${invalidDomain}`)
          .expect('Content-Type', /json/);

        expect([400, 404]).toContain(response.status);
        if (response.status === 400 || response.status === 404) {
          expect(response.body).toHaveProperty('code');
          expect(response.body).toHaveProperty('message');
        }
      }
    });

    it('should handle special characters in domain parameter', async () => {
      const specialCases = ['%20', 'clinical%2Ftest', 'clinical..', 'clinical/'];

      for (const specialCase of specialCases) {
        const response = await request(apiUrl)
          .get(`/api/coverage/domain/${specialCase}`)
          .expect('Content-Type', /json/);

        expect([400, 404]).toContain(response.status);
      }
    });
  });

  describe('Contract Validation', () => {
    it('should match OpenAPI DomainCoverage schema exactly', async () => {
      const response = await request(apiUrl)
        .get('/api/coverage/domain/clinical')
        .expect(200);

      // Required fields from OpenAPI schema
      const requiredFields = [
        'domain',
        'totalEntities',
        'migratedEntities',
        'coveragePercentage',
        'entities'
      ];

      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });

      // Ensure no extra fields (strict contract compliance)
      const responseFields = Object.keys(response.body);
      const extraFields = responseFields.filter(field => !requiredFields.includes(field));
      expect(extraFields).toEqual([]);
    });

    it('should validate DataEntity schema in entities array', async () => {
      const response = await request(apiUrl)
        .get('/api/coverage/domain/business')
        .expect(200);

      if (response.body.entities.length > 0) {
        const entity = response.body.entities[0];

        // Required fields from DataEntity schema
        const entityRequiredFields = [
          'id',
          'name',
          'domainId',
          'totalRecords',
          'migratedRecords',
          'failedRecords'
        ];

        entityRequiredFields.forEach(field => {
          expect(entity).toHaveProperty(field);
        });

        // Optional fields that may be present
        const optionalFields = [
          'legacyTable',
          'targetTable',
          'migrationScriptId'
        ];

        // Ensure only expected fields are present
        const entityFields = Object.keys(entity);
        const allowedFields = [...entityRequiredFields, ...optionalFields];
        const unexpectedFields = entityFields.filter(field => !allowedFields.includes(field));
        expect(unexpectedFields).toEqual([]);
      }
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
 * - All tests should pass for valid domains (clinical, business, communications, technical)
 * - Invalid domains should return 404 with proper error structure
 * - Response should match the exact OpenAPI specification
 */
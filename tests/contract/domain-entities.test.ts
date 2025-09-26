/**
 * Contract Test: GET /entities/{domain}
 *
 * This test validates the API contract for domain entities endpoint.
 * It MUST FAIL until the actual endpoint is implemented.
 */

import request from 'supertest';
import { TEST_CONFIG } from '../setup';

describe('Contract: GET /entities/{domain}', () => {
  const apiUrl = TEST_CONFIG.api.baseUrl;
  const validDomains = ['clinical', 'business', 'communications', 'technical'];

  describe('GET /api/entities/{domain}', () => {
    validDomains.forEach(domain => {
      it(`should return 200 with entities for ${domain} domain`, async () => {
        const response = await request(apiUrl)
          .get(`/api/entities/${domain}`)
          .expect('Content-Type', /json/)
          .expect(200);

        // Validate response structure matches OpenAPI DataEntityList schema
        expect(response.body).toHaveProperty('entities');
        expect(Array.isArray(response.body.entities)).toBe(true);

        // Validate individual entity structure
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
        .get('/api/entities/invalid-domain')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
    });

    it('should handle performance requirements', async () => {
      const startTime = Date.now();

      await request(apiUrl)
        .get('/api/entities/clinical')
        .expect(200);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Contract Validation', () => {
    it('should match OpenAPI DataEntityList schema exactly', async () => {
      const response = await request(apiUrl)
        .get('/api/entities/business')
        .expect(200);

      const requiredFields = ['entities'];
      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });

      const responseFields = Object.keys(response.body);
      const extraFields = responseFields.filter(field => !requiredFields.includes(field));
      expect(extraFields).toEqual([]);
    });
  });
});

/**
 * IMPORTANT: This test MUST FAIL until the actual implementation is created.
 */
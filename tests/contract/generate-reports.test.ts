/**
 * Contract Test: POST /reports/generate
 *
 * This test validates the API contract for report generation endpoint.
 * It MUST FAIL until the actual endpoint is implemented.
 */

import request from 'supertest';
import { TEST_CONFIG } from '../setup';

describe('Contract: POST /reports/generate', () => {
  const apiUrl = TEST_CONFIG.api.baseUrl;

  const validRequest = {
    format: 'json',
    includeDomains: ['clinical', 'business'],
    includeMetrics: true
  };

  describe('POST /api/reports/generate', () => {
    it('should return 201 with report generation response', async () => {
      const response = await request(apiUrl)
        .post('/api/reports/generate')
        .send(validRequest)
        .expect('Content-Type', /json/)
        .expect(201);

      // Validate response structure matches OpenAPI ReportGenerationResponse schema
      expect(response.body).toHaveProperty('reportId');
      expect(response.body).toHaveProperty('status');

      expect(response.body.reportId).toBeValidUUID();
      expect(['pending', 'generating', 'completed', 'failed']).toContain(response.body.status);

      // Optional downloadUrl field
      if (response.body.downloadUrl) {
        expect(typeof response.body.downloadUrl).toBe('string');
        expect(response.body.downloadUrl).toMatch(/^https?:\/\/.+/);
      }
    });

    it('should handle different format options', async () => {
      const formats = ['json', 'markdown', 'pdf'];

      for (const format of formats) {
        const response = await request(apiUrl)
          .post('/api/reports/generate')
          .send({ ...validRequest, format })
          .expect(201);

        expect(response.body.reportId).toBeValidUUID();
        expect(response.body.status).toBeDefined();
      }
    });

    it('should handle optional parameters', async () => {
      const minimalRequest = {};

      const response = await request(apiUrl)
        .post('/api/reports/generate')
        .send(minimalRequest)
        .expect(201);

      expect(response.body.reportId).toBeValidUUID();
      expect(response.body.status).toBeDefined();
    });
  });

  describe('Contract Validation', () => {
    it('should match OpenAPI ReportGenerationResponse schema exactly', async () => {
      const response = await request(apiUrl)
        .post('/api/reports/generate')
        .send(validRequest)
        .expect(201);

      const requiredFields = ['reportId', 'status'];
      requiredFields.forEach(field => {
        expect(response.body).toHaveProperty(field);
      });
    });
  });
});

/**
 * IMPORTANT: This test MUST FAIL until the actual implementation is created.
 */
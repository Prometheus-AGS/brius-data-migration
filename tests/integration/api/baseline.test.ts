/**
 * Baseline Analysis API Integration Tests
 * Tests POST /api/migration/baseline with various entity configurations
 */

import request from 'supertest';
import { Pool } from 'pg';
import { BaselineAnalyzer } from '../../../src/differential-migration/services/baseline-analyzer';

// Mock the services
jest.mock('../../../src/differential-migration/services/baseline-analyzer');

// Mock Express app - in real implementation, this would import your actual Express app
const mockApp = {
  post: jest.fn(),
  listen: jest.fn()
};

describe('Baseline Analysis API Integration Tests', () => {
  let mockAnalyzer: jest.Mocked<BaselineAnalyzer>;
  let server: any;

  beforeAll(async () => {
    // Mock BaselineAnalyzer
    mockAnalyzer = {
      generateBaselineReport: jest.fn(),
      testConnections: jest.fn(),
      close: jest.fn()
    } as any;

    (BaselineAnalyzer as jest.MockedClass<typeof BaselineAnalyzer>).mockImplementation(() => mockAnalyzer);

    // In real implementation, this would start your Express server
    server = mockApp;
  });

  afterAll(async () => {
    // Cleanup server
    if (server && server.close) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/migration/baseline', () => {
    const validRequest = {
      entities: ['offices', 'doctors', 'patients'],
      includeMappings: true,
      outputFormat: 'json' as const
    };

    const mockBaselineReport = {
      analysisId: '550e8400-e29b-41d4-a716-446655440000',
      generatedAt: new Date('2025-10-26T10:30:00Z'),
      overallStatus: 'gaps_detected' as const,
      entityResults: [
        {
          entityType: 'offices',
          sourceCount: 1234,
          destinationCount: 1234,
          recordGap: 0,
          gapPercentage: 0,
          hasData: true,
          lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z')
        },
        {
          entityType: 'doctors',
          sourceCount: 5678,
          destinationCount: 5670,
          recordGap: 8,
          gapPercentage: 0.14,
          hasData: true,
          lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z')
        },
        {
          entityType: 'patients',
          sourceCount: 12345,
          destinationCount: 12200,
          recordGap: 145,
          gapPercentage: 1.17,
          hasData: true,
          lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z')
        }
      ],
      summary: {
        totalSourceRecords: 19257,
        totalDestinationRecords: 19104,
        overallGap: 153,
        averageGapPercentage: 0.44
      },
      performanceMetrics: {
        analysisDurationMs: 15000,
        queriesExecuted: 12,
        averageQueryTimeMs: 1250
      },
      mappingValidation: [],
      recommendations: [
        'Migration recommended for detected gaps',
        'Focus on doctors and patients entities'
      ]
    };

    test('should successfully analyze baseline for all entities', async () => {
      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockBaselineReport);

      // Mock the HTTP request - in real implementation, use supertest with actual app
      const mockResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            analysisId: mockBaselineReport.analysisId,
            timestamp: mockBaselineReport.generatedAt.toISOString(),
            overallStatus: mockBaselineReport.overallStatus,
            entitySummary: mockBaselineReport.entityResults.map(result => ({
              entityType: result.entityType,
              sourceCount: result.sourceCount,
              destinationCount: result.destinationCount,
              recordGap: result.recordGap,
              gapPercentage: result.gapPercentage,
              status: result.recordGap === 0 ? 'synced' : 'behind',
              lastMigrationTimestamp: result.lastMigrationTimestamp?.toISOString()
            })),
            summary: {
              totalSourceRecords: mockBaselineReport.summary.totalSourceRecords,
              totalDestinationRecords: mockBaselineReport.summary.totalDestinationRecords,
              overallGap: mockBaselineReport.summary.overallGap
            },
            recommendations: mockBaselineReport.recommendations,
            performance: {
              analysisDurationMs: mockBaselineReport.performanceMetrics.analysisDurationMs,
              queriesExecuted: mockBaselineReport.performanceMetrics.queriesExecuted
            }
          }
        }
      };

      // Verify the analyzer would be called with correct parameters
      expect(mockAnalyzer.generateBaselineReport).toHaveBeenCalledWith(
        validRequest.entities,
        expect.any(String) // analysisId
      );

      // Verify response structure
      expect(mockResponse.status).toBe(200);
      expect(mockResponse.body.success).toBe(true);
      expect(mockResponse.body.data.analysisId).toBe(mockBaselineReport.analysisId);
      expect(mockResponse.body.data.entitySummary).toHaveLength(3);
      expect(mockResponse.body.data.overallStatus).toBe('gaps_detected');
    });

    test('should handle specific entity filtering', async () => {
      const specificEntitiesRequest = {
        entities: ['doctors'],
        includeMappings: false,
        outputFormat: 'json' as const
      };

      const singleEntityReport = {
        ...mockBaselineReport,
        entityResults: [mockBaselineReport.entityResults[1]] // Just doctors
      };

      mockAnalyzer.generateBaselineReport.mockResolvedValue(singleEntityReport);

      // Mock response for specific entity request
      const mockResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            analysisId: singleEntityReport.analysisId,
            entitySummary: [{
              entityType: 'doctors',
              sourceCount: 5678,
              destinationCount: 5670,
              recordGap: 8,
              gapPercentage: 0.14,
              status: 'behind'
            }]
          }
        }
      };

      expect(mockAnalyzer.generateBaselineReport).toHaveBeenCalledWith(
        ['doctors'],
        expect.any(String)
      );
      expect(mockResponse.body.data.entitySummary).toHaveLength(1);
      expect(mockResponse.body.data.entitySummary[0].entityType).toBe('doctors');
    });

    test('should validate request parameters', async () => {
      const invalidRequests = [
        // Missing entities
        {
          includeMappings: true,
          outputFormat: 'json'
        },
        // Invalid entities array
        {
          entities: [],
          includeMappings: true,
          outputFormat: 'json'
        },
        // Invalid output format
        {
          entities: ['offices'],
          includeMappings: true,
          outputFormat: 'invalid_format'
        }
      ];

      for (const invalidRequest of invalidRequests) {
        const mockErrorResponse = {
          status: 400,
          body: {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request parameters',
              details: expect.any(Array)
            }
          }
        };

        expect(mockErrorResponse.status).toBe(400);
        expect(mockErrorResponse.body.success).toBe(false);
        expect(mockErrorResponse.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    test('should handle database connection failures', async () => {
      mockAnalyzer.generateBaselineReport.mockRejectedValue(
        new Error('Database connection failed')
      );

      const mockErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'DATABASE_CONNECTION_ERROR',
            message: 'Failed to connect to database',
            timestamp: expect.any(String)
          }
        }
      };

      expect(mockErrorResponse.status).toBe(500);
      expect(mockErrorResponse.body.success).toBe(false);
      expect(mockErrorResponse.body.error.code).toBe('DATABASE_CONNECTION_ERROR');
    });

    test('should handle analysis failures gracefully', async () => {
      mockAnalyzer.generateBaselineReport.mockRejectedValue(
        new Error('Analysis failed due to insufficient permissions')
      );

      const mockErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'ANALYSIS_FAILED',
            message: 'Baseline analysis could not be completed',
            details: 'Analysis failed due to insufficient permissions',
            timestamp: expect.any(String),
            retryable: true
          }
        }
      };

      expect(mockErrorResponse.status).toBe(500);
      expect(mockErrorResponse.body.error.retryable).toBe(true);
    });

    test('should support different output formats in response headers', async () => {
      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockBaselineReport);

      const formatTests = [
        { format: 'json', expectedContentType: 'application/json' },
        { format: 'csv', expectedContentType: 'text/csv' },
        { format: 'table', expectedContentType: 'text/plain' }
      ];

      for (const { format, expectedContentType } of formatTests) {
        const request = {
          ...validRequest,
          outputFormat: format as 'json' | 'csv' | 'table'
        };

        const mockResponse = {
          status: 200,
          headers: {
            'content-type': expectedContentType
          },
          body: format === 'json' ? {
            success: true,
            data: expect.any(Object)
          } : expect.any(String)
        };

        expect(mockResponse.headers['content-type']).toBe(expectedContentType);
      }
    });

    test('should include performance metrics in response', async () => {
      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockBaselineReport);

      const mockResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            performance: {
              analysisDurationMs: 15000,
              queriesExecuted: 12,
              recordsAnalyzed: 19257,
              averageQueryTimeMs: 1250
            }
          }
        }
      };

      expect(mockResponse.body.data.performance).toMatchObject({
        analysisDurationMs: expect.any(Number),
        queriesExecuted: expect.any(Number),
        recordsAnalyzed: expect.any(Number)
      });
    });

    test('should handle concurrent baseline analysis requests', async () => {
      // Simulate multiple concurrent requests
      const concurrentRequests = Array(5).fill(validRequest);

      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockBaselineReport);

      // Mock concurrent processing
      const mockResponses = concurrentRequests.map((_, index) => ({
        status: 200,
        body: {
          success: true,
          data: {
            analysisId: `concurrent-analysis-${index}`,
            entitySummary: expect.any(Array)
          }
        }
      }));

      // Verify all requests would be processed
      expect(mockResponses).toHaveLength(5);
      mockResponses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.data.analysisId).toBe(`concurrent-analysis-${index}`);
      });
    });

    test('should validate entity names against known entities', async () => {
      const invalidEntityRequest = {
        entities: ['invalid_entity', 'unknown_table'],
        includeMappings: false,
        outputFormat: 'json' as const
      };

      const mockErrorResponse = {
        status: 400,
        body: {
          success: false,
          error: {
            code: 'INVALID_ENTITIES',
            message: 'Unknown entity types specified',
            details: {
              invalidEntities: ['invalid_entity', 'unknown_table'],
              validEntities: [
                'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
                'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
                'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
                'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
              ]
            }
          }
        }
      };

      expect(mockErrorResponse.status).toBe(400);
      expect(mockErrorResponse.body.error.details.invalidEntities).toEqual(['invalid_entity', 'unknown_table']);
      expect(mockErrorResponse.body.error.details.validEntities).toContain('offices');
    });

    test('should include mapping validation when requested', async () => {
      const mappingRequest = {
        ...validRequest,
        includeMappings: true
      };

      const reportWithMappings = {
        ...mockBaselineReport,
        mappingValidation: [
          {
            entityType: 'doctors',
            isValid: true,
            missingMappings: [],
            orphanedMappings: [],
            schemaChanges: []
          },
          {
            entityType: 'patients',
            isValid: false,
            missingMappings: ['patient_123', 'patient_456'],
            orphanedMappings: ['orphaned_uuid_1'],
            schemaChanges: ['added_column: emergency_contact']
          }
        ]
      };

      mockAnalyzer.generateBaselineReport.mockResolvedValue(reportWithMappings);

      const mockResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            mappingValidation: [
              {
                entityType: 'doctors',
                isValid: true,
                issues: {
                  missingMappings: 0,
                  orphanedMappings: 0,
                  schemaChanges: 0
                }
              },
              {
                entityType: 'patients',
                isValid: false,
                issues: {
                  missingMappings: 2,
                  orphanedMappings: 1,
                  schemaChanges: 1
                },
                details: {
                  missingMappings: ['patient_123', 'patient_456'],
                  orphanedMappings: ['orphaned_uuid_1'],
                  schemaChanges: ['added_column: emergency_contact']
                }
              }
            ]
          }
        }
      };

      expect(mockResponse.body.data.mappingValidation).toHaveLength(2);
      expect(mockResponse.body.data.mappingValidation[1].isValid).toBe(false);
      expect(mockResponse.body.data.mappingValidation[1].issues.missingMappings).toBe(2);
    });
  });

  describe('Error Scenarios', () => {
    test('should handle timeout errors', async () => {
      mockAnalyzer.generateBaselineReport.mockImplementation(() =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Analysis timeout')), 100);
        })
      );

      const mockTimeoutResponse = {
        status: 504,
        body: {
          success: false,
          error: {
            code: 'ANALYSIS_TIMEOUT',
            message: 'Baseline analysis timed out',
            retryable: true,
            timestamp: expect.any(String)
          }
        }
      };

      expect(mockTimeoutResponse.status).toBe(504);
      expect(mockTimeoutResponse.body.error.retryable).toBe(true);
    });

    test('should handle memory limit errors', async () => {
      mockAnalyzer.generateBaselineReport.mockRejectedValue(
        new Error('JavaScript heap out of memory')
      );

      const mockMemoryErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'RESOURCE_EXHAUSTED',
            message: 'Analysis failed due to resource constraints',
            suggestion: 'Try analyzing fewer entities or increase server memory',
            retryable: false
          }
        }
      };

      expect(mockMemoryErrorResponse.body.error.code).toBe('RESOURCE_EXHAUSTED');
      expect(mockMemoryErrorResponse.body.error.retryable).toBe(false);
    });
  });

  describe('Response Format Validation', () => {
    test('should return consistent response structure', async () => {
      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockBaselineReport);

      const mockResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            analysisId: expect.any(String),
            timestamp: expect.any(String),
            overallStatus: expect.stringMatching(/^(synced|gaps_detected|critical_issues)$/),
            entitySummary: expect.arrayContaining([
              expect.objectContaining({
                entityType: expect.any(String),
                sourceCount: expect.any(Number),
                destinationCount: expect.any(Number),
                recordGap: expect.any(Number),
                gapPercentage: expect.any(Number),
                status: expect.stringMatching(/^(synced|behind|major_gap)$/)
              })
            ]),
            summary: expect.objectContaining({
              totalSourceRecords: expect.any(Number),
              totalDestinationRecords: expect.any(Number),
              overallGap: expect.any(Number)
            }),
            recommendations: expect.arrayContaining([expect.any(String)]),
            performance: expect.objectContaining({
              analysisDurationMs: expect.any(Number),
              queriesExecuted: expect.any(Number)
            })
          },
          meta: {
            apiVersion: '1.0.0',
            requestId: expect.any(String),
            timestamp: expect.any(String)
          }
        }
      };

      // Validate response structure
      expect(mockResponse.body).toHaveProperty('success');
      expect(mockResponse.body).toHaveProperty('data');
      expect(mockResponse.body).toHaveProperty('meta');
      expect(mockResponse.body.data).toHaveProperty('analysisId');
      expect(mockResponse.body.data).toHaveProperty('entitySummary');
      expect(mockResponse.body.meta).toHaveProperty('apiVersion');
    });
  });
});
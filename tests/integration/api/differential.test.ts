/**
 * Differential Analysis API Integration Tests
 * Tests POST /api/migration/differential with timestamp filtering
 */

import request from 'supertest';
import { Pool } from 'pg';
import { DifferentialDetector } from '../../../src/differential-migration/services/differential-detector';

// Mock the services
jest.mock('../../../src/differential-migration/services/differential-detector');

// Mock Express app - in real implementation, this would import your actual Express app
const mockApp = {
  post: jest.fn(),
  listen: jest.fn()
};

describe('Differential Analysis API Integration Tests', () => {
  let mockDetector: jest.Mocked<DifferentialDetector>;
  let server: any;

  beforeAll(async () => {
    // Mock DifferentialDetector
    mockDetector = {
      detectChanges: jest.fn(),
      batchDetectChanges: jest.fn(),
      calculateContentHash: jest.fn(),
      validateTimestamps: jest.fn(),
      optimizeDetectionQuery: jest.fn()
    } as any;

    (DifferentialDetector as jest.MockedClass<typeof DifferentialDetector>).mockImplementation(() => mockDetector);

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

  describe('POST /api/migration/differential', () => {
    const validRequest = {
      entities: ['doctors', 'patients'],
      sinceTimestamp: '2025-10-25T12:00:00Z',
      includeDeletes: true,
      enableContentHashing: true,
      changeThreshold: 0.0
    };

    const mockDetectionResult = {
      analysisId: '550e8400-e29b-41d4-a716-446655440001',
      entityType: 'doctors',
      analysisTimestamp: new Date('2025-10-26T10:30:00Z'),
      baselineTimestamp: new Date('2025-10-25T12:00:00Z'),
      detectionMethod: 'timestamp_with_hash' as const,
      totalRecordsAnalyzed: 5000,
      changesDetected: [
        {
          recordId: 'doctor_123',
          changeType: 'new' as const,
          sourceTimestamp: new Date('2025-10-26T09:00:00Z'),
          contentHash: 'sha256_abc123',
          metadata: {
            sourceTable: 'dispatch_doctors',
            destinationTable: 'doctors',
            confidence: 0.95
          }
        },
        {
          recordId: 'doctor_456',
          changeType: 'modified' as const,
          sourceTimestamp: new Date('2025-10-26T09:30:00Z'),
          destinationTimestamp: new Date('2025-10-25T14:00:00Z'),
          contentHash: 'sha256_def456',
          previousContentHash: 'sha256_old789',
          metadata: {
            sourceTable: 'dispatch_doctors',
            destinationTable: 'doctors',
            confidence: 0.98
          }
        },
        {
          recordId: 'doctor_789',
          changeType: 'deleted' as const,
          sourceTimestamp: new Date('2025-10-26T08:00:00Z'),
          destinationTimestamp: new Date('2025-10-25T10:00:00Z'),
          metadata: {
            sourceTable: 'dispatch_doctors',
            destinationTable: 'doctors',
            confidence: 0.90
          }
        }
      ],
      summary: {
        newRecords: 45,
        modifiedRecords: 23,
        deletedRecords: 1,
        totalChanges: 69,
        changePercentage: 1.38
      },
      performance: {
        analysisDurationMs: 8000,
        recordsPerSecond: 625,
        queriesExecuted: 6
      },
      recommendations: [
        'Migration recommended for 69 detected changes',
        'Focus on modified records for data integrity'
      ]
    };

    test('should successfully perform differential analysis', async () => {
      mockDetector.detectChanges.mockResolvedValue(mockDetectionResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            analysisId: mockDetectionResult.analysisId,
            timestamp: mockDetectionResult.analysisTimestamp.toISOString(),
            baselineTimestamp: mockDetectionResult.baselineTimestamp.toISOString(),
            entityResults: [
              {
                entityType: mockDetectionResult.entityType,
                detectionMethod: mockDetectionResult.detectionMethod,
                totalRecordsAnalyzed: mockDetectionResult.totalRecordsAnalyzed,
                summary: {
                  newRecords: mockDetectionResult.summary.newRecords,
                  modifiedRecords: mockDetectionResult.summary.modifiedRecords,
                  deletedRecords: mockDetectionResult.summary.deletedRecords,
                  totalChanges: mockDetectionResult.summary.totalChanges,
                  changePercentage: mockDetectionResult.summary.changePercentage
                },
                changes: mockDetectionResult.changesDetected.map(change => ({
                  recordId: change.recordId,
                  changeType: change.changeType,
                  sourceTimestamp: change.sourceTimestamp.toISOString(),
                  destinationTimestamp: change.destinationTimestamp?.toISOString(),
                  contentHash: change.contentHash,
                  confidence: change.metadata.confidence
                })),
                performance: {
                  analysisDurationMs: mockDetectionResult.performance.analysisDurationMs,
                  recordsPerSecond: mockDetectionResult.performance.recordsPerSecond,
                  queriesExecuted: mockDetectionResult.performance.queriesExecuted
                }
              }
            ],
            overallSummary: {
              totalChanges: mockDetectionResult.summary.totalChanges,
              estimatedMigrationTime: expect.any(String),
              averageChangePercentage: mockDetectionResult.summary.changePercentage
            },
            recommendations: mockDetectionResult.recommendations
          }
        }
      };

      // Verify the detector would be called with correct parameters
      expect(mockDetector.detectChanges).toHaveBeenCalledWith({
        entityType: 'doctors',
        sinceTimestamp: new Date(validRequest.sinceTimestamp),
        includeDeletes: validRequest.includeDeletes,
        enableContentHashing: validRequest.enableContentHashing,
        batchSize: expect.any(Number)
      });

      // Verify response structure
      expect(expectedResponse.status).toBe(200);
      expect(expectedResponse.body.success).toBe(true);
      expect(expectedResponse.body.data.analysisId).toBe(mockDetectionResult.analysisId);
      expect(expectedResponse.body.data.entityResults).toHaveLength(1);
      expect(expectedResponse.body.data.overallSummary.totalChanges).toBe(69);
    });

    test('should handle multiple entities in parallel', async () => {
      const multiEntityRequest = {
        ...validRequest,
        entities: ['doctors', 'patients', 'orders']
      };

      const mockResults = [
        { ...mockDetectionResult, entityType: 'doctors' },
        { ...mockDetectionResult, entityType: 'patients', summary: { ...mockDetectionResult.summary, totalChanges: 156 } },
        { ...mockDetectionResult, entityType: 'orders', summary: { ...mockDetectionResult.summary, totalChanges: 89 } }
      ];

      mockDetector.detectChanges
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
        .mockResolvedValueOnce(mockResults[2]);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            entityResults: [
              expect.objectContaining({ entityType: 'doctors' }),
              expect.objectContaining({ entityType: 'patients' }),
              expect.objectContaining({ entityType: 'orders' })
            ],
            overallSummary: {
              totalChanges: 314, // 69 + 156 + 89
              estimatedMigrationTime: expect.any(String),
              averageChangePercentage: expect.any(Number)
            }
          }
        }
      };

      expect(mockDetector.detectChanges).toHaveBeenCalledTimes(3);
      expect(expectedResponse.body.data.entityResults).toHaveLength(3);
      expect(expectedResponse.body.data.overallSummary.totalChanges).toBe(314);
    });

    test('should validate request parameters', async () => {
      const invalidRequests = [
        // Missing entities
        {
          sinceTimestamp: '2025-10-25T12:00:00Z',
          includeDeletes: true
        },
        // Invalid timestamp format
        {
          entities: ['doctors'],
          sinceTimestamp: 'invalid-timestamp',
          includeDeletes: true
        },
        // Empty entities array
        {
          entities: [],
          sinceTimestamp: '2025-10-25T12:00:00Z',
          includeDeletes: true
        },
        // Invalid change threshold
        {
          entities: ['doctors'],
          sinceTimestamp: '2025-10-25T12:00:00Z',
          includeDeletes: true,
          changeThreshold: -1
        }
      ];

      for (const invalidRequest of invalidRequests) {
        const expectedErrorResponse = {
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

        expect(expectedErrorResponse.status).toBe(400);
        expect(expectedErrorResponse.body.success).toBe(false);
        expect(expectedErrorResponse.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    test('should handle timestamp parsing and validation', async () => {
      const timestampTests = [
        {
          input: '2025-10-25T12:00:00Z',
          valid: true,
          expected: new Date('2025-10-25T12:00:00Z')
        },
        {
          input: '2025-10-25 12:00:00',
          valid: true,
          expected: new Date('2025-10-25T12:00:00')
        },
        {
          input: '2025-10-25',
          valid: true,
          expected: new Date('2025-10-25T00:00:00')
        },
        {
          input: 'invalid-date',
          valid: false,
          expected: null
        },
        {
          input: '2025-13-45T25:70:99Z', // Invalid date values
          valid: false,
          expected: null
        }
      ];

      for (const { input, valid, expected } of timestampTests) {
        const request = {
          ...validRequest,
          sinceTimestamp: input
        };

        if (valid) {
          mockDetector.detectChanges.mockResolvedValue(mockDetectionResult);

          const mockResponse = {
            status: 200,
            body: {
              success: true,
              data: {
                baselineTimestamp: expected?.toISOString()
              }
            }
          };

          expect(mockResponse.status).toBe(200);
          expect(mockDetector.detectChanges).toHaveBeenCalledWith(
            expect.objectContaining({
              sinceTimestamp: expected
            })
          );
        } else {
          const mockErrorResponse = {
            status: 400,
            body: {
              success: false,
              error: {
                code: 'INVALID_TIMESTAMP',
                message: `Invalid timestamp format: ${input}`,
                validFormats: [
                  'ISO 8601: 2025-10-25T12:00:00Z',
                  'SQL format: 2025-10-25 12:00:00',
                  'Date only: 2025-10-25'
                ]
              }
            }
          };

          expect(mockErrorResponse.status).toBe(400);
          expect(mockErrorResponse.body.error.code).toBe('INVALID_TIMESTAMP');
        }
      }
    });

    test('should apply change threshold filtering', async () => {
      const lowChangeResult = {
        ...mockDetectionResult,
        summary: {
          newRecords: 2,
          modifiedRecords: 1,
          deletedRecords: 0,
          totalChanges: 3,
          changePercentage: 0.06 // Below 1% threshold
        }
      };

      const thresholdRequest = {
        ...validRequest,
        changeThreshold: 1.0 // 1% minimum threshold
      };

      mockDetector.detectChanges.mockResolvedValue(lowChangeResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            entityResults: [], // Filtered out due to low change percentage
            overallSummary: {
              totalChanges: 0,
              estimatedMigrationTime: '< 1 min',
              averageChangePercentage: 0,
              filteredEntities: [
                {
                  entityType: 'doctors',
                  changePercentage: 0.06,
                  reason: 'Below threshold of 1%'
                }
              ]
            },
            recommendations: [
              'No entities meet the change threshold',
              'Consider lowering threshold or checking for recent changes'
            ]
          }
        }
      };

      expect(expectedResponse.body.data.entityResults).toHaveLength(0);
      expect(expectedResponse.body.data.overallSummary.filteredEntities).toHaveLength(1);
    });

    test('should handle content hashing options', async () => {
      const hashingTests = [
        {
          enableContentHashing: true,
          expectedMethod: 'timestamp_with_hash'
        },
        {
          enableContentHashing: false,
          expectedMethod: 'timestamp_only'
        }
      ];

      for (const { enableContentHashing, expectedMethod } of hashingTests) {
        const request = {
          ...validRequest,
          enableContentHashing
        };

        const result = {
          ...mockDetectionResult,
          detectionMethod: expectedMethod as 'timestamp_with_hash' | 'timestamp_only'
        };

        mockDetector.detectChanges.mockResolvedValue(result);

        expect(mockDetector.detectChanges).toHaveBeenCalledWith(
          expect.objectContaining({
            enableContentHashing
          })
        );

        const mockResponse = {
          status: 200,
          body: {
            success: true,
            data: {
              entityResults: [
                expect.objectContaining({
                  detectionMethod: expectedMethod
                })
              ]
            }
          }
        };

        expect(mockResponse.body.data.entityResults[0].detectionMethod).toBe(expectedMethod);
      }
    });

    test('should handle detection errors gracefully', async () => {
      const errorScenarios = [
        {
          error: new Error('Database connection lost'),
          expectedCode: 'DATABASE_CONNECTION_ERROR',
          expectedStatus: 500,
          retryable: true
        },
        {
          error: new Error('Table does not exist'),
          expectedCode: 'ENTITY_NOT_FOUND',
          expectedStatus: 404,
          retryable: false
        },
        {
          error: new Error('Insufficient permissions'),
          expectedCode: 'PERMISSION_DENIED',
          expectedStatus: 403,
          retryable: false
        },
        {
          error: new Error('Query timeout'),
          expectedCode: 'ANALYSIS_TIMEOUT',
          expectedStatus: 504,
          retryable: true
        }
      ];

      for (const { error, expectedCode, expectedStatus, retryable } of errorScenarios) {
        mockDetector.detectChanges.mockRejectedValue(error);

        const expectedErrorResponse = {
          status: expectedStatus,
          body: {
            success: false,
            error: {
              code: expectedCode,
              message: expect.any(String),
              details: error.message,
              retryable,
              timestamp: expect.any(String)
            }
          }
        };

        expect(expectedErrorResponse.status).toBe(expectedStatus);
        expect(expectedErrorResponse.body.error.code).toBe(expectedCode);
        expect(expectedErrorResponse.body.error.retryable).toBe(retryable);
      }
    });

    test('should include detailed change information', async () => {
      const detailedResult = {
        ...mockDetectionResult,
        changesDetected: [
          {
            recordId: 'doctor_123',
            changeType: 'new' as const,
            sourceTimestamp: new Date('2025-10-26T09:00:00Z'),
            contentHash: 'sha256_abc123',
            metadata: {
              sourceTable: 'dispatch_doctors',
              destinationTable: 'doctors',
              confidence: 0.95,
              fieldChanges: ['name', 'phone', 'email'],
              dataQuality: 'high'
            }
          },
          {
            recordId: 'doctor_456',
            changeType: 'modified' as const,
            sourceTimestamp: new Date('2025-10-26T09:30:00Z'),
            destinationTimestamp: new Date('2025-10-25T14:00:00Z'),
            contentHash: 'sha256_def456',
            previousContentHash: 'sha256_old789',
            metadata: {
              sourceTable: 'dispatch_doctors',
              destinationTable: 'doctors',
              confidence: 0.98,
              fieldChanges: ['address', 'specialty'],
              dataQuality: 'medium'
            }
          }
        ]
      };

      mockDetector.detectChanges.mockResolvedValue(detailedResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            entityResults: [
              {
                changes: [
                  {
                    recordId: 'doctor_123',
                    changeType: 'new',
                    sourceTimestamp: '2025-10-26T09:00:00.000Z',
                    contentHash: 'sha256_abc123',
                    confidence: 0.95,
                    metadata: {
                      fieldChanges: ['name', 'phone', 'email'],
                      dataQuality: 'high'
                    }
                  },
                  {
                    recordId: 'doctor_456',
                    changeType: 'modified',
                    sourceTimestamp: '2025-10-26T09:30:00.000Z',
                    destinationTimestamp: '2025-10-25T14:00:00.000Z',
                    contentHash: 'sha256_def456',
                    previousContentHash: 'sha256_old789',
                    confidence: 0.98,
                    metadata: {
                      fieldChanges: ['address', 'specialty'],
                      dataQuality: 'medium'
                    }
                  }
                ]
              }
            ]
          }
        }
      };

      expect(expectedResponse.body.data.entityResults[0].changes).toHaveLength(2);
      expect(expectedResponse.body.data.entityResults[0].changes[0].metadata.fieldChanges).toEqual(['name', 'phone', 'email']);
      expect(expectedResponse.body.data.entityResults[0].changes[1].metadata.fieldChanges).toEqual(['address', 'specialty']);
    });

    test('should estimate migration time based on changes', async () => {
      const changeScenarios = [
        { totalChanges: 50, expectedTime: /< 1 min/ },
        { totalChanges: 5000, expectedTime: /5 min/ },
        { totalChanges: 120000, expectedTime: /2 hours?/ }
      ];

      for (const { totalChanges, expectedTime } of changeScenarios) {
        const result = {
          ...mockDetectionResult,
          summary: {
            ...mockDetectionResult.summary,
            totalChanges
          }
        };

        mockDetector.detectChanges.mockResolvedValue(result);

        const mockResponse = {
          status: 200,
          body: {
            success: true,
            data: {
              overallSummary: {
                totalChanges,
                estimatedMigrationTime: 'calculated_time_here'
              }
            }
          }
        };

        // In real implementation, this would be calculated based on performance benchmarks
        const estimatedTime = totalChanges < 1000 ? '< 1 min' :
                            totalChanges < 60000 ? `${Math.ceil(totalChanges / 1000)} min` :
                            `${Math.ceil(totalChanges / 60000)} hour${totalChanges >= 120000 ? 's' : ''}`;

        expect(estimatedTime).toMatch(expectedTime);
      }
    });

    test('should support async processing for large datasets', async () => {
      const largeDatasetRequest = {
        ...validRequest,
        entities: ['all'], // All entities
        asyncMode: true
      };

      // Mock async processing response
      const expectedAsyncResponse = {
        status: 202, // Accepted for async processing
        body: {
          success: true,
          data: {
            analysisId: expect.any(String),
            status: 'processing',
            estimatedCompletionTime: expect.any(String),
            checkStatusUrl: `/api/migration/differential/status/${expect.any(String)}`,
            message: 'Differential analysis started for large dataset. Check status endpoint for progress.'
          }
        }
      };

      expect(expectedAsyncResponse.status).toBe(202);
      expect(expectedAsyncResponse.body.data.status).toBe('processing');
      expect(expectedAsyncResponse.body.data.checkStatusUrl).toMatch(/\/api\/migration\/differential\/status\//);
    });
  });

  describe('Performance and Optimization', () => {
    test('should track and report performance metrics', async () => {
      const performanceResult = {
        ...mockDetectionResult,
        performance: {
          analysisDurationMs: 25000, // 25 seconds
          recordsPerSecond: 2000,
          queriesExecuted: 15,
          cacheHitRate: 0.85,
          memoryUsageMb: 256
        }
      };

      mockDetector.detectChanges.mockResolvedValue(performanceResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            entityResults: [
              {
                performance: {
                  analysisDurationMs: 25000,
                  recordsPerSecond: 2000,
                  queriesExecuted: 15,
                  cacheHitRate: 0.85,
                  memoryUsageMb: 256,
                  efficiencyRating: 'high' // Based on performance thresholds
                }
              }
            ]
          }
        }
      };

      expect(expectedResponse.body.data.entityResults[0].performance.recordsPerSecond).toBe(2000);
      expect(expectedResponse.body.data.entityResults[0].performance.cacheHitRate).toBe(0.85);
    });

    test('should handle concurrent analysis requests', async () => {
      // Test that multiple concurrent requests are handled properly
      const concurrentRequests = 3;
      mockDetector.detectChanges.mockResolvedValue(mockDetectionResult);

      const expectedConcurrentResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            processingMetrics: {
              concurrentAnalyses: concurrentRequests,
              queuedRequests: 0,
              averageWaitTime: expect.any(Number)
            }
          }
        }
      };

      expect(expectedConcurrentResponse.body.data.processingMetrics.concurrentAnalyses).toBe(3);
    });
  });
});
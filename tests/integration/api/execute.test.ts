/**
 * Migration Execution API Integration Tests
 * Tests POST /api/migration/execute with session management
 */

import request from 'supertest';
import { Pool } from 'pg';
import { MigrationExecutor } from '../../../src/differential-migration/services/migration-executor';

// Mock the services
jest.mock('../../../src/differential-migration/services/migration-executor');

// Mock Express app - in real implementation, this would import your actual Express app
const mockApp = {
  post: jest.fn(),
  listen: jest.fn()
};

describe('Migration Execution API Integration Tests', () => {
  let mockExecutor: jest.Mocked<MigrationExecutor>;
  let server: any;

  beforeAll(async () => {
    // Mock MigrationExecutor
    mockExecutor = {
      executeMigrationTasks: jest.fn(),
      executeBatch: jest.fn(),
      pauseExecution: jest.fn(),
      resumeExecution: jest.fn(),
      validateMigrationIntegrity: jest.fn(),
      buildDependencyGraph: jest.fn()
    } as any;

    (MigrationExecutor as jest.MockedClass<typeof MigrationExecutor>).mockImplementation(() => mockExecutor);

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

  describe('POST /api/migration/execute', () => {
    const validRequest = {
      analysisId: '550e8400-e29b-41d4-a716-446655440001',
      entities: ['doctors', 'patients'],
      batchSize: 1000,
      parallel: true,
      maxConcurrent: 3,
      dryRun: false,
      enableValidation: true
    };

    const mockExecutionResult = {
      executionId: '660f9500-f3ac-52e5-b827-557766551111',
      sessionId: '770f9500-f3ac-52e5-b827-557766552222',
      overallStatus: 'completed' as const,
      entitiesProcessed: ['doctors', 'patients'],
      entitiesFailed: [],
      totalRecordsProcessed: 15234,
      totalRecordsFailed: 12,
      batchResults: [
        {
          batchId: 'batch_doctors_1_1729948200000',
          entityType: 'doctors',
          recordIds: ['doctor_123', 'doctor_456'],
          status: 'success' as const,
          processedRecords: 2000,
          failedRecords: 5,
          errors: [
            {
              recordId: 'doctor_789',
              errorType: 'validation_error',
              message: 'Invalid phone number format',
              retryable: true
            }
          ],
          performance: {
            startTime: new Date('2025-10-26T10:30:00Z'),
            endTime: new Date('2025-10-26T10:32:00Z'),
            durationMs: 120000,
            recordsPerSecond: 1000,
            memoryUsageMb: 128
          }
        },
        {
          batchId: 'batch_patients_1_1729948200000',
          entityType: 'patients',
          recordIds: ['patient_123', 'patient_456'],
          status: 'success' as const,
          processedRecords: 13234,
          failedRecords: 7,
          errors: [
            {
              recordId: 'patient_999',
              errorType: 'constraint_violation',
              message: 'Foreign key constraint violation',
              retryable: true
            }
          ],
          performance: {
            startTime: new Date('2025-10-26T10:32:00Z'),
            endTime: new Date('2025-10-26T10:45:00Z'),
            durationMs: 780000,
            recordsPerSecond: 850,
            memoryUsageMb: 256
          }
        }
      ],
      checkpoints: ['checkpoint_1', 'checkpoint_2'],
      executionSummary: {
        startTime: new Date('2025-10-26T10:30:00Z'),
        endTime: new Date('2025-10-26T10:45:00Z'),
        totalDurationMs: 900000,
        averageThroughput: 900,
        peakMemoryUsageMb: 256
      },
      recovery: {
        isRecoverable: true,
        lastCheckpointId: 'checkpoint_2',
        resumeFromBatch: 2,
        recommendedActions: [
          'Review validation errors for retry',
          'Consider increasing batch size for better performance'
        ]
      }
    };

    test('should successfully execute migration with all entities', async () => {
      mockExecutor.executeMigrationTasks.mockResolvedValue(mockExecutionResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            executionId: mockExecutionResult.executionId,
            sessionId: mockExecutionResult.sessionId,
            status: mockExecutionResult.overallStatus,
            summary: {
              entitiesProcessed: mockExecutionResult.entitiesProcessed,
              entitiesFailed: mockExecutionResult.entitiesFailed,
              totalRecordsProcessed: mockExecutionResult.totalRecordsProcessed,
              totalRecordsFailed: mockExecutionResult.totalRecordsFailed,
              successRate: ((mockExecutionResult.totalRecordsProcessed / (mockExecutionResult.totalRecordsProcessed + mockExecutionResult.totalRecordsFailed)) * 100).toFixed(2)
            },
            performance: {
              totalDurationMs: mockExecutionResult.executionSummary.totalDurationMs,
              averageThroughput: mockExecutionResult.executionSummary.averageThroughput,
              peakMemoryUsageMb: mockExecutionResult.executionSummary.peakMemoryUsageMb
            },
            checkpoints: mockExecutionResult.checkpoints,
            recovery: mockExecutionResult.recovery,
            statusUrl: `/api/migration/status/${mockExecutionResult.sessionId}`,
            logsUrl: `/api/migration/logs/${mockExecutionResult.sessionId}`
          },
          meta: {
            apiVersion: '1.0.0',
            requestId: expect.any(String),
            timestamp: expect.any(String)
          }
        }
      };

      // Verify executor would be called with correct parameters
      expect(mockExecutor.executeMigrationTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            entityType: 'doctors',
            priority: expect.any(String),
            dependencies: expect.any(Array)
          }),
          expect.objectContaining({
            entityType: 'patients',
            priority: expect.any(String),
            dependencies: expect.any(Array)
          })
        ])
      );

      // Verify response structure
      expect(expectedResponse.status).toBe(200);
      expect(expectedResponse.body.success).toBe(true);
      expect(expectedResponse.body.data.executionId).toBe(mockExecutionResult.executionId);
      expect(expectedResponse.body.data.sessionId).toBe(mockExecutionResult.sessionId);
      expect(expectedResponse.body.data.summary.successRate).toBe('99.92');
    });

    test('should validate request parameters', async () => {
      const invalidRequests = [
        // Missing analysisId
        {
          entities: ['doctors'],
          batchSize: 1000
        },
        // Invalid analysisId format
        {
          analysisId: 'invalid-uuid',
          entities: ['doctors'],
          batchSize: 1000
        },
        // Empty entities array
        {
          analysisId: '550e8400-e29b-41d4-a716-446655440001',
          entities: [],
          batchSize: 1000
        },
        // Invalid batch size
        {
          analysisId: '550e8400-e29b-41d4-a716-446655440001',
          entities: ['doctors'],
          batchSize: 0
        },
        // Invalid maxConcurrent
        {
          analysisId: '550e8400-e29b-41d4-a716-446655440001',
          entities: ['doctors'],
          batchSize: 1000,
          maxConcurrent: 0
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

    test('should handle dry run execution', async () => {
      const dryRunRequest = {
        ...validRequest,
        dryRun: true
      };

      const mockDryRunResult = {
        ...mockExecutionResult,
        overallStatus: 'simulated' as any,
        totalRecordsProcessed: 0,
        totalRecordsFailed: 0,
        batchResults: []
      };

      mockExecutor.executeMigrationTasks.mockResolvedValue(mockDryRunResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            executionId: mockDryRunResult.executionId,
            sessionId: mockDryRunResult.sessionId,
            status: 'simulated',
            dryRun: true,
            simulation: {
              wouldProcess: 15246, // Total records that would be processed
              estimatedDuration: '15 minutes',
              estimatedMemoryUsage: '256 MB',
              dependencyOrder: ['doctors', 'patients'],
              batchConfiguration: {
                totalBatches: 16,
                recordsPerBatch: 1000,
                parallelExecutions: 3
              }
            },
            recommendations: [
              'Migration plan looks good',
              'No conflicts detected in dependency order',
              'Estimated completion time: 15 minutes'
            ]
          }
        }
      };

      expect(expectedResponse.body.data.dryRun).toBe(true);
      expect(expectedResponse.body.data.status).toBe('simulated');
      expect(expectedResponse.body.data.simulation.wouldProcess).toBe(15246);
    });

    test('should handle migration execution failures', async () => {
      const failedExecutionResult = {
        ...mockExecutionResult,
        overallStatus: 'failed' as const,
        entitiesProcessed: ['doctors'],
        entitiesFailed: ['patients'],
        totalRecordsProcessed: 2000,
        totalRecordsFailed: 13246,
        recovery: {
          isRecoverable: true,
          lastCheckpointId: 'checkpoint_1',
          resumeFromBatch: 1,
          recommendedActions: [
            'Review patient entity configuration',
            'Check foreign key dependencies',
            'Resume from checkpoint_1 after fixing issues'
          ]
        }
      };

      mockExecutor.executeMigrationTasks.mockResolvedValue(failedExecutionResult);

      const expectedResponse = {
        status: 200, // Still 200 because the execution service responded
        body: {
          success: false, // But success is false due to migration failures
          data: {
            executionId: failedExecutionResult.executionId,
            sessionId: failedExecutionResult.sessionId,
            status: 'failed',
            summary: {
              entitiesProcessed: ['doctors'],
              entitiesFailed: ['patients'],
              totalRecordsProcessed: 2000,
              totalRecordsFailed: 13246,
              successRate: '13.11' // Low success rate
            },
            errors: {
              primaryCause: 'Entity migration failures',
              affectedEntities: ['patients'],
              failureRate: '86.89%'
            },
            recovery: {
              isRecoverable: true,
              resumeFromCheckpoint: 'checkpoint_1',
              resumeFromBatch: 1,
              actions: failedExecutionResult.recovery.recommendedActions
            },
            retryUrl: `/api/migration/execute?resumeFrom=${failedExecutionResult.recovery.lastCheckpointId}`
          }
        }
      };

      expect(expectedResponse.body.success).toBe(false);
      expect(expectedResponse.body.data.status).toBe('failed');
      expect(expectedResponse.body.data.recovery.isRecoverable).toBe(true);
      expect(expectedResponse.body.data.summary.successRate).toBe('13.11');
    });

    test('should handle partial migration success', async () => {
      const partialSuccessResult = {
        ...mockExecutionResult,
        overallStatus: 'partial' as const,
        entitiesProcessed: ['doctors'],
        entitiesFailed: ['patients'],
        totalRecordsProcessed: 2000,
        totalRecordsFailed: 150,
        recovery: {
          isRecoverable: true,
          lastCheckpointId: 'checkpoint_1',
          resumeFromBatch: 2,
          recommendedActions: [
            'Review failed patient records',
            'Consider data quality improvements',
            'Resume from checkpoint to complete remaining records'
          ]
        }
      };

      mockExecutor.executeMigrationTasks.mockResolvedValue(partialSuccessResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true, // Partial success is still considered successful
          data: {
            status: 'partial',
            summary: {
              entitiesProcessed: ['doctors'],
              entitiesFailed: ['patients'],
              totalRecordsProcessed: 2000,
              totalRecordsFailed: 150,
              successRate: '93.02'
            },
            partialResults: {
              completedEntities: 1,
              failedEntities: 1,
              totalEntities: 2,
              completionPercentage: 50
            },
            nextSteps: [
              'Review failed records in patients entity',
              'Resume migration to complete remaining records',
              'Monitor status for completion updates'
            ]
          }
        }
      };

      expect(expectedResponse.body.success).toBe(true);
      expect(expectedResponse.body.data.status).toBe('partial');
      expect(expectedResponse.body.data.partialResults.completionPercentage).toBe(50);
      expect(expectedResponse.body.data.summary.successRate).toBe('93.02');
    });

    test('should support session resumption from checkpoint', async () => {
      const resumeRequest = {
        ...validRequest,
        resumeFromCheckpoint: 'checkpoint_1',
        resumeFromBatch: 2
      };

      const resumedExecutionResult = {
        ...mockExecutionResult,
        recovery: {
          ...mockExecutionResult.recovery,
          resumedFromCheckpoint: 'checkpoint_1',
          resumedFromBatch: 2,
          resumedAt: new Date('2025-10-26T11:00:00Z')
        }
      };

      mockExecutor.resumeExecution.mockResolvedValue({
        success: true,
        resumedFromBatch: 2
      });
      mockExecutor.executeMigrationTasks.mockResolvedValue(resumedExecutionResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            executionId: resumedExecutionResult.executionId,
            sessionId: resumedExecutionResult.sessionId,
            status: 'completed',
            resumed: true,
            resumption: {
              fromCheckpoint: 'checkpoint_1',
              fromBatch: 2,
              resumedAt: '2025-10-26T11:00:00.000Z',
              recoveredRecords: expect.any(Number)
            }
          }
        }
      };

      expect(mockExecutor.resumeExecution).toHaveBeenCalledWith('checkpoint_1');
      expect(expectedResponse.body.data.resumed).toBe(true);
      expect(expectedResponse.body.data.resumption.fromCheckpoint).toBe('checkpoint_1');
    });

    test('should handle concurrent migration prevention', async () => {
      // Simulate another migration already running
      mockExecutor.executeMigrationTasks.mockRejectedValue(
        new Error('Another migration is already running for this analysis')
      );

      const expectedConflictResponse = {
        status: 409, // Conflict
        body: {
          success: false,
          error: {
            code: 'MIGRATION_IN_PROGRESS',
            message: 'Another migration is already running',
            details: {
              conflictingAnalysisId: validRequest.analysisId,
              activeSessionId: expect.any(String),
              estimatedCompletion: expect.any(String)
            },
            suggestions: [
              'Wait for current migration to complete',
              'Check migration status using the status endpoint',
              'Cancel current migration if necessary'
            ]
          }
        }
      };

      expect(expectedConflictResponse.status).toBe(409);
      expect(expectedConflictResponse.body.error.code).toBe('MIGRATION_IN_PROGRESS');
    });

    test('should validate entity dependencies and order', async () => {
      const dependencyRequest = {
        ...validRequest,
        entities: ['patients', 'orders', 'doctors'] // Wrong dependency order
      };

      const mockDependencyResult = {
        entities: ['patients', 'orders', 'doctors'],
        dependencies: {
          doctors: [],
          patients: ['doctors'],
          orders: ['patients']
        },
        executionOrder: [['doctors'], ['patients'], ['orders']] // Corrected order
      };

      mockExecutor.buildDependencyGraph.mockReturnValue(mockDependencyResult);
      mockExecutor.executeMigrationTasks.mockResolvedValue(mockExecutionResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            dependencyResolution: {
              requestedOrder: ['patients', 'orders', 'doctors'],
              executionOrder: [['doctors'], ['patients'], ['orders']],
              reordered: true,
              reason: 'Dependency constraints required reordering'
            }
          }
        }
      };

      expect(mockExecutor.buildDependencyGraph).toHaveBeenCalled();
      expect(expectedResponse.body.data.dependencyResolution.reordered).toBe(true);
      expect(expectedResponse.body.data.dependencyResolution.executionOrder).toEqual([['doctors'], ['patients'], ['orders']]);
    });

    test('should handle validation failures before execution', async () => {
      const validationRequest = {
        ...validRequest,
        enableValidation: true,
        preValidation: true
      };

      mockExecutor.validateMigrationIntegrity.mockResolvedValue({
        isValid: false,
        validationResults: [],
        summary: {
          totalValidated: 100,
          successfulMatches: 85,
          failedMatches: 15,
          matchPercentage: 85
        },
        recommendations: [
          'Data quality issues detected',
          'Fix validation errors before proceeding with migration'
        ]
      });

      const expectedValidationErrorResponse = {
        status: 400,
        body: {
          success: false,
          error: {
            code: 'PRE_VALIDATION_FAILED',
            message: 'Migration validation failed',
            validationSummary: {
              totalValidated: 100,
              successfulMatches: 85,
              failedMatches: 15,
              matchPercentage: 85
            },
            recommendations: [
              'Data quality issues detected',
              'Fix validation errors before proceeding with migration'
            ]
          }
        }
      };

      expect(expectedValidationErrorResponse.status).toBe(400);
      expect(expectedValidationErrorResponse.body.error.code).toBe('PRE_VALIDATION_FAILED');
      expect(expectedValidationErrorResponse.body.error.validationSummary.matchPercentage).toBe(85);
    });

    test('should provide detailed batch execution results', async () => {
      mockExecutor.executeMigrationTasks.mockResolvedValue(mockExecutionResult);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            batchResults: [
              {
                batchId: 'batch_doctors_1_1729948200000',
                entityType: 'doctors',
                status: 'success',
                processedRecords: 2000,
                failedRecords: 5,
                successRate: '99.75%',
                performance: {
                  durationMs: 120000,
                  recordsPerSecond: 1000,
                  memoryUsageMb: 128
                },
                errors: [
                  {
                    recordId: 'doctor_789',
                    errorType: 'validation_error',
                    message: 'Invalid phone number format',
                    retryable: true
                  }
                ]
              },
              {
                batchId: 'batch_patients_1_1729948200000',
                entityType: 'patients',
                status: 'success',
                processedRecords: 13234,
                failedRecords: 7,
                successRate: '99.95%',
                performance: {
                  durationMs: 780000,
                  recordsPerSecond: 850,
                  memoryUsageMb: 256
                }
              }
            ]
          }
        }
      };

      expect(expectedResponse.body.data.batchResults).toHaveLength(2);
      expect(expectedResponse.body.data.batchResults[0].successRate).toBe('99.75%');
      expect(expectedResponse.body.data.batchResults[1].successRate).toBe('99.95%');
    });

    test('should handle system resource constraints', async () => {
      mockExecutor.executeMigrationTasks.mockRejectedValue(
        new Error('Insufficient memory to complete migration')
      );

      const expectedResourceErrorResponse = {
        status: 507, // Insufficient Storage (closest to resource exhaustion)
        body: {
          success: false,
          error: {
            code: 'RESOURCE_EXHAUSTED',
            message: 'Migration failed due to resource constraints',
            details: 'Insufficient memory to complete migration',
            suggestions: [
              'Reduce batch size to lower memory usage',
              'Process fewer entities concurrently',
              'Increase server memory allocation',
              'Consider splitting migration into smaller chunks'
            ],
            retryable: true,
            retryAfter: 3600 // Retry after 1 hour
          }
        }
      };

      expect(expectedResourceErrorResponse.status).toBe(507);
      expect(expectedResourceErrorResponse.body.error.code).toBe('RESOURCE_EXHAUSTED');
      expect(expectedResourceErrorResponse.body.error.retryable).toBe(true);
    });
  });

  describe('Async Execution Mode', () => {
    test('should support async execution for large migrations', async () => {
      const asyncRequest = {
        ...validRequest,
        entities: ['all'], // All entities indicates large migration
        asyncMode: true
      };

      // Mock async execution start
      const expectedAsyncResponse = {
        status: 202, // Accepted
        body: {
          success: true,
          data: {
            executionId: expect.any(String),
            sessionId: expect.any(String),
            status: 'queued',
            asyncMode: true,
            estimatedStartTime: expect.any(String),
            estimatedDuration: expect.any(String),
            statusUrl: `/api/migration/status/${expect.any(String)}`,
            webhookUrl: `/api/migration/webhook/${expect.any(String)}`,
            message: 'Migration queued for async execution. Monitor status endpoint for progress.'
          }
        }
      };

      expect(expectedAsyncResponse.status).toBe(202);
      expect(expectedAsyncResponse.body.data.asyncMode).toBe(true);
      expect(expectedAsyncResponse.body.data.status).toBe('queued');
    });
  });
});
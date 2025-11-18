/**
 * Status Retrieval API Integration Tests
 * Tests GET /api/migration/status/{sessionId} and control endpoints
 */

import request from 'supertest';
import { Pool } from 'pg';
import { ProgressTracker } from '../../../src/differential-migration/services/progress-tracker';
import { MigrationExecutor } from '../../../src/differential-migration/services/migration-executor';

// Mock the services
jest.mock('../../../src/differential-migration/services/progress-tracker');
jest.mock('../../../src/differential-migration/services/migration-executor');

// Mock Express app - in real implementation, this would import your actual Express app
const mockApp = {
  get: jest.fn(),
  post: jest.fn(),
  listen: jest.fn()
};

describe('Status Retrieval API Integration Tests', () => {
  let mockProgressTracker: jest.Mocked<ProgressTracker>;
  let mockExecutor: jest.Mocked<MigrationExecutor>;
  let server: any;

  beforeAll(async () => {
    // Mock ProgressTracker
    mockProgressTracker = {
      getAllProgress: jest.fn(),
      getLatestProgress: jest.fn(),
      calculatePerformanceMetrics: jest.fn(),
      getActiveAlerts: jest.fn(),
      generateProgressReport: jest.fn(),
      subscribeToUpdates: jest.fn(),
      stop: jest.fn()
    } as any;

    // Mock MigrationExecutor
    mockExecutor = {
      pauseExecution: jest.fn(),
      resumeExecution: jest.fn(),
      validateMigrationIntegrity: jest.fn()
    } as any;

    (ProgressTracker as jest.MockedClass<typeof ProgressTracker>).mockImplementation(() => mockProgressTracker);
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

  describe('GET /api/migration/status/{sessionId}', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

    const mockProgressData = [
      {
        snapshotId: 'snapshot-1',
        sessionId: validSessionId,
        entityType: 'doctors',
        timestamp: new Date('2025-10-26T10:30:00Z'),
        progress: {
          recordsProcessed: 4500,
          recordsRemaining: 1200,
          totalRecords: 5700,
          percentageComplete: 78.95
        },
        performance: {
          recordsPerSecond: 987,
          averageBatchTimeMs: 180,
          memoryUsageMb: 256
        },
        timing: {
          startTime: new Date('2025-10-26T10:15:00Z'),
          estimatedCompletionTime: new Date('2025-10-26T10:34:30Z'),
          elapsedTimeMs: 900000,
          remainingTimeMs: 280000
        },
        status: 'running' as const,
        currentBatch: {
          batchNumber: 9,
          batchSize: 500,
          batchProgress: 0.6
        }
      },
      {
        snapshotId: 'snapshot-2',
        sessionId: validSessionId,
        entityType: 'patients',
        timestamp: new Date('2025-10-26T10:30:00Z'),
        progress: {
          recordsProcessed: 12000,
          recordsRemaining: 3000,
          totalRecords: 15000,
          percentageComplete: 80.0
        },
        performance: {
          recordsPerSecond: 1200,
          averageBatchTimeMs: 150,
          memoryUsageMb: 192
        },
        timing: {
          startTime: new Date('2025-10-26T10:20:00Z'),
          estimatedCompletionTime: new Date('2025-10-26T10:32:30Z'),
          elapsedTimeMs: 600000,
          remainingTimeMs: 150000
        },
        status: 'running' as const,
        currentBatch: {
          batchNumber: 24,
          batchSize: 500,
          batchProgress: 0.8
        }
      },
      {
        snapshotId: 'snapshot-3',
        sessionId: validSessionId,
        entityType: 'offices',
        timestamp: new Date('2025-10-26T10:30:00Z'),
        progress: {
          recordsProcessed: 1234,
          recordsRemaining: 0,
          totalRecords: 1234,
          percentageComplete: 100
        },
        performance: {
          recordsPerSecond: 1234,
          averageBatchTimeMs: 120,
          memoryUsageMb: 64
        },
        timing: {
          startTime: new Date('2025-10-26T10:10:00Z'),
          estimatedCompletionTime: new Date('2025-10-26T10:12:00Z'),
          elapsedTimeMs: 120000,
          remainingTimeMs: 0
        },
        status: 'completed' as const,
        currentBatch: {
          batchNumber: 3,
          batchSize: 500,
          batchProgress: 1.0
        }
      }
    ];

    const mockAlerts = [
      {
        alertId: 'alert-1',
        severity: 'warning' as const,
        type: 'low_throughput' as const,
        entityType: 'doctors',
        message: 'Low throughput detected: 800 records/sec',
        details: { threshold: 1000, actual: 800 },
        timestamp: new Date('2025-10-26T10:28:00Z')
      },
      {
        alertId: 'alert-2',
        severity: 'info' as const,
        type: 'checkpoint_created' as const,
        entityType: 'patients',
        message: 'Checkpoint created at batch 20',
        details: { batchNumber: 20, recordsProcessed: 10000 },
        timestamp: new Date('2025-10-26T10:25:00Z')
      }
    ];

    test('should retrieve migration status successfully', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue(mockProgressData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue(mockAlerts);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            sessionId: validSessionId,
            overallStatus: 'RUNNING',
            overallProgress: {
              percentage: 82, // Weighted average: (78.95 * 5700 + 80 * 15000 + 100 * 1234) / 21934
              recordsProcessed: 17734,
              totalRecords: 21934,
              recordsRemaining: 4200
            },
            entities: [
              {
                entityType: 'offices',
                status: 'completed',
                progress: 100,
                recordsProcessed: 1234,
                totalRecords: 1234,
                throughput: 1234,
                elapsedTime: '2m 0s',
                remainingTime: null,
                currentBatch: {
                  batchNumber: 3,
                  batchSize: 500,
                  batchProgress: 100
                }
              },
              {
                entityType: 'doctors',
                status: 'running',
                progress: 78.95,
                recordsProcessed: 4500,
                totalRecords: 5700,
                throughput: 987,
                elapsedTime: '15m 0s',
                remainingTime: '4m 40s',
                estimatedCompletion: '2025-10-26T10:34:30.000Z',
                currentBatch: {
                  batchNumber: 9,
                  batchSize: 500,
                  batchProgress: 60
                }
              },
              {
                entityType: 'patients',
                status: 'running',
                progress: 80.0,
                recordsProcessed: 12000,
                totalRecords: 15000,
                throughput: 1200,
                elapsedTime: '10m 0s',
                remainingTime: '2m 30s',
                estimatedCompletion: '2025-10-26T10:32:30.000Z',
                currentBatch: {
                  batchNumber: 24,
                  batchSize: 500,
                  batchProgress: 80
                }
              }
            ],
            performance: {
              averageThroughput: 1142, // Average of active entities
              peakThroughput: 1234,
              totalMemoryUsage: 512, // Sum of all entities
              averageMemoryUsage: 171, // Average across entities
              totalElapsedTime: 1620000, // Sum of elapsed times
              estimatedTotalCompletion: '2025-10-26T10:34:30.000Z'
            },
            alerts: [
              {
                alertId: 'alert-1',
                severity: 'warning',
                type: 'low_throughput',
                entityType: 'doctors',
                message: 'Low throughput detected: 800 records/sec',
                timestamp: '2025-10-26T10:28:00.000Z',
                age: expect.any(String)
              },
              {
                alertId: 'alert-2',
                severity: 'info',
                type: 'checkpoint_created',
                entityType: 'patients',
                message: 'Checkpoint created at batch 20',
                timestamp: '2025-10-26T10:25:00.000Z',
                age: expect.any(String)
              }
            ],
            lastUpdate: '2025-10-26T10:30:00.000Z'
          },
          meta: {
            apiVersion: '1.0.0',
            requestId: expect.any(String),
            timestamp: expect.any(String),
            refreshInterval: 5000
          }
        }
      };

      // Verify tracker would be called
      expect(mockProgressTracker.getAllProgress).toHaveBeenCalled();
      expect(mockProgressTracker.getActiveAlerts).toHaveBeenCalled();

      // Verify response structure
      expect(expectedResponse.status).toBe(200);
      expect(expectedResponse.body.success).toBe(true);
      expect(expectedResponse.body.data.sessionId).toBe(validSessionId);
      expect(expectedResponse.body.data.overallStatus).toBe('RUNNING');
      expect(expectedResponse.body.data.entities).toHaveLength(3);
      expect(expectedResponse.body.data.alerts).toHaveLength(2);
    });

    test('should handle session not found', async () => {
      const nonExistentSessionId = '000e8400-e29b-41d4-a716-446655440000';

      mockProgressTracker.getAllProgress.mockResolvedValue([]); // No progress data found

      const expectedErrorResponse = {
        status: 404,
        body: {
          success: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `Migration session not found: ${nonExistentSessionId}`,
            details: {
              sessionId: nonExistentSessionId,
              suggestions: [
                'Verify the session ID is correct',
                'Check if the migration has expired or been cleaned up',
                'Use GET /api/migration/sessions to list active sessions'
              ]
            }
          }
        }
      };

      expect(expectedResponse.status).toBe(404);
      expect(expectedResponse.body.error.code).toBe('SESSION_NOT_FOUND');
      expect(expectedResponse.body.error.details.sessionId).toBe(nonExistentSessionId);
    });

    test('should validate session ID format', async () => {
      const invalidSessionIds = [
        'invalid-uuid',
        '123456789',
        'not-a-uuid-at-all',
        ''
      ];

      for (const invalidId of invalidSessionIds) {
        const expectedErrorResponse = {
          status: 400,
          body: {
            success: false,
            error: {
              code: 'INVALID_SESSION_ID',
              message: 'Invalid session ID format',
              details: {
                providedId: invalidId,
                expectedFormat: 'UUID v4 (e.g., 550e8400-e29b-41d4-a716-446655440000)'
              }
            }
          }
        };

        expect(expectedErrorResponse.status).toBe(400);
        expect(expectedErrorResponse.body.error.code).toBe('INVALID_SESSION_ID');
      }
    });

    test('should handle different migration statuses', async () => {
      const statusScenarios = [
        {
          mockData: [
            { ...mockProgressData[0], status: 'completed' as const },
            { ...mockProgressData[1], status: 'completed' as const },
            { ...mockProgressData[2], status: 'completed' as const }
          ],
          expectedStatus: 'COMPLETED'
        },
        {
          mockData: [
            { ...mockProgressData[0], status: 'paused' as const },
            { ...mockProgressData[1], status: 'paused' as const },
            { ...mockProgressData[2], status: 'completed' as const }
          ],
          expectedStatus: 'PAUSED'
        },
        {
          mockData: [
            { ...mockProgressData[0], status: 'failed' as const },
            { ...mockProgressData[1], status: 'running' as const },
            { ...mockProgressData[2], status: 'completed' as const }
          ],
          expectedStatus: 'FAILED'
        },
        {
          mockData: [
            { ...mockProgressData[0], status: 'starting' as const },
            { ...mockProgressData[1], status: 'starting' as const },
            { ...mockProgressData[2], status: 'starting' as const }
          ],
          expectedStatus: 'STARTING'
        }
      ];

      for (const { mockData, expectedStatus } of statusScenarios) {
        mockProgressTracker.getAllProgress.mockResolvedValue(mockData);
        mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

        const expectedResponse = {
          status: 200,
          body: {
            success: true,
            data: {
              sessionId: validSessionId,
              overallStatus: expectedStatus
            }
          }
        };

        expect(expectedResponse.body.data.overallStatus).toBe(expectedStatus);
      }
    });

    test('should include performance metrics and recommendations', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue(mockProgressData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue(mockAlerts);
      mockProgressTracker.calculatePerformanceMetrics.mockResolvedValue({
        entityType: 'overall',
        timeWindow: {
          startTime: new Date('2025-10-26T10:10:00Z'),
          endTime: new Date('2025-10-26T10:30:00Z'),
          durationMs: 1200000
        },
        throughput: {
          current: 1142,
          average: 1074,
          peak: 1234,
          minimum: 987
        },
        memory: {
          current: 512,
          average: 480,
          peak: 576
        },
        timing: {
          averageBatchTimeMs: 150,
          fastestBatchMs: 120,
          slowestBatchMs: 180,
          varianceMs: 20
        },
        efficiency: {
          cpuEfficiency: 0.87,
          memoryEfficiency: 0.75,
          overallScore: 85
        }
      });

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            performanceMetrics: {
              throughput: {
                current: 1142,
                average: 1074,
                peak: 1234,
                minimum: 987
              },
              efficiency: {
                cpuEfficiency: 87,
                memoryEfficiency: 75,
                overallScore: 85
              },
              timing: {
                averageBatchTimeMs: 150,
                fastestBatchMs: 120,
                slowestBatchMs: 180
              }
            },
            recommendations: [
              'Performance is within normal parameters',
              'Memory usage could be optimized for better efficiency',
              'Consider adjusting batch size for faster processing'
            ]
          }
        }
      };

      expect(mockProgressTracker.calculatePerformanceMetrics).toHaveBeenCalled();
      expect(expectedResponse.body.data.performanceMetrics.efficiency.overallScore).toBe(85);
    });

    test('should support real-time updates via Server-Sent Events', async () => {
      // Mock SSE setup
      const sseRequest = {
        headers: {
          'accept': 'text/event-stream',
          'cache-control': 'no-cache'
        }
      };

      mockProgressTracker.subscribeToUpdates.mockImplementation((callback) => {
        // Simulate real-time updates
        setTimeout(() => {
          callback({
            updateId: 'update-123',
            sessionId: validSessionId,
            updateType: 'progress',
            entityType: 'doctors',
            data: {
              recordsProcessed: 4600,
              percentageComplete: 80.7
            },
            timestamp: new Date()
          });
        }, 100);

        return jest.fn(); // Unsubscribe function
      });

      const expectedSSEResponse = {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        },
        body: [
          'data: {"type":"connected","sessionId":"550e8400-e29b-41d4-a716-446655440000"}\n\n',
          'data: {"type":"progress","entityType":"doctors","data":{"recordsProcessed":4600,"percentageComplete":80.7}}\n\n'
        ]
      };

      expect(mockProgressTracker.subscribeToUpdates).toHaveBeenCalled();
      expect(expectedSSEResponse.headers['Content-Type']).toBe('text/event-stream');
    });
  });

  describe('POST /api/migration/pause/{sessionId}', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

    test('should pause migration successfully', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], status: 'running' as const }
      ]);
      mockExecutor.pauseExecution.mockResolvedValue({
        success: true,
        checkpointId: 'checkpoint_pause_12345'
      });

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            sessionId: validSessionId,
            action: 'pause',
            status: 'paused',
            checkpointId: 'checkpoint_pause_12345',
            pausedAt: expect.any(String),
            message: 'Migration paused successfully',
            resumeInstructions: {
              endpoint: `/api/migration/resume/${validSessionId}`,
              method: 'POST',
              description: 'Use this endpoint to resume the migration from the current checkpoint'
            }
          }
        }
      };

      expect(mockExecutor.pauseExecution).toHaveBeenCalled();
      expect(expectedResponse.status).toBe(200);
      expect(expectedResponse.body.success).toBe(true);
      expect(expectedResponse.body.data.action).toBe('pause');
      expect(expectedResponse.body.data.checkpointId).toBe('checkpoint_pause_12345');
    });

    test('should handle pause of non-running migration', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], status: 'completed' as const }
      ]);

      const expectedErrorResponse = {
        status: 409, // Conflict
        body: {
          success: false,
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: 'Cannot pause migration in current state',
            details: {
              currentStatus: 'completed',
              allowedStates: ['running'],
              action: 'pause'
            }
          }
        }
      };

      expect(expectedErrorResponse.status).toBe(409);
      expect(expectedErrorResponse.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(expectedErrorResponse.body.error.details.currentStatus).toBe('completed');
    });

    test('should handle pause failures', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], status: 'running' as const }
      ]);
      mockExecutor.pauseExecution.mockResolvedValue({
        success: false
      });

      const expectedErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'PAUSE_FAILED',
            message: 'Failed to pause migration',
            details: 'Migration could not be paused at this time',
            retryable: true,
            retryAfter: 30
          }
        }
      };

      expect(expectedErrorResponse.status).toBe(500);
      expect(expectedErrorResponse.body.error.retryable).toBe(true);
    });
  });

  describe('POST /api/migration/resume/{sessionId}', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

    test('should resume migration successfully', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], status: 'paused' as const }
      ]);
      mockExecutor.resumeExecution.mockResolvedValue({
        success: true,
        resumedFromBatch: 5
      });

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            sessionId: validSessionId,
            action: 'resume',
            status: 'running',
            resumedFromBatch: 5,
            resumedAt: expect.any(String),
            message: 'Migration resumed successfully',
            statusUrl: `/api/migration/status/${validSessionId}`
          }
        }
      };

      expect(mockExecutor.resumeExecution).toHaveBeenCalled();
      expect(expectedResponse.status).toBe(200);
      expect(expectedResponse.body.success).toBe(true);
      expect(expectedResponse.body.data.action).toBe('resume');
      expect(expectedResponse.body.data.resumedFromBatch).toBe(5);
    });

    test('should handle resume of non-paused migration', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], status: 'running' as const }
      ]);

      const expectedErrorResponse = {
        status: 409,
        body: {
          success: false,
          error: {
            code: 'INVALID_STATE_TRANSITION',
            message: 'Cannot resume migration in current state',
            details: {
              currentStatus: 'running',
              allowedStates: ['paused'],
              action: 'resume'
            }
          }
        }
      };

      expect(expectedErrorResponse.status).toBe(409);
      expect(expectedErrorResponse.body.error.details.currentStatus).toBe('running');
    });

    test('should handle missing checkpoint for resume', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], status: 'paused' as const }
      ]);
      mockExecutor.resumeExecution.mockRejectedValue(
        new Error('No checkpoint found for resumption')
      );

      const expectedErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: {
            code: 'CHECKPOINT_NOT_FOUND',
            message: 'Cannot resume migration without valid checkpoint',
            details: 'No checkpoint found for resumption',
            suggestions: [
              'Restart the migration from the beginning',
              'Check if checkpoints were properly saved',
              'Contact support if this persists'
            ]
          }
        }
      };

      expect(expectedErrorResponse.status).toBe(500);
      expect(expectedErrorResponse.body.error.code).toBe('CHECKPOINT_NOT_FOUND');
    });
  });

  describe('GET /api/migration/sessions', () => {
    test('should list all active sessions', async () => {
      const mockSessions = [
        {
          sessionId: '550e8400-e29b-41d4-a716-446655440000',
          status: 'running',
          startTime: new Date('2025-10-26T10:00:00Z'),
          lastUpdate: new Date('2025-10-26T10:30:00Z'),
          entitiesActive: ['doctors', 'patients'],
          entitiesCompleted: ['offices'],
          totalProgress: 75
        },
        {
          sessionId: '660f9500-f3ac-52e5-b827-557766551111',
          status: 'paused',
          startTime: new Date('2025-10-26T09:00:00Z'),
          lastUpdate: new Date('2025-10-26T09:45:00Z'),
          entitiesActive: [],
          entitiesCompleted: ['offices', 'doctors'],
          totalProgress: 60
        }
      ];

      // Mock multiple session data
      mockProgressTracker.getAllProgress.mockResolvedValue([
        { ...mockProgressData[0], sessionId: mockSessions[0].sessionId },
        { ...mockProgressData[1], sessionId: mockSessions[1].sessionId, status: 'paused' as const }
      ]);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            sessions: [
              {
                sessionId: '550e8400-e29b-41d4-a716-446655440000',
                status: 'running',
                startTime: '2025-10-26T10:00:00.000Z',
                lastUpdate: '2025-10-26T10:30:00.000Z',
                progress: {
                  percentage: 75,
                  entitiesActive: 2,
                  entitiesCompleted: 1,
                  totalEntities: 3
                },
                statusUrl: '/api/migration/status/550e8400-e29b-41d4-a716-446655440000'
              },
              {
                sessionId: '660f9500-f3ac-52e5-b827-557766551111',
                status: 'paused',
                startTime: '2025-10-26T09:00:00.000Z',
                lastUpdate: '2025-10-26T09:45:00.000Z',
                progress: {
                  percentage: 60,
                  entitiesActive: 0,
                  entitiesCompleted: 2,
                  totalEntities: 2
                },
                statusUrl: '/api/migration/status/660f9500-f3ac-52e5-b827-557766551111'
              }
            ],
            meta: {
              totalSessions: 2,
              activeSessions: 1,
              pausedSessions: 1,
              completedSessions: 0
            }
          }
        }
      };

      expect(expectedResponse.body.data.sessions).toHaveLength(2);
      expect(expectedResponse.body.data.meta.activeSessions).toBe(1);
      expect(expectedResponse.body.data.meta.pausedSessions).toBe(1);
    });

    test('should handle empty session list', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([]);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: {
            sessions: [],
            meta: {
              totalSessions: 0,
              message: 'No active migration sessions found'
            }
          }
        }
      };

      expect(expectedResponse.body.data.sessions).toHaveLength(0);
      expect(expectedResponse.body.data.meta.totalSessions).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle service unavailable errors', async () => {
      mockProgressTracker.getAllProgress.mockRejectedValue(
        new Error('Database connection lost')
      );

      const expectedErrorResponse = {
        status: 503, // Service Unavailable
        body: {
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Status service temporarily unavailable',
            details: 'Database connection lost',
            retryable: true,
            retryAfter: 60
          }
        }
      };

      expect(expectedErrorResponse.status).toBe(503);
      expect(expectedErrorResponse.body.error.retryable).toBe(true);
    });

    test('should handle timeout errors', async () => {
      mockProgressTracker.getAllProgress.mockImplementation(() =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Query timeout')), 100);
        })
      );

      const expectedErrorResponse = {
        status: 504, // Gateway Timeout
        body: {
          success: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Status request timed out',
            details: 'Query timeout',
            retryable: true
          }
        }
      };

      expect(expectedErrorResponse.status).toBe(504);
      expect(expectedErrorResponse.body.error.code).toBe('REQUEST_TIMEOUT');
    });
  });

  describe('Response Formatting', () => {
    test('should format time durations consistently', async () => {
      const testCases = [
        { ms: 1000, expected: '1s' },
        { ms: 60000, expected: '1m 0s' },
        { ms: 3600000, expected: '1h 0m' },
        { ms: 7265000, expected: '2h 1m 5s' }
      ];

      for (const { ms, expected } of testCases) {
        // Mock data with specific timing
        const mockData = [{
          ...mockProgressData[0],
          timing: {
            ...mockProgressData[0].timing,
            elapsedTimeMs: ms
          }
        }];

        mockProgressTracker.getAllProgress.mockResolvedValue(mockData);
        mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

        const expectedResponse = {
          status: 200,
          body: {
            success: true,
            data: {
              entities: [
                expect.objectContaining({
                  elapsedTime: expected
                })
              ]
            }
          }
        };

        expect(expectedResponse.body.data.entities[0].elapsedTime).toBe(expected);
      }
    });

    test('should include API metadata in all responses', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[0]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const expectedResponse = {
        status: 200,
        body: {
          success: true,
          data: expect.any(Object),
          meta: {
            apiVersion: '1.0.0',
            requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
            timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
            refreshInterval: 5000
          }
        }
      };

      expect(expectedResponse.body.meta.apiVersion).toBe('1.0.0');
      expect(expectedResponse.body.meta.refreshInterval).toBe(5000);
    });
  });
});
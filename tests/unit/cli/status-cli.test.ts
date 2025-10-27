/**
 * Status Monitoring CLI Tests
 * Tests watch mode, formatting, session management for differential:status
 */

import { StatusCLI, type StatusOptions, type StatusDisplay } from '../../../src/differential-migration/cli/status-cli';
import { ProgressTracker } from '../../../src/differential-migration/services/progress-tracker';
import { MigrationExecutor } from '../../../src/differential-migration/services/migration-executor';

// Mock the services
jest.mock('../../../src/differential-migration/services/progress-tracker');
jest.mock('../../../src/differential-migration/services/migration-executor');

describe('StatusCLI', () => {
  let cli: StatusCLI;
  let mockProgressTracker: jest.Mocked<ProgressTracker>;
  let mockExecutor: jest.Mocked<MigrationExecutor>;
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let setIntervalSpy: jest.SpyInstance;
  let clearIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'clear').mockImplementation();

    // Mock process.exit
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`Process exit: ${code}`);
    });

    // Mock timers
    setIntervalSpy = jest.spyOn(global, 'setInterval');
    clearIntervalSpy = jest.spyOn(global, 'clearInterval');

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
      validateMigrationIntegrity: jest.fn(),
      pauseExecution: jest.fn(),
      resumeExecution: jest.fn()
    } as any;

    (ProgressTracker as jest.MockedClass<typeof ProgressTracker>).mockImplementation(() => mockProgressTracker);
    (MigrationExecutor as jest.MockedClass<typeof MigrationExecutor>).mockImplementation(() => mockExecutor);

    cli = new StatusCLI();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  describe('Command Parsing', () => {
    test('should parse default options correctly', async () => {
      const options = cli.parseArguments([]);

      expect(options.sessionId).toBeUndefined();
      expect(options.watch).toBe(false);
      expect(options.interval).toBe(10);
      expect(options.showErrors).toBe(false);
      expect(options.verbose).toBe(false);
    });

    test('should parse session ID correctly', async () => {
      const sessionId = '550e8400-e29b-41d4-a716-446655440000';
      const options = cli.parseArguments(['--session-id', sessionId]);

      expect(options.sessionId).toBe(sessionId);
    });

    test('should parse watch mode options correctly', async () => {
      const options = cli.parseArguments(['--watch', '--interval', '5']);

      expect(options.watch).toBe(true);
      expect(options.interval).toBe(5);
    });

    test('should parse error and verbose flags correctly', async () => {
      const options = cli.parseArguments(['--show-errors', '--verbose']);

      expect(options.showErrors).toBe(true);
      expect(options.verbose).toBe(true);
    });

    test('should validate interval range', async () => {
      expect(() => {
        cli.parseArguments(['--interval', '0']);
      }).toThrow('Interval must be between 1 and 300 seconds');

      expect(() => {
        cli.parseArguments(['--interval', '301']);
      }).toThrow('Interval must be between 1 and 300 seconds');
    });

    test('should show help when requested', async () => {
      expect(() => {
        cli.parseArguments(['--help']);
      }).toThrow('Process exit: 0');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('differential:status'));
    });
  });

  describe('Status Display', () => {
    const mockProgressData = [
      {
        snapshotId: 'snapshot-1',
        sessionId: 'session-123',
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
          averageBatchTimeMs: 150,
          memoryUsageMb: 128
        },
        timing: {
          startTime: new Date('2025-10-26T10:28:00Z'),
          estimatedCompletionTime: new Date('2025-10-26T10:30:00Z'),
          elapsedTimeMs: 120000,
          remainingTimeMs: 0
        },
        status: 'completed' as const,
        currentBatch: {
          batchNumber: 3,
          batchSize: 500,
          batchProgress: 1.0
        }
      },
      {
        snapshotId: 'snapshot-2',
        sessionId: 'session-123',
        entityType: 'doctors',
        timestamp: new Date('2025-10-26T10:32:00Z'),
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
          startTime: new Date('2025-10-26T10:30:15Z'),
          estimatedCompletionTime: new Date('2025-10-26T10:34:30Z'),
          elapsedTimeMs: 105000,
          remainingTimeMs: 73000
        },
        status: 'running' as const,
        currentBatch: {
          batchNumber: 9,
          batchSize: 500,
          batchProgress: 0.6
        }
      },
      {
        snapshotId: 'snapshot-3',
        sessionId: 'session-123',
        entityType: 'patients',
        timestamp: new Date('2025-10-26T10:32:00Z'),
        progress: {
          recordsProcessed: 0,
          recordsRemaining: 12345,
          totalRecords: 12345,
          percentageComplete: 0
        },
        performance: {
          recordsPerSecond: 0,
          averageBatchTimeMs: 0,
          memoryUsageMb: 64
        },
        timing: {
          startTime: new Date('2025-10-26T10:32:00Z'),
          estimatedCompletionTime: null,
          elapsedTimeMs: 0,
          remainingTimeMs: null
        },
        status: 'starting' as const
      }
    ];

    test('should display comprehensive status information', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue(mockProgressData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      await cli.displayStatus(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migration Status: session-123')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Overall Progress: 30% complete (5,734 of 19,279 records)')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ offices     (completed - 100%, 1,234 records in 2m 0s)')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('→ doctors     (running - 78%, 4,500/5,700 records, 987 rec/sec)')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⏸ patients    (starting - 0%, 12,345 records queued)')
      );
    });

    test('should display performance metrics', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue(mockProgressData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: true
      };

      await cli.displayStatus(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Performance:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Throughput: 987 records/sec (avg)')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Memory Usage: 256 MB')
      );
    });

    test('should display error information when requested', async () => {
      const mockAlerts = [
        {
          alertId: 'alert-1',
          severity: 'warning' as const,
          type: 'low_throughput' as const,
          entityType: 'doctors',
          message: 'Low throughput detected: 50 records/sec',
          details: { threshold: 100, actual: 50 },
          timestamp: new Date('2025-10-26T10:31:00Z')
        },
        {
          alertId: 'alert-2',
          severity: 'error' as const,
          type: 'stalled_progress' as const,
          entityType: 'patients',
          message: 'Progress stalled for 15 minutes',
          details: { lastUpdateMinutesAgo: 15 },
          timestamp: new Date('2025-10-26T10:32:00Z')
        }
      ];

      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[0]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue(mockAlerts);

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: false,
        interval: 10,
        showErrors: true,
        verbose: false
      };

      await cli.displayStatus(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recent Errors: 2')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  WARNING: Low throughput detected: 50 records/sec')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ ERROR: Progress stalled for 15 minutes')
      );
    });

    test('should show no active session message', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([]);

      const options: StatusOptions = {
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      await cli.displayStatus(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No active migration sessions found')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Run differential:analyze to start a new migration')
      );
    });

    test('should calculate and display ETA correctly', async () => {
      const runningData = [{
        ...mockProgressData[1],
        timing: {
          ...mockProgressData[1].timing,
          estimatedCompletionTime: new Date('2025-10-26T10:34:30Z'),
          remainingTimeMs: 150000 // 2.5 minutes
        }
      }];

      mockProgressTracker.getAllProgress.mockResolvedValue(runningData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      await cli.displayStatus(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ETA: 2025-10-26 10:34:30')
      );
    });
  });

  describe('Watch Mode', () => {
    test('should setup watch mode with correct interval', async () => {
      let intervalCallback: () => void = () => {};
      setIntervalSpy.mockImplementation((callback: () => void, interval: number) => {
        intervalCallback = callback;
        return 12345 as any; // Mock timer ID
      });

      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[0]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: true,
        interval: 5,
        showErrors: false,
        verbose: false
      };

      const watchPromise = cli.startWatchMode(options);

      // Verify interval setup
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

      // Simulate interval callback
      intervalCallback();

      expect(mockProgressTracker.getAllProgress).toHaveBeenCalledTimes(1);

      // Cleanup
      cli.stopWatchMode();
      expect(clearIntervalSpy).toHaveBeenCalledWith(12345);
    });

    test('should clear screen on each update in watch mode', async () => {
      let intervalCallback: () => void = () => {};
      setIntervalSpy.mockImplementation((callback: () => void, interval: number) => {
        intervalCallback = callback;
        return 12345 as any;
      });

      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[1]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: true,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      cli.startWatchMode(options);

      // Trigger update
      intervalCallback();

      expect(console.clear).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('🔄 Auto-refreshing every 10s (Ctrl+C to stop)')
      );
    });

    test('should handle watch mode errors gracefully', async () => {
      let intervalCallback: () => void = () => {};
      setIntervalSpy.mockImplementation((callback: () => void) => {
        intervalCallback = callback;
        return 12345 as any;
      });

      mockProgressTracker.getAllProgress.mockRejectedValue(new Error('Connection lost'));

      cli.startWatchMode({
        watch: true,
        interval: 10,
        showErrors: false,
        verbose: false
      });

      // Trigger error
      intervalCallback();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error refreshing status: Connection lost')
      );
    });

    test('should stop watch mode cleanly', async () => {
      setIntervalSpy.mockReturnValue(12345 as any);

      cli.startWatchMode({
        watch: true,
        interval: 10,
        showErrors: false,
        verbose: false
      });

      cli.stopWatchMode();

      expect(clearIntervalSpy).toHaveBeenCalledWith(12345);
    });
  });

  describe('Session Management', () => {
    test('should find latest session when none specified', async () => {
      const latestSessionProgress = [
        {
          ...mockProgressData[0],
          sessionId: 'latest-session',
          timestamp: new Date('2025-10-26T11:00:00Z')
        }
      ];

      mockProgressTracker.getAllProgress.mockResolvedValue(latestSessionProgress);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      await cli.displayStatus(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migration Status: latest-session')
      );
    });

    test('should handle specified session ID', async () => {
      const specificSessionProgress = [
        {
          ...mockProgressData[1],
          sessionId: 'specific-session-456'
        }
      ];

      jest.spyOn(cli, 'getSessionProgress').mockResolvedValue(specificSessionProgress);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'specific-session-456',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      await cli.displayStatus(options);

      expect(cli.getSessionProgress).toHaveBeenCalledWith('specific-session-456');
    });

    test('should handle non-existent session ID', async () => {
      jest.spyOn(cli, 'getSessionProgress').mockResolvedValue([]);

      const options: StatusOptions = {
        sessionId: 'nonexistent-session',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      expect(async () => {
        await cli.displayStatus(options);
      }).rejects.toThrow('Process exit: 3');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Session not found: nonexistent-session')
      );
    });
  });

  describe('Status Formatting', () => {
    test('should format completed migration status', async () => {
      const completedData = [
        {
          ...mockProgressData[0],
          status: 'completed' as const,
          progress: { ...mockProgressData[0].progress, percentageComplete: 100 }
        }
      ];

      mockProgressTracker.getAllProgress.mockResolvedValue(completedData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      await cli.displayStatus({
        sessionId: 'completed-session',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Status: COMPLETED')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✓ offices     (completed - 100%')
      );
    });

    test('should format running migration status', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[1]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      await cli.displayStatus({
        sessionId: 'running-session',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Status: RUNNING')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('→ doctors     (running - 78%, 4,500/5,700 records, 987 rec/sec)')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ETA: 2025-10-26 10:34:30')
      );
    });

    test('should format paused migration status', async () => {
      const pausedData = [
        {
          ...mockProgressData[1],
          status: 'paused' as const
        }
      ];

      mockProgressTracker.getAllProgress.mockResolvedValue(pausedData);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      await cli.displayStatus({
        sessionId: 'paused-session',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Status: PAUSED')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⏸ doctors     (paused - 78%')
      );
    });

    test('should show detailed performance metrics in verbose mode', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[1]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);
      mockProgressTracker.calculatePerformanceMetrics.mockResolvedValue({
        entityType: 'doctors',
        timeWindow: {
          startTime: new Date('2025-10-26T10:30:00Z'),
          endTime: new Date('2025-10-26T10:32:00Z'),
          durationMs: 120000
        },
        throughput: {
          current: 987,
          average: 950,
          peak: 1200,
          minimum: 800
        },
        memory: {
          current: 256,
          average: 240,
          peak: 280
        },
        timing: {
          averageBatchTimeMs: 180,
          fastestBatchMs: 120,
          slowestBatchMs: 240,
          varianceMs: 30
        },
        efficiency: {
          cpuEfficiency: 0.85,
          memoryEfficiency: 0.78,
          overallScore: 82
        }
      });

      await cli.displayStatus({
        sessionId: 'session-123',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Detailed Performance Metrics:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Peak Throughput: 1,200 records/sec')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Efficiency Score: 82/100')
      );
    });
  });

  describe('Integration and Main Entry Point', () => {
    test('should execute status check successfully', async () => {
      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[0]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const args = ['--session-id', 'session-123'];

      await cli.main(args);

      expect(mockProgressTracker.getAllProgress).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migration Status: session-123')
      );
    });

    test('should start watch mode when requested', async () => {
      setIntervalSpy.mockReturnValue(12345 as any);
      mockProgressTracker.getAllProgress.mockResolvedValue([mockProgressData[1]]);
      mockProgressTracker.getActiveAlerts.mockResolvedValue([]);

      const args = ['--watch', '--interval', '3'];

      // Mock process exit to simulate Ctrl+C
      const originalExit = process.exit;
      let watchStarted = false;

      const mockExit = jest.fn().mockImplementation(() => {
        if (!watchStarted) {
          watchStarted = true;
          // Simulate watch mode running briefly then stopping
          setTimeout(() => {
            cli.stopWatchMode();
          }, 100);
          return;
        }
        throw new Error('Process exit: 0');
      });

      process.exit = mockExit as any;

      try {
        await cli.main(args);
      } catch (error) {
        // Expected from mocked exit
      }

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);

      process.exit = originalExit;
    });

    test('should handle service initialization errors', async () => {
      (ProgressTracker as jest.MockedClass<typeof ProgressTracker>)
        .mockImplementation(() => {
          throw new Error('Service initialization failed');
        });

      const args = ['--session-id', 'session-123'];

      expect(async () => {
        await cli.main(args);
      }).rejects.toThrow('Process exit: 7');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize status monitoring: Service initialization failed')
      );
    });
  });

  describe('Real-time Updates', () => {
    test('should subscribe to real-time updates', async () => {
      const mockUnsubscribe = jest.fn();
      mockProgressTracker.subscribeToUpdates.mockReturnValue(mockUnsubscribe);

      cli.setupRealTimeUpdates('session-123');

      expect(mockProgressTracker.subscribeToUpdates).toHaveBeenCalledWith(
        expect.any(Function)
      );

      // Test unsubscribe
      cli.cleanupRealTimeUpdates();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    test('should handle real-time update events', async () => {
      let updateCallback: (update: any) => void = () => {};

      mockProgressTracker.subscribeToUpdates.mockImplementation((callback) => {
        updateCallback = callback;
        return jest.fn();
      });

      cli.setupRealTimeUpdates('session-123');

      // Simulate real-time update
      const mockUpdate = {
        updateId: 'update-123',
        sessionId: 'session-123',
        updateType: 'progress' as const,
        entityType: 'doctors',
        data: {
          recordsProcessed: 5000,
          percentageComplete: 88
        },
        timestamp: new Date()
      };

      updateCallback(mockUpdate);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('📊 doctors: 88% complete (5,000 records processed)')
      );
    });

    test('should handle real-time alert updates', async () => {
      let updateCallback: (update: any) => void = () => {};

      mockProgressTracker.subscribeToUpdates.mockImplementation((callback) => {
        updateCallback = callback;
        return jest.fn();
      });

      cli.setupRealTimeUpdates('session-123');

      // Simulate alert update
      const mockAlertUpdate = {
        updateId: 'alert-update-123',
        sessionId: 'session-123',
        updateType: 'alert' as const,
        data: {
          alertId: 'alert-123',
          severity: 'warning',
          type: 'high_memory',
          entityType: 'patients',
          message: 'High memory usage: 450MB',
          timestamp: new Date()
        },
        timestamp: new Date()
      };

      updateCallback(mockAlertUpdate);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  ALERT: High memory usage: 450MB (patients)')
      );
    });
  });

  describe('Error Handling and Exit Codes', () => {
    test('should return correct exit codes for different scenarios', async () => {
      // Invalid parameters
      expect(() => {
        cli.parseArguments(['--interval', '0']);
      }).toThrow();

      // Session not found
      jest.spyOn(cli, 'getSessionProgress').mockResolvedValue([]);

      expect(async () => {
        await cli.main(['--session-id', 'nonexistent']);
      }).rejects.toThrow('Process exit: 3');

      // System error
      mockProgressTracker.getAllProgress.mockRejectedValue(new Error('Database error'));

      expect(async () => {
        await cli.main([]);
      }).rejects.toThrow('Process exit: 7');
    });

    test('should format error messages consistently', async () => {
      mockProgressTracker.getAllProgress.mockRejectedValue(
        new Error('Connection timeout')
      );

      const options: StatusOptions = {
        sessionId: 'session-123',
        watch: false,
        interval: 10,
        showErrors: false,
        verbose: false
      };

      expect(async () => {
        await cli.displayStatus(options);
      }).rejects.toThrow('Process exit: 7');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ERROR: Status check failed')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Details: Connection timeout')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Session ID: session-123')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Timestamp:')
      );
    });
  });

  describe('Configuration and Environment', () => {
    test('should load monitoring configuration from environment', async () => {
      process.env.PROGRESS_UPDATE_INTERVAL = '2000';
      process.env.MIGRATION_STATUS_RETENTION = '24';

      const newCli = new StatusCLI();
      const config = newCli.getMonitoringConfig();

      expect(config.updateIntervalMs).toBe(2000);
      expect(config.retentionPeriodHours).toBe(24);

      // Cleanup
      delete process.env.PROGRESS_UPDATE_INTERVAL;
      delete process.env.MIGRATION_STATUS_RETENTION;
    });

    test('should use default configuration when environment variables are missing', async () => {
      const config = cli.getMonitoringConfig();

      expect(config.updateIntervalMs).toBe(5000); // Default 5 seconds
      expect(config.retentionPeriodHours).toBe(72); // Default 3 days
      expect(config.enableRealTimeUpdates).toBe(true);
    });
  });
});
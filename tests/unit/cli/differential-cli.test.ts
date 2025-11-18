/**
 * Differential Detection CLI Tests
 * Tests command parsing, file output, progress display for differential:detect
 */

import * as fs from 'fs/promises';
import { DifferentialCLI, type DetectionOptions, type DetectionOutput } from '../../../src/differential-migration/cli/differential-cli';
import { DifferentialDetector } from '../../../src/differential-migration/services/differential-detector';

// Mock the DifferentialDetector service and fs
jest.mock('../../../src/differential-migration/services/differential-detector');
jest.mock('fs/promises');

describe('DifferentialCLI', () => {
  let cli: DifferentialCLI;
  let mockDetector: jest.Mocked<DifferentialDetector>;
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let mockFs: jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'table').mockImplementation();

    // Mock process.exit
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`Process exit: ${code}`);
    });

    // Mock fs
    mockFs = fs as jest.Mocked<typeof fs>;

    // Mock DifferentialDetector
    mockDetector = {
      detectChanges: jest.fn(),
      batchDetectChanges: jest.fn(),
      calculateContentHash: jest.fn(),
      validateTimestamps: jest.fn(),
      optimizeDetectionQuery: jest.fn()
    } as any;

    (DifferentialDetector as jest.MockedClass<typeof DifferentialDetector>).mockImplementation(() => mockDetector);

    cli = new DifferentialCLI();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('Command Parsing', () => {
    test('should parse default options correctly', async () => {
      const options = cli.parseArguments([]);

      expect(options.entities).toEqual(['all']);
      expect(options.since).toBeUndefined();
      expect(options.includeDeleted).toBe(true);
      expect(options.output).toBe('table');
      expect(options.saveTo).toBeUndefined();
      expect(options.threshold).toBe(0);
    });

    test('should parse entity list correctly', async () => {
      const options = cli.parseArguments(['--entities', 'orders,cases,messages']);

      expect(options.entities).toEqual(['orders', 'cases', 'messages']);
    });

    test('should parse timestamp correctly', async () => {
      const timestampStr = '2025-10-25 12:00:00';
      const options = cli.parseArguments(['--since', timestampStr]);

      expect(options.since).toEqual(new Date('2025-10-25T12:00:00'));
    });

    test('should parse output options correctly', async () => {
      const options = cli.parseArguments([
        '--output', 'json',
        '--save-to', 'results.json',
        '--threshold', '5'
      ]);

      expect(options.output).toBe('json');
      expect(options.saveTo).toBe('results.json');
      expect(options.threshold).toBe(5);
    });

    test('should parse boolean flags correctly', async () => {
      const options = cli.parseArguments([
        '--include-deleted',
        '--no-include-deleted'
      ]);

      expect(options.includeDeleted).toBe(false);
    });

    test('should handle invalid timestamp format', async () => {
      expect(() => {
        cli.parseArguments(['--since', 'invalid-date']);
      }).toThrow();
    });

    test('should show help when requested', async () => {
      expect(() => {
        cli.parseArguments(['--help']);
      }).toThrow('Process exit: 0');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('differential:detect'));
    });
  });

  describe('Detection Execution', () => {
    const mockDetectionResult = {
      analysisId: 'detection-123',
      entityType: 'orders',
      analysisTimestamp: new Date('2025-10-26T10:30:00Z'),
      baselineTimestamp: new Date('2025-10-25T12:00:00Z'),
      detectionMethod: 'timestamp_with_hash' as const,
      totalRecordsAnalyzed: 10000,
      changesDetected: [
        {
          recordId: 'order_1001',
          changeType: 'new' as const,
          sourceTimestamp: new Date('2025-10-26T09:00:00Z'),
          contentHash: 'sha256_abc123',
          metadata: {
            sourceTable: 'dispatch_orders',
            destinationTable: 'orders',
            confidence: 0.95
          }
        },
        {
          recordId: 'order_1002',
          changeType: 'modified' as const,
          sourceTimestamp: new Date('2025-10-26T09:30:00Z'),
          destinationTimestamp: new Date('2025-10-25T14:00:00Z'),
          contentHash: 'sha256_def456',
          previousContentHash: 'sha256_old789',
          metadata: {
            sourceTable: 'dispatch_orders',
            destinationTable: 'orders',
            confidence: 0.98
          }
        },
        {
          recordId: 'order_1003',
          changeType: 'deleted' as const,
          sourceTimestamp: new Date('2025-10-26T08:00:00Z'),
          destinationTimestamp: new Date('2025-10-25T10:00:00Z'),
          metadata: {
            sourceTable: 'dispatch_orders',
            destinationTable: 'orders',
            confidence: 0.90
          }
        }
      ],
      summary: {
        newRecords: 156,
        modifiedRecords: 89,
        deletedRecords: 7,
        totalChanges: 252,
        changePercentage: 2.52
      },
      performance: {
        analysisDurationMs: 15000,
        recordsPerSecond: 667,
        queriesExecuted: 12
      },
      recommendations: [
        'Large number of new records - consider batch processing',
        'Change detection completed successfully'
      ]
    };

    test('should execute detection for all entities', async () => {
      mockDetector.detectChanges.mockResolvedValue(mockDetectionResult);

      const options: DetectionOptions = {
        entities: ['all'],
        since: new Date('2025-10-25T12:00:00Z'),
        includeDeleted: true,
        output: 'table',
        threshold: 0
      };

      await cli.runDetection(options);

      expect(mockDetector.detectChanges).toHaveBeenCalledWith({
        entityType: expect.any(String),
        sinceTimestamp: new Date('2025-10-25T12:00:00Z'),
        includeDeletes: true,
        enableContentHashing: true
      });
    });

    test('should execute detection for specific entities', async () => {
      mockDetector.detectChanges.mockResolvedValue(mockDetectionResult);

      const options: DetectionOptions = {
        entities: ['orders', 'cases'],
        since: new Date('2025-10-25T12:00:00Z'),
        includeDeleted: false,
        output: 'table',
        threshold: 5
      };

      await cli.runDetection(options);

      expect(mockDetector.detectChanges).toHaveBeenCalledWith({
        entityType: 'orders',
        sinceTimestamp: new Date('2025-10-25T12:00:00Z'),
        includeDeletes: false,
        enableContentHashing: true
      });
    });

    test('should filter results by threshold', async () => {
      const lowChangeResult = {
        ...mockDetectionResult,
        summary: {
          newRecords: 2,
          modifiedRecords: 1,
          deletedRecords: 0,
          totalChanges: 3,
          changePercentage: 0.03
        }
      };

      mockDetector.detectChanges.mockResolvedValue(lowChangeResult);

      const options: DetectionOptions = {
        entities: ['offices'],
        threshold: 1.0, // 1% threshold
        output: 'table',
        includeDeleted: true
      };

      await cli.runDetection(options);

      // Should skip entities below threshold
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping offices: change percentage (0.03%) below threshold (1%)')
      );
    });

    test('should handle detection errors gracefully', async () => {
      mockDetector.detectChanges.mockRejectedValue(
        new Error('Database connection lost')
      );

      const options: DetectionOptions = {
        entities: ['orders'],
        output: 'table',
        includeDeleted: true,
        threshold: 0
      };

      expect(async () => {
        await cli.runDetection(options);
      }).rejects.toThrow('Process exit: 3');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Detection failed: Database connection lost')
      );
    });

    test('should use last migration timestamp when since is not provided', async () => {
      // Mock finding last migration timestamp
      const lastMigrationTime = new Date('2025-10-25T08:00:00Z');
      jest.spyOn(cli, 'getLastMigrationTimestamp').mockResolvedValue(lastMigrationTime);

      mockDetector.detectChanges.mockResolvedValue(mockDetectionResult);

      const options: DetectionOptions = {
        entities: ['doctors'],
        includeDeleted: true,
        output: 'table',
        threshold: 0
      };

      await cli.runDetection(options);

      expect(mockDetector.detectChanges).toHaveBeenCalledWith({
        entityType: 'doctors',
        sinceTimestamp: lastMigrationTime,
        includeDeletes: true,
        enableContentHashing: true
      });
    });
  });

  describe('Output Formatting', () => {
    const mockResults = [
      {
        analysisId: 'detection-123',
        entityType: 'orders',
        analysisTimestamp: new Date('2025-10-26T10:30:00Z'),
        baselineTimestamp: new Date('2025-10-25T12:00:00Z'),
        detectionMethod: 'timestamp_with_hash' as const,
        totalRecordsAnalyzed: 10000,
        changesDetected: [],
        summary: {
          newRecords: 156,
          modifiedRecords: 89,
          deletedRecords: 7,
          totalChanges: 252,
          changePercentage: 2.52
        },
        performance: {
          analysisDurationMs: 15000,
          recordsPerSecond: 667,
          queriesExecuted: 12
        },
        recommendations: ['Large number of new records']
      },
      {
        analysisId: 'detection-456',
        entityType: 'cases',
        analysisTimestamp: new Date('2025-10-26T10:35:00Z'),
        baselineTimestamp: new Date('2025-10-25T12:00:00Z'),
        detectionMethod: 'timestamp_only' as const,
        totalRecordsAnalyzed: 5000,
        changesDetected: [],
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
        recommendations: ['Change detection completed successfully']
      }
    ];

    test('should format table output correctly', async () => {
      cli.formatOutput(mockResults, 'table', false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Differential Analysis Results')
      );
      expect(console.table).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            Entity: 'orders',
            New: '156',
            Modified: '89',
            Deleted: '7',
            'Change%': '2.52%',
            'Est. Time': expect.any(String)
          }),
          expect.objectContaining({
            Entity: 'cases',
            New: '45',
            Modified: '23',
            Deleted: '1',
            'Change%': '1.38%'
          })
        ])
      );
    });

    test('should format JSON output correctly', async () => {
      cli.formatOutput(mockResults, 'json', false);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(jsonOutput).toEqual({
        detectionId: expect.any(String),
        timestamp: expect.any(String),
        entityResults: expect.arrayContaining([
          expect.objectContaining({
            entityType: 'orders',
            summary: expect.objectContaining({
              newRecords: 156,
              modifiedRecords: 89,
              deletedRecords: 7,
              totalChanges: 252,
              changePercentage: 2.52
            })
          })
        ]),
        overallSummary: expect.objectContaining({
          totalChanges: 321,
          estimatedMigrationTime: expect.any(String)
        })
      });
    });

    test('should format CSV output correctly', async () => {
      cli.formatOutput(mockResults, 'csv', false);

      const csvOutput = consoleSpy.mock.calls[0][0];

      expect(csvOutput).toContain('Entity,New,Modified,Deleted,Total Changes,Change %,Records/sec');
      expect(csvOutput).toContain('orders,156,89,7,252,2.52,667');
      expect(csvOutput).toContain('cases,45,23,1,69,1.38,625');
    });

    test('should show verbose information when requested', async () => {
      cli.formatOutput(mockResults, 'table', true);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Performance Metrics')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Total Analysis Time: 23,000ms')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Average Throughput: 646 records/sec')
      );
    });

    test('should display recommendations', async () => {
      cli.formatOutput(mockResults, 'table', false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recommendations')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large number of new records')
      );
    });

    test('should calculate estimated migration time', async () => {
      cli.formatOutput(mockResults, 'table', false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Total Changes: 321 records')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Estimated Migration Time:')
      );
    });
  });

  describe('File Saving', () => {
    const mockResults = [{
      analysisId: 'detection-123',
      entityType: 'orders',
      analysisTimestamp: new Date('2025-10-26T10:30:00Z'),
      baselineTimestamp: new Date('2025-10-25T12:00:00Z'),
      detectionMethod: 'timestamp_only' as const,
      totalRecordsAnalyzed: 1000,
      changesDetected: [],
      summary: {
        newRecords: 50,
        modifiedRecords: 25,
        deletedRecords: 2,
        totalChanges: 77,
        changePercentage: 7.7
      },
      performance: {
        analysisDurationMs: 5000,
        recordsPerSecond: 200,
        queriesExecuted: 4
      },
      recommendations: []
    }];

    test('should save JSON results to file', async () => {
      mockFs.writeFile.mockResolvedValue();

      const options: DetectionOptions = {
        entities: ['orders'],
        output: 'json',
        saveTo: 'detection-results.json',
        includeDeleted: true,
        threshold: 0
      };

      mockDetector.detectChanges.mockResolvedValue(mockResults[0]);

      await cli.runDetection(options);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        'detection-results.json',
        expect.stringContaining('"entityType":"orders"'),
        'utf8'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Results saved to: detection-results.json')
      );
    });

    test('should save CSV results to file', async () => {
      mockFs.writeFile.mockResolvedValue();

      const options: DetectionOptions = {
        entities: ['orders'],
        output: 'csv',
        saveTo: 'detection-results.csv',
        includeDeleted: true,
        threshold: 0
      };

      mockDetector.detectChanges.mockResolvedValue(mockResults[0]);

      await cli.runDetection(options);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        'detection-results.csv',
        expect.stringContaining('Entity,New,Modified,Deleted'),
        'utf8'
      );
    });

    test('should handle file write errors', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Permission denied'));

      const options: DetectionOptions = {
        entities: ['orders'],
        output: 'json',
        saveTo: 'readonly-file.json',
        includeDeleted: true,
        threshold: 0
      };

      mockDetector.detectChanges.mockResolvedValue(mockResults[0]);

      await cli.runDetection(options);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save results to file: Permission denied')
      );
    });
  });

  describe('Progress Display', () => {
    test('should show progress for multiple entities', async () => {
      const progressSpy = jest.spyOn(cli, 'showProgress').mockImplementation();

      mockDetector.detectChanges
        .mockResolvedValueOnce({
          analysisId: 'det-1',
          entityType: 'orders',
          analysisTimestamp: new Date(),
          baselineTimestamp: new Date(),
          detectionMethod: 'timestamp_only' as const,
          totalRecordsAnalyzed: 1000,
          changesDetected: [],
          summary: { newRecords: 10, modifiedRecords: 5, deletedRecords: 1, totalChanges: 16, changePercentage: 1.6 },
          performance: { analysisDurationMs: 2000, recordsPerSecond: 500, queriesExecuted: 2 },
          recommendations: []
        })
        .mockResolvedValueOnce({
          analysisId: 'det-2',
          entityType: 'cases',
          analysisTimestamp: new Date(),
          baselineTimestamp: new Date(),
          detectionMethod: 'timestamp_only' as const,
          totalRecordsAnalyzed: 500,
          changesDetected: [],
          summary: { newRecords: 8, modifiedRecords: 3, deletedRecords: 0, totalChanges: 11, changePercentage: 2.2 },
          performance: { analysisDurationMs: 1500, recordsPerSecond: 333, queriesExecuted: 2 },
          recommendations: []
        });

      const options: DetectionOptions = {
        entities: ['orders', 'cases'],
        includeDeleted: true,
        output: 'table',
        threshold: 0
      };

      await cli.runDetection(options);

      expect(progressSpy).toHaveBeenCalledWith(1, 2, 'orders');
      expect(progressSpy).toHaveBeenCalledWith(2, 2, 'cases');

      progressSpy.mockRestore();
    });

    test('should display real-time progress updates', async () => {
      // Mock a slow detection to test progress display
      mockDetector.detectChanges.mockImplementation(() =>
        new Promise(resolve => {
          setTimeout(() => {
            resolve({
              analysisId: 'slow-det',
              entityType: 'large_entity',
              analysisTimestamp: new Date(),
              baselineTimestamp: new Date(),
              detectionMethod: 'timestamp_with_hash' as const,
              totalRecordsAnalyzed: 100000,
              changesDetected: [],
              summary: { newRecords: 500, modifiedRecords: 200, deletedRecords: 10, totalChanges: 710, changePercentage: 0.71 },
              performance: { analysisDurationMs: 30000, recordsPerSecond: 3333, queriesExecuted: 20 },
              recommendations: []
            });
          }, 100); // Small delay for testing
        })
      );

      const options: DetectionOptions = {
        entities: ['large_entity'],
        includeDeleted: true,
        output: 'table',
        threshold: 0
      };

      await cli.runDetection(options);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Analyzing large_entity...')
      );
    });
  });

  describe('Integration and Main Entry Point', () => {
    test('should execute complete workflow successfully', async () => {
      const mockResult = {
        analysisId: 'detection-123',
        entityType: 'offices',
        analysisTimestamp: new Date(),
        baselineTimestamp: new Date(),
        detectionMethod: 'timestamp_only' as const,
        totalRecordsAnalyzed: 100,
        changesDetected: [],
        summary: {
          newRecords: 5,
          modifiedRecords: 3,
          deletedRecords: 1,
          totalChanges: 9,
          changePercentage: 9.0
        },
        performance: {
          analysisDurationMs: 1000,
          recordsPerSecond: 100,
          queriesExecuted: 2
        },
        recommendations: ['Change detection completed successfully']
      };

      mockDetector.detectChanges.mockResolvedValue(mockResult);
      jest.spyOn(cli, 'getLastMigrationTimestamp').mockResolvedValue(new Date('2025-10-25T12:00:00Z'));

      const args = ['--entities', 'offices', '--output', 'table'];

      await cli.main(args);

      expect(mockDetector.detectChanges).toHaveBeenCalled();
    });

    test('should handle no baseline found error', async () => {
      jest.spyOn(cli, 'getLastMigrationTimestamp').mockResolvedValue(null);

      const args = ['--entities', 'offices'];

      expect(async () => {
        await cli.main(args);
      }).rejects.toThrow('Process exit: 3');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No baseline found')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Run differential:analyze first')
      );
    });

    test('should override baseline with --since parameter', async () => {
      const mockResult = {
        analysisId: 'detection-override',
        entityType: 'doctors',
        analysisTimestamp: new Date(),
        baselineTimestamp: new Date('2025-10-24T10:00:00Z'),
        detectionMethod: 'timestamp_only' as const,
        totalRecordsAnalyzed: 200,
        changesDetected: [],
        summary: { newRecords: 10, modifiedRecords: 5, deletedRecords: 0, totalChanges: 15, changePercentage: 7.5 },
        performance: { analysisDurationMs: 2000, recordsPerSecond: 100, queriesExecuted: 3 },
        recommendations: []
      };

      mockDetector.detectChanges.mockResolvedValue(mockResult);

      const args = ['--entities', 'doctors', '--since', '2025-10-24 10:00:00'];

      await cli.main(args);

      expect(mockDetector.detectChanges).toHaveBeenCalledWith({
        entityType: 'doctors',
        sinceTimestamp: new Date('2025-10-24T10:00:00'),
        includeDeletes: true,
        enableContentHashing: true
      });
    });
  });

  describe('Error Handling and Exit Codes', () => {
    test('should return correct exit codes for different scenarios', async () => {
      // Invalid parameters
      expect(() => {
        cli.parseArguments(['--since', 'invalid-date']);
      }).toThrow();

      // No baseline found
      jest.spyOn(cli, 'getLastMigrationTimestamp').mockResolvedValue(null);

      expect(async () => {
        await cli.main(['--entities', 'offices']);
      }).rejects.toThrow('Process exit: 3');

      // Detection failure
      jest.spyOn(cli, 'getLastMigrationTimestamp').mockResolvedValue(new Date());
      mockDetector.detectChanges.mockRejectedValue(new Error('Query failed'));

      expect(async () => {
        await cli.main(['--entities', 'offices']);
      }).rejects.toThrow('Process exit: 3');
    });

    test('should format error messages consistently', async () => {
      mockDetector.detectChanges.mockRejectedValue(new Error('Connection timeout'));
      jest.spyOn(cli, 'getLastMigrationTimestamp').mockResolvedValue(new Date());

      const options: DetectionOptions = {
        entities: ['orders'],
        output: 'table',
        includeDeleted: true,
        threshold: 0
      };

      expect(async () => {
        await cli.runDetection(options);
      }).rejects.toThrow('Process exit: 3');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ERROR: Detection failed for entity \'orders\'')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Details: Connection timeout')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Timestamp:')
      );
    });
  });
});
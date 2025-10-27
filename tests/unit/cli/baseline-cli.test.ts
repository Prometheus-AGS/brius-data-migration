/**
 * Baseline Analysis CLI Tests
 * Tests command parsing, output formatting, and error handling for differential:analyze
 */

import { BaselineCLI, type BaselineOptions, type BaselineOutput } from '../../../src/differential-migration/cli/baseline-cli';
import { BaselineAnalyzer } from '../../../src/differential-migration/services/baseline-analyzer';

// Mock the BaselineAnalyzer service
jest.mock('../../../src/differential-migration/services/baseline-analyzer');

describe('BaselineCLI', () => {
  let cli: BaselineCLI;
  let mockAnalyzer: jest.Mocked<BaselineAnalyzer>;
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

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

    // Mock BaselineAnalyzer
    mockAnalyzer = {
      generateBaselineReport: jest.fn(),
      analyzeEntity: jest.fn(),
      validateMappings: jest.fn(),
      testConnections: jest.fn(),
      close: jest.fn()
    } as any;

    (BaselineAnalyzer as jest.MockedClass<typeof BaselineAnalyzer>).mockImplementation(() => mockAnalyzer);

    cli = new BaselineCLI();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('Command Parsing', () => {
    test('should parse default options correctly', async () => {
      const options = cli.parseArguments([]);

      expect(options.entities).toEqual(['all']);
      expect(options.output).toBe('table');
      expect(options.includeMappings).toBe(false);
      expect(options.verbose).toBe(false);
      expect(options.dryRun).toBe(false);
    });

    test('should parse entity list correctly', async () => {
      const options = cli.parseArguments(['--entities', 'offices,doctors,patients']);

      expect(options.entities).toEqual(['offices', 'doctors', 'patients']);
    });

    test('should parse output format correctly', async () => {
      const tableOptions = cli.parseArguments(['--output', 'table']);
      expect(tableOptions.output).toBe('table');

      const jsonOptions = cli.parseArguments(['--output', 'json']);
      expect(jsonOptions.output).toBe('json');

      const csvOptions = cli.parseArguments(['--output', 'csv']);
      expect(csvOptions.output).toBe('csv');
    });

    test('should parse boolean flags correctly', async () => {
      const options = cli.parseArguments([
        '--include-mappings',
        '--verbose',
        '--dry-run'
      ]);

      expect(options.includeMappings).toBe(true);
      expect(options.verbose).toBe(true);
      expect(options.dryRun).toBe(true);
    });

    test('should handle invalid output format', async () => {
      expect(() => {
        cli.parseArguments(['--output', 'invalid']);
      }).toThrow();
    });

    test('should show help when requested', async () => {
      expect(() => {
        cli.parseArguments(['--help']);
      }).toThrow('Process exit: 0');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('differential:analyze'));
    });
  });

  describe('Database Connection Testing', () => {
    test('should test connections successfully', async () => {
      const mockConnectionResult = {
        sourceConnection: { successful: true, latencyMs: 50 },
        destinationConnection: { successful: true, latencyMs: 75 }
      };

      mockAnalyzer.testConnections.mockResolvedValue(mockConnectionResult);

      const result = await cli.testDatabaseConnections();

      expect(result).toBe(true);
      expect(mockAnalyzer.testConnections).toHaveBeenCalled();
    });

    test('should handle connection failures', async () => {
      const mockConnectionResult = {
        sourceConnection: { successful: false, error: 'Connection refused' },
        destinationConnection: { successful: true, latencyMs: 75 }
      };

      mockAnalyzer.testConnections.mockResolvedValue(mockConnectionResult);

      const result = await cli.testDatabaseConnections();

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Source database connection failed')
      );
    });

    test('should handle connection test exceptions', async () => {
      mockAnalyzer.testConnections.mockRejectedValue(new Error('Network error'));

      const result = await cli.testDatabaseConnections();

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Connection test failed')
      );
    });
  });

  describe('Baseline Analysis Execution', () => {
    test('should execute baseline analysis for all entities', async () => {
      const mockReport = {
        analysisId: 'analysis-123',
        sessionId: 'session-456',
        totalEntities: 3,
        entitiesAnalyzed: ['offices', 'doctors', 'patients'],
        overallStatus: 'gaps_detected' as const,
        entityResults: [
          {
            entityType: 'offices',
            sourceCount: 1234,
            destinationCount: 1234,
            recordGap: 0,
            gapPercentage: 0,
            hasData: true,
            lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z'),
            analysisTimestamp: new Date()
          },
          {
            entityType: 'doctors',
            sourceCount: 5678,
            destinationCount: 5670,
            recordGap: 8,
            gapPercentage: 0.14,
            hasData: true,
            lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z'),
            analysisTimestamp: new Date()
          }
        ],
        mappingValidation: [],
        recommendations: ['8 records behind in doctors entity'],
        summary: {
          totalSourceRecords: 6912,
          totalDestinationRecords: 6904,
          overallGap: 8,
          averageGapPercentage: 0.07,
          entitiesWithGaps: 1
        },
        performanceMetrics: {
          analysisDurationMs: 1500,
          queriesExecuted: 6,
          averageQueryTimeMs: 250
        },
        generatedAt: new Date()
      };

      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockReport);

      const options: BaselineOptions = {
        entities: ['all'],
        output: 'table',
        includeMappings: false,
        verbose: false,
        dryRun: false
      };

      await cli.runAnalysis(options);

      expect(mockAnalyzer.generateBaselineReport).toHaveBeenCalledWith(
        expect.arrayContaining(['offices', 'doctors', 'patients', 'orders', 'cases']),
        expect.any(String)
      );
    });

    test('should execute analysis for specific entities', async () => {
      const mockReport = {
        analysisId: 'analysis-123',
        sessionId: 'session-456',
        totalEntities: 2,
        entitiesAnalyzed: ['offices', 'doctors'],
        overallStatus: 'healthy' as const,
        entityResults: [
          {
            entityType: 'offices',
            sourceCount: 1234,
            destinationCount: 1234,
            recordGap: 0,
            gapPercentage: 0,
            hasData: true,
            lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z'),
            analysisTimestamp: new Date()
          }
        ],
        mappingValidation: [],
        recommendations: ['All entities appear healthy'],
        summary: {
          totalSourceRecords: 1234,
          totalDestinationRecords: 1234,
          overallGap: 0,
          averageGapPercentage: 0,
          entitiesWithGaps: 0
        },
        performanceMetrics: {
          analysisDurationMs: 800,
          queriesExecuted: 4,
          averageQueryTimeMs: 200
        },
        generatedAt: new Date()
      };

      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockReport);

      const options: BaselineOptions = {
        entities: ['offices', 'doctors'],
        output: 'table',
        includeMappings: false,
        verbose: false,
        dryRun: false
      };

      await cli.runAnalysis(options);

      expect(mockAnalyzer.generateBaselineReport).toHaveBeenCalledWith(
        ['offices', 'doctors'],
        expect.any(String)
      );
    });

    test('should handle analysis errors gracefully', async () => {
      mockAnalyzer.generateBaselineReport.mockRejectedValue(
        new Error('Database query failed')
      );

      const options: BaselineOptions = {
        entities: ['offices'],
        output: 'table',
        includeMappings: false,
        verbose: false,
        dryRun: false
      };

      expect(async () => {
        await cli.runAnalysis(options);
      }).rejects.toThrow('Process exit: 3');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Analysis failed: Database query failed')
      );
    });
  });

  describe('Output Formatting', () => {
    const mockReport = {
      analysisId: 'analysis-123',
      sessionId: 'session-456',
      totalEntities: 3,
      entitiesAnalyzed: ['offices', 'doctors', 'patients'],
      overallStatus: 'gaps_detected' as const,
      entityResults: [
        {
          entityType: 'offices',
          sourceCount: 1234,
          destinationCount: 1234,
          recordGap: 0,
          gapPercentage: 0,
          hasData: true,
          lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z'),
          analysisTimestamp: new Date()
        },
        {
          entityType: 'doctors',
          sourceCount: 5678,
          destinationCount: 5670,
          recordGap: 8,
          gapPercentage: 0.14,
          hasData: true,
          lastMigrationTimestamp: new Date('2025-10-25T14:30:00Z'),
          analysisTimestamp: new Date()
        }
      ],
      mappingValidation: [],
      recommendations: ['8 records behind in doctors entity'],
      summary: {
        totalSourceRecords: 6912,
        totalDestinationRecords: 6904,
        overallGap: 8,
        averageGapPercentage: 0.07,
        entitiesWithGaps: 1
      },
      performanceMetrics: {
        analysisDurationMs: 1500,
        queriesExecuted: 6,
        averageQueryTimeMs: 250
      },
      generatedAt: new Date()
    };

    test('should format table output correctly', async () => {
      cli.formatOutput(mockReport, 'table', false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Entity Analysis Summary')
      );
      expect(console.table).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            Entity: 'offices',
            Source: '1,234',
            Dest: '1,234',
            Status: 'synced'
          }),
          expect.objectContaining({
            Entity: 'doctors',
            Source: '5,678',
            Dest: '5,670',
            Status: 'behind'
          })
        ])
      );
    });

    test('should format JSON output correctly', async () => {
      cli.formatOutput(mockReport, 'json', false);

      const jsonOutput = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(jsonOutput).toEqual({
        analysisId: 'analysis-123',
        timestamp: expect.any(String),
        entitySummary: expect.arrayContaining([
          expect.objectContaining({
            entityType: 'offices',
            sourceCount: 1234,
            destinationCount: 1234,
            status: 'synced'
          })
        ]),
        overallStatus: 'gaps_detected',
        totalSourceRecords: 6912,
        totalDestinationRecords: 6904,
        overallGap: 8
      });
    });

    test('should format CSV output correctly', async () => {
      cli.formatOutput(mockReport, 'csv', false);

      const csvOutput = consoleSpy.mock.calls[0][0];

      expect(csvOutput).toContain('Entity,Source,Destination,Gap,Status,Last Migration');
      expect(csvOutput).toContain('offices,1234,1234,0,synced,2025-10-25T14:30:00.000Z');
      expect(csvOutput).toContain('doctors,5678,5670,8,behind,2025-10-25T14:30:00.000Z');
    });

    test('should include verbose information when requested', async () => {
      cli.formatOutput(mockReport, 'table', true);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Performance Metrics')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Analysis Duration: 1,500ms')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Queries Executed: 6')
      );
    });

    test('should display recommendations', async () => {
      cli.formatOutput(mockReport, 'table', false);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recommendations')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('8 records behind in doctors entity')
      );
    });
  });

  describe('Integration and Main Entry Point', () => {
    test('should execute complete workflow successfully', async () => {
      const mockReport = {
        analysisId: 'analysis-123',
        sessionId: 'session-456',
        totalEntities: 1,
        entitiesAnalyzed: ['offices'],
        overallStatus: 'healthy' as const,
        entityResults: [{
          entityType: 'offices',
          sourceCount: 100,
          destinationCount: 100,
          recordGap: 0,
          gapPercentage: 0,
          hasData: true,
          lastMigrationTimestamp: new Date(),
          analysisTimestamp: new Date()
        }],
        mappingValidation: [],
        recommendations: ['All entities appear healthy'],
        summary: {
          totalSourceRecords: 100,
          totalDestinationRecords: 100,
          overallGap: 0,
          averageGapPercentage: 0,
          entitiesWithGaps: 0
        },
        performanceMetrics: {
          analysisDurationMs: 500,
          queriesExecuted: 2,
          averageQueryTimeMs: 250
        },
        generatedAt: new Date()
      };

      mockAnalyzer.testConnections.mockResolvedValue({
        sourceConnection: { successful: true, latencyMs: 50 },
        destinationConnection: { successful: true, latencyMs: 75 }
      });
      mockAnalyzer.generateBaselineReport.mockResolvedValue(mockReport);

      const args = ['--entities', 'offices', '--output', 'table'];

      await cli.main(args);

      expect(mockAnalyzer.testConnections).toHaveBeenCalled();
      expect(mockAnalyzer.generateBaselineReport).toHaveBeenCalled();
      expect(mockAnalyzer.close).toHaveBeenCalled();
    });

    test('should handle dry-run mode', async () => {
      mockAnalyzer.testConnections.mockResolvedValue({
        sourceConnection: { successful: true, latencyMs: 50 },
        destinationConnection: { successful: true, latencyMs: 75 }
      });

      const args = ['--entities', 'offices', '--dry-run'];

      await cli.main(args);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN MODE')
      );
      expect(mockAnalyzer.testConnections).toHaveBeenCalled();
      expect(mockAnalyzer.generateBaselineReport).not.toHaveBeenCalled();
    });

    test('should exit with code 2 on connection failure', async () => {
      mockAnalyzer.testConnections.mockResolvedValue({
        sourceConnection: { successful: false, error: 'Connection refused' },
        destinationConnection: { successful: true, latencyMs: 75 }
      });

      const args = ['--entities', 'offices'];

      expect(async () => {
        await cli.main(args);
      }).rejects.toThrow('Process exit: 2');
    });

    test('should exit with code 1 on invalid arguments', async () => {
      const args = ['--invalid-option'];

      expect(() => {
        cli.main(args);
      }).rejects.toThrow();
    });
  });

  describe('Error Codes and Messages', () => {
    test('should return correct exit codes for different scenarios', async () => {
      // Invalid parameters
      expect(() => {
        cli.parseArguments(['--output', 'invalid']);
      }).toThrow();

      // Database connection failure
      mockAnalyzer.testConnections.mockResolvedValue({
        sourceConnection: { successful: false, error: 'Cannot connect' },
        destinationConnection: { successful: true, latencyMs: 50 }
      });

      expect(async () => {
        await cli.main(['--entities', 'offices']);
      }).rejects.toThrow('Process exit: 2');

      // Analysis failure
      mockAnalyzer.testConnections.mockResolvedValue({
        sourceConnection: { successful: true, latencyMs: 50 },
        destinationConnection: { successful: true, latencyMs: 75 }
      });
      mockAnalyzer.generateBaselineReport.mockRejectedValue(new Error('Query failed'));

      expect(async () => {
        await cli.main(['--entities', 'offices']);
      }).rejects.toThrow('Process exit: 3');
    });

    test('should format error messages consistently', async () => {
      mockAnalyzer.generateBaselineReport.mockRejectedValue(
        new Error('Database timeout')
      );

      const options: BaselineOptions = {
        entities: ['offices'],
        output: 'table',
        includeMappings: false,
        verbose: false,
        dryRun: false
      };

      expect(async () => {
        await cli.runAnalysis(options);
      }).rejects.toThrow('Process exit: 3');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ERROR: Analysis failed for entity \'offices\'')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Details: Database timeout')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Timestamp:')
      );
    });
  });

  describe('Configuration and Environment', () => {
    test('should load configuration from environment', async () => {
      process.env.BATCH_SIZE = '2000';
      process.env.SOURCE_DB_HOST = 'test-source-host';
      process.env.TARGET_DB_HOST = 'test-target-host';

      const newCli = new BaselineCLI();
      const config = newCli.getConfiguration();

      expect(config.batchSize).toBe(2000);
      expect(config.sourceDatabase.host).toBe('test-source-host');
      expect(config.destinationDatabase.host).toBe('test-target-host');

      // Cleanup
      delete process.env.BATCH_SIZE;
      delete process.env.SOURCE_DB_HOST;
      delete process.env.TARGET_DB_HOST;
    });

    test('should support custom config file', async () => {
      const customConfigPath = '/tmp/test-config.env';
      const args = ['--config', customConfigPath, '--entities', 'offices'];

      // This would test config file loading, but we'll mock it
      const configSpy = jest.spyOn(cli, 'loadConfiguration').mockImplementation(() => ({
        batchSize: 500,
        sourceDatabase: { host: 'custom-source' } as any,
        destinationDatabase: { host: 'custom-dest' } as any
      }));

      mockAnalyzer.testConnections.mockResolvedValue({
        sourceConnection: { successful: true, latencyMs: 50 },
        destinationConnection: { successful: true, latencyMs: 75 }
      });

      await cli.main(args);

      expect(configSpy).toHaveBeenCalledWith(customConfigPath);

      configSpy.mockRestore();
    });
  });
});
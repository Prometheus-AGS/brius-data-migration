/**
 * Unit Tests for Migration Script Analyzer Service
 */

import { promises as fs } from 'fs';
import { MigrationScriptAnalyzer, AnalysisOptions } from '../../../src/migration-coverage/services/migration-script-analyzer';
import { DataDomain } from '../../../src/migration-coverage/models';

// Mock fs promises
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn()
  }
}));

const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
const mockReaddir = fs.readdir as jest.MockedFunction<typeof fs.readdir>;

describe('MigrationScriptAnalyzer', () => {
  let analyzer: MigrationScriptAnalyzer;

  beforeEach(() => {
    analyzer = new MigrationScriptAnalyzer('./test-scripts');
    jest.clearAllMocks();
  });

  describe('analyzeAllScripts', () => {
    it('should discover and analyze all migration scripts', async () => {
      // Mock directory structure
      mockReaddir.mockResolvedValueOnce([
        { name: 'migrate-patients.ts', isFile: () => true, isDirectory: () => false } as any,
        { name: 'analyze-orders.ts', isFile: () => true, isDirectory: () => false } as any,
        { name: 'non-migration-file.txt', isFile: () => true, isDirectory: () => false } as any,
        { name: 'subdirectory', isFile: () => false, isDirectory: () => true } as any
      ]);

      // Mock subdirectory content
      mockReaddir.mockResolvedValueOnce([
        { name: 'migrate-doctors.ts', isFile: () => true, isDirectory: () => false } as any
      ]);

      // Mock file contents
      const patientScript = `
        /**
         * Patient Migration Script
         * Migrates dispatch_patient table to modern patients table
         */
        const BATCH_SIZE = 500;

        export async function migratePatients() {
          // Migration logic here
          console.log('Successfully migrated patients');
        }
      `;

      const orderScript = `
        /**
         * Order Analysis Script
         */
        const BATCH_SIZE = 1000;

        // Analyze dispatch_order table
        export function analyzeOrders() {
          // Analysis logic
        }
      `;

      const doctorScript = `
        /**
         * Doctor Migration Script
         */
        export function migrateDoctors() {
          // Doctor migration
        }
      `;

      mockReadFile
        .mockResolvedValueOnce(patientScript)
        .mockResolvedValueOnce(orderScript)
        .mockResolvedValueOnce(doctorScript);

      const results = await analyzer.analyzeAllScripts({
        scanForDependencies: true,
        includeValidation: true
      });

      expect(results).toHaveLength(3);
      expect(results[0].script.name).toBe('migrate-patients');
      expect(results[1].script.name).toBe('analyze-orders');
      expect(results[2].script.name).toBe('migrate-doctors');

      // Results should be sorted by complexity score descending
      expect(results[0].complexityScore).toBeGreaterThanOrEqual(results[1].complexityScore);
    });

    it('should skip non-migration files', async () => {
      mockReaddir.mockResolvedValueOnce([
        { name: 'regular-file.ts', isFile: () => true, isDirectory: () => false } as any,
        { name: 'test-file.test.ts', isFile: () => true, isDirectory: () => false } as any,
        { name: 'README.md', isFile: () => true, isDirectory: () => false } as any
      ]);

      const results = await analyzer.analyzeAllScripts();

      expect(results).toHaveLength(0);
    });

    it('should handle file read errors gracefully', async () => {
      mockReaddir.mockResolvedValueOnce([
        { name: 'migrate-patients.ts', isFile: () => true, isDirectory: () => false } as any
      ]);

      mockReadFile.mockRejectedValueOnce(new Error('File read failed'));

      const results = await analyzer.analyzeAllScripts();

      expect(results).toHaveLength(0); // Failed analysis should be filtered out
    });
  });

  describe('analyzeScript', () => {
    it('should analyze a migration script correctly', async () => {
      const scriptContent = `
        /**
         * Patient Migration Script
         * Migrates patient data from legacy system
         */
        const BATCH_SIZE = 500;

        export async function migratePatients(): Promise<void> {
          try {
            console.log('Starting patient migration');
            // Migration logic with dispatch_patient table
            const patients = await query('SELECT * FROM dispatch_patient');
            console.log(\`Processing \${patients.length} patients\`);

            for (const patient of patients) {
              // Transform and insert patient data
              await insertPatient(patient);
            }

            console.log('Patient migration completed successfully');
          } catch (error) {
            console.error('Migration failed:', error);
            throw error;
          }
        }

        function insertPatient(patient: any) {
          // Insert logic
        }
      `;

      mockReadFile.mockResolvedValueOnce(scriptContent);

      const result = await analyzer.analyzeScript('/test/migrate-patients.ts', {
        scanForDependencies: true,
        includeValidation: true
      });

      expect(result).toBeDefined();
      expect(result!.script.name).toBe('migrate-patients');
      expect(result!.script.category).toBe('core');
      expect(result!.script.domain).toBe(DataDomain.CLINICAL);
      expect(result!.script.description).toContain('patient');
      expect(result!.script.estimatedRecords).toBe(15000); // Default for dispatch_patient
      expect(result!.estimatedRecords).toBeGreaterThan(0);
      expect(result!.complexityScore).toBeGreaterThan(0);
    });

    it('should determine script category correctly', async () => {
      const testCases = [
        { fileName: 'migrate-office.ts', expectedCategory: 'core' },
        { fileName: 'migrate-orders.ts', expectedCategory: 'business' },
        { fileName: 'migrate-messages.ts', expectedCategory: 'communications' },
        { fileName: 'migrate-cases.ts', expectedCategory: 'specialized' },
        { fileName: 'fix-data-issues.ts', expectedCategory: 'critical-fix' },
        { fileName: 'setup-schema.ts', expectedCategory: 'system' }
      ];

      for (const testCase of testCases) {
        mockReadFile.mockResolvedValueOnce('// Test script content');

        const result = await analyzer.analyzeScript(`/test/${testCase.fileName}`);

        expect(result).toBeDefined();
        expect(result!.script.category).toBe(testCase.expectedCategory);
      }
    });

    it('should determine script domain correctly', async () => {
      const testCases = [
        { fileName: 'migrate-patients.ts', expectedDomain: DataDomain.CLINICAL },
        { fileName: 'migrate-doctors.ts', expectedDomain: DataDomain.CLINICAL },
        { fileName: 'migrate-orders.ts', expectedDomain: DataDomain.BUSINESS },
        { fileName: 'migrate-products.ts', expectedDomain: DataDomain.BUSINESS },
        { fileName: 'migrate-messages.ts', expectedDomain: DataDomain.COMMUNICATIONS },
        { fileName: 'migrate-notifications.ts', expectedDomain: DataDomain.COMMUNICATIONS },
        { fileName: 'migrate-schema.ts', expectedDomain: DataDomain.TECHNICAL }
      ];

      for (const testCase of testCases) {
        mockReadFile.mockResolvedValueOnce('// Test script content\ndispatch_');

        const result = await analyzer.analyzeScript(`/test/${testCase.fileName}`);

        expect(result).toBeDefined();
        expect(result!.script.domain).toBe(testCase.expectedDomain);
      }
    });

    it('should extract estimated records from content', async () => {
      const testCases = [
        { content: 'BATCH_SIZE = 1000', expectedRecords: 10000 },
        { content: '25000 records need migration', expectedRecords: 25000 },
        { content: 'dispatch_task table', expectedRecords: 750000 },
        { content: 'dispatch_patient records', expectedRecords: 15000 },
        { content: 'dispatch_order data', expectedRecords: 25000 },
        { content: 'dispatch_case migration', expectedRecords: 8000 }
      ];

      for (const testCase of testCases) {
        mockReadFile.mockResolvedValueOnce(testCase.content);

        const result = await analyzer.analyzeScript('/test/script.ts');

        expect(result).toBeDefined();
        expect(result!.script.estimatedRecords).toBe(testCase.expectedRecords);
      }
    });

    it('should extract dependencies when requested', async () => {
      const scriptContent = `
        // Migration script with dependencies
        const offices = await query('SELECT * FROM offices');
        const doctors = await query('JOIN doctors ON patients.doctor_id = doctors.id');
        const profiles = await query('REFERENCES profiles(id)');
      `;

      mockReadFile.mockResolvedValueOnce(scriptContent);

      const result = await analyzer.analyzeScript('/test/script.ts', {
        scanForDependencies: true
      });

      expect(result).toBeDefined();
      expect(result!.dependencies.length).toBeGreaterThan(0);
      expect(result!.dependencies).toContain('offices');
      expect(result!.dependencies).toContain('doctors');
      expect(result!.dependencies).toContain('profiles');
    });

    it('should calculate complexity score', async () => {
      const complexScript = `
        /**
         * Complex migration script with many operations
         */
        export async function complexMigration() {
          // Multiple SQL operations
          const data1 = await query('SELECT * FROM table1');
          await query('INSERT INTO table2 VALUES (?)');
          await query('UPDATE table3 SET status = ?');
          await query('DELETE FROM table4 WHERE id = ?');

          // Control flow
          if (data1.length > 0) {
            for (const item of data1) {
              if (item.status === 'active') {
                try {
                  await processItem(item);
                } catch (error) {
                  await handleError(error);
                }
              } else {
                await skipItem(item);
              }
            }
          } else {
            throw new Error('No data found');
          }

          // Transaction handling
          await query('BEGIN');
          await query('COMMIT');
        }
      `;

      mockReadFile.mockResolvedValueOnce(complexScript);

      const result = await analyzer.analyzeScript('/test/complex-script.ts', {
        scanForDependencies: true
      });

      expect(result).toBeDefined();
      expect(result!.complexityScore).toBeGreaterThan(10); // Should be fairly complex
    });

    it('should return null for non-existent files', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));

      const result = await analyzer.analyzeScript('/test/non-existent.ts');

      expect(result).toBeNull();
    });
  });

  describe('getScriptMetrics', () => {
    it('should calculate script metrics correctly', async () => {
      const scriptContent = `
        /**
         * Test migration script
         * Multiple lines of code
         */
        import { something } from 'somewhere';

        export async function migrate() {
          const data = await getData();

          if (data.length > 0) {
            for (const item of data) {
              await processItem(item);
            }
          } else {
            console.log('No data');
          }

          return true;
        }

        function processItem(item: any) {
          // Process logic
        }

        function getData() {
          return [];
        }
      `;

      // Mock finding the script
      mockReaddir.mockResolvedValueOnce([
        { name: 'test-script.ts', isFile: () => true, isDirectory: () => false } as any
      ]);

      mockReadFile.mockResolvedValueOnce(scriptContent);

      const metrics = await analyzer.getScriptMetrics('test-script');

      expect(metrics).toBeDefined();
      expect(metrics!.linesOfCode).toBeGreaterThan(0);
      expect(metrics!.cyclomaticComplexity).toBeGreaterThan(1); // Has if and for statements
      expect(metrics!.maintainabilityIndex).toBeGreaterThan(0);
      expect(metrics!.maintainabilityIndex).toBeLessThanOrEqual(171);
    });

    it('should return null for non-existent scripts', async () => {
      mockReaddir.mockResolvedValueOnce([]);

      const metrics = await analyzer.getScriptMetrics('non-existent-script');

      expect(metrics).toBeNull();
    });
  });

  describe('complexity calculations', () => {
    it('should calculate cyclomatic complexity correctly', () => {
      const analyzer = new MigrationScriptAnalyzer();
      const calculateComplexity = (analyzer as any).calculateCyclomaticComplexity;

      const testCases = [
        { code: 'console.log("hello");', expectedComplexity: 1 }, // Base complexity
        { code: 'if (true) { console.log("test"); }', expectedComplexity: 2 }, // +1 for if
        { code: 'if (true) { } else if (false) { }', expectedComplexity: 3 }, // +1 for if, +1 for else if
        { code: 'while (true) { break; }', expectedComplexity: 2 }, // +1 for while
        { code: 'for (let i = 0; i < 10; i++) { }', expectedComplexity: 2 }, // +1 for for
        { code: 'try { } catch (e) { }', expectedComplexity: 2 }, // +1 for catch
        { code: 'const result = condition ? "yes" : "no";', expectedComplexity: 2 } // +1 for ternary
      ];

      testCases.forEach(({ code, expectedComplexity }) => {
        const complexity = calculateComplexity(code);
        expect(complexity).toBe(expectedComplexity);
      });
    });

    it('should estimate Halstead volume', () => {
      const analyzer = new MigrationScriptAnalyzer();
      const estimateVolume = (analyzer as any).estimateHalsteadVolume;

      const simpleCode = 'const a = b + c;';
      const volume = estimateVolume(simpleCode);

      expect(volume).toBeGreaterThan(0);
      expect(typeof volume).toBe('number');
    });

    it('should calculate maintainability index', () => {
      const analyzer = new MigrationScriptAnalyzer();
      const calculateMI = (analyzer as any).calculateMaintainabilityIndex;

      const simpleCode = 'console.log("hello world");';
      const linesOfCode = 1;

      const mi = calculateMI(simpleCode, linesOfCode);

      expect(mi).toBeGreaterThan(0);
      expect(mi).toBeLessThanOrEqual(171);
    });
  });

  describe('directory scanning', () => {
    it('should skip node_modules and other excluded directories', async () => {
      mockReaddir.mockResolvedValueOnce([
        { name: 'node_modules', isFile: () => false, isDirectory: () => true } as any,
        { name: '.git', isFile: () => false, isDirectory: () => true } as any,
        { name: 'dist', isFile: () => false, isDirectory: () => true } as any,
        { name: 'src', isFile: () => false, isDirectory: () => true } as any
      ]);

      mockReaddir.mockResolvedValueOnce([
        { name: 'migrate-test.ts', isFile: () => true, isDirectory: () => false } as any
      ]);

      mockReadFile.mockResolvedValueOnce('// test migration script');

      const results = await analyzer.analyzeAllScripts();

      // Should only scan 'src' directory, skip excluded ones
      expect(mockReaddir).toHaveBeenCalledTimes(2); // Root + src directory
      expect(results).toHaveLength(1);
    });

    it('should identify migration scripts by filename patterns', () => {
      const analyzer = new MigrationScriptAnalyzer();
      const isMigrationScript = (analyzer as any).isMigrationScript;

      const testCases = [
        { fileName: 'migrate-patients.ts', expected: true },
        { fileName: 'analyze-orders.ts', expected: true },
        { fileName: 'dispatch-migration.ts', expected: true },
        { fileName: 'regular-file.ts', expected: false },
        { fileName: 'test-file.test.ts', expected: false },
        { fileName: 'migrate-data.js', expected: false }, // Only .ts files
        { fileName: 'README.md', expected: false }
      ];

      testCases.forEach(({ fileName, expected }) => {
        const result = isMigrationScript(fileName);
        expect(result).toBe(expected);
      });
    });
  });

  describe('error handling', () => {
    it('should handle directory read errors', async () => {
      mockReaddir.mockRejectedValueOnce(new Error('Permission denied'));

      const results = await analyzer.analyzeAllScripts();

      expect(results).toEqual([]);
    });

    it('should handle file content parsing errors', async () => {
      mockReaddir.mockResolvedValueOnce([
        { name: 'corrupt-script.ts', isFile: () => true, isDirectory: () => false } as any
      ]);

      mockReadFile.mockResolvedValueOnce('invalid syntax {{{ corrupted file');

      const results = await analyzer.analyzeAllScripts();

      // Should handle the error gracefully and continue
      expect(results).toHaveLength(0);
    });
  });

  describe('status determination', () => {
    it('should determine script status from content', () => {
      const analyzer = new MigrationScriptAnalyzer();
      const determineStatus = (analyzer as any).determineStatus;

      const testCases = [
        { content: '// TODO: Implement migration', expectedStatus: 'pending' },
        { content: '// FIXME: Handle edge case', expectedStatus: 'pending' },
        { content: 'console.log("migrated successfully");', expectedStatus: 'completed' },
        { content: 'try { migrate(); } catch (error) { }', expectedStatus: 'in_progress' },
        { content: 'const data = getData();', expectedStatus: 'pending' }
      ];

      testCases.forEach(({ content, expectedStatus }) => {
        const status = determineStatus(content);
        expect(status).toBe(expectedStatus);
      });
    });
  });
});
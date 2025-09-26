// Contract test for Data Validation CLI
// Tests the command-line interface contracts for data validation operations
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';

const CLI_PATH = resolve(__dirname, '../../src/data-validator.ts');

describe('Data Validation CLI Contract Tests', () => {
  beforeAll(() => {
    // Ensure we have a clean test environment
    process.env.NODE_ENV = 'test';
  });

  describe('validate command', () => {
    it('should accept required parameters for validation', async () => {
      const command = `npx ts-node ${CLI_PATH} validate --entities offices --type data_integrity`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).not.toThrow();
    });

    it('should accept all valid validation types', async () => {
      const validTypes = ['data_integrity', 'relationship_integrity', 'completeness_check', 'performance_check'];

      for (const type of validTypes) {
        const command = `npx ts-node ${CLI_PATH} validate --entities offices --type ${type}`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 15000
          });
        }).not.toThrow();
      }
    });

    it('should reject invalid validation types', async () => {
      const invalidTypes = ['invalid_type', 'wrong', ''];

      for (const type of invalidTypes) {
        const command = `npx ts-node ${CLI_PATH} validate --entities offices --type ${type}`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        }).toThrow();
      }
    });

    it('should accept multiple entities', async () => {
      const entityLists = [
        'offices',
        'offices,doctors',
        'offices,doctors,patients',
        'offices,profiles,doctors,patients,orders'
      ];

      for (const entities of entityLists) {
        const command = `npx ts-node ${CLI_PATH} validate --entities ${entities} --type completeness_check`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 15000
          });
        }).not.toThrow();
      }
    });

    it('should accept optional sampling-rate parameter', async () => {
      const validRates = [0.1, 0.5, 1.0];

      for (const rate of validRates) {
        const command = `npx ts-node ${CLI_PATH} validate --entities offices --type data_integrity --sampling-rate ${rate}`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 15000
          });
        }).not.toThrow();
      }
    });

    it('should validate sampling-rate is within acceptable range', async () => {
      const invalidRates = [0, 1.1, -0.1, 2.0];

      for (const rate of invalidRates) {
        const command = `npx ts-node ${CLI_PATH} validate --entities offices --type data_integrity --sampling-rate ${rate}`;

        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        }).toThrow();
      }
    });

    it('should support verbose output mode', async () => {
      const command = `npx ts-node ${CLI_PATH} validate --entities offices --type data_integrity --verbose`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 15000
      });

      expect(result).toContain('Validation started');
      expect(result).toContain('Processing entity:');
    });

    it('should return structured validation result', async () => {
      const command = `npx ts-node ${CLI_PATH} validate --entities offices --type completeness_check --format json`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 15000
      });

      expect(() => JSON.parse(result)).not.toThrow();
      const output = JSON.parse(result);
      expect(output).toHaveProperty('validationId');
      expect(output).toHaveProperty('validationType', 'completeness_check');
      expect(output).toHaveProperty('recordsValidated');
      expect(output).toHaveProperty('validationPassed');
      expect(output).toHaveProperty('discrepanciesFound');
      expect(output).toHaveProperty('executionTime');
      expect(output).toHaveProperty('reports');
      expect(output).toHaveProperty('generatedAt');
      expect(Array.isArray(output.reports)).toBe(true);
    });
  });

  describe('report command', () => {
    it('should generate comprehensive validation report', async () => {
      const command = `npx ts-node ${CLI_PATH} report --comprehensive`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 20000
        });
      }).not.toThrow();
    });

    it('should support output to file', async () => {
      const outputFile = '/tmp/validation-report.json';
      const command = `npx ts-node ${CLI_PATH} report --comprehensive --output ${outputFile}`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 20000
        });
      }).not.toThrow();

      // Verify file was created
      expect(() => {
        execSync(`test -f ${outputFile}`, { stdio: 'pipe' });
      }).not.toThrow();
    });

    it('should support filtering by entity', async () => {
      const command = `npx ts-node ${CLI_PATH} report --entity offices`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).not.toThrow();
    });

    it('should support filtering by validation type', async () => {
      const command = `npx ts-node ${CLI_PATH} report --type data_integrity`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 15000
        });
      }).not.toThrow();
    });
  });

  describe('check-record command', () => {
    it('should validate individual record by entity and legacy ID', async () => {
      const command = `npx ts-node ${CLI_PATH} check-record --entity offices --legacy-id 1`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });

    it('should return detailed record validation result', async () => {
      const command = `npx ts-node ${CLI_PATH} check-record --entity offices --legacy-id 1 --format json`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 10000
      });

      expect(() => JSON.parse(result)).not.toThrow();
      const output = JSON.parse(result);
      expect(output).toHaveProperty('entity', 'offices');
      expect(output).toHaveProperty('legacyId', '1');
      expect(output).toHaveProperty('exists');
      expect(output).toHaveProperty('validation');
      expect(typeof output.exists).toBe('boolean');
    });

    it('should handle non-existent records gracefully', async () => {
      const command = `npx ts-node ${CLI_PATH} check-record --entity offices --legacy-id 999999`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).not.toThrow();
    });
  });

  describe('performance validation', () => {
    it('should validate performance for large datasets', async () => {
      const command = `npx ts-node ${CLI_PATH} validate --entities orders --type performance_check --max-records 10000`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 30000
        });
      }).not.toThrow();
    });

    it('should respect timeout parameter', async () => {
      const command = `npx ts-node ${CLI_PATH} validate --entities offices --type data_integrity --timeout 5000`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 8000
        });
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error messages for missing required parameters', async () => {
      const incompleteCommands = [
        `npx ts-node ${CLI_PATH} validate`,
        `npx ts-node ${CLI_PATH} validate --entities offices`,
        `npx ts-node ${CLI_PATH} validate --type data_integrity`,
        `npx ts-node ${CLI_PATH} check-record`,
        `npx ts-node ${CLI_PATH} check-record --entity offices`
      ];

      for (const command of incompleteCommands) {
        expect(() => {
          execSync(command, {
            stdio: 'pipe',
            cwd: resolve(__dirname, '../..'),
            timeout: 5000
          });
        }).toThrow();
      }
    });

    it('should handle database connection errors gracefully', async () => {
      // Temporarily set invalid database config
      const originalHost = process.env.TARGET_DB_HOST;
      process.env.TARGET_DB_HOST = 'invalid-host';

      const command = `npx ts-node ${CLI_PATH} validate --entities offices --type data_integrity`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).toThrow();

      // Restore original config
      process.env.TARGET_DB_HOST = originalHost;
    });

    it('should validate entity names exist', async () => {
      const command = `npx ts-node ${CLI_PATH} validate --entities invalid_entity --type data_integrity`;

      expect(() => {
        execSync(command, {
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 10000
        });
      }).toThrow();
    });
  });

  describe('help command', () => {
    it('should display help information', async () => {
      const command = `npx ts-node ${CLI_PATH} --help`;

      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 5000
      });

      expect(result).toContain('validate');
      expect(result).toContain('report');
      expect(result).toContain('check-record');
      expect(result).toContain('--entities');
      expect(result).toContain('--type');
      expect(result).toContain('--sampling-rate');
      expect(result).toContain('--verbose');
    });
  });
});
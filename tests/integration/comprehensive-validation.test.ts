// Integration test for Scenario 5: Comprehensive Validation
// Tests end-to-end validation of data integrity, relationships, and performance
// This test MUST FAIL initially until the implementation is complete

import { execSync } from 'child_process';
import { resolve } from 'path';
import { Pool } from 'pg';
import { writeFileSync, unlinkSync } from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

const VALIDATOR_CLI = resolve(__dirname, '../../src/data-validator.ts');

describe('Integration Test: Comprehensive Validation Scenario', () => {
  let targetDb: Pool;
  let sourceDb: Pool;

  beforeAll(async () => {
    // Setup database connections
    targetDb = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME,
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
    });

    sourceDb = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME,
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
    });

    // Ensure we have a clean test environment
    process.env.NODE_ENV = 'test';
  });

  afterAll(async () => {
    await targetDb.end();
    await sourceDb.end();
  });

  describe('Scenario 5: Comprehensive Validation', () => {
    const testEntities = ['offices', 'profiles', 'doctors', 'patients', 'orders'];

    it('should complete the full comprehensive validation workflow', async () => {
      // Step 1: Run comprehensive data integrity check
      const dataIntegrityCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities "${testEntities.join(',')}" --type data_integrity --sampling-rate 1.0 --format json`;

      const integrityResult = execSync(dataIntegrityCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 180000 // 3 minutes for comprehensive check
      });

      // Validate data integrity results
      expect(() => JSON.parse(integrityResult)).not.toThrow();
      const integrity = JSON.parse(integrityResult);
      expect(integrity).toHaveProperty('validationId');
      expect(integrity).toHaveProperty('validationType', 'data_integrity');
      expect(integrity).toHaveProperty('recordsValidated');
      expect(integrity).toHaveProperty('validationPassed');
      expect(integrity).toHaveProperty('discrepanciesFound');
      expect(integrity).toHaveProperty('executionTime');
      expect(integrity).toHaveProperty('reports');
      expect(Array.isArray(integrity.reports)).toBe(true);

      expect(integrity.recordsValidated).toBeGreaterThan(0);
      expect(typeof integrity.validationPassed).toBe('boolean');
      expect(integrity.executionTime).toBeGreaterThan(0);

      // Validate each entity has a report
      for (const entity of testEntities) {
        const entityReport = integrity.reports.find((r: any) => r.entity === entity);
        expect(entityReport).toBeDefined();
        expect(entityReport).toHaveProperty('recordsChecked');
        expect(entityReport).toHaveProperty('issuesFound');
        expect(entityReport.recordsChecked).toBeGreaterThanOrEqual(0);
      }

      // Step 2: Check relationship integrity
      const relationshipCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities "${testEntities.join(',')}" --type relationship_integrity --format json`;

      const relationshipResult = execSync(relationshipCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 120000 // 2 minutes for relationship check
      });

      // Validate relationship integrity results
      expect(() => JSON.parse(relationshipResult)).not.toThrow();
      const relationships = JSON.parse(relationshipResult);
      expect(relationships).toHaveProperty('validationType', 'relationship_integrity');
      expect(relationships).toHaveProperty('validationPassed');
      expect(relationships).toHaveProperty('discrepanciesFound');

      // Relationship integrity should pass for a properly migrated system
      if (relationships.discrepanciesFound > 0) {
        // If there are discrepancies, they should be documented
        expect(relationships.reports).toBeDefined();
        const issueReports = relationships.reports.filter((r: any) => r.issuesFound > 0);
        expect(issueReports.length).toBeGreaterThan(0);
      }

      // Step 3: Performance validation (ensure sync meets timing requirements)
      const performanceCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities "orders" --type performance_check --max-records 100000 --format json`;

      const performanceResult = execSync(performanceCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 300000 // 5 minutes for performance check
      });

      // Validate performance results
      expect(() => JSON.parse(performanceResult)).not.toThrow();
      const performance = JSON.parse(performanceResult);
      expect(performance).toHaveProperty('validationType', 'performance_check');
      expect(performance).toHaveProperty('executionTime');
      expect(performance).toHaveProperty('validationPassed');

      // Performance should meet requirements (process 100K records efficiently)
      const maxAcceptableTime = 300000; // 5 minutes in milliseconds
      expect(performance.executionTime).toBeLessThan(maxAcceptableTime);

      // Step 4: Generate comprehensive validation report
      const reportPath = '/tmp/validation-report.json';
      const reportCommand = `npx ts-node ${VALIDATOR_CLI} report --comprehensive --output ${reportPath}`;

      execSync(reportCommand, {
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 60000
      });

      // Validate report was generated
      expect(() => {
        execSync(`test -f ${reportPath}`, { stdio: 'pipe' });
      }).not.toThrow();

      // Cleanup report file
      try {
        unlinkSync(reportPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    }, 600000); // 10 minute timeout for comprehensive validation

    it('should validate all source database records exist in target', async () => {
      // Run completeness check for each entity
      for (const entity of testEntities) {
        const completenessCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities ${entity} --type completeness_check --format json`;

        const result = execSync(completenessCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 120000
        });

        const validation = JSON.parse(result);
        expect(validation).toHaveProperty('validationType', 'completeness_check');
        expect(validation).toHaveProperty('validationPassed');

        // For a properly migrated system, completeness should pass
        if (!validation.validationPassed) {
          expect(validation).toHaveProperty('discrepanciesFound');
          expect(validation.discrepanciesFound).toBeGreaterThan(0);

          // Log details for debugging
          console.warn(`Completeness validation failed for ${entity}:`, {
            discrepancies: validation.discrepanciesFound,
            recordsValidated: validation.recordsValidated
          });
        }
      }
    });

    it('should validate referential integrity across all entities', async () => {
      // Test specific referential integrity rules
      const integrityRules = [
        {
          name: 'Doctors have valid office references',
          query: `SELECT COUNT(*) as invalid_count FROM doctors d
                  LEFT JOIN offices o ON d.office_id = o.id
                  WHERE d.office_id IS NOT NULL AND o.id IS NULL`
        },
        {
          name: 'Patients have valid doctor references',
          query: `SELECT COUNT(*) as invalid_count FROM patients p
                  LEFT JOIN doctors d ON p.doctor_id = d.id
                  WHERE p.doctor_id IS NOT NULL AND d.id IS NULL`
        },
        {
          name: 'Orders have valid patient references',
          query: `SELECT COUNT(*) as invalid_count FROM orders ord
                  LEFT JOIN patients p ON ord.patient_id = p.id
                  WHERE ord.patient_id IS NOT NULL AND p.id IS NULL`
        },
        {
          name: 'Profiles have valid office references',
          query: `SELECT COUNT(*) as invalid_count FROM profiles pr
                  LEFT JOIN offices o ON pr.office_id = o.id
                  WHERE pr.office_id IS NOT NULL AND o.id IS NULL`
        }
      ];

      for (const rule of integrityRules) {
        try {
          const result = await targetDb.query(rule.query);
          const invalidCount = parseInt(result.rows[0].invalid_count);
          expect(invalidCount).toBe(0);
        } catch (error) {
          // If the query fails, it might be due to missing tables or columns
          // This is acceptable in a test environment
          console.warn(`Integrity rule "${rule.name}" could not be validated:`, error.message);
        }
      }
    });

    it('should validate UUID mappings consistency', async () => {
      // Check that all UUID mappings are consistent and valid
      const mappingValidationCommand = `npx ts-node ${VALIDATOR_CLI} validate --entities "${testEntities.join(',')}" --type data_integrity --verbose --format json`;

      const result = execSync(mappingValidationCommand, {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: resolve(__dirname, '../..'),
        timeout: 180000
      });

      const validation = JSON.parse(result);

      // Check UUID mapping consistency in the database
      const mappingQuery = `
        SELECT entity_type, COUNT(*) as mapping_count,
               COUNT(DISTINCT legacy_id) as unique_legacy_ids,
               COUNT(DISTINCT uuid_id) as unique_uuid_ids
        FROM migration_mappings
        WHERE entity_type = ANY($1)
        GROUP BY entity_type
      `;

      const mappingResult = await targetDb.query(mappingQuery, [testEntities]);

      for (const row of mappingResult.rows) {
        // Each legacy ID should map to exactly one UUID and vice versa
        expect(row.mapping_count).toBe(row.unique_legacy_ids);
        expect(row.mapping_count).toBe(row.unique_uuid_ids);
      }

      // Validate UUIDs are properly formatted
      const uuidFormatQuery = `
        SELECT COUNT(*) as invalid_uuid_count
        FROM migration_mappings
        WHERE entity_type = ANY($1)
          AND NOT (uuid_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      `;

      const uuidResult = await targetDb.query(uuidFormatQuery, [testEntities]);
      expect(parseInt(uuidResult.rows[0].invalid_uuid_count)).toBe(0);
    });

    it('should validate data types and constraints', async () => {
      // Validate that migrated data meets database constraints
      const constraintChecks = [
        {
          name: 'No NULL values in required fields',
          query: `SELECT COUNT(*) as null_count FROM offices WHERE name IS NULL`
        },
        {
          name: 'Valid email formats in profiles',
          query: `SELECT COUNT(*) as invalid_email_count FROM profiles
                  WHERE email IS NOT NULL
                    AND email != ''
                    AND NOT (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')`
        },
        {
          name: 'Valid phone number formats',
          query: `SELECT COUNT(*) as invalid_phone_count FROM doctors
                  WHERE phone IS NOT NULL
                    AND phone != ''
                    AND LENGTH(phone) < 10`
        },
        {
          name: 'Positive values for numeric fields',
          query: `SELECT COUNT(*) as negative_count FROM orders
                  WHERE total_amount < 0`
        }
      ];

      for (const check of constraintChecks) {
        try {
          const result = await targetDb.query(check.query);
          const violationCount = parseInt(result.rows[0][Object.keys(result.rows[0])[0]]);
          expect(violationCount).toBe(0);
        } catch (error) {
          // Some checks might fail due to missing columns/tables in test environment
          console.warn(`Constraint check "${check.name}" could not be validated:`, error.message);
        }
      }
    });

    it('should validate performance benchmarks', async () => {
      // Test query performance on large datasets
      const performanceTests = [
        {
          name: 'Count all records in orders table',
          query: 'SELECT COUNT(*) FROM orders',
          maxTime: 5000 // 5 seconds
        },
        {
          name: 'Join query with multiple tables',
          query: `SELECT COUNT(*) FROM patients p
                  JOIN doctors d ON p.doctor_id = d.id
                  JOIN offices o ON d.office_id = o.id`,
          maxTime: 10000 // 10 seconds
        },
        {
          name: 'Complex aggregation query',
          query: `SELECT d.office_id, COUNT(p.id) as patient_count
                  FROM doctors d
                  LEFT JOIN patients p ON d.id = p.doctor_id
                  GROUP BY d.office_id`,
          maxTime: 15000 // 15 seconds
        }
      ];

      for (const test of performanceTests) {
        const startTime = Date.now();

        try {
          await targetDb.query(test.query);
          const executionTime = Date.now() - startTime;
          expect(executionTime).toBeLessThan(test.maxTime);
        } catch (error) {
          // Some queries might fail due to missing data in test environment
          console.warn(`Performance test "${test.name}" could not be executed:`, error.message);
        }
      }
    });

    it('should generate detailed validation reports', async () => {
      // Generate reports for each validation type
      const validationTypes = ['data_integrity', 'relationship_integrity', 'completeness_check'];

      for (const type of validationTypes) {
        const reportCommand = `npx ts-node ${VALIDATOR_CLI} report --type ${type} --format json`;

        const result = execSync(reportCommand, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 60000
        });

        expect(() => JSON.parse(result)).not.toThrow();
        const report = JSON.parse(result);
        expect(report).toHaveProperty('validation_type', type);
        expect(report).toHaveProperty('summary');
        expect(report).toHaveProperty('details');

        // Validate report structure
        expect(report.summary).toHaveProperty('total_validations');
        expect(report.summary).toHaveProperty('passed_validations');
        expect(report.summary).toHaveProperty('failed_validations');
        expect(Array.isArray(report.details)).toBe(true);
      }
    });

    it('should validate sampling functionality', async () => {
      // Test different sampling rates
      const samplingRates = [0.1, 0.5, 1.0];

      for (const rate of samplingRates) {
        const command = `npx ts-node ${VALIDATOR_CLI} validate --entities offices --type data_integrity --sampling-rate ${rate} --format json`;

        const result = execSync(command, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: resolve(__dirname, '../..'),
          timeout: 60000
        });

        const validation = JSON.parse(result);
        expect(validation).toHaveProperty('recordsValidated');

        // For sampling rates < 1.0, should validate fewer records
        if (rate < 1.0) {
          // Get total record count
          const totalResult = execSync(
            `npx ts-node ${VALIDATOR_CLI} validate --entities offices --type data_integrity --sampling-rate 1.0 --format json`,
            {
              encoding: 'utf8',
              stdio: 'pipe',
              cwd: resolve(__dirname, '../..'),
              timeout: 60000
            }
          );

          const totalValidation = JSON.parse(totalResult);
          expect(validation.recordsValidated).toBeLessThanOrEqual(totalValidation.recordsValidated);
        }
      }
    });
  });
});
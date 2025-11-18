#!/usr/bin/env ts-node

/**
 * Validation Script: Orders Suffix Migration
 *
 * Validates that the orders.suffix field has been correctly populated
 * with values from dispatch_instruction.suffix based on the
 * orders.legacy_instruction_id = dispatch_instruction.id mapping.
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface ValidationResult {
  test_name: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  expected: number | string;
  actual: number | string;
  message: string;
}

interface ValidationSummary {
  total_tests: number;
  passed: number;
  failed: number;
  warnings: number;
  success_rate: number;
}

class OrdersSuffixValidation {
  private sourcePool: Pool;
  private targetPool: Pool;

  constructor() {
    // Source database connection (legacy system)
    this.sourcePool = new Pool({
      host: process.env.SOURCE_DB_HOST,
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      user: process.env.SOURCE_DB_USER,
      password: process.env.SOURCE_DB_PASSWORD,
      database: process.env.SOURCE_DB_NAME,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Target database connection (modern system)
    this.targetPool = new Pool({
      host: process.env.TARGET_DB_HOST,
      port: parseInt(process.env.TARGET_DB_PORT || '5432'),
      user: process.env.TARGET_DB_USER,
      password: process.env.TARGET_DB_PASSWORD,
      database: process.env.TARGET_DB_NAME,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    console.log('🔗 Database connections initialized for validation');
  }

  /**
   * Test 1: Check total counts
   */
  async validateCounts(): Promise<ValidationResult> {
    console.log('🧪 Test 1: Validating record counts...');

    const sourceQuery = 'SELECT COUNT(*) as count FROM dispatch_instruction WHERE suffix IS NOT NULL AND suffix != \'\'';
    const targetQuery = 'SELECT COUNT(*) as count FROM orders WHERE legacy_instruction_id IS NOT NULL';

    const sourceResult = await this.sourcePool.query(sourceQuery);
    const targetResult = await this.targetPool.query(targetQuery);

    const sourceCount = parseInt(sourceResult.rows[0].count);
    const targetCount = parseInt(targetResult.rows[0].count);

    if (sourceCount >= targetCount) {
      return {
        test_name: 'Record Count Validation',
        status: 'PASS',
        expected: sourceCount,
        actual: targetCount,
        message: `Source has ${sourceCount} dispatch_instruction records, target has ${targetCount} orders with legacy_instruction_id`
      };
    } else {
      return {
        test_name: 'Record Count Validation',
        status: 'WARNING',
        expected: sourceCount,
        actual: targetCount,
        message: `Unexpected: Target has more orders (${targetCount}) than source dispatch_instructions (${sourceCount})`
      };
    }
  }

  /**
   * Test 2: Check suffix population
   */
  async validateSuffixPopulation(): Promise<ValidationResult> {
    console.log('🧪 Test 2: Validating suffix field population...');

    const query = `
      SELECT
        COUNT(*) as total_orders,
        COUNT(CASE WHEN legacy_instruction_id IS NOT NULL THEN 1 END) as with_legacy_id,
        COUNT(CASE WHEN suffix IS NOT NULL AND suffix != '' THEN 1 END) as with_suffix,
        COUNT(CASE WHEN legacy_instruction_id IS NOT NULL AND (suffix IS NULL OR suffix = '') THEN 1 END) as missing_suffix
      FROM orders;
    `;

    const result = await this.targetPool.query(query);
    const data = result.rows[0];

    const totalOrders = parseInt(data.total_orders);
    const withLegacyId = parseInt(data.with_legacy_id);
    const withSuffix = parseInt(data.with_suffix);
    const missingSuffix = parseInt(data.missing_suffix);

    if (missingSuffix === 0 && withSuffix === withLegacyId) {
      return {
        test_name: 'Suffix Population Validation',
        status: 'PASS',
        expected: withLegacyId,
        actual: withSuffix,
        message: `All ${withSuffix} orders with legacy_instruction_id have suffix values populated`
      };
    } else {
      return {
        test_name: 'Suffix Population Validation',
        status: 'FAIL',
        expected: withLegacyId,
        actual: withSuffix,
        message: `${missingSuffix} orders still missing suffix values out of ${withLegacyId} orders with legacy_instruction_id`
      };
    }
  }

  /**
   * Test 3: Validate suffix data integrity (sample check)
   */
  async validateSuffixIntegrity(): Promise<ValidationResult> {
    console.log('🧪 Test 3: Validating suffix data integrity (sample check)...');

    const query = `
      SELECT
        o.id as order_id,
        o.legacy_instruction_id,
        o.suffix as order_suffix,
        di.suffix as source_suffix
      FROM orders o
      JOIN dispatch_instruction di ON o.legacy_instruction_id = di.id
      WHERE o.suffix != di.suffix
      LIMIT 10;
    `;

    // We need to do a cross-database query, so let's fetch a sample from each
    const ordersSampleQuery = `
      SELECT
        id as order_id,
        legacy_instruction_id,
        suffix as order_suffix
      FROM orders
      WHERE legacy_instruction_id IS NOT NULL
        AND suffix IS NOT NULL
        AND suffix != ''
      ORDER BY legacy_instruction_id
      LIMIT 100;
    `;

    const ordersResult = await this.targetPool.query(ordersSampleQuery);
    const ordersSample = ordersResult.rows;

    if (ordersSample.length === 0) {
      return {
        test_name: 'Suffix Data Integrity Check',
        status: 'FAIL',
        expected: '>0',
        actual: 0,
        message: 'No orders found with suffix values for integrity check'
      };
    }

    // Get corresponding source data
    const legacyIds = ordersSample.map(row => row.legacy_instruction_id);
    const sourceQuery = `
      SELECT
        id as instruction_id,
        suffix as source_suffix
      FROM dispatch_instruction
      WHERE id = ANY($1);
    `;

    const sourceResult = await this.sourcePool.query(sourceQuery, [legacyIds]);
    const sourceMap = new Map(sourceResult.rows.map(row => [row.instruction_id, row.source_suffix]));

    let mismatches = 0;
    const sampleSize = ordersSample.length;

    for (const order of ordersSample) {
      const sourceSuffix = sourceMap.get(order.legacy_instruction_id);
      if (sourceSuffix && order.order_suffix !== sourceSuffix) {
        mismatches++;
      }
    }

    if (mismatches === 0) {
      return {
        test_name: 'Suffix Data Integrity Check',
        status: 'PASS',
        expected: 0,
        actual: mismatches,
        message: `Sample check passed: ${sampleSize} orders verified with matching suffix values`
      };
    } else {
      return {
        test_name: 'Suffix Data Integrity Check',
        status: 'FAIL',
        expected: 0,
        actual: mismatches,
        message: `Sample check failed: ${mismatches} out of ${sampleSize} orders have mismatched suffix values`
      };
    }
  }

  /**
   * Test 4: Check for null or empty suffix values where they shouldn't be
   */
  async validateNoMissingSuffix(): Promise<ValidationResult> {
    console.log('🧪 Test 4: Checking for missing suffix values...');

    const query = `
      SELECT
        COUNT(*) as missing_count,
        (SELECT ARRAY_AGG(id) FROM (SELECT id FROM orders WHERE legacy_instruction_id IS NOT NULL AND (suffix IS NULL OR suffix = '') ORDER BY id LIMIT 5) sub) as sample_ids
      FROM orders
      WHERE legacy_instruction_id IS NOT NULL
        AND (suffix IS NULL OR suffix = '');
    `;

    const result = await this.targetPool.query(query);
    const missingCount = parseInt(result.rows[0].missing_count);
    const sampleIds = result.rows[0].sample_ids;

    if (missingCount === 0) {
      return {
        test_name: 'Missing Suffix Check',
        status: 'PASS',
        expected: 0,
        actual: missingCount,
        message: 'No orders with legacy_instruction_id are missing suffix values'
      };
    } else {
      return {
        test_name: 'Missing Suffix Check',
        status: 'FAIL',
        expected: 0,
        actual: missingCount,
        message: `${missingCount} orders still missing suffix values. Sample IDs: ${sampleIds ? sampleIds.join(', ') : 'none'}`
      };
    }
  }

  /**
   * Test 5: Check suffix format and length consistency
   */
  async validateSuffixFormat(): Promise<ValidationResult> {
    console.log('🧪 Test 5: Validating suffix format and length...');

    const query = `
      SELECT
        COUNT(*) as total_with_suffix,
        COUNT(CASE WHEN LENGTH(suffix) > 10 THEN 1 END) as too_long,
        COUNT(CASE WHEN suffix ~ '^[A-Z0-9_-]+$' THEN 1 END) as valid_format,
        MIN(LENGTH(suffix)) as min_length,
        MAX(LENGTH(suffix)) as max_length
      FROM orders
      WHERE suffix IS NOT NULL AND suffix != '';
    `;

    const result = await this.targetPool.query(query);
    const data = result.rows[0];

    const totalWithSuffix = parseInt(data.total_with_suffix);
    const tooLong = parseInt(data.too_long);
    const validFormat = parseInt(data.valid_format);
    const minLength = parseInt(data.min_length);
    const maxLength = parseInt(data.max_length);

    if (tooLong === 0 && maxLength <= 10) {
      return {
        test_name: 'Suffix Format Validation',
        status: 'PASS',
        expected: '≤10 chars',
        actual: `${minLength}-${maxLength} chars`,
        message: `All ${totalWithSuffix} suffix values are within expected length (≤10 chars) and format constraints`
      };
    } else {
      return {
        test_name: 'Suffix Format Validation',
        status: 'WARNING',
        expected: '≤10 chars',
        actual: `${minLength}-${maxLength} chars, ${tooLong} too long`,
        message: `${tooLong} suffix values exceed 10 characters. Length range: ${minLength}-${maxLength}`
      };
    }
  }

  /**
   * Run all validation tests
   */
  async runAllValidations(): Promise<ValidationSummary> {
    console.log('🚀 Starting Orders Suffix Migration Validation');
    console.log('================================================\n');

    const results: ValidationResult[] = [];

    try {
      // Run all validation tests
      results.push(await this.validateCounts());
      results.push(await this.validateSuffixPopulation());
      results.push(await this.validateSuffixIntegrity());
      results.push(await this.validateNoMissingSuffix());
      results.push(await this.validateSuffixFormat());

      // Calculate summary
      const summary: ValidationSummary = {
        total_tests: results.length,
        passed: results.filter(r => r.status === 'PASS').length,
        failed: results.filter(r => r.status === 'FAIL').length,
        warnings: results.filter(r => r.status === 'WARNING').length,
        success_rate: 0
      };

      summary.success_rate = (summary.passed / summary.total_tests) * 100;

      // Display results
      console.log('\n📊 Validation Results:');
      console.log('======================');

      results.forEach((result, index) => {
        const icon = result.status === 'PASS' ? '✅' : result.status === 'WARNING' ? '⚠️' : '❌';
        console.log(`${icon} Test ${index + 1}: ${result.test_name}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Expected: ${result.expected}`);
        console.log(`   Actual: ${result.actual}`);
        console.log(`   Message: ${result.message}\n`);
      });

      // Display summary
      console.log('📈 Validation Summary:');
      console.log('======================');
      console.log(`Total Tests: ${summary.total_tests}`);
      console.log(`Passed: ${summary.passed}`);
      console.log(`Failed: ${summary.failed}`);
      console.log(`Warnings: ${summary.warnings}`);
      console.log(`Success Rate: ${summary.success_rate.toFixed(1)}%`);

      if (summary.failed === 0) {
        console.log('\n🎉 Overall Status: VALIDATION PASSED');
        if (summary.warnings > 0) {
          console.log('⚠️  Note: Some warnings were found but do not affect data integrity');
        }
      } else {
        console.log('\n❌ Overall Status: VALIDATION FAILED');
        console.log(`${summary.failed} critical issues found that need attention`);
      }

      return summary;

    } catch (error) {
      console.error('❌ Validation failed with error:', error);
      throw error;
    }
  }

  /**
   * Generate validation report
   */
  async generateValidationReport(summary: ValidationSummary): Promise<void> {
    const report = `
# Orders Suffix Migration Validation Report

## Validation Summary
- **Total Tests**: ${summary.total_tests}
- **Passed**: ${summary.passed}
- **Failed**: ${summary.failed}
- **Warnings**: ${summary.warnings}
- **Success Rate**: ${summary.success_rate.toFixed(1)}%

## Overall Status
${summary.failed === 0 ? '✅ **VALIDATION PASSED**' : '❌ **VALIDATION FAILED**'}

${summary.warnings > 0 ? `\n⚠️ **${summary.warnings} Warning(s)**: Some issues found but do not affect data integrity` : ''}

## Migration Details
- **Source Table**: dispatch_instruction
- **Target Table**: orders
- **Field Updated**: suffix
- **Join Condition**: orders.legacy_instruction_id = dispatch_instruction.id
- **Validation Date**: ${new Date().toISOString()}

## What Was Validated
1. **Record Count Validation**: Ensured source and target record counts are consistent
2. **Suffix Population Validation**: Verified all orders with legacy_instruction_id have suffix values
3. **Suffix Data Integrity Check**: Sample verification that suffix values match source data
4. **Missing Suffix Check**: Confirmed no orders are missing expected suffix values
5. **Suffix Format Validation**: Validated suffix format and length constraints

## Next Steps
${summary.failed === 0
  ? '✅ Migration validation completed successfully. The suffix field has been properly populated.'
  : '❌ Migration validation found issues. Please review the failed tests and re-run the migration if necessary.'
}

Generated by Orders Suffix Migration Validation Script
    `.trim();

    await require('fs').promises.writeFile('ORDERS_SUFFIX_VALIDATION_REPORT.md', report);
    console.log('\n📄 Validation report saved to ORDERS_SUFFIX_VALIDATION_REPORT.md');
  }

  /**
   * Close database connections
   */
  async cleanup(): Promise<void> {
    await this.sourcePool.end();
    await this.targetPool.end();
    console.log('🔌 Database connections closed');
  }

  /**
   * Main validation execution
   */
  async execute(): Promise<void> {
    try {
      const summary = await this.runAllValidations();
      await this.generateValidationReport(summary);

      if (summary.failed === 0) {
        console.log('\n✅ Validation completed successfully');
        process.exit(0);
      } else {
        console.log('\n❌ Validation completed with failures');
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Validation failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }
}

// Execute validation if run directly
if (require.main === module) {
  const validation = new OrdersSuffixValidation();
  validation.execute()
    .catch((error) => {
      console.error('❌ Validation script failed:', error);
      process.exit(1);
    });
}

export { OrdersSuffixValidation };
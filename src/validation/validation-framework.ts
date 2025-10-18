/**
 * T006: Validation framework
 * Core validation infrastructure for all migration scripts
 */

import { Client } from 'pg';
import {
  ValidationResult,
  ValidationIssue,
  MigrationConfig
} from '../interfaces/migration-types';

export class ValidationFramework {
  constructor(
    private sourceClient: Client,
    private targetClient: Client
  ) {}

  /**
   * Validate foreign key integrity
   */
  async validateForeignKeys(
    tableName: string,
    foreignKeyChecks: ForeignKeyCheck[]
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    let validRecords = 0;
    let invalidRecords = 0;

    console.log(`  Validating foreign key integrity for ${tableName}...`);

    for (const check of foreignKeyChecks) {
      try {
        // Check for orphaned records
        const orphanResult = await this.targetClient.query(`
          SELECT COUNT(*) as count
          FROM ${tableName} t
          WHERE t.${check.foreignKeyField} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${check.referencedTable} r
            WHERE r.id = t.${check.foreignKeyField}
          )
        `);

        const orphanCount = parseInt(orphanResult.rows[0].count);

        if (orphanCount > 0) {
          issues.push({
            severity: 'error',
            table: tableName,
            field: check.foreignKeyField,
            message: `Found ${orphanCount} orphaned records in ${tableName}.${check.foreignKeyField} referencing ${check.referencedTable}`,
            suggestedFix: `Verify that ${check.referencedTable} migration completed successfully`
          });
          invalidRecords += orphanCount;
        } else {
          console.log(`    ✅ ${check.foreignKeyField} → ${check.referencedTable}: No orphaned records`);
        }

      } catch (error: any) {
        issues.push({
          severity: 'error',
          table: tableName,
          field: check.foreignKeyField,
          message: `Foreign key validation failed: ${error.message}`
        });
      }
    }

    // Get total record count
    const totalResult = await this.targetClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    const totalRecords = parseInt(totalResult.rows[0].count);
    validRecords = totalRecords - invalidRecords;

    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      totalRecords,
      validRecords,
      invalidRecords,
      missingRecords: 0,
      issues
    };
  }

  /**
   * Validate data completeness by comparing record counts
   */
  async validateCompleteness(
    sourceTable: string,
    targetTable: string,
    whereClause?: string
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    try {
      // Get source count
      const sourceQuery = `SELECT COUNT(*) as count FROM ${sourceTable}${whereClause ? ` WHERE ${whereClause}` : ''}`;
      const sourceResult = await this.sourceClient.query(sourceQuery);
      const sourceCount = parseInt(sourceResult.rows[0].count);

      // Get target count
      const targetResult = await this.targetClient.query(`SELECT COUNT(*) as count FROM ${targetTable}`);
      const targetCount = parseInt(targetResult.rows[0].count);

      const missingRecords = Math.max(0, sourceCount - targetCount);

      if (missingRecords > 0) {
        issues.push({
          severity: 'warning',
          table: targetTable,
          message: `Missing ${missingRecords} records (source: ${sourceCount}, target: ${targetCount})`,
          suggestedFix: 'Re-run migration to capture missed records'
        });
      }

      console.log(`  Record count validation: Source ${sourceCount}, Target ${targetCount}, Missing ${missingRecords}`);

      return {
        isValid: missingRecords === 0,
        totalRecords: targetCount,
        validRecords: targetCount,
        invalidRecords: 0,
        missingRecords,
        issues
      };

    } catch (error: any) {
      return {
        isValid: false,
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
        missingRecords: 0,
        issues: [{
          severity: 'error',
          table: targetTable,
          message: `Completeness validation failed: ${error.message}`
        }]
      };
    }
  }

  /**
   * Validate data integrity with custom SQL checks
   */
  async validateIntegrity(
    tableName: string,
    integrityChecks: IntegrityCheck[]
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    let totalRecords = 0;
    let invalidRecords = 0;

    console.log(`  Running integrity checks for ${tableName}...`);

    // Get total record count first
    const countResult = await this.targetClient.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    totalRecords = parseInt(countResult.rows[0].count);

    for (const check of integrityChecks) {
      try {
        const result = await this.targetClient.query(check.query);
        const violationCount = parseInt(result.rows[0]?.count || '0');

        if (violationCount > 0) {
          issues.push({
            severity: check.severity,
            table: tableName,
            message: `${check.description}: ${violationCount} violations`,
            suggestedFix: check.suggestedFix
          });

          if (check.severity === 'error') {
            invalidRecords += violationCount;
          }
        } else {
          console.log(`    ✅ ${check.description}: No violations`);
        }

      } catch (error: any) {
        issues.push({
          severity: 'error',
          table: tableName,
          message: `Integrity check failed: ${check.description} - ${error.message}`
        });
      }
    }

    return {
      isValid: issues.filter(i => i.severity === 'error').length === 0,
      totalRecords,
      validRecords: totalRecords - invalidRecords,
      invalidRecords,
      missingRecords: 0,
      issues
    };
  }

  /**
   * Run comprehensive validation for a migrated table
   */
  async validateTable(
    sourceTable: string,
    targetTable: string,
    foreignKeyChecks?: ForeignKeyCheck[],
    integrityChecks?: IntegrityCheck[],
    whereClause?: string
  ): Promise<ValidationResult> {
    console.log(`🔍 Comprehensive validation for ${targetTable}`);

    const results: ValidationResult[] = [];

    // 1. Completeness validation
    const completenessResult = await this.validateCompleteness(sourceTable, targetTable, whereClause);
    results.push(completenessResult);

    // 2. Foreign key validation (if specified)
    if (foreignKeyChecks && foreignKeyChecks.length > 0) {
      const fkResult = await this.validateForeignKeys(targetTable, foreignKeyChecks);
      results.push(fkResult);
    }

    // 3. Data integrity validation (if specified)
    if (integrityChecks && integrityChecks.length > 0) {
      const integrityResult = await this.validateIntegrity(targetTable, integrityChecks);
      results.push(integrityResult);
    }

    // Combine all results
    const combinedIssues = results.flatMap(r => r.issues);
    const totalRecords = Math.max(...results.map(r => r.totalRecords));
    const hasErrors = combinedIssues.some(i => i.severity === 'error');

    console.log(`  ${hasErrors ? '❌' : '✅'} Validation complete: ${combinedIssues.length} issues found`);

    return {
      isValid: !hasErrors,
      totalRecords,
      validRecords: Math.min(...results.map(r => r.validRecords)),
      invalidRecords: Math.max(...results.map(r => r.invalidRecords)),
      missingRecords: Math.max(...results.map(r => r.missingRecords)),
      issues: combinedIssues
    };
  }
}

// Supporting interfaces for validation framework
export interface ForeignKeyCheck {
  foreignKeyField: string;
  referencedTable: string;
  description?: string;
}

export interface IntegrityCheck {
  query: string; // SQL query that returns a 'count' column with violations
  description: string;
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: string;
}

// Common integrity checks
export const COMMON_INTEGRITY_CHECKS = {
  // Check for null values in required fields
  nullCheck: (fieldName: string): IntegrityCheck => ({
    query: `SELECT COUNT(*) as count FROM {table} WHERE ${fieldName} IS NULL`,
    description: `Null values in required field ${fieldName}`,
    severity: 'error',
    suggestedFix: `Update records to provide values for ${fieldName}`
  }),

  // Check for duplicate values in unique fields
  duplicateCheck: (fieldName: string): IntegrityCheck => ({
    query: `SELECT COUNT(*) - COUNT(DISTINCT ${fieldName}) as count FROM {table} WHERE ${fieldName} IS NOT NULL`,
    description: `Duplicate values in unique field ${fieldName}`,
    severity: 'error',
    suggestedFix: `Remove duplicate values from ${fieldName}`
  }),

  // Check for invalid enum values
  enumCheck: (fieldName: string, validValues: string[]): IntegrityCheck => ({
    query: `SELECT COUNT(*) as count FROM {table} WHERE ${fieldName} NOT IN ('${validValues.join("','")}')`,
    description: `Invalid enum values in ${fieldName}`,
    severity: 'warning',
    suggestedFix: `Update invalid values to match allowed enum values: ${validValues.join(', ')}`
  })
};

// Common foreign key checks for migration tables
export const COMMON_FOREIGN_KEY_CHECKS = {
  profiles: { foreignKeyField: 'profile_id', referencedTable: 'profiles' },
  patients: { foreignKeyField: 'patient_id', referencedTable: 'patients' },
  orders: { foreignKeyField: 'order_id', referencedTable: 'orders' },
  cases: { foreignKeyField: 'case_id', referencedTable: 'cases' },
  files: { foreignKeyField: 'file_id', referencedTable: 'files' },
  messages: { foreignKeyField: 'message_id', referencedTable: 'messages' },
  technicians: { foreignKeyField: 'technician_id', referencedTable: 'technicians' },
  templateGroups: { foreignKeyField: 'group_id', referencedTable: 'template_view_groups' }
};
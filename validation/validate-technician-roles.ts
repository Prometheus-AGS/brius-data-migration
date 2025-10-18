/**
 * T020: Technician roles validation script
 * Comprehensive validation for migrated technician role records
 */

import { DatabaseConnectionManager } from '../src/database/connection-manager';
import { ValidationFramework, ForeignKeyCheck, IntegrityCheck } from '../src/validation/validation-framework';
import { MigrationReportGenerator } from '../src/reporting/report-generator';
import {
  ValidationResult,
  ValidationIssue,
  MigrationStats
} from '../src/interfaces/migration-types';

export class TechnicianRolesValidator {
  private connectionManager: DatabaseConnectionManager;
  private validator: ValidationFramework;
  private reportGenerator: MigrationReportGenerator;

  constructor() {
    this.connectionManager = DatabaseConnectionManager.fromEnvironment();
    this.validator = new ValidationFramework(
      this.connectionManager.getSourceClient(),
      this.connectionManager.getTargetClient()
    );
    this.reportGenerator = new MigrationReportGenerator();
  }

  async validate(): Promise<ValidationResult> {
    console.log('🔍 Starting comprehensive technician roles validation...');

    try {
      // Initialize connections
      await this.connectionManager.initializeClients();

      // Run all validation checks
      const results: ValidationResult[] = [];

      // 1. Data completeness validation
      console.log('📊 Validating data completeness...');
      const completenessResult = await this.validateCompleteness();
      results.push(completenessResult);

      // 2. Foreign key integrity validation
      console.log('🔗 Validating foreign key relationships...');
      const foreignKeyResult = await this.validateForeignKeys();
      results.push(foreignKeyResult);

      // 3. Data integrity validation
      console.log('✅ Validating data integrity...');
      const integrityResult = await this.validateDataIntegrity();
      results.push(integrityResult);

      // 4. Business logic validation
      console.log('🏢 Validating business rules...');
      const businessResult = await this.validateBusinessRules();
      results.push(businessResult);

      // 5. Role-specific validation
      console.log('👥 Validating role-specific rules...');
      const roleSpecificResult = await this.validateRoleSpecificRules();
      results.push(roleSpecificResult);

      // Combine all results
      const combinedResult = this.combineValidationResults(results);

      // Generate validation report
      await this.generateValidationReport(combinedResult);

      console.log(`✅ Technician roles validation completed: ${combinedResult.isValid ? 'PASSED' : 'FAILED'}`);
      return combinedResult;

    } catch (error) {
      console.error('❌ Technician roles validation failed:', error);
      throw error;
    } finally {
      await this.connectionManager.closeAll();
    }
  }

  private async validateCompleteness(): Promise<ValidationResult> {
    return await this.validator.validateCompleteness(
      'dispatch_technician_role',
      'technician_roles'
    );
  }

  private async validateForeignKeys(): Promise<ValidationResult> {
    const foreignKeyChecks: ForeignKeyCheck[] = [
      {
        foreignKeyField: 'technician_id',
        referencedTable: 'technicians',
        description: 'Technician role linkage'
      }
    ];

    return await this.validator.validateForeignKeys('technician_roles', foreignKeyChecks);
  }

  private async validateDataIntegrity(): Promise<ValidationResult> {
    const integrityChecks: IntegrityCheck[] = [
      // Check for null technician_id (should not exist)
      {
        query: `SELECT COUNT(*) as count FROM technician_roles WHERE technician_id IS NULL`,
        description: 'Records with missing technician linkage',
        severity: 'error',
        suggestedFix: 'All roles must be linked to a valid technician'
      },

      // Check for missing legacy role ID
      {
        query: `SELECT COUNT(*) as count FROM technician_roles WHERE legacy_role_id IS NULL`,
        description: 'Records missing legacy role ID',
        severity: 'error',
        suggestedFix: 'All records should preserve legacy ID for traceability'
      },

      // Check for duplicate legacy role IDs
      {
        query: `
          SELECT COUNT(*) - COUNT(DISTINCT legacy_role_id) as count
          FROM technician_roles
          WHERE legacy_role_id IS NOT NULL
        `,
        description: 'Duplicate legacy role IDs',
        severity: 'error',
        suggestedFix: 'Each legacy ID should appear only once'
      },

      // Check for empty role names
      {
        query: `SELECT COUNT(*) as count FROM technician_roles WHERE role_name IS NULL OR role_name = ''`,
        description: 'Records with empty role names',
        severity: 'error',
        suggestedFix: 'All roles must have a name'
      },

      // Check for null effective dates
      {
        query: `SELECT COUNT(*) as count FROM technician_roles WHERE effective_date IS NULL`,
        description: 'Records with null effective date',
        severity: 'error',
        suggestedFix: 'All roles must have an effective date'
      },

      // Check for invalid date ranges
      {
        query: `
          SELECT COUNT(*) as count
          FROM technician_roles
          WHERE expiry_date IS NOT NULL
          AND expiry_date < effective_date
        `,
        description: 'Records with expiry date before effective date',
        severity: 'warning',
        suggestedFix: 'Review date logic for expired roles'
      },

      // Check for future effective dates
      {
        query: `
          SELECT COUNT(*) as count
          FROM technician_roles
          WHERE effective_date > CURRENT_DATE
        `,
        description: 'Records with future effective dates',
        severity: 'warning',
        suggestedFix: 'Review roles with future effective dates'
      },

      // Check for malformed permissions JSON
      {
        query: `
          SELECT COUNT(*) as count
          FROM technician_roles
          WHERE permissions IS NOT NULL
          AND NOT (permissions::text ~ '^\\[.*\\]$' OR permissions::text ~ '^\\{.*\\}$')
        `,
        description: 'Records with malformed permissions JSON',
        severity: 'warning',
        suggestedFix: 'Ensure permissions are valid JSON arrays or objects'
      }
    ];

    return await this.validator.validateIntegrity('technician_roles', integrityChecks);
  }

  private async validateBusinessRules(): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const targetClient = this.connectionManager.getTargetClient();

    try {
      // Get total record count
      const countResult = await targetClient.query('SELECT COUNT(*) as count FROM technician_roles');
      const totalRecords = parseInt(countResult.rows[0].count);

      // Business Rule 1: Active roles should have effective dates in the past or present
      const futureActiveRoles = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technician_roles
        WHERE is_active = true
        AND effective_date > CURRENT_DATE
      `);

      if (parseInt(futureActiveRoles.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'technician_roles',
          message: `${futureActiveRoles.rows[0].count} active roles with future effective dates`,
          suggestedFix: 'Review roles that are active but not yet effective'
        });
      }

      // Business Rule 2: Expired roles should not be active
      const expiredActiveRoles = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technician_roles
        WHERE is_active = true
        AND expiry_date IS NOT NULL
        AND expiry_date < CURRENT_DATE
      `);

      if (parseInt(expiredActiveRoles.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'technician_roles',
          message: `${expiredActiveRoles.rows[0].count} active roles that have expired`,
          suggestedFix: 'Consider deactivating expired roles'
        });
      }

      // Business Rule 3: Check for orphaned scope references
      const orphanedOfficeScopes = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technician_roles tr
        WHERE tr.scope_type = 'office'
        AND tr.scope_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM offices o WHERE o.id = tr.scope_id::uuid
        )
      `);

      if (parseInt(orphanedOfficeScopes.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'technician_roles',
          message: `${orphanedOfficeScopes.rows[0].count} roles with invalid office scope references`,
          suggestedFix: 'Verify office migration completed successfully'
        });
      }

      // Business Rule 4: Technicians should have at least one active role
      const techniciansWithoutActiveRoles = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technicians t
        WHERE NOT EXISTS (
          SELECT 1 FROM technician_roles tr
          WHERE tr.technician_id = t.id
          AND tr.is_active = true
          AND tr.effective_date <= CURRENT_DATE
          AND (tr.expiry_date IS NULL OR tr.expiry_date >= CURRENT_DATE)
        )
      `);

      if (parseInt(techniciansWithoutActiveRoles.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'technician_roles',
          message: `${techniciansWithoutActiveRoles.rows[0].count} technicians without active roles`,
          suggestedFix: 'Review technicians who may need role assignments'
        });
      }

      // Business Rule 5: Check for conflicting role types per technician
      const conflictingRoles = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT technician_id
          FROM technician_roles
          WHERE is_active = true
          AND effective_date <= CURRENT_DATE
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
          GROUP BY technician_id
          HAVING COUNT(DISTINCT role_type) > 1
        ) conflicts
      `);

      if (parseInt(conflictingRoles.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'technician_roles',
          message: `${conflictingRoles.rows[0].count} technicians with multiple active role types`,
          suggestedFix: 'Review if technicians should have multiple role types simultaneously'
        });
      }

      return {
        isValid: issues.filter(i => i.severity === 'error').length === 0,
        totalRecords,
        validRecords: totalRecords - issues.filter(i => i.severity === 'error').length,
        invalidRecords: issues.filter(i => i.severity === 'error').length,
        missingRecords: 0,
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
          table: 'technician_roles',
          message: `Business rule validation failed: ${error.message}`
        }]
      };
    }
  }

  private async validateRoleSpecificRules(): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const targetClient = this.connectionManager.getTargetClient();

    try {
      // Get total record count
      const countResult = await targetClient.query('SELECT COUNT(*) as count FROM technician_roles');
      const totalRecords = parseInt(countResult.rows[0].count);

      // Role-Specific Rule 1: System roles should have global scope
      const systemRolesNonGlobal = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technician_roles
        WHERE role_type = 'system'
        AND (scope_type IS NULL OR scope_type != 'global')
      `);

      if (parseInt(systemRolesNonGlobal.rows[0].count) > 0) {
        issues.push({
          severity: 'warning',
          table: 'technician_roles',
          message: `${systemRolesNonGlobal.rows[0].count} system roles without global scope`,
          suggestedFix: 'System roles should typically have global scope'
        });
      }

      // Role-Specific Rule 2: Clinical roles should have office or department scope
      const clinicalRolesGlobal = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technician_roles
        WHERE role_type = 'clinical'
        AND scope_type = 'global'
      `);

      if (parseInt(clinicalRolesGlobal.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'technician_roles',
          message: `${clinicalRolesGlobal.rows[0].count} clinical roles with global scope`,
          suggestedFix: 'Consider if clinical roles should have office-specific scope'
        });
      }

      // Role-Specific Rule 3: Check for common role names consistency
      const roleNameVariations = await targetClient.query(`
        SELECT role_name, COUNT(*) as count
        FROM technician_roles
        WHERE LOWER(role_name) IN ('admin', 'administrator', 'user', 'technician', 'staff')
        GROUP BY role_name
        HAVING COUNT(*) > 1
        ORDER BY count DESC
      `);

      if (roleNameVariations.rows.length > 0) {
        const variations = roleNameVariations.rows.map(r => `${r.role_name}(${r.count})`).join(', ');
        issues.push({
          severity: 'info',
          table: 'technician_roles',
          message: `Role name variations found: ${variations}`,
          suggestedFix: 'Consider standardizing common role names'
        });
      }

      // Role-Specific Rule 4: Check permissions structure
      const invalidPermissions = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technician_roles
        WHERE permissions IS NOT NULL
        AND (
          permissions::text = '[]'
          OR permissions::text = '{}'
          OR permissions::text = 'null'
          OR permissions::text = '""'
        )
      `);

      if (parseInt(invalidPermissions.rows[0].count) > 0) {
        issues.push({
          severity: 'info',
          table: 'technician_roles',
          message: `${invalidPermissions.rows[0].count} roles with empty or null permissions`,
          suggestedFix: 'Review roles that may need permission assignments'
        });
      }

      return {
        isValid: issues.filter(i => i.severity === 'error').length === 0,
        totalRecords,
        validRecords: totalRecords - issues.filter(i => i.severity === 'error').length,
        invalidRecords: issues.filter(i => i.severity === 'error').length,
        missingRecords: 0,
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
          table: 'technician_roles',
          message: `Role-specific validation failed: ${error.message}`
        }]
      };
    }
  }

  private combineValidationResults(results: ValidationResult[]): ValidationResult {
    const allIssues = results.flatMap(r => r.issues);
    const totalRecords = Math.max(...results.map(r => r.totalRecords));
    const hasErrors = allIssues.some(i => i.severity === 'error');

    return {
      isValid: !hasErrors,
      totalRecords,
      validRecords: Math.min(...results.map(r => r.validRecords)),
      invalidRecords: Math.max(...results.map(r => r.invalidRecords)),
      missingRecords: Math.max(...results.map(r => r.missingRecords)),
      issues: allIssues
    };
  }

  private async generateValidationReport(result: ValidationResult): Promise<void> {
    // Create mock migration stats for report generation
    const migrationStats: MigrationStats = {
      totalProcessed: result.totalRecords,
      successful: result.validRecords,
      failed: result.invalidRecords,
      skipped: result.missingRecords,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      errorDetails: result.issues.filter(i => i.severity === 'error').map(i => i.message)
    };

    const report = await this.reportGenerator.generateTableReport(
      'technician-roles-validation',
      migrationStats,
      result
    );

    const reportPath = 'TECHNICIAN_ROLES_VALIDATION_REPORT.md';
    await this.reportGenerator.saveReport(report, reportPath);

    console.log(`📋 Validation report saved: ${reportPath}`);
  }

  async getValidationSummary(): Promise<{
    totalRecords: number;
    validRecords: number;
    issues: { errors: number; warnings: number; info: number };
    status: 'passed' | 'failed';
    roleDistribution: { [roleType: string]: number };
    scopeDistribution: { [scopeType: string]: number };
  }> {
    const result = await this.validate();

    const errors = result.issues.filter(i => i.severity === 'error').length;
    const warnings = result.issues.filter(i => i.severity === 'warning').length;
    const info = result.issues.filter(i => i.severity === 'info').length;

    // Get role and scope distribution
    const targetClient = this.connectionManager.getTargetClient();

    const roleDistribution: { [roleType: string]: number } = {};
    const roleResult = await targetClient.query(`
      SELECT COALESCE(role_type, 'unknown') as role_type, COUNT(*) as count
      FROM technician_roles
      GROUP BY role_type
      ORDER BY count DESC
    `);

    for (const row of roleResult.rows) {
      roleDistribution[row.role_type] = parseInt(row.count);
    }

    const scopeDistribution: { [scopeType: string]: number } = {};
    const scopeResult = await targetClient.query(`
      SELECT COALESCE(scope_type, 'none') as scope_type, COUNT(*) as count
      FROM technician_roles
      GROUP BY scope_type
      ORDER BY count DESC
    `);

    for (const row of scopeResult.rows) {
      scopeDistribution[row.scope_type] = parseInt(row.count);
    }

    return {
      totalRecords: result.totalRecords,
      validRecords: result.validRecords,
      issues: { errors, warnings, info },
      status: result.isValid ? 'passed' : 'failed',
      roleDistribution,
      scopeDistribution
    };
  }
}

// Main execution
async function main() {
  try {
    const validator = new TechnicianRolesValidator();
    const result = await validator.validate();

    console.log('\n=== TECHNICIAN ROLES VALIDATION SUMMARY ===');
    console.log(`Status: ${result.isValid ? 'PASSED' : 'FAILED'}`);
    console.log(`Total records: ${result.totalRecords}`);
    console.log(`Valid records: ${result.validRecords}`);
    console.log(`Invalid records: ${result.invalidRecords}`);
    console.log(`Missing records: ${result.missingRecords}`);
    console.log(`Issues found: ${result.issues.length}`);

    if (result.issues.length > 0) {
      const errors = result.issues.filter(i => i.severity === 'error').length;
      const warnings = result.issues.filter(i => i.severity === 'warning').length;
      const info = result.issues.filter(i => i.severity === 'info').length;

      console.log(`  - Errors: ${errors}`);
      console.log(`  - Warnings: ${warnings}`);
      console.log(`  - Info: ${info}`);
    }
    console.log('============================================\n');

    if (!result.isValid) {
      console.log('❌ Critical issues found:');
      result.issues
        .filter(i => i.severity === 'error')
        .forEach((issue, i) => {
          console.log(`${i + 1}. ${issue.message}`);
          if (issue.suggestedFix) {
            console.log(`   Fix: ${issue.suggestedFix}`);
          }
        });
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { main as validateTechnicianRoles };
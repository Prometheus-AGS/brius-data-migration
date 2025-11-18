"use strict";
/**
 * T018: Technicians validation script
 * Comprehensive validation for migrated technician records
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TechniciansValidator = void 0;
exports.validateTechnicians = main;
const connection_manager_1 = require("../src/database/connection-manager");
const validation_framework_1 = require("../src/validation/validation-framework");
const report_generator_1 = require("../src/reporting/report-generator");
class TechniciansValidator {
    constructor() {
        this.connectionManager = connection_manager_1.DatabaseConnectionManager.fromEnvironment();
        this.validator = new validation_framework_1.ValidationFramework(this.connectionManager.getSourceClient(), this.connectionManager.getTargetClient());
        this.reportGenerator = new report_generator_1.MigrationReportGenerator();
    }
    async validate() {
        console.log('🔍 Starting comprehensive technicians validation...');
        try {
            // Initialize connections
            await this.connectionManager.initializeClients();
            // Run all validation checks
            const results = [];
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
            // Combine all results
            const combinedResult = this.combineValidationResults(results);
            // Generate validation report
            await this.generateValidationReport(combinedResult);
            console.log(`✅ Technicians validation completed: ${combinedResult.isValid ? 'PASSED' : 'FAILED'}`);
            return combinedResult;
        }
        catch (error) {
            console.error('❌ Technicians validation failed:', error);
            throw error;
        }
        finally {
            await this.connectionManager.closeAll();
        }
    }
    async validateCompleteness() {
        return await this.validator.validateCompleteness('dispatch_technician', 'technicians');
    }
    async validateForeignKeys() {
        const foreignKeyChecks = [
            {
                foreignKeyField: 'profile_id',
                referencedTable: 'profiles',
                description: 'Technician profile linkage'
            }
        ];
        return await this.validator.validateForeignKeys('technicians', foreignKeyChecks);
    }
    async validateDataIntegrity() {
        const integrityChecks = [
            // Check for null profile_id (should not exist)
            {
                query: `SELECT COUNT(*) as count FROM technicians WHERE profile_id IS NULL`,
                description: 'Records with missing profile linkage',
                severity: 'error',
                suggestedFix: 'All technicians must be linked to a valid profile'
            },
            // Check for missing legacy technician ID
            {
                query: `SELECT COUNT(*) as count FROM technicians WHERE legacy_technician_id IS NULL`,
                description: 'Records missing legacy technician ID',
                severity: 'error',
                suggestedFix: 'All records should preserve legacy ID for traceability'
            },
            // Check for duplicate legacy technician IDs
            {
                query: `
          SELECT COUNT(*) - COUNT(DISTINCT legacy_technician_id) as count
          FROM technicians
          WHERE legacy_technician_id IS NOT NULL
        `,
                description: 'Duplicate legacy technician IDs',
                severity: 'error',
                suggestedFix: 'Each legacy ID should appear only once'
            },
            // Check for duplicate employee IDs
            {
                query: `
          SELECT COUNT(*) - COUNT(DISTINCT employee_id) as count
          FROM technicians
          WHERE employee_id IS NOT NULL
        `,
                description: 'Duplicate employee IDs',
                severity: 'warning',
                suggestedFix: 'Employee IDs should be unique across technicians'
            },
            // Check for invalid status values
            {
                query: `
          SELECT COUNT(*) as count
          FROM technicians
          WHERE status NOT IN ('active', 'inactive', 'terminated')
        `,
                description: 'Records with invalid status values',
                severity: 'warning',
                suggestedFix: 'Status should be one of: active, inactive, terminated'
            },
            // Check for invalid email formats
            {
                query: `
          SELECT COUNT(*) as count
          FROM technicians
          WHERE email IS NOT NULL
          AND email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'
        `,
                description: 'Records with invalid email formats',
                severity: 'warning',
                suggestedFix: 'Correct email format validation needed'
            },
            // Check for future hire dates
            {
                query: `
          SELECT COUNT(*) as count
          FROM technicians
          WHERE hire_date > CURRENT_DATE
        `,
                description: 'Records with future hire dates',
                severity: 'warning',
                suggestedFix: 'Hire dates should not be in the future'
            }
        ];
        return await this.validator.validateIntegrity('technicians', integrityChecks);
    }
    async validateBusinessRules() {
        const issues = [];
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Get total record count
            const countResult = await targetClient.query('SELECT COUNT(*) as count FROM technicians');
            const totalRecords = parseInt(countResult.rows[0].count);
            // Business Rule 1: Active technicians should have employee IDs
            const activeWithoutEmployeeId = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technicians
        WHERE status = 'active'
        AND (employee_id IS NULL OR employee_id = '')
      `);
            if (parseInt(activeWithoutEmployeeId.rows[0].count) > 0) {
                issues.push({
                    severity: 'warning',
                    table: 'technicians',
                    message: `${activeWithoutEmployeeId.rows[0].count} active technicians without employee IDs`,
                    suggestedFix: 'Active technicians should have employee IDs for HR tracking'
                });
            }
            // Business Rule 2: Technicians with profiles should have matching email addresses
            const emailMismatch = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technicians t
        JOIN profiles p ON t.profile_id = p.id
        WHERE t.email IS NOT NULL
        AND p.email IS NOT NULL
        AND t.email != p.email
      `);
            if (parseInt(emailMismatch.rows[0].count) > 0) {
                issues.push({
                    severity: 'info',
                    table: 'technicians',
                    message: `${emailMismatch.rows[0].count} technicians with email different from profile email`,
                    suggestedFix: 'Consider synchronizing email addresses between technicians and profiles'
                });
            }
            // Business Rule 3: Terminated technicians should not have recent activity
            const terminatedRecent = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technicians
        WHERE status = 'terminated'
        AND updated_at > CURRENT_DATE - INTERVAL '30 days'
      `);
            if (parseInt(terminatedRecent.rows[0].count) > 0) {
                issues.push({
                    severity: 'info',
                    table: 'technicians',
                    message: `${terminatedRecent.rows[0].count} terminated technicians with recent updates`,
                    suggestedFix: 'Review recently terminated technicians for data accuracy'
                });
            }
            // Business Rule 4: Check for orphaned legacy user IDs
            const orphanedUsers = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technicians t
        WHERE t.legacy_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.legacy_user_id = t.legacy_user_id
        )
      `);
            if (parseInt(orphanedUsers.rows[0].count) > 0) {
                issues.push({
                    severity: 'warning',
                    table: 'technicians',
                    message: `${orphanedUsers.rows[0].count} technicians with orphaned legacy user IDs`,
                    suggestedFix: 'Verify profile migration completed successfully for all users'
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
        }
        catch (error) {
            return {
                isValid: false,
                totalRecords: 0,
                validRecords: 0,
                invalidRecords: 0,
                missingRecords: 0,
                issues: [{
                        severity: 'error',
                        table: 'technicians',
                        message: `Business rule validation failed: ${error.message}`
                    }]
            };
        }
    }
    combineValidationResults(results) {
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
    async generateValidationReport(result) {
        // Create mock migration stats for report generation
        const migrationStats = {
            totalProcessed: result.totalRecords,
            successful: result.validRecords,
            failed: result.invalidRecords,
            skipped: result.missingRecords,
            startTime: new Date(),
            endTime: new Date(),
            duration: 0,
            errorDetails: result.issues.filter(i => i.severity === 'error').map(i => i.message)
        };
        const report = await this.reportGenerator.generateTableReport('technicians-validation', migrationStats, result);
        const reportPath = 'TECHNICIANS_VALIDATION_REPORT.md';
        await this.reportGenerator.saveReport(report, reportPath);
        console.log(`📋 Validation report saved: ${reportPath}`);
    }
    async getValidationSummary() {
        const result = await this.validate();
        const errors = result.issues.filter(i => i.severity === 'error').length;
        const warnings = result.issues.filter(i => i.severity === 'warning').length;
        const info = result.issues.filter(i => i.severity === 'info').length;
        return {
            totalRecords: result.totalRecords,
            validRecords: result.validRecords,
            issues: { errors, warnings, info },
            status: result.isValid ? 'passed' : 'failed'
        };
    }
}
exports.TechniciansValidator = TechniciansValidator;
// Main execution
async function main() {
    try {
        const validator = new TechniciansValidator();
        const result = await validator.validate();
        console.log('\n=== TECHNICIANS VALIDATION SUMMARY ===');
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
        console.log('========================================\n');
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
    }
    catch (error) {
        console.error('❌ Validation failed:', error);
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    main();
}
//# sourceMappingURL=validate-technicians.js.map
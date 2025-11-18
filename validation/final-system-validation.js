"use strict";
/**
 * T029: Final system validation script
 * Comprehensive validation across all migrated tables and system readiness assessment
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinalSystemValidator = void 0;
exports.validateFinalSystem = main;
const connection_manager_1 = require("../src/database/connection-manager");
const validation_framework_1 = require("../src/validation/validation-framework");
const report_generator_1 = require("../src/reporting/report-generator");
// Import individual validators
const validate_technicians_1 = require("./validate-technicians");
const validate_technician_roles_1 = require("./validate-technician-roles");
const validate_message_attachments_1 = require("./validate-message-attachments");
class FinalSystemValidator {
    constructor() {
        // Table configurations for comprehensive validation
        this.FINAL_MIGRATION_TABLES = [
            {
                name: 'technicians',
                priority: 'high',
                validator: validate_technicians_1.TechniciansValidator,
                dependencies: ['profiles']
            },
            {
                name: 'technician_roles',
                priority: 'high',
                validator: validate_technician_roles_1.TechnicianRolesValidator,
                dependencies: ['technicians']
            },
            {
                name: 'message_attachments',
                priority: 'high',
                validator: validate_message_attachments_1.MessageAttachmentsValidator,
                dependencies: ['messages', 'files']
            },
            // Placeholder for remaining tables to be implemented
            {
                name: 'template_view_groups',
                priority: 'medium',
                validator: null, // To be implemented
                dependencies: []
            },
            {
                name: 'template_view_roles',
                priority: 'medium',
                validator: null, // To be implemented
                dependencies: ['template_view_groups']
            },
            {
                name: 'treatment_discussions',
                priority: 'medium',
                validator: null, // To be implemented
                dependencies: ['patients']
            },
            {
                name: 'brackets',
                priority: 'low',
                validator: null, // To be implemented
                dependencies: []
            },
            {
                name: 'order_cases',
                priority: 'medium',
                validator: null, // To be implemented
                dependencies: ['orders', 'cases']
            },
            {
                name: 'purchases',
                priority: 'medium',
                validator: null, // To be implemented
                dependencies: ['orders']
            }
        ];
        this.connectionManager = connection_manager_1.DatabaseConnectionManager.fromEnvironment();
        this.validator = new validation_framework_1.ValidationFramework(this.connectionManager.getSourceClient(), this.connectionManager.getTargetClient());
        this.reportGenerator = new report_generator_1.MigrationReportGenerator();
    }
    async validateFinalSystem() {
        console.log('🔍 Starting comprehensive final system validation...');
        console.log('📋 This validates all migrated tables and system readiness\n');
        try {
            // Initialize connections
            await this.connectionManager.initializeClients();
            const validationResults = [];
            // 1. Database connectivity validation
            console.log('🔌 Validating database connectivity...');
            const connectivityResult = await this.validateDatabaseConnectivity();
            // 2. Schema validation
            console.log('📐 Validating database schemas...');
            const schemaResult = await this.validateDatabaseSchemas();
            // 3. Core dependency validation
            console.log('🔗 Validating core table dependencies...');
            const dependencyResult = await this.validateCoreDependencies();
            // 4. Individual table validations
            console.log('📊 Validating individual migrated tables...\n');
            for (const tableConfig of this.FINAL_MIGRATION_TABLES) {
                console.log(`🔍 Validating ${tableConfig.name}...`);
                const tableResult = await this.validateIndividualTable(tableConfig);
                validationResults.push(tableResult);
                // Print immediate results
                const status = tableResult.validationResult.isValid ? '✅ PASSED' : '❌ FAILED';
                const recordCount = tableResult.targetRecords.toLocaleString();
                console.log(`   ${status} - ${recordCount} records`);
            }
            // 5. Cross-table relationship validation
            console.log('\n🔗 Validating cross-table relationships...');
            const relationshipResult = await this.validateCrossTableRelationships();
            // 6. System performance validation
            console.log('⚡ Validating system performance...');
            const performanceResult = await this.validateSystemPerformance();
            // 7. Data integrity checks
            console.log('🛡️ Validating overall data integrity...');
            const integrityResult = await this.validateOverallDataIntegrity();
            // Compile final system result
            const systemResult = {
                overallStatus: this.determineOverallStatus(validationResults, [
                    connectivityResult,
                    schemaResult,
                    dependencyResult,
                    relationshipResult,
                    performanceResult,
                    integrityResult
                ]),
                tableResults: validationResults,
                systemChecks: {
                    connectivity: connectivityResult,
                    schema: schemaResult,
                    dependencies: dependencyResult,
                    relationships: relationshipResult,
                    performance: performanceResult,
                    integrity: integrityResult
                },
                summary: this.generateSystemSummary(validationResults),
                timestamp: new Date(),
                recommendedActions: this.generateRecommendedActions(validationResults)
            };
            // Generate comprehensive report
            await this.generateFinalSystemReport(systemResult);
            console.log('\n=== FINAL SYSTEM VALIDATION COMPLETE ===');
            console.log(`Overall Status: ${systemResult.overallStatus.toUpperCase()}`);
            console.log(`Tables Validated: ${validationResults.length}`);
            console.log(`System Ready: ${systemResult.overallStatus === 'ready' ? 'YES' : 'NO'}`);
            console.log('==========================================\n');
            return systemResult;
        }
        catch (error) {
            console.error('❌ Final system validation failed:', error);
            throw error;
        }
        finally {
            await this.connectionManager.closeAll();
        }
    }
    async validateDatabaseConnectivity() {
        const issues = [];
        try {
            const healthCheck = await this.connectionManager.healthCheck();
            if (healthCheck.status === 'unhealthy') {
                issues.push({
                    severity: 'error',
                    table: 'system',
                    message: 'Database connectivity issues detected',
                    suggestedFix: 'Check database connection parameters and network connectivity'
                });
            }
            if (healthCheck.connections.source === 'error') {
                issues.push({
                    severity: 'error',
                    table: 'system',
                    message: 'Source database connection failed',
                    suggestedFix: 'Verify source database credentials and accessibility'
                });
            }
            if (healthCheck.connections.target === 'error') {
                issues.push({
                    severity: 'error',
                    table: 'system',
                    message: 'Target database connection failed',
                    suggestedFix: 'Verify target database credentials and accessibility'
                });
            }
            return {
                isValid: issues.filter(i => i.severity === 'error').length === 0,
                totalRecords: 2, // Source and target connections
                validRecords: healthCheck.status === 'healthy' ? 2 : 0,
                invalidRecords: healthCheck.status === 'healthy' ? 0 : 2,
                missingRecords: 0,
                issues
            };
        }
        catch (error) {
            return {
                isValid: false,
                totalRecords: 0,
                validRecords: 0,
                invalidRecords: 2,
                missingRecords: 0,
                issues: [{
                        severity: 'error',
                        table: 'system',
                        message: `Connectivity validation failed: ${error.message}`
                    }]
            };
        }
    }
    async validateDatabaseSchemas() {
        const issues = [];
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Check if all required tables exist
            for (const tableConfig of this.FINAL_MIGRATION_TABLES) {
                const exists = await this.connectionManager.tableExists(targetClient, tableConfig.name);
                if (!exists) {
                    issues.push({
                        severity: 'error',
                        table: tableConfig.name,
                        message: `Required table '${tableConfig.name}' does not exist`,
                        suggestedFix: `Run migration for ${tableConfig.name} table`
                    });
                }
            }
            // Check for critical indexes
            const indexCheck = await targetClient.query(`
        SELECT schemaname, tablename, indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename IN (${this.FINAL_MIGRATION_TABLES.map(t => `'${t.name}'`).join(',')})
        AND indexname LIKE '%pkey%'
      `);
            const tablesWithPrimaryKeys = new Set(indexCheck.rows.map(r => r.tablename));
            const tablesWithoutPrimaryKeys = this.FINAL_MIGRATION_TABLES
                .map(t => t.name)
                .filter(name => !tablesWithPrimaryKeys.has(name));
            if (tablesWithoutPrimaryKeys.length > 0) {
                issues.push({
                    severity: 'warning',
                    table: 'system',
                    message: `Tables without primary key indexes: ${tablesWithoutPrimaryKeys.join(', ')}`,
                    suggestedFix: 'Verify table schema creation completed successfully'
                });
            }
            return {
                isValid: issues.filter(i => i.severity === 'error').length === 0,
                totalRecords: this.FINAL_MIGRATION_TABLES.length,
                validRecords: this.FINAL_MIGRATION_TABLES.length - issues.filter(i => i.severity === 'error').length,
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
                invalidRecords: this.FINAL_MIGRATION_TABLES.length,
                missingRecords: 0,
                issues: [{
                        severity: 'error',
                        table: 'system',
                        message: `Schema validation failed: ${error.message}`
                    }]
            };
        }
    }
    async validateCoreDependencies() {
        const issues = [];
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Check core dependency tables exist and have data
            const coreTables = ['profiles', 'messages', 'files', 'orders', 'cases', 'patients'];
            for (const tableName of coreTables) {
                const exists = await this.connectionManager.tableExists(targetClient, tableName);
                if (!exists) {
                    issues.push({
                        severity: 'error',
                        table: tableName,
                        message: `Core dependency table '${tableName}' does not exist`,
                        suggestedFix: `Ensure ${tableName} migration completed successfully`
                    });
                }
                else {
                    const count = await this.connectionManager.getRecordCount(targetClient, tableName);
                    if (count === 0) {
                        issues.push({
                            severity: 'warning',
                            table: tableName,
                            message: `Core table '${tableName}' exists but is empty`,
                            suggestedFix: `Verify ${tableName} migration completed with data`
                        });
                    }
                }
            }
            return {
                isValid: issues.filter(i => i.severity === 'error').length === 0,
                totalRecords: coreTables.length,
                validRecords: coreTables.length - issues.filter(i => i.severity === 'error').length,
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
                        table: 'system',
                        message: `Dependency validation failed: ${error.message}`
                    }]
            };
        }
    }
    async validateIndividualTable(tableConfig) {
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Get basic table statistics
            const targetRecords = await this.connectionManager.getRecordCount(targetClient, tableConfig.name);
            // Run specific validator if available
            let validationResult;
            if (tableConfig.validator) {
                const validator = new tableConfig.validator();
                validationResult = await validator.validate();
            }
            else {
                // Basic validation for tables without specific validators
                validationResult = await this.basicTableValidation(tableConfig.name);
            }
            // Create mock migration stats
            const migrationStats = {
                totalProcessed: targetRecords,
                successful: validationResult.validRecords,
                failed: validationResult.invalidRecords,
                skipped: validationResult.missingRecords,
                startTime: new Date(),
                endTime: new Date(),
                duration: 0,
                errorDetails: validationResult.issues.filter(i => i.severity === 'error').map(i => i.message)
            };
            return {
                tableName: tableConfig.name,
                status: validationResult.isValid ? 'completed' : 'partial',
                sourceRecords: 0, // Unknown for this validation
                targetRecords,
                migrationStats,
                validationResult,
                executionTime: 0,
                metadata: {
                    priority: tableConfig.priority,
                    dependencies: tableConfig.dependencies,
                    hasValidator: !!tableConfig.validator
                }
            };
        }
        catch (error) {
            return {
                tableName: tableConfig.name,
                status: 'failed',
                sourceRecords: 0,
                targetRecords: 0,
                migrationStats: {
                    totalProcessed: 0,
                    successful: 0,
                    failed: 1,
                    skipped: 0,
                    startTime: new Date(),
                    endTime: new Date(),
                    duration: 0,
                    errorDetails: [error.message]
                },
                validationResult: {
                    isValid: false,
                    totalRecords: 0,
                    validRecords: 0,
                    invalidRecords: 1,
                    missingRecords: 0,
                    issues: [{
                            severity: 'error',
                            table: tableConfig.name,
                            message: `Table validation failed: ${error.message}`
                        }]
                },
                executionTime: 0,
                metadata: { error: error.message }
            };
        }
    }
    async basicTableValidation(tableName) {
        const targetClient = this.connectionManager.getTargetClient();
        const issues = [];
        try {
            const recordCount = await this.connectionManager.getRecordCount(targetClient, tableName);
            if (recordCount === 0) {
                issues.push({
                    severity: 'warning',
                    table: tableName,
                    message: `Table '${tableName}' is empty`,
                    suggestedFix: `Verify migration for ${tableName} completed successfully`
                });
            }
            return {
                isValid: issues.filter(i => i.severity === 'error').length === 0,
                totalRecords: recordCount,
                validRecords: recordCount,
                invalidRecords: 0,
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
                        table: tableName,
                        message: `Basic validation failed: ${error.message}`
                    }]
            };
        }
    }
    async validateCrossTableRelationships() {
        const issues = [];
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Check technician -> profile relationships
            const orphanedTechnicians = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM technicians t
        LEFT JOIN profiles p ON t.profile_id = p.id
        WHERE p.id IS NULL
      `);
            if (parseInt(orphanedTechnicians.rows[0]?.count || '0') > 0) {
                issues.push({
                    severity: 'error',
                    table: 'technicians',
                    message: `${orphanedTechnicians.rows[0].count} technicians with invalid profile references`,
                    suggestedFix: 'Verify profile migration completed before technician migration'
                });
            }
            // Check message_attachments -> messages/files relationships
            const orphanedAttachments = await targetClient.query(`
        SELECT COUNT(*) as count
        FROM message_attachments ma
        LEFT JOIN messages m ON ma.message_id = m.id
        LEFT JOIN files f ON ma.file_id = f.id
        WHERE m.id IS NULL OR f.id IS NULL
      `);
            if (parseInt(orphanedAttachments.rows[0]?.count || '0') > 0) {
                issues.push({
                    severity: 'error',
                    table: 'message_attachments',
                    message: `${orphanedAttachments.rows[0].count} message attachments with invalid references`,
                    suggestedFix: 'Verify messages and files migrations completed successfully'
                });
            }
            return {
                isValid: issues.filter(i => i.severity === 'error').length === 0,
                totalRecords: 2, // Number of relationship checks
                validRecords: 2 - issues.filter(i => i.severity === 'error').length,
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
                invalidRecords: 2,
                missingRecords: 0,
                issues: [{
                        severity: 'error',
                        table: 'system',
                        message: `Cross-table relationship validation failed: ${error.message}`
                    }]
            };
        }
    }
    async validateSystemPerformance() {
        const issues = [];
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Check for tables with excessive record counts that might impact performance
            const performanceChecks = await Promise.all(this.FINAL_MIGRATION_TABLES.map(async (table) => {
                const count = await this.connectionManager.getRecordCount(targetClient, table.name);
                return { table: table.name, count };
            }));
            const totalRecords = performanceChecks.reduce((sum, check) => sum + check.count, 0);
            if (totalRecords > 1000000) {
                issues.push({
                    severity: 'info',
                    table: 'system',
                    message: `High record count detected: ${totalRecords.toLocaleString()} total records`,
                    suggestedFix: 'Consider implementing query optimization and indexing strategies'
                });
            }
            return {
                isValid: true, // Performance issues are informational
                totalRecords: this.FINAL_MIGRATION_TABLES.length,
                validRecords: this.FINAL_MIGRATION_TABLES.length,
                invalidRecords: 0,
                missingRecords: 0,
                issues
            };
        }
        catch (error) {
            return {
                isValid: false,
                totalRecords: 0,
                validRecords: 0,
                invalidRecords: 1,
                missingRecords: 0,
                issues: [{
                        severity: 'error',
                        table: 'system',
                        message: `Performance validation failed: ${error.message}`
                    }]
            };
        }
    }
    async validateOverallDataIntegrity() {
        const issues = [];
        const targetClient = this.connectionManager.getTargetClient();
        try {
            // Overall integrity checks across all migrated tables
            const totalMigratedRecords = await Promise.all(this.FINAL_MIGRATION_TABLES.map(async (table) => {
                const count = await this.connectionManager.getRecordCount(targetClient, table.name);
                return { table: table.name, count };
            }));
            const tablesWithData = totalMigratedRecords.filter(t => t.count > 0);
            const emptyTables = totalMigratedRecords.filter(t => t.count === 0);
            if (emptyTables.length > 0) {
                issues.push({
                    severity: 'warning',
                    table: 'system',
                    message: `Empty tables detected: ${emptyTables.map(t => t.table).join(', ')}`,
                    suggestedFix: 'Verify all migrations completed successfully'
                });
            }
            const grandTotal = totalMigratedRecords.reduce((sum, t) => sum + t.count, 0);
            issues.push({
                severity: 'info',
                table: 'system',
                message: `Migration summary: ${grandTotal.toLocaleString()} total records across ${tablesWithData.length} tables`,
                suggestedFix: 'Migration statistics for reference'
            });
            return {
                isValid: issues.filter(i => i.severity === 'error').length === 0,
                totalRecords: this.FINAL_MIGRATION_TABLES.length,
                validRecords: tablesWithData.length,
                invalidRecords: 0,
                missingRecords: emptyTables.length,
                issues
            };
        }
        catch (error) {
            return {
                isValid: false,
                totalRecords: 0,
                validRecords: 0,
                invalidRecords: 1,
                missingRecords: 0,
                issues: [{
                        severity: 'error',
                        table: 'system',
                        message: `Data integrity validation failed: ${error.message}`
                    }]
            };
        }
    }
    determineOverallStatus(tableResults, systemChecks) {
        const criticalErrors = [
            ...systemChecks.flatMap(r => r.issues.filter(i => i.severity === 'error')),
            ...tableResults.flatMap(r => r.validationResult.issues.filter(i => i.severity === 'error'))
        ];
        if (criticalErrors.length > 0) {
            return 'failed';
        }
        const partialTables = tableResults.filter(r => r.status === 'partial').length;
        if (partialTables > 0) {
            return 'partial';
        }
        return 'ready';
    }
    generateSystemSummary(tableResults) {
        const totalTables = tableResults.length;
        const completedTables = tableResults.filter(r => r.status === 'completed').length;
        const partialTables = tableResults.filter(r => r.status === 'partial').length;
        const failedTables = tableResults.filter(r => r.status === 'failed').length;
        const totalRecords = tableResults.reduce((sum, r) => sum + r.targetRecords, 0);
        const totalIssues = tableResults.reduce((sum, r) => sum + r.validationResult.issues.length, 0);
        return {
            tables: {
                total: totalTables,
                completed: completedTables,
                partial: partialTables,
                failed: failedTables
            },
            records: {
                total: totalRecords,
                byTable: tableResults.map(r => ({
                    table: r.tableName,
                    count: r.targetRecords
                }))
            },
            issues: {
                total: totalIssues,
                byTable: tableResults.map(r => ({
                    table: r.tableName,
                    count: r.validationResult.issues.length
                }))
            }
        };
    }
    generateRecommendedActions(tableResults) {
        const actions = [];
        const failedTables = tableResults.filter(r => r.status === 'failed');
        if (failedTables.length > 0) {
            actions.push(`🔧 Fix critical issues in tables: ${failedTables.map(t => t.tableName).join(', ')}`);
        }
        const partialTables = tableResults.filter(r => r.status === 'partial');
        if (partialTables.length > 0) {
            actions.push(`⚠️ Review and resolve issues in tables: ${partialTables.map(t => t.tableName).join(', ')}`);
        }
        const emptyTables = tableResults.filter(r => r.targetRecords === 0);
        if (emptyTables.length > 0) {
            actions.push(`📊 Investigate empty tables: ${emptyTables.map(t => t.tableName).join(', ')}`);
        }
        if (actions.length === 0) {
            actions.push('✅ System validation passed - ready for production use');
            actions.push('📈 Consider performance testing with full dataset');
            actions.push('🗂️ Archive migration logs and scripts for future reference');
        }
        return actions;
    }
    async generateFinalSystemReport(systemResult) {
        const report = await this.reportGenerator.generateFinalReport(systemResult.tableResults);
        const reportPath = 'FINAL_SYSTEM_VALIDATION_REPORT.md';
        await this.reportGenerator.saveReport(report, reportPath);
        console.log(`📋 Final system validation report saved: ${reportPath}`);
    }
}
exports.FinalSystemValidator = FinalSystemValidator;
// Main execution
async function main() {
    try {
        const validator = new FinalSystemValidator();
        const result = await validator.validateFinalSystem();
        console.log('\n=== FINAL SYSTEM VALIDATION RESULTS ===');
        console.log(`Overall Status: ${result.overallStatus.toUpperCase()}`);
        console.log(`Tables Completed: ${result.summary.tables.completed}/${result.summary.tables.total}`);
        console.log(`Total Records: ${result.summary.records.total.toLocaleString()}`);
        console.log(`System Ready: ${result.overallStatus === 'ready' ? 'YES' : 'NO'}`);
        if (result.recommendedActions.length > 0) {
            console.log('\n📋 Recommended Actions:');
            result.recommendedActions.forEach((action, i) => {
                console.log(`${i + 1}. ${action}`);
            });
        }
        console.log('=====================================\n');
        if (result.overallStatus === 'failed') {
            process.exit(1);
        }
    }
    catch (error) {
        console.error('❌ Final system validation failed:', error);
        process.exit(1);
    }
}
// Run if called directly
if (require.main === module) {
    main();
}
//# sourceMappingURL=final-system-validation.js.map
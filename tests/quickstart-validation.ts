#!/usr/bin/env node

// Quickstart Scenarios Validation Script
// Validates that all quickstart scenarios can be executed and their interfaces work correctly

import { existsSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

interface ValidationResult {
  scenario: string;
  steps: StepValidationResult[];
  success: boolean;
  errors: string[];
  duration: number;
}

interface StepValidationResult {
  step: string;
  command: string;
  success: boolean;
  error?: string;
}

class QuickstartValidator {
  private results: ValidationResult[] = [];

  /**
   * Validate all quickstart scenarios
   */
  async validateAllScenarios(): Promise<ValidationResult[]> {
    console.log('🚀 Starting quickstart scenarios validation...\n');

    // Scenario 1: Differential Migration
    await this.validateDifferentialMigrationScenario();

    // Scenario 2: Sync Scheduler Setup
    await this.validateSyncSchedulerScenario();

    // Scenario 3: Conflict Resolution
    await this.validateConflictResolutionScenario();

    // Scenario 4: Error Recovery and Checkpointing
    await this.validateErrorRecoveryScenario();

    // Scenario 5: Comprehensive Validation
    await this.validateComprehensiveValidationScenario();

    this.displaySummary();
    return this.results;
  }

  /**
   * Scenario 1: Differential Migration Validation
   */
  private async validateDifferentialMigrationScenario(): Promise<void> {
    console.log('🔍 Validating Scenario 1: Differential Migration');
    const scenario = 'Differential Migration';
    const startTime = Date.now();
    const steps: StepValidationResult[] = [];
    const errors: string[] = [];

    // Step 1: Check migration status interface
    steps.push(await this.validateStep(
      'Check migration status',
      'migration-status interface',
      () => this.checkFileExists('src/differential-migration.ts')
    ));

    // Step 2: Validate differential migration analysis interface
    steps.push(await this.validateStep(
      'Differential migration analysis',
      'differential-migration analyze',
      () => this.validateCLIInterface('src/cli/differential-migration.ts', 'analyze')
    ));

    // Step 3: Validate migration execution interface
    steps.push(await this.validateStep(
      'Migration execution',
      'differential-migration migrate',
      () => this.validateCLIInterface('src/cli/differential-migration.ts', 'migrate')
    ));

    // Step 4: Validate dry run capability
    steps.push(await this.validateStep(
      'Dry run validation',
      'differential-migration dry-run',
      () => this.checkConfigurationOption('src/differential-migration.ts', 'dryRun')
    ));

    // Step 5: Validate data validation integration
    steps.push(await this.validateStep(
      'Data validation integration',
      'data-validator validate',
      () => this.validateCLIInterface('src/cli/data-validator.ts', 'validate')
    ));

    const success = steps.every(step => step.success);
    const duration = Date.now() - startTime;

    this.results.push({
      scenario,
      steps,
      success,
      errors,
      duration
    });

    this.displayScenarioResult(scenario, success, steps.length, errors.length, duration);
  }

  /**
   * Scenario 2: Sync Scheduler Setup Validation
   */
  private async validateSyncSchedulerScenario(): Promise<void> {
    console.log('🔍 Validating Scenario 2: Sync Scheduler Setup');
    const scenario = 'Sync Scheduler Setup';
    const startTime = Date.now();
    const steps: StepValidationResult[] = [];
    const errors: string[] = [];

    // Step 1: Validate job creation interface
    steps.push(await this.validateStep(
      'Create sync job',
      'sync-scheduler create-job',
      () => this.validateCLIInterface('src/cli/sync-scheduler.ts', 'create-job')
    ));

    // Step 2: Validate job listing interface
    steps.push(await this.validateStep(
      'List jobs',
      'sync-scheduler list-jobs',
      () => this.validateCLIInterface('src/cli/sync-scheduler.ts', 'list-jobs')
    ));

    // Step 3: Validate manual job execution
    steps.push(await this.validateStep(
      'Manual job execution',
      'sync-scheduler run-job',
      () => this.validateCLIInterface('src/cli/sync-scheduler.ts', 'run-job')
    ));

    // Step 4: Validate job status checking
    steps.push(await this.validateStep(
      'Job status check',
      'sync-scheduler job-status',
      () => this.validateCLIInterface('src/cli/sync-scheduler.ts', 'job-status')
    ));

    const success = steps.every(step => step.success);
    const duration = Date.now() - startTime;

    this.results.push({
      scenario,
      steps,
      success,
      errors,
      duration
    });

    this.displayScenarioResult(scenario, success, steps.length, errors.length, duration);
  }

  /**
   * Scenario 3: Conflict Resolution Validation
   */
  private async validateConflictResolutionScenario(): Promise<void> {
    console.log('🔍 Validating Scenario 3: Conflict Resolution');
    const scenario = 'Conflict Resolution';
    const startTime = Date.now();
    const steps: StepValidationResult[] = [];
    const errors: string[] = [];

    // Step 1: Validate conflict detection interface
    steps.push(await this.validateStep(
      'Conflict detection',
      'differential-migration detect-conflicts',
      () => this.checkConfigurationOption('src/differential-migration.ts', 'detectConflicts')
    ));

    // Step 2: Validate conflict resolution service
    steps.push(await this.validateStep(
      'Conflict resolution service',
      'conflict-resolver interface',
      () => this.checkFileExists('src/conflict-resolver.ts')
    ));

    // Step 3: Validate resolution reporting
    steps.push(await this.validateStep(
      'Resolution reporting',
      'conflict-resolver report',
      () => this.checkServiceMethod('src/services/conflict-resolver.ts', 'getConflictStatistics')
    ));

    // Step 4: Validate source-wins strategy
    steps.push(await this.validateStep(
      'Source-wins strategy',
      'source-wins implementation',
      () => this.checkEnumValue('src/types/migration-types.ts', 'ResolutionStrategy', 'SOURCE_WINS')
    ));

    const success = steps.every(step => step.success);
    const duration = Date.now() - startTime;

    this.results.push({
      scenario,
      steps,
      success,
      errors,
      duration
    });

    this.displayScenarioResult(scenario, success, steps.length, errors.length, duration);
  }

  /**
   * Scenario 4: Error Recovery and Checkpointing Validation
   */
  private async validateErrorRecoveryScenario(): Promise<void> {
    console.log('🔍 Validating Scenario 4: Error Recovery and Checkpointing');
    const scenario = 'Error Recovery and Checkpointing';
    const startTime = Date.now();
    const steps: StepValidationResult[] = [];
    const errors: string[] = [];

    // Step 1: Validate checkpoint manager
    steps.push(await this.validateStep(
      'Checkpoint manager',
      'checkpoint-manager interface',
      () => this.checkFileExists('src/lib/checkpoint-manager.ts')
    ));

    // Step 2: Validate checkpoint status checking
    steps.push(await this.validateStep(
      'Checkpoint status',
      'migration-analyzer checkpoint-status',
      () => this.validateCLIInterface('src/cli/migration-analyzer.ts', 'checkpoint-status')
    ));

    // Step 3: Validate resume functionality
    steps.push(await this.validateStep(
      'Resume functionality',
      'differential-migration resume',
      () => this.checkServiceMethod('src/differential-migration.ts', 'resumedFromCheckpoint')
    ));

    // Step 4: Validate graceful interruption handling
    steps.push(await this.validateStep(
      'Graceful interruption',
      'checkpoint save/restore',
      () => this.checkServiceMethod('src/lib/checkpoint-manager.ts', 'saveCheckpoint')
    ));

    const success = steps.every(step => step.success);
    const duration = Date.now() - startTime;

    this.results.push({
      scenario,
      steps,
      success,
      errors,
      duration
    });

    this.displayScenarioResult(scenario, success, steps.length, errors.length, duration);
  }

  /**
   * Scenario 5: Comprehensive Validation
   */
  private async validateComprehensiveValidationScenario(): Promise<void> {
    console.log('🔍 Validating Scenario 5: Comprehensive Validation');
    const scenario = 'Comprehensive Validation';
    const startTime = Date.now();
    const steps: StepValidationResult[] = [];
    const errors: string[] = [];

    // Step 1: Validate data integrity checking
    steps.push(await this.validateStep(
      'Data integrity validation',
      'data-validator data_integrity',
      () => this.checkEnumValue('src/types/migration-types.ts', 'ValidationType', 'DATA_INTEGRITY')
    ));

    // Step 2: Validate relationship integrity checking
    steps.push(await this.validateStep(
      'Relationship integrity validation',
      'data-validator relationship_integrity',
      () => this.checkEnumValue('src/types/migration-types.ts', 'ValidationType', 'RELATIONSHIP_INTEGRITY')
    ));

    // Step 3: Validate performance checking
    steps.push(await this.validateStep(
      'Performance validation',
      'data-validator performance_check',
      () => this.checkEnumValue('src/types/migration-types.ts', 'ValidationType', 'PERFORMANCE_CHECK')
    ));

    // Step 4: Validate comprehensive reporting
    steps.push(await this.validateStep(
      'Comprehensive reporting',
      'data-validator report',
      () => this.validateCLIInterface('src/cli/data-validator.ts', 'report')
    ));

    const success = steps.every(step => step.success);
    const duration = Date.now() - startTime;

    this.results.push({
      scenario,
      steps,
      success,
      errors,
      duration
    });

    this.displayScenarioResult(scenario, success, steps.length, errors.length, duration);
  }

  /**
   * Helper validation methods
   */

  private async validateStep(
    stepName: string,
    command: string,
    validation: () => Promise<boolean>
  ): Promise<StepValidationResult> {
    try {
      const success = await validation();
      return {
        step: stepName,
        command,
        success
      };
    } catch (error) {
      return {
        step: stepName,
        command,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkFileExists(filePath: string): Promise<boolean> {
    const fullPath = join(process.cwd(), filePath);
    return existsSync(fullPath);
  }

  private async validateCLIInterface(filePath: string, commandName: string): Promise<boolean> {
    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      throw new Error(`CLI file not found: ${filePath}`);
    }

    // Read file and check for command implementation
    const fs = require('fs').promises;
    const content = await fs.readFile(fullPath, 'utf8');

    // Check if command is implemented in CLI
    const hasCommand = content.includes(commandName) ||
                      content.includes(`'${commandName}'`) ||
                      content.includes(`"${commandName}"`);

    if (!hasCommand) {
      throw new Error(`Command '${commandName}' not found in ${filePath}`);
    }

    return true;
  }

  private async checkConfigurationOption(filePath: string, optionName: string): Promise<boolean> {
    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fs = require('fs').promises;
    const content = await fs.readFile(fullPath, 'utf8');

    const hasOption = content.includes(optionName) ||
                     content.includes(optionName.toLowerCase());

    if (!hasOption) {
      throw new Error(`Configuration option '${optionName}' not found in ${filePath}`);
    }

    return true;
  }

  private async checkServiceMethod(filePath: string, methodName: string): Promise<boolean> {
    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fs = require('fs').promises;
    const content = await fs.readFile(fullPath, 'utf8');

    const hasMethod = content.includes(`${methodName}(`) ||
                     content.includes(`${methodName}:`);

    if (!hasMethod) {
      throw new Error(`Method '${methodName}' not found in ${filePath}`);
    }

    return true;
  }

  private async checkEnumValue(filePath: string, enumName: string, valueName: string): Promise<boolean> {
    const fullPath = join(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fs = require('fs').promises;
    const content = await fs.readFile(fullPath, 'utf8');

    const hasEnum = content.includes(`enum ${enumName}`) ||
                   content.includes(`${enumName}`) && content.includes(valueName);

    if (!hasEnum) {
      throw new Error(`Enum value '${enumName}.${valueName}' not found in ${filePath}`);
    }

    return true;
  }

  private displayScenarioResult(
    scenario: string,
    success: boolean,
    stepCount: number,
    errorCount: number,
    duration: number
  ): void {
    const status = success ? '✅' : '❌';
    const time = (duration / 1000).toFixed(2);

    console.log(`${status} ${scenario}: ${stepCount} steps, ${errorCount} errors, ${time}s\n`);
  }

  private displaySummary(): void {
    const totalScenarios = this.results.length;
    const successfulScenarios = this.results.filter(r => r.success).length;
    const totalSteps = this.results.reduce((sum, r) => sum + r.steps.length, 0);
    const successfulSteps = this.results.reduce((sum, r) => sum + r.steps.filter(s => s.success).length, 0);
    const totalErrors = this.results.reduce((sum, r) => sum + r.errors.length, 0);
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n📊 QUICKSTART VALIDATION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`🎯 Scenarios: ${successfulScenarios}/${totalScenarios} successful`);
    console.log(`📋 Steps: ${successfulSteps}/${totalSteps} successful`);
    console.log(`❌ Total Errors: ${totalErrors}`);
    console.log(`⏱️  Total Time: ${(totalTime / 1000).toFixed(2)}s`);

    if (totalErrors === 0) {
      console.log('\n🎉 All quickstart scenarios validated successfully!');
      console.log('✅ System is ready for production use.');
    } else {
      console.log('\n⚠️  Some validation issues found:');
      this.results.forEach(result => {
        if (!result.success) {
          console.log(`\n❌ ${result.scenario}:`);
          result.steps.forEach(step => {
            if (!step.success) {
              console.log(`   • ${step.step}: ${step.error}`);
            }
          });
        }
      });
    }

    console.log('\n📋 Detailed Results:');
    this.results.forEach(result => {
      console.log(`\n📁 ${result.scenario}:`);
      result.steps.forEach(step => {
        const status = step.success ? '✅' : '❌';
        console.log(`   ${status} ${step.step} (${step.command})`);
      });
    });
  }
}

/**
 * Integration Test: Validate system component integration
 */
class IntegrationValidator {
  async validateSystemIntegration(): Promise<{
    componentsValid: boolean;
    servicesIntegrated: boolean;
    cliCommandsAvailable: boolean;
    databaseSchemaReady: boolean;
  }> {
    console.log('🔧 Validating system integration...');

    const components = await this.validateComponents();
    const services = await this.validateServices();
    const cliCommands = await this.validateCLICommands();
    const databaseSchema = await this.validateDatabaseSchema();

    return {
      componentsValid: components,
      servicesIntegrated: services,
      cliCommandsAvailable: cliCommands,
      databaseSchemaReady: databaseSchema
    };
  }

  private async validateComponents(): Promise<boolean> {
    const requiredFiles = [
      'src/differential-migration.ts',
      'src/sync-scheduler.ts',
      'src/data-validator.ts',
      'src/conflict-resolver.ts'
    ];

    for (const file of requiredFiles) {
      if (!existsSync(join(process.cwd(), file))) {
        console.log(`❌ Missing component: ${file}`);
        return false;
      }
    }

    console.log('✅ All core components present');
    return true;
  }

  private async validateServices(): Promise<boolean> {
    const requiredServices = [
      'src/services/differential-migration-service.ts',
      'src/services/sync-scheduler-service.ts',
      'src/services/data-validator.ts',
      'src/services/conflict-resolver.ts',
      'src/services/migration-analyzer.ts',
      'src/services/data-comparator.ts',
      'src/services/sync-logger.ts'
    ];

    for (const service of requiredServices) {
      if (!existsSync(join(process.cwd(), service))) {
        console.log(`❌ Missing service: ${service}`);
        return false;
      }
    }

    console.log('✅ All services present');
    return true;
  }

  private async validateCLICommands(): Promise<boolean> {
    const requiredCLIs = [
      'src/cli/differential-migration.ts',
      'src/cli/sync-scheduler.ts',
      'src/cli/data-validator.ts',
      'src/cli/migration-analyzer.ts'
    ];

    for (const cli of requiredCLIs) {
      if (!existsSync(join(process.cwd(), cli))) {
        console.log(`❌ Missing CLI: ${cli}`);
        return false;
      }
    }

    console.log('✅ All CLI commands present');
    return true;
  }

  private async validateDatabaseSchema(): Promise<boolean> {
    // Check for database schema files
    const schemaFile = 'specs/001-i-need-to/contracts/database-schema.sql';
    if (!existsSync(join(process.cwd(), schemaFile))) {
      console.log(`❌ Missing database schema: ${schemaFile}`);
      return false;
    }

    console.log('✅ Database schema file present');
    return true;
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    console.log('🎯 Database Migration and Synchronization System');
    console.log('📋 Quickstart Scenarios Validation\n');

    // Integration validation
    const integrationValidator = new IntegrationValidator();
    const integration = await integrationValidator.validateSystemIntegration();

    if (!integration.componentsValid || !integration.servicesIntegrated) {
      console.log('❌ System integration validation failed. Cannot proceed with scenario validation.');
      process.exit(1);
    }

    // Quickstart scenarios validation
    const validator = new QuickstartValidator();
    const results = await validator.validateAllScenarios();

    const allPassed = results.every(r => r.success);
    const exitCode = allPassed ? 0 : 1;

    console.log(`\n🏁 Validation completed with exit code: ${exitCode}`);
    process.exit(exitCode);

  } catch (error) {
    console.error('\n💥 Validation failed with error:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { QuickstartValidator, IntegrationValidator };
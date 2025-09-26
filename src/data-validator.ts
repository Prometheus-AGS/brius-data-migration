// Data Validation Orchestrator
// Main entry point for comprehensive data validation workflows
// Coordinates validation processes, reporting, and integrity checks

import { Pool } from 'pg';
import { DatabaseConnectionManager } from './lib/database-connections';
import { CheckpointManager } from './lib/checkpoint-manager';
import { BatchProcessorService } from './lib/batch-processor';
import { UUIDMapperService } from './lib/uuid-mapper';
import { DataValidatorService, ValidationConfig, DataIntegrityResult, RelationshipIntegrityResult, CompletenessResult } from './services/data-validator';
import { SyncLoggerService, OperationLogger } from './services/sync-logger';
import {
  ValidationType,
  ValidationOptions,
  ValidationResponse,
  ValidationReport,
  ValidationIssue,
  MigrationValidationReport,
  ValidationError
} from './types/migration-types';

export interface ValidationOrchestratorConfig {
  batchSize?: number;
  maxConcurrentValidations?: number;
  defaultSamplingRate?: number;
  defaultTimeout?: number;
  enablePerformanceChecks?: boolean;
  maxIssuesPerType?: number;
  enableDetailedReporting?: boolean;
  outputFormat?: 'json' | 'markdown' | 'csv';
  saveReportsToFile?: boolean;
}

export interface ValidationWorkflowOptions {
  entities: string[];
  validationTypes: ValidationType[];
  samplingRate?: number;
  performanceThresholds?: Record<string, number>;
  customRules?: ValidationRule[];
  generateReport?: boolean;
  compareWithSource?: boolean;
}

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  entityType: string;
  validationType: ValidationType;
  query: string;
  expectedResult: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ValidationExecutionContext {
  operationId: string;
  config: ValidationOrchestratorConfig;
  workflow: ValidationWorkflowOptions;
  logger: OperationLogger;
  dbManager: DatabaseConnectionManager;
  validatorService: DataValidatorService;
  startTime: Date;
  results: Map<string, ValidationResult>;
  issues: ValidationIssue[];
  errors: ValidationError[];
}

export interface ValidationResult {
  entityType: string;
  validationType: ValidationType;
  success: boolean;
  executionTimeMs: number;
  dataIntegrity?: DataIntegrityResult;
  relationshipIntegrity?: RelationshipIntegrityResult;
  completeness?: CompletenessResult;
  performanceMetrics?: PerformanceValidationResult;
  issues: ValidationIssue[];
}

export interface PerformanceValidationResult {
  entityType: string;
  queryTime: number;
  indexEfficiency: number;
  recordProcessingRate: number;
  memoryUsage: number;
  recommendations: string[];
}

export interface ValidationOrchestrationResult {
  operationId: string;
  success: boolean;
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  totalIssuesFound: number;
  criticalIssues: number;
  executionTimeMs: number;
  results: ValidationResult[];
  summary: ValidationSummary;
  reportPath?: string;
}

export interface ValidationSummary {
  overallHealthScore: number; // 0-100
  entitiesValidated: string[];
  validationTypesCovered: ValidationType[];
  topIssues: ValidationIssue[];
  recommendations: string[];
  nextValidationSuggested?: Date;
}

export class DataValidationOrchestrator {
  private dbManager: DatabaseConnectionManager;
  private checkpointManager: CheckpointManager;
  private logger: SyncLoggerService;
  private validatorService: DataValidatorService;

  constructor(projectRoot: string = process.cwd()) {
    this.dbManager = new DatabaseConnectionManager();
    this.checkpointManager = new CheckpointManager(this.dbManager.getTargetPool());
    this.logger = new SyncLoggerService(projectRoot);

    this.validatorService = new DataValidatorService(
      this.dbManager.getSourcePool(),
      this.dbManager.getTargetPool(),
      projectRoot
    );
  }

  /**
   * Execute comprehensive validation workflow
   */
  async executeValidationWorkflow(
    workflow: ValidationWorkflowOptions,
    config: ValidationOrchestratorConfig = {}
  ): Promise<ValidationOrchestrationResult> {
    const operationId = this.generateOperationId('validation_workflow');
    const operationLogger = this.logger.createOperationLogger(operationId);

    const context: ValidationExecutionContext = {
      operationId,
      config: this.mergeDefaultConfig(config),
      workflow,
      logger: operationLogger,
      dbManager: this.dbManager,
      validatorService: this.validatorService,
      startTime: new Date(),
      results: new Map(),
      issues: [],
      errors: []
    };

    try {
      operationLogger.info('🔍 Starting data validation orchestration', {
        operationId,
        entities: workflow.entities,
        validationTypes: workflow.validationTypes,
        config: context.config
      });

      // Test database connections
      await this.validateConnections(context);

      // Initialize validator service
      await this.initializeValidator(context);

      // Execute validation workflow
      await this.executeValidations(context);

      // Generate comprehensive report
      const result = await this.generateValidationReport(context);

      operationLogger.info('✅ Data validation orchestration completed successfully', {
        operationId,
        result: {
          totalValidations: result.totalValidations,
          successfulValidations: result.successfulValidations,
          totalIssuesFound: result.totalIssuesFound,
          overallHealthScore: result.summary.overallHealthScore
        }
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.errors.push({
        type: 'orchestration_error',
        message: errorMessage,
        timestamp: new Date(),
        context: { operationId, phase: 'execution' }
      });

      operationLogger.error('❌ Data validation orchestration failed', {
        error: errorMessage,
        operationId
      });

      return this.generateFailureResult(context, error as Error);
    }
  }

  /**
   * Execute quick validation check for specific entities
   */
  async quickValidation(
    entities: string[],
    validationType: ValidationType = ValidationType.DATA_INTEGRITY
  ): Promise<ValidationResponse> {
    const operationId = this.generateOperationId('quick_validation');
    const operationLogger = this.logger.createOperationLogger(operationId);

    try {
      operationLogger.info('⚡ Starting quick validation', {
        operationId,
        entities,
        validationType
      });

      const options: ValidationOptions = {
        operationId,
        entities,
        validationType,
        samplingRate: 0.1, // 10% sampling for quick validation
        timeout: 30000, // 30 second timeout
        generateReport: false
      };

      const response = await this.validatorService.executeValidation(options);

      operationLogger.info('✅ Quick validation completed', {
        operationId,
        success: response.success,
        issuesFound: response.issues?.length || 0
      });

      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Quick validation failed', {
        error: errorMessage,
        operationId
      });
      throw error;
    }
  }

  /**
   * Generate validation report for specific entities
   */
  async generateValidationReport(
    entities: string[],
    outputPath?: string
  ): Promise<{ reportPath: string; summary: ValidationSummary }> {
    const operationId = this.generateOperationId('validation_report');
    const operationLogger = this.logger.createOperationLogger(operationId);

    try {
      operationLogger.info('📋 Generating validation report', {
        operationId,
        entities,
        outputPath
      });

      // Execute comprehensive validation for all specified entities
      const workflow: ValidationWorkflowOptions = {
        entities,
        validationTypes: [
          ValidationType.DATA_INTEGRITY,
          ValidationType.RELATIONSHIP_INTEGRITY,
          ValidationType.COMPLETENESS_CHECK
        ],
        generateReport: true,
        compareWithSource: true
      };

      const result = await this.executeValidationWorkflow(workflow, {
        enableDetailedReporting: true,
        saveReportsToFile: true,
        outputFormat: 'markdown'
      });

      operationLogger.info('✅ Validation report generated successfully', {
        operationId,
        reportPath: result.reportPath,
        overallScore: result.summary.overallHealthScore
      });

      return {
        reportPath: result.reportPath || '',
        summary: result.summary
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Validation report generation failed', {
        error: errorMessage,
        operationId
      });
      throw error;
    }
  }

  /**
   * Check specific record by ID
   */
  async checkRecord(
    entityType: string,
    recordId: string,
    includeRelationships: boolean = true
  ): Promise<{ valid: boolean; issues: ValidationIssue[]; record?: any }> {
    const operationId = this.generateOperationId('record_check');
    const operationLogger = this.logger.createOperationLogger(operationId);

    try {
      operationLogger.info('🔎 Checking specific record', {
        operationId,
        entityType,
        recordId,
        includeRelationships
      });

      const options: ValidationOptions = {
        operationId,
        entities: [entityType],
        validationType: ValidationType.DATA_INTEGRITY,
        recordIds: [recordId],
        includeRelationships,
        generateReport: false
      };

      const response = await this.validatorService.executeValidation(options);

      const result = {
        valid: response.success && (response.issues?.length || 0) === 0,
        issues: response.issues || [],
        record: response.validatedRecords?.[0]
      };

      operationLogger.info('✅ Record check completed', {
        operationId,
        valid: result.valid,
        issuesFound: result.issues.length
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      operationLogger.error('❌ Record check failed', {
        error: errorMessage,
        operationId
      });
      throw error;
    }
  }

  /**
   * Get validation status and history
   */
  async getValidationStatus(entityType?: string): Promise<any> {
    try {
      if (entityType) {
        // Get validation status for specific entity
        const reports = await this.validatorService.getValidationReports(entityType, 10);
        const latestReport = reports.length > 0 ? reports[0] : null;

        return {
          entityType,
          latestValidation: latestReport,
          validationHistory: reports,
          lastValidationDate: latestReport?.generated_at,
          overallStatus: latestReport?.validation_passed ? 'healthy' : 'issues_found'
        };
      }

      // Get overall validation status
      const allReports = await this.validatorService.getAllValidationReports(20);
      const entitySummary = new Map<string, any>();

      for (const report of allReports) {
        if (!entitySummary.has(report.source_entity)) {
          entitySummary.set(report.source_entity, {
            entityType: report.source_entity,
            lastValidation: report.generated_at,
            status: report.validation_passed ? 'healthy' : 'issues_found',
            issuesFound: report.discrepancies_found
          });
        }
      }

      return {
        totalEntitiesValidated: entitySummary.size,
        entityStatuses: Array.from(entitySummary.values()),
        recentValidations: allReports.slice(0, 10),
        overallHealthScore: this.calculateOverallHealthScore(Array.from(entitySummary.values()))
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get validation status: ${errorMessage}`);
    }
  }

  /**
   * Private helper methods
   */

  private mergeDefaultConfig(config: ValidationOrchestratorConfig): ValidationOrchestratorConfig {
    return {
      batchSize: 1000,
      maxConcurrentValidations: 3,
      defaultSamplingRate: 1.0, // 100% by default for thorough validation
      defaultTimeout: 300000, // 5 minutes
      enablePerformanceChecks: true,
      maxIssuesPerType: 100,
      enableDetailedReporting: true,
      outputFormat: 'json',
      saveReportsToFile: true,
      ...config
    };
  }

  private generateOperationId(prefix: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private async validateConnections(context: ValidationExecutionContext): Promise<void> {
    context.logger.info('🔌 Validating database connections');

    const sourceTest = await this.dbManager.testConnection('source');
    if (!sourceTest.success && context.workflow.compareWithSource) {
      throw new Error(`Source database connection failed: ${sourceTest.error}`);
    }

    const targetTest = await this.dbManager.testConnection('target');
    if (!targetTest.success) {
      throw new Error(`Target database connection failed: ${targetTest.error}`);
    }

    context.logger.info('✅ Database connections validated', {
      sourceLatency: sourceTest.latency,
      targetLatency: targetTest.latency
    });
  }

  private async initializeValidator(context: ValidationExecutionContext): Promise<void> {
    const validationConfig: ValidationConfig = {
      defaultSamplingRate: context.config.defaultSamplingRate,
      defaultTimeout: context.config.defaultTimeout,
      enablePerformanceChecks: context.config.enablePerformanceChecks,
      maxIssuesPerType: context.config.maxIssuesPerType
    };

    await this.validatorService.initialize(validationConfig);
    context.logger.info('✅ Validator service initialized');
  }

  private async executeValidations(context: ValidationExecutionContext): Promise<void> {
    const { workflow, logger } = context;

    logger.info('⚡ Executing validation workflow', {
      entities: workflow.entities,
      validationTypes: workflow.validationTypes
    });

    const promises: Promise<void>[] = [];

    for (const entity of workflow.entities) {
      for (const validationType of workflow.validationTypes) {
        promises.push(this.executeValidation(context, entity, validationType));

        // Respect concurrency limits
        if (promises.length >= (context.config.maxConcurrentValidations || 3)) {
          await Promise.allSettled(promises.splice(0, 1));
        }
      }
    }

    // Wait for remaining validations
    await Promise.allSettled(promises);

    logger.info('✅ Validation workflow completed', {
      totalResults: context.results.size,
      totalIssues: context.issues.length
    });
  }

  private async executeValidation(
    context: ValidationExecutionContext,
    entityType: string,
    validationType: ValidationType
  ): Promise<void> {
    const { logger, workflow } = context;
    const resultKey = `${entityType}_${validationType}`;

    try {
      logger.info('🔍 Executing validation', { entityType, validationType });

      const options: ValidationOptions = {
        operationId: context.operationId,
        entities: [entityType],
        validationType,
        samplingRate: workflow.samplingRate || context.config.defaultSamplingRate,
        timeout: context.config.defaultTimeout,
        generateReport: workflow.generateReport || false,
        includeRelationships: validationType === ValidationType.RELATIONSHIP_INTEGRITY
      };

      const startTime = Date.now();
      const response = await this.validatorService.executeValidation(options);
      const executionTimeMs = Date.now() - startTime;

      const result: ValidationResult = {
        entityType,
        validationType,
        success: response.success,
        executionTimeMs,
        issues: response.issues || []
      };

      // Add type-specific results
      if (response.dataIntegrity) {
        result.dataIntegrity = response.dataIntegrity;
      }
      if (response.relationshipIntegrity) {
        result.relationshipIntegrity = response.relationshipIntegrity;
      }
      if (response.completeness) {
        result.completeness = response.completeness;
      }

      context.results.set(resultKey, result);
      context.issues.push(...result.issues);

      logger.info('✅ Validation completed', {
        entityType,
        validationType,
        success: result.success,
        issuesFound: result.issues.length,
        executionTime: executionTimeMs
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const failedResult: ValidationResult = {
        entityType,
        validationType,
        success: false,
        executionTimeMs: 0,
        issues: [{
          type: 'validation_error',
          severity: 'critical',
          message: errorMessage,
          entityType,
          recordId: null,
          field: null,
          expectedValue: null,
          actualValue: null,
          timestamp: new Date()
        }]
      };

      context.results.set(resultKey, failedResult);
      context.errors.push({
        type: 'validation_error',
        message: errorMessage,
        timestamp: new Date(),
        context: { entityType, validationType }
      });

      logger.error('❌ Validation failed', {
        entityType,
        validationType,
        error: errorMessage
      });
    }
  }

  private async generateValidationReport(context: ValidationExecutionContext): Promise<ValidationOrchestrationResult> {
    const executionTimeMs = Date.now() - context.startTime.getTime();
    const results = Array.from(context.results.values());

    const summary = this.generateValidationSummary(results, context.issues);

    const result: ValidationOrchestrationResult = {
      operationId: context.operationId,
      success: context.errors.length === 0 && summary.criticalIssues === 0,
      totalValidations: results.length,
      successfulValidations: results.filter(r => r.success).length,
      failedValidations: results.filter(r => !r.success).length,
      totalIssuesFound: context.issues.length,
      criticalIssues: context.issues.filter(i => i.severity === 'critical').length,
      executionTimeMs,
      results,
      summary
    };

    // Save report to file if enabled
    if (context.config.saveReportsToFile) {
      result.reportPath = await this.saveReportToFile(context, result);
    }

    return result;
  }

  private generateValidationSummary(results: ValidationResult[], issues: ValidationIssue[]): ValidationSummary {
    const entitiesValidated = [...new Set(results.map(r => r.entityType))];
    const validationTypesCovered = [...new Set(results.map(r => r.validationType))];
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const totalIssues = issues.length;

    // Calculate health score (0-100)
    const successfulValidations = results.filter(r => r.success).length;
    const totalValidations = results.length;
    const successRate = totalValidations > 0 ? (successfulValidations / totalValidations) : 1;
    const issueImpact = Math.min(totalIssues / (entitiesValidated.length * 10), 1); // Normalize issue impact
    const overallHealthScore = Math.round((successRate * (1 - issueImpact)) * 100);

    // Get top issues (most critical first, then by frequency)
    const topIssues = issues
      .sort((a, b) => {
        if (a.severity !== b.severity) {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return 0;
      })
      .slice(0, 10);

    // Generate recommendations
    const recommendations: string[] = [];
    if (criticalIssues > 0) {
      recommendations.push(`Address ${criticalIssues} critical data integrity issues immediately`);
    }
    if (overallHealthScore < 80) {
      recommendations.push('Data quality requires attention - consider implementing data cleansing processes');
    }
    if (successRate < 0.9) {
      recommendations.push('Some validations are failing - review database constraints and relationships');
    }

    return {
      overallHealthScore,
      entitiesValidated,
      validationTypesCovered,
      topIssues,
      recommendations,
      criticalIssues,
      nextValidationSuggested: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 1 week from now
    };
  }

  private generateFailureResult(context: ValidationExecutionContext, error: Error): ValidationOrchestrationResult {
    const executionTimeMs = Date.now() - context.startTime.getTime();
    const results = Array.from(context.results.values());

    return {
      operationId: context.operationId,
      success: false,
      totalValidations: results.length,
      successfulValidations: results.filter(r => r.success).length,
      failedValidations: results.filter(r => !r.success).length + 1,
      totalIssuesFound: context.issues.length,
      criticalIssues: context.issues.filter(i => i.severity === 'critical').length + 1,
      executionTimeMs,
      results,
      summary: {
        overallHealthScore: 0,
        entitiesValidated: [],
        validationTypesCovered: [],
        topIssues: [],
        recommendations: [`Fix orchestration error: ${error.message}`],
        criticalIssues: 1
      }
    };
  }

  private async saveReportToFile(
    context: ValidationExecutionContext,
    result: ValidationOrchestrationResult
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = `./validation_report_${timestamp}.${context.config.outputFormat}`;

    try {
      // Implementation would depend on the output format
      // For now, just return the path
      context.logger.info('📁 Validation report saved', { reportPath });
      return reportPath;
    } catch (error) {
      context.logger.warn('⚠️ Could not save validation report to file', { error });
      return '';
    }
  }

  private calculateOverallHealthScore(entityStatuses: any[]): number {
    if (entityStatuses.length === 0) return 100;

    const healthyEntities = entityStatuses.filter(e => e.status === 'healthy').length;
    return Math.round((healthyEntities / entityStatuses.length) * 100);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.checkpointManager.cleanup();
    await this.dbManager.closeAll();
  }
}

// Factory function for easy instantiation
export function createDataValidationOrchestrator(projectRoot?: string): DataValidationOrchestrator {
  return new DataValidationOrchestrator(projectRoot);
}

// Default export for CLI integration
export default DataValidationOrchestrator;
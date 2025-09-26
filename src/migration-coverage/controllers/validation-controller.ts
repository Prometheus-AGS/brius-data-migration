/**
 * Validation Controller
 *
 * Handles validation execution and results endpoints.
 */

import { Request, Response } from 'express';
import { DataValidator, ValidationResult, ValidationSummary } from '../services/data-validator';
import { CoverageCalculator } from '../services/coverage-calculator';
import { ReportGenerator } from '../services/report-generator';
import { DataEntity } from '../models';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

interface ValidationJobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  progress: number;
  results?: ValidationSummary;
  error?: string;
}

export class ValidationController {
  private readonly dataValidator: DataValidator;
  private readonly coverageCalculator: CoverageCalculator;
  private readonly reportGenerator: ReportGenerator;
  private readonly dbPool: Pool;
  private readonly validationJobs: Map<string, ValidationJobStatus> = new Map();
  private readonly validationResults: Map<string, {
    results: ValidationResult[];
    summary: ValidationSummary;
    integrityChecks: any[];
  }> = new Map();

  constructor(
    dataValidator: DataValidator,
    coverageCalculator: CoverageCalculator,
    reportGenerator: ReportGenerator,
    dbPool: Pool
  ) {
    this.dataValidator = dataValidator;
    this.coverageCalculator = coverageCalculator;
    this.reportGenerator = reportGenerator;
    this.dbPool = dbPool;
  }

  /**
   * POST /validation/run
   * Initiates a comprehensive validation of migration data
   */
  public async runValidation(req: Request, res: Response): Promise<void> {
    try {
      const { entities, includeIntegrityChecks, includeCrossEntity } = req.body;

      // Validate request body
      if (entities && !Array.isArray(entities)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'entities must be an array',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Create validation job
      const jobId = uuidv4();
      const job: ValidationJobStatus = {
        id: jobId,
        status: 'pending',
        startTime: new Date().toISOString(),
        progress: 0
      };

      this.validationJobs.set(jobId, job);

      // Start validation asynchronously
      this.executeValidation(jobId, {
        entities: entities || [],
        includeIntegrityChecks: includeIntegrityChecks !== false,
        includeCrossEntity: includeCrossEntity !== false
      }).catch(error => {
        console.error(`Validation job ${jobId} failed:`, error);
        const failedJob = this.validationJobs.get(jobId);
        if (failedJob) {
          failedJob.status = 'failed';
          failedJob.endTime = new Date().toISOString();
          failedJob.error = error.message;
          this.validationJobs.set(jobId, failedJob);
        }
      });

      // Return job ID immediately
      res.status(202).json({
        jobId,
        status: 'accepted',
        message: 'Validation job started',
        estimatedDuration: this.estimateValidationDuration(entities?.length || 0),
        pollUrl: `/validation/results/${jobId}`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error starting validation:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to start validation',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * GET /validation/results/{id}
   * Returns validation results for a specific job
   */
  public async getValidationResults(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const includeDetails = req.query.includeDetails === 'true';
      const format = (req.query.format as string) || 'json';

      if (!id) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Validation job ID is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const job = this.validationJobs.get(id);
      if (!job) {
        res.status(404).json({
          error: 'Not Found',
          message: 'Validation job not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // If job is still running or pending
      if (job.status === 'pending' || job.status === 'running') {
        res.status(200).json({
          jobId: id,
          status: job.status,
          progress: job.progress,
          startTime: job.startTime,
          estimatedCompletion: this.estimateCompletion(job),
          message: job.status === 'pending'
            ? 'Validation job is queued'
            : 'Validation is in progress',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // If job failed
      if (job.status === 'failed') {
        res.status(500).json({
          jobId: id,
          status: job.status,
          progress: job.progress,
          startTime: job.startTime,
          endTime: job.endTime,
          error: job.error,
          message: 'Validation job failed',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Job completed - return results
      const validationData = this.validationResults.get(id);
      if (!validationData || !job.results) {
        res.status(500).json({
          error: 'Internal server error',
          message: 'Validation results not available',
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Handle different response formats
      if (format === 'report') {
        try {
          const report = await this.reportGenerator.generateValidationReport(
            validationData.results,
            validationData.summary,
            validationData.integrityChecks
          );

          res.setHeader('Content-Type', 'text/markdown');
          res.setHeader('Content-Disposition', `attachment; filename="validation-report-${id}.md"`);
          res.status(200).send(report);
          return;
        } catch (error) {
          console.error('Error generating validation report:', error);
          res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to generate validation report',
            timestamp: new Date().toISOString()
          });
          return;
        }
      }

      // Default JSON response
      const response = {
        jobId: id,
        status: job.status,
        startTime: job.startTime,
        endTime: job.endTime,
        duration: job.endTime
          ? new Date(job.endTime).getTime() - new Date(job.startTime).getTime()
          : null,
        summary: {
          totalRules: job.results.totalRules,
          passedRules: job.results.passedRules,
          failedRules: job.results.failedRules,
          criticalFailures: job.results.criticalFailures,
          warningCount: job.results.warningCount,
          overallScore: job.results.overallScore,
          executionTime: job.results.executionTime
        },
        integrityChecks: {
          total: validationData.integrityChecks.length,
          passed: validationData.integrityChecks.filter(c => c.passed).length,
          failed: validationData.integrityChecks.filter(c => !c.passed).length
        },
        recommendations: this.generateValidationRecommendations(validationData),
        timestamp: new Date().toISOString()
      };

      if (includeDetails) {
        (response as any).details = {
          results: validationData.results.map(r => ({
            ruleId: r.ruleId,
            ruleName: r.ruleName,
            passed: r.passed,
            severity: r.severity,
            message: r.message,
            actualValue: r.actualValue,
            expectedValue: r.expectedValue,
            executionTime: r.executionTime
          })),
          integrityChecks: validationData.integrityChecks
        };
      }

      // Validate response structure
      this.validateValidationResultsResponse(response);

      res.status(200).json(response);
    } catch (error) {
      console.error('Error getting validation results:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve validation results',
        timestamp: new Date().toISOString()
      });
    }
  }

  private async executeValidation(jobId: string, options: {
    entities: string[];
    includeIntegrityChecks: boolean;
    includeCrossEntity: boolean;
  }): Promise<void> {
    const job = this.validationJobs.get(jobId);
    if (!job) return;

    try {
      // Update job status
      job.status = 'running';
      job.progress = 0;
      this.validationJobs.set(jobId, job);

      const allResults: ValidationResult[] = [];
      const allIntegrityChecks: any[] = [];

      // Get entities to validate
      const entitiesToValidate = options.entities.length > 0
        ? options.entities
        : await this.getDefaultEntities();

      const totalSteps = entitiesToValidate.length +
        (options.includeIntegrityChecks ? 1 : 0) +
        (options.includeCrossEntity ? 1 : 0);

      let currentStep = 0;

      // Validate each entity
      for (const entityName of entitiesToValidate) {
        try {
          // Create DataEntity instance (simplified - in real implementation, fetch from DB)
          const entityCoverage = this.coverageCalculator.calculateEntityCoverage()
            .find(ec => ec.entityName.toLowerCase() === entityName.toLowerCase());

          if (entityCoverage) {
            const dataEntity = new DataEntity({
              name: entityCoverage.entityName,
              domainId: entityCoverage.domainId,
              totalRecords: entityCoverage.totalRecords,
              migratedRecords: entityCoverage.migratedRecords,
              failedRecords: entityCoverage.failedRecords,
              lastMigrated: entityCoverage.lastMigrated
            });

            const entityResults = await this.dataValidator.validateEntity(dataEntity);
            allResults.push(...entityResults);
          }

          currentStep++;
          job.progress = Math.round((currentStep / totalSteps) * 100);
          this.validationJobs.set(jobId, job);
        } catch (error) {
          console.warn(`Error validating entity ${entityName}:`, error);
        }
      }

      // Run integrity checks
      if (options.includeIntegrityChecks) {
        try {
          const integrityChecks = await this.dataValidator.validateMigrationCompleteness(jobId);
          allIntegrityChecks.push(...integrityChecks);

          currentStep++;
          job.progress = Math.round((currentStep / totalSteps) * 100);
          this.validationJobs.set(jobId, job);
        } catch (error) {
          console.warn('Error running integrity checks:', error);
        }
      }

      // Run cross-entity validation
      if (options.includeCrossEntity) {
        try {
          const crossEntityResults = await this.dataValidator.validateCrossEntityConsistency();
          allResults.push(...crossEntityResults);

          currentStep++;
          job.progress = Math.round((currentStep / totalSteps) * 100);
          this.validationJobs.set(jobId, job);
        } catch (error) {
          console.warn('Error running cross-entity validation:', error);
        }
      }

      // Generate summary
      const summary = await this.dataValidator.generateValidationSummary(allResults);

      // Store results
      this.validationResults.set(jobId, {
        results: allResults,
        summary,
        integrityChecks: allIntegrityChecks
      });

      // Complete job
      job.status = 'completed';
      job.progress = 100;
      job.endTime = new Date().toISOString();
      job.results = summary;
      this.validationJobs.set(jobId, job);

    } catch (error) {
      throw error;
    }
  }

  private async getDefaultEntities(): Promise<string[]> {
    // Return default entities to validate
    return ['offices', 'profiles', 'doctors', 'patients', 'orders'];
  }

  private estimateValidationDuration(entityCount: number): string {
    const baseTime = 30; // 30 seconds base
    const perEntityTime = 10; // 10 seconds per entity
    const totalSeconds = baseTime + (entityCount * perEntityTime);

    if (totalSeconds < 60) {
      return `${totalSeconds} seconds`;
    } else if (totalSeconds < 3600) {
      return `${Math.round(totalSeconds / 60)} minutes`;
    } else {
      return `${Math.round(totalSeconds / 3600)} hours`;
    }
  }

  private estimateCompletion(job: ValidationJobStatus): string | null {
    if (job.status !== 'running' || job.progress === 0) return null;

    const startTime = new Date(job.startTime).getTime();
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;

    const estimatedTotalTime = (elapsedTime / job.progress) * 100;
    const remainingTime = estimatedTotalTime - elapsedTime;

    if (remainingTime <= 0) return null;

    const completionTime = new Date(currentTime + remainingTime);
    return completionTime.toISOString();
  }

  private generateValidationRecommendations(validationData: {
    results: ValidationResult[];
    summary: ValidationSummary;
    integrityChecks: any[];
  }): string[] {
    const recommendations: string[] = [];

    // Based on critical failures
    if (validationData.summary.criticalFailures > 0) {
      recommendations.push('Address critical validation failures immediately to ensure data integrity');
    }

    // Based on overall score
    if (validationData.summary.overallScore < 80) {
      recommendations.push('Overall validation score is below threshold - review migration processes');
    } else if (validationData.summary.overallScore < 95) {
      recommendations.push('Consider optimizing migration scripts to improve validation scores');
    }

    // Based on warnings
    if (validationData.summary.warningCount > 5) {
      recommendations.push('High number of warnings detected - review for potential issues');
    }

    // Based on integrity checks
    const failedIntegrityChecks = validationData.integrityChecks.filter(c => !c.passed);
    if (failedIntegrityChecks.length > 0) {
      recommendations.push('Data integrity issues detected - verify referential constraints');
    }

    // Performance-based recommendations
    const slowRules = validationData.results.filter(r => r.executionTime > 5000);
    if (slowRules.length > 0) {
      recommendations.push('Some validation rules are slow - consider optimizing queries');
    }

    if (recommendations.length === 0) {
      recommendations.push('Validation results look good - no immediate action required');
    }

    return recommendations;
  }

  private validateValidationResultsResponse(response: any): void {
    // Validate top-level structure
    const requiredFields = ['jobId', 'status', 'startTime', 'summary', 'integrityChecks', 'recommendations', 'timestamp'];

    for (const field of requiredFields) {
      if (!(field in response)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate job ID
    if (typeof response.jobId !== 'string' || !response.jobId.trim()) {
      throw new Error('jobId must be a non-empty string');
    }

    // Validate status
    const validStatuses = ['pending', 'running', 'completed', 'failed'];
    if (!validStatuses.includes(response.status)) {
      throw new Error(`Invalid status: ${response.status}`);
    }

    // Validate timestamps
    if (isNaN(Date.parse(response.startTime))) {
      throw new Error('startTime must be a valid ISO timestamp');
    }

    if (response.endTime && isNaN(Date.parse(response.endTime))) {
      throw new Error('endTime must be a valid ISO timestamp');
    }

    if (isNaN(Date.parse(response.timestamp))) {
      throw new Error('timestamp must be a valid ISO timestamp');
    }

    // Validate summary
    if (!response.summary || typeof response.summary !== 'object') {
      throw new Error('summary must be an object');
    }

    const requiredSummaryFields = ['totalRules', 'passedRules', 'failedRules', 'criticalFailures', 'warningCount', 'overallScore', 'executionTime'];
    requiredSummaryFields.forEach(field => {
      if (!(field in response.summary)) {
        throw new Error(`Missing required summary field: ${field}`);
      }
      if (typeof response.summary[field] !== 'number' || response.summary[field] < 0) {
        throw new Error(`summary.${field} must be a non-negative number`);
      }
    });

    if (response.summary.overallScore > 100) {
      throw new Error('summary.overallScore cannot exceed 100');
    }

    // Validate integrity checks
    if (!response.integrityChecks || typeof response.integrityChecks !== 'object') {
      throw new Error('integrityChecks must be an object');
    }

    const requiredIntegrityFields = ['total', 'passed', 'failed'];
    requiredIntegrityFields.forEach(field => {
      if (!(field in response.integrityChecks)) {
        throw new Error(`Missing required integrityChecks field: ${field}`);
      }
      if (typeof response.integrityChecks[field] !== 'number' || response.integrityChecks[field] < 0) {
        throw new Error(`integrityChecks.${field} must be a non-negative number`);
      }
    });

    // Validate recommendations
    if (!Array.isArray(response.recommendations)) {
      throw new Error('recommendations must be an array');
    }

    response.recommendations.forEach((rec: any, index: number) => {
      if (typeof rec !== 'string') {
        throw new Error(`recommendation at index ${index} must be a string`);
      }
    });

    // Validate duration if present
    if (response.duration !== null && response.duration !== undefined) {
      if (typeof response.duration !== 'number' || response.duration < 0) {
        throw new Error('duration must be null or a non-negative number');
      }
    }
  }
}
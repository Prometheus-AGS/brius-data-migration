/**
 * Coverage Controller
 *
 * Handles coverage-related API endpoints.
 */

import { Request, Response } from 'express';
import { CoverageCalculator } from '../services/coverage-calculator';
import { MigrationScriptAnalyzer } from '../services/migration-script-analyzer';
import { Pool } from 'pg';

export class CoverageController {
  private readonly coverageCalculator: CoverageCalculator;
  private readonly scriptAnalyzer: MigrationScriptAnalyzer;
  private readonly dbPool: Pool;

  constructor(
    coverageCalculator: CoverageCalculator,
    scriptAnalyzer: MigrationScriptAnalyzer,
    dbPool: Pool
  ) {
    this.coverageCalculator = coverageCalculator;
    this.scriptAnalyzer = scriptAnalyzer;
    this.dbPool = dbPool;
  }

  /**
   * GET /coverage/summary
   * Returns high-level coverage summary across all migration domains
   */
  public async getCoverageSummary(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();

      // Generate coverage report
      const coverageReport = this.coverageCalculator.generateCoverageReport();
      const coverageBreakdown = this.coverageCalculator.calculateOverallCoverage();
      const riskScore = this.coverageCalculator.calculateRiskScore();
      const completionEstimate = this.coverageCalculator.calculateCompletionEstimate();

      const summary = {
        totalScripts: coverageReport.totalScripts,
        completedScripts: coverageReport.completedScripts,
        totalRecords: coverageReport.totalRecords,
        migratedRecords: coverageReport.migratedRecords,
        overallSuccessRate: Math.round(coverageReport.overallSuccessRate * 10000) / 100, // Percentage with 2 decimals
        domainCoverage: {
          clinical: Math.round(coverageReport.clinicalCoverage * 10000) / 100,
          business: Math.round(coverageReport.businessCoverage * 10000) / 100,
          communications: Math.round(coverageReport.communicationsCoverage * 10000) / 100,
          technical: Math.round(coverageReport.technicalCoverage * 10000) / 100
        },
        riskAssessment: {
          level: riskScore < 0.3 ? 'low' : riskScore < 0.6 ? 'medium' : 'high',
          score: Math.round(riskScore * 100) / 100
        },
        timeline: {
          estimatedCompletionDays: completionEstimate.estimatedDays === Infinity ? null : completionEstimate.estimatedDays,
          confidence: Math.round(completionEstimate.confidence * 100) / 100
        },
        lastUpdated: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };

      // Validate response matches OpenAPI schema
      this.validateCoverageSummaryResponse(summary);

      res.status(200).json(summary);
    } catch (error) {
      console.error('Error generating coverage summary:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to generate coverage summary',
        timestamp: new Date().toISOString()
      });
    }
  }

  private validateCoverageSummaryResponse(summary: any): void {
    const requiredFields = [
      'totalScripts', 'completedScripts', 'totalRecords', 'migratedRecords',
      'overallSuccessRate', 'domainCoverage', 'riskAssessment', 'timeline',
      'lastUpdated', 'responseTime'
    ];

    const requiredDomainFields = ['clinical', 'business', 'communications', 'technical'];
    const requiredRiskFields = ['level', 'score'];
    const requiredTimelineFields = ['estimatedCompletionDays', 'confidence'];

    for (const field of requiredFields) {
      if (!(field in summary)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    for (const field of requiredDomainFields) {
      if (!(field in summary.domainCoverage)) {
        throw new Error(`Missing required domain field: ${field}`);
      }
    }

    for (const field of requiredRiskFields) {
      if (!(field in summary.riskAssessment)) {
        throw new Error(`Missing required risk field: ${field}`);
      }
    }

    for (const field of requiredTimelineFields) {
      if (!(field in summary.timeline)) {
        throw new Error(`Missing required timeline field: ${field}`);
      }
    }

    // Validate data types and constraints
    if (typeof summary.totalScripts !== 'number' || summary.totalScripts < 0) {
      throw new Error('totalScripts must be a non-negative number');
    }

    if (typeof summary.completedScripts !== 'number' || summary.completedScripts < 0) {
      throw new Error('completedScripts must be a non-negative number');
    }

    if (summary.completedScripts > summary.totalScripts) {
      throw new Error('completedScripts cannot exceed totalScripts');
    }

    if (typeof summary.overallSuccessRate !== 'number' || summary.overallSuccessRate < 0 || summary.overallSuccessRate > 100) {
      throw new Error('overallSuccessRate must be between 0 and 100');
    }

    // Validate domain coverage percentages
    Object.values(summary.domainCoverage).forEach((coverage: any) => {
      if (typeof coverage !== 'number' || coverage < 0 || coverage > 100) {
        throw new Error('Domain coverage must be between 0 and 100');
      }
    });

    // Validate risk level
    const validRiskLevels = ['low', 'medium', 'high'];
    if (!validRiskLevels.includes(summary.riskAssessment.level)) {
      throw new Error('Risk level must be one of: low, medium, high');
    }

    if (typeof summary.riskAssessment.score !== 'number' || summary.riskAssessment.score < 0 || summary.riskAssessment.score > 1) {
      throw new Error('Risk score must be between 0 and 1');
    }

    // Validate timeline
    if (summary.timeline.estimatedCompletionDays !== null) {
      if (typeof summary.timeline.estimatedCompletionDays !== 'number' || summary.timeline.estimatedCompletionDays < 0) {
        throw new Error('estimatedCompletionDays must be null or a non-negative number');
      }
    }

    if (typeof summary.timeline.confidence !== 'number' || summary.timeline.confidence < 0 || summary.timeline.confidence > 1) {
      throw new Error('confidence must be between 0 and 1');
    }

    // Validate timestamp format
    if (isNaN(Date.parse(summary.lastUpdated))) {
      throw new Error('lastUpdated must be a valid ISO timestamp');
    }

    if (typeof summary.responseTime !== 'number' || summary.responseTime < 0) {
      throw new Error('responseTime must be a non-negative number');
    }
  }
}
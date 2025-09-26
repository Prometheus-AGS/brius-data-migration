/**
 * Domains Controller
 *
 * Handles domain coverage analysis endpoints.
 */

import { Request, Response } from 'express';
import { CoverageCalculator } from '../services/coverage-calculator';
import { DataValidator } from '../services/data-validator';
import { DataDomain } from '../models';
import { Pool } from 'pg';

export class DomainsController {
  private readonly coverageCalculator: CoverageCalculator;
  private readonly dataValidator: DataValidator;
  private readonly dbPool: Pool;

  constructor(
    coverageCalculator: CoverageCalculator,
    dataValidator: DataValidator,
    dbPool: Pool
  ) {
    this.coverageCalculator = coverageCalculator;
    this.dataValidator = dataValidator;
    this.dbPool = dbPool;
  }

  /**
   * GET /domains/coverage
   * Returns coverage analysis broken down by data domain
   */
  public async getDomainsCoverage(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();

      // Parse query parameters
      const includeDetails = req.query.includeDetails === 'true';
      const includeValidation = req.query.includeValidation === 'true';
      const domain = req.query.domain as string;

      // Get domain coverage details
      let domainCoverage = this.coverageCalculator.calculateDomainCoverageDetails();

      // Filter by specific domain if requested
      if (domain) {
        const targetDomain = domain.toUpperCase() as DataDomain;
        if (!Object.values(DataDomain).includes(targetDomain)) {
          res.status(400).json({
            error: 'Bad Request',
            message: `Invalid domain: ${domain}. Valid domains are: ${Object.values(DataDomain).join(', ')}`,
            timestamp: new Date().toISOString()
          });
          return;
        }
        domainCoverage = domainCoverage.filter(dc => dc.domain === targetDomain);
      }

      // Calculate overall metrics
      const totalScripts = domainCoverage.reduce((sum, dc) => sum + dc.totalScripts, 0);
      const completedScripts = domainCoverage.reduce((sum, dc) => sum + dc.completedScripts, 0);
      const totalRecords = domainCoverage.reduce((sum, dc) => sum + dc.totalRecords, 0);
      const migratedRecords = domainCoverage.reduce((sum, dc) => sum + dc.migratedRecords, 0);

      const overallCoverage = totalScripts > 0 ? completedScripts / totalScripts : 0;
      const overallMigrationRate = totalRecords > 0 ? migratedRecords / totalRecords : 0;

      // Prepare domain details
      const domains = await Promise.all(
        domainCoverage.map(async (dc) => {
          const baseInfo = {
            domain: dc.domain.toLowerCase(),
            totalScripts: dc.totalScripts,
            completedScripts: dc.completedScripts,
            totalRecords: dc.totalRecords,
            migratedRecords: dc.migratedRecords,
            coverage: Math.round(dc.coverage * 10000) / 100, // Percentage with 2 decimals
            averageSuccessRate: Math.round(dc.averageSuccessRate * 10000) / 100,
            status: this.getDomainStatus(dc.coverage, dc.averageSuccessRate),
            priority: this.getDomainPriority(dc.domain),
            lastUpdated: new Date().toISOString()
          };

          if (includeDetails) {
            const entityCoverage = this.coverageCalculator.calculateEntityCoverage()
              .filter(ec => ec.domainId.toLowerCase() === dc.domain.toLowerCase());

            const issues = await this.identifyDomainIssues(dc.domain);

            return {
              ...baseInfo,
              details: {
                entities: entityCoverage.map(ec => ({
                  name: ec.entityName,
                  totalRecords: ec.totalRecords,
                  migratedRecords: ec.migratedRecords,
                  failedRecords: ec.failedRecords,
                  successRate: Math.round(ec.successRate * 10000) / 100,
                  lastMigrated: ec.lastMigrated
                })),
                issues: issues,
                recommendations: this.generateDomainRecommendations(dc, issues)
              }
            };
          }

          if (includeValidation) {
            // Run domain-specific validation
            const validationResults = await this.validateDomain(dc.domain);
            return {
              ...baseInfo,
              validation: {
                passed: validationResults.passed,
                totalChecks: validationResults.totalChecks,
                criticalIssues: validationResults.criticalIssues,
                warnings: validationResults.warnings,
                lastValidated: new Date().toISOString()
              }
            };
          }

          return baseInfo;
        })
      );

      // Calculate trends and insights
      const trends = this.calculateDomainTrends(domainCoverage);
      const insights = this.generateDomainInsights(domainCoverage);

      const response = {
        domains: domains.sort((a, b) => b.coverage - a.coverage), // Sort by coverage descending
        summary: {
          totalDomains: domains.length,
          totalScripts,
          completedScripts,
          totalRecords,
          migratedRecords,
          overallCoverage: Math.round(overallCoverage * 10000) / 100,
          overallMigrationRate: Math.round(overallMigrationRate * 10000) / 100,
          averageSuccessRate: domains.length > 0
            ? Math.round((domains.reduce((sum, d) => sum + d.averageSuccessRate, 0) / domains.length) * 100) / 100
            : 0
        },
        trends,
        insights,
        metadata: {
          includeDetails,
          includeValidation,
          filteredDomain: domain || null,
          lastUpdated: new Date().toISOString(),
          responseTime: Date.now() - startTime
        }
      };

      // Validate response structure
      this.validateDomainsCoverageResponse(response);

      res.status(200).json(response);
    } catch (error) {
      console.error('Error getting domains coverage:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve domains coverage',
        timestamp: new Date().toISOString()
      });
    }
  }

  private getDomainStatus(coverage: number, successRate: number): string {
    if (coverage >= 0.95 && successRate >= 0.98) return 'excellent';
    if (coverage >= 0.90 && successRate >= 0.95) return 'good';
    if (coverage >= 0.75 && successRate >= 0.90) return 'fair';
    if (coverage >= 0.50 || successRate >= 0.80) return 'needs_attention';
    return 'critical';
  }

  private getDomainPriority(domain: DataDomain): string {
    switch (domain) {
      case DataDomain.CLINICAL:
        return 'critical';
      case DataDomain.BUSINESS:
        return 'high';
      case DataDomain.COMMUNICATIONS:
        return 'medium';
      case DataDomain.TECHNICAL:
        return 'low';
      default:
        return 'medium';
    }
  }

  private async identifyDomainIssues(domain: DataDomain): Promise<Array<{
    type: string;
    severity: string;
    description: string;
    affectedEntities: number;
  }>> {
    const issues: Array<{
      type: string;
      severity: string;
      description: string;
      affectedEntities: number;
    }> = [];

    try {
      // Check for data integrity issues
      const integrityChecks = await this.dataValidator.validateMigrationCompleteness('domain_' + domain.toLowerCase());
      const failedChecks = integrityChecks.filter(check => !check.passed);

      failedChecks.forEach(check => {
        issues.push({
          type: check.checkType,
          severity: check.affectedRecords > 1000 ? 'critical' : check.affectedRecords > 100 ? 'high' : 'medium',
          description: check.details,
          affectedEntities: check.affectedRecords
        });
      });

      // Check for performance issues
      const entityCoverage = this.coverageCalculator.calculateEntityCoverage()
        .filter(ec => ec.domainId.toLowerCase() === domain.toLowerCase());

      const slowEntities = entityCoverage.filter(ec => ec.successRate < 0.95);
      if (slowEntities.length > 0) {
        issues.push({
          type: 'performance',
          severity: slowEntities.length > 3 ? 'high' : 'medium',
          description: `${slowEntities.length} entities have success rates below 95%`,
          affectedEntities: slowEntities.length
        });
      }

      const incompleteEntities = entityCoverage.filter(ec => ec.migratedRecords < ec.totalRecords);
      if (incompleteEntities.length > 0) {
        issues.push({
          type: 'completeness',
          severity: incompleteEntities.length > 2 ? 'high' : 'medium',
          description: `${incompleteEntities.length} entities have incomplete migrations`,
          affectedEntities: incompleteEntities.length
        });
      }
    } catch (error) {
      console.warn(`Error identifying issues for domain ${domain}:`, error);
      issues.push({
        type: 'system',
        severity: 'medium',
        description: 'Unable to fully assess domain health',
        affectedEntities: 0
      });
    }

    return issues;
  }

  private generateDomainRecommendations(
    domainCoverage: any,
    issues: Array<{ type: string; severity: string; description: string; affectedEntities: number }>
  ): string[] {
    const recommendations: string[] = [];

    // Coverage-based recommendations
    if (domainCoverage.coverage < 0.80) {
      recommendations.push('Prioritize completing pending migrations to improve coverage');
    }

    if (domainCoverage.averageSuccessRate < 0.95) {
      recommendations.push('Review and optimize migration scripts to improve success rates');
    }

    // Issue-based recommendations
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push('Address critical data integrity issues immediately');
    }

    const performanceIssues = issues.filter(i => i.type === 'performance');
    if (performanceIssues.length > 0) {
      recommendations.push('Optimize migration performance by reviewing batch sizes and indexing');
    }

    const completenessIssues = issues.filter(i => i.type === 'completeness');
    if (completenessIssues.length > 0) {
      recommendations.push('Complete pending migrations to ensure data consistency');
    }

    // Domain-specific recommendations
    switch (domainCoverage.domain) {
      case DataDomain.CLINICAL:
        if (domainCoverage.coverage < 0.99) {
          recommendations.push('Clinical data requires 99%+ coverage - prioritize completion');
        }
        break;
      case DataDomain.BUSINESS:
        if (domainCoverage.averageSuccessRate < 0.98) {
          recommendations.push('Business data integrity is critical - review failed transactions');
        }
        break;
    }

    return recommendations.length > 0 ? recommendations : ['Domain performance is within acceptable parameters'];
  }

  private calculateDomainTrends(domainCoverage: any[]): {
    improvingDomains: string[];
    decliningDomains: string[];
    stableDomains: string[];
  } {
    // Note: In a real implementation, this would compare against historical data
    // For now, we'll use current performance as a proxy
    const sorted = [...domainCoverage].sort((a, b) => b.coverage - a.coverage);

    return {
      improvingDomains: sorted.slice(0, Math.ceil(sorted.length / 3)).map(d => d.domain.toLowerCase()),
      stableDomains: sorted.slice(Math.ceil(sorted.length / 3), Math.ceil(2 * sorted.length / 3)).map(d => d.domain.toLowerCase()),
      decliningDomains: sorted.slice(Math.ceil(2 * sorted.length / 3)).map(d => d.domain.toLowerCase())
    };
  }

  private generateDomainInsights(domainCoverage: any[]): string[] {
    const insights: string[] = [];

    const avgCoverage = domainCoverage.reduce((sum, dc) => sum + dc.coverage, 0) / domainCoverage.length;
    const avgSuccessRate = domainCoverage.reduce((sum, dc) => sum + dc.averageSuccessRate, 0) / domainCoverage.length;

    if (avgCoverage > 0.90) {
      insights.push('Overall domain coverage is excellent with most migrations completed');
    } else if (avgCoverage > 0.75) {
      insights.push('Domain coverage is good but some areas need attention');
    } else {
      insights.push('Domain coverage needs significant improvement');
    }

    if (avgSuccessRate > 0.95) {
      insights.push('Migration success rates are consistently high across domains');
    } else if (avgSuccessRate > 0.90) {
      insights.push('Success rates are acceptable but could be optimized');
    } else {
      insights.push('Success rates indicate potential issues with migration scripts');
    }

    const bestDomain = domainCoverage.reduce((best, current) =>
      current.coverage > best.coverage ? current : best
    );
    insights.push(`${bestDomain.domain.toLowerCase()} domain is performing best with ${Math.round(bestDomain.coverage * 100)}% coverage`);

    const needsAttention = domainCoverage.filter(dc => dc.coverage < 0.80 || dc.averageSuccessRate < 0.90);
    if (needsAttention.length > 0) {
      insights.push(`${needsAttention.length} domain(s) require immediate attention`);
    }

    return insights;
  }

  private async validateDomain(domain: DataDomain): Promise<{
    passed: boolean;
    totalChecks: number;
    criticalIssues: number;
    warnings: number;
  }> {
    try {
      // Run cross-entity consistency validation
      const validationResults = await this.dataValidator.validateCrossEntityConsistency();
      const domainResults = validationResults.filter(r =>
        r.ruleName.toLowerCase().includes(domain.toLowerCase())
      );

      const totalChecks = domainResults.length;
      const criticalIssues = domainResults.filter(r => !r.passed && r.severity === 'critical').length;
      const warnings = domainResults.filter(r => !r.passed && r.severity === 'warning').length;
      const passed = criticalIssues === 0;

      return {
        passed,
        totalChecks,
        criticalIssues,
        warnings
      };
    } catch (error) {
      console.warn(`Error validating domain ${domain}:`, error);
      return {
        passed: false,
        totalChecks: 0,
        criticalIssues: 1,
        warnings: 0
      };
    }
  }

  private validateDomainsCoverageResponse(response: any): void {
    // Validate top-level structure
    const requiredFields = ['domains', 'summary', 'trends', 'insights', 'metadata'];

    for (const field of requiredFields) {
      if (!(field in response)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate domains array
    if (!Array.isArray(response.domains)) {
      throw new Error('domains must be an array');
    }

    // Validate each domain
    response.domains.forEach((domain: any, index: number) => {
      const requiredDomainFields = [
        'domain', 'totalScripts', 'completedScripts', 'totalRecords',
        'migratedRecords', 'coverage', 'averageSuccessRate', 'status',
        'priority', 'lastUpdated'
      ];

      requiredDomainFields.forEach(field => {
        if (!(field in domain)) {
          throw new Error(`Missing required domain field at index ${index}: ${field}`);
        }
      });

      // Validate data types and constraints
      if (typeof domain.totalScripts !== 'number' || domain.totalScripts < 0) {
        throw new Error(`totalScripts at index ${index} must be a non-negative number`);
      }

      if (typeof domain.coverage !== 'number' || domain.coverage < 0 || domain.coverage > 100) {
        throw new Error(`coverage at index ${index} must be between 0 and 100`);
      }

      if (typeof domain.averageSuccessRate !== 'number' || domain.averageSuccessRate < 0 || domain.averageSuccessRate > 100) {
        throw new Error(`averageSuccessRate at index ${index} must be between 0 and 100`);
      }

      // Validate status values
      const validStatuses = ['excellent', 'good', 'fair', 'needs_attention', 'critical'];
      if (!validStatuses.includes(domain.status)) {
        throw new Error(`Invalid status at index ${index}: ${domain.status}`);
      }

      // Validate priority values
      const validPriorities = ['critical', 'high', 'medium', 'low'];
      if (!validPriorities.includes(domain.priority)) {
        throw new Error(`Invalid priority at index ${index}: ${domain.priority}`);
      }

      // Validate timestamp
      if (isNaN(Date.parse(domain.lastUpdated))) {
        throw new Error(`Invalid lastUpdated timestamp at index ${index}`);
      }
    });

    // Validate summary
    const requiredSummaryFields = [
      'totalDomains', 'totalScripts', 'completedScripts', 'totalRecords',
      'migratedRecords', 'overallCoverage', 'overallMigrationRate', 'averageSuccessRate'
    ];

    requiredSummaryFields.forEach(field => {
      if (!(field in response.summary)) {
        throw new Error(`Missing required summary field: ${field}`);
      }
    });

    // Validate summary data types
    Object.entries(response.summary).forEach(([key, value]) => {
      if (typeof value !== 'number' || (value as number) < 0) {
        throw new Error(`Summary field ${key} must be a non-negative number`);
      }
    });

    // Validate trends
    const requiredTrendFields = ['improvingDomains', 'decliningDomains', 'stableDomains'];
    requiredTrendFields.forEach(field => {
      if (!(field in response.trends)) {
        throw new Error(`Missing required trend field: ${field}`);
      }
      if (!Array.isArray(response.trends[field])) {
        throw new Error(`Trend field ${field} must be an array`);
      }
    });

    // Validate insights
    if (!Array.isArray(response.insights)) {
      throw new Error('insights must be an array');
    }

    // Validate metadata
    const requiredMetadataFields = ['includeDetails', 'includeValidation', 'filteredDomain', 'lastUpdated', 'responseTime'];
    requiredMetadataFields.forEach(field => {
      if (!(field in response.metadata)) {
        throw new Error(`Missing required metadata field: ${field}`);
      }
    });

    if (isNaN(Date.parse(response.metadata.lastUpdated))) {
      throw new Error('metadata.lastUpdated must be a valid ISO timestamp');
    }

    if (typeof response.metadata.responseTime !== 'number' || response.metadata.responseTime < 0) {
      throw new Error('metadata.responseTime must be a non-negative number');
    }
  }
}
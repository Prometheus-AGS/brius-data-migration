/**
 * Entities Controller
 *
 * Handles entity performance analysis endpoints.
 */

import { Request, Response } from 'express';
import { CoverageCalculator } from '../services/coverage-calculator';
import { DataValidator } from '../services/data-validator';
import { DataEntity } from '../models';
import { Pool } from 'pg';

export class EntitiesController {
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
   * GET /entities/performance
   * Returns performance metrics for individual data entities
   */
  public async getEntitiesPerformance(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();

      // Parse query parameters
      const domain = req.query.domain as string;
      const minSuccessRate = parseFloat(req.query.minSuccessRate as string) || 0;
      const minRecords = parseInt(req.query.minRecords as string) || 0;
      const sortBy = (req.query.sortBy as string) || 'successRate';
      const sortOrder = (req.query.sortOrder as string) || 'desc';
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const includeValidation = req.query.includeValidation === 'true';
      const includeHistory = req.query.includeHistory === 'true';

      // Validate sort parameters
      const validSortFields = ['successRate', 'totalRecords', 'migratedRecords', 'entityName', 'lastMigrated'];
      if (!validSortFields.includes(sortBy)) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Invalid sortBy parameter. Valid values: ${validSortFields.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const validSortOrders = ['asc', 'desc'];
      if (!validSortOrders.includes(sortOrder)) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Invalid sortOrder parameter. Valid values: ${validSortOrders.join(', ')}`,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Get entity coverage data
      let entityCoverage = this.coverageCalculator.calculateEntityCoverage();

      // Apply filters
      if (domain) {
        entityCoverage = entityCoverage.filter(ec =>
          ec.domainId.toLowerCase() === domain.toLowerCase()
        );
      }

      if (minSuccessRate > 0) {
        entityCoverage = entityCoverage.filter(ec => ec.successRate >= minSuccessRate / 100);
      }

      if (minRecords > 0) {
        entityCoverage = entityCoverage.filter(ec => ec.totalRecords >= minRecords);
      }

      // Sort entities
      entityCoverage.sort((a, b) => {
        let valueA: any, valueB: any;

        switch (sortBy) {
          case 'successRate':
            valueA = a.successRate;
            valueB = b.successRate;
            break;
          case 'totalRecords':
            valueA = a.totalRecords;
            valueB = b.totalRecords;
            break;
          case 'migratedRecords':
            valueA = a.migratedRecords;
            valueB = b.migratedRecords;
            break;
          case 'entityName':
            valueA = a.entityName.toLowerCase();
            valueB = b.entityName.toLowerCase();
            break;
          case 'lastMigrated':
            valueA = a.lastMigrated ? new Date(a.lastMigrated).getTime() : 0;
            valueB = b.lastMigrated ? new Date(b.lastMigrated).getTime() : 0;
            break;
          default:
            valueA = a.successRate;
            valueB = b.successRate;
        }

        if (sortOrder === 'asc') {
          return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
        } else {
          return valueA > valueB ? -1 : valueA < valueB ? 1 : 0;
        }
      });

      // Calculate pagination
      const totalItems = entityCoverage.length;
      const totalPages = Math.ceil(totalItems / limit);
      const offset = (page - 1) * limit;
      const paginatedEntities = entityCoverage.slice(offset, offset + limit);

      // Prepare entity details
      const entities = await Promise.all(
        paginatedEntities.map(async (entity) => {
          const baseInfo = {
            entityName: entity.entityName,
            domainId: entity.domainId.toLowerCase(),
            totalRecords: entity.totalRecords,
            migratedRecords: entity.migratedRecords,
            failedRecords: entity.failedRecords,
            successRate: Math.round(entity.successRate * 10000) / 100, // Percentage with 2 decimals
            migrationRate: entity.totalRecords > 0
              ? Math.round((entity.migratedRecords / entity.totalRecords) * 10000) / 100
              : 0,
            errorRate: entity.totalRecords > 0
              ? Math.round((entity.failedRecords / entity.totalRecords) * 10000) / 100
              : 0,
            status: this.getEntityStatus(entity),
            lastMigrated: entity.lastMigrated,
            performance: this.calculateEntityPerformance(entity)
          };

          if (includeValidation) {
            try {
              // Create a DataEntity instance for validation
              const dataEntity = new DataEntity({
                name: entity.entityName,
                domainId: entity.domainId,
                totalRecords: entity.totalRecords,
                migratedRecords: entity.migratedRecords,
                failedRecords: entity.failedRecords,
                lastMigrated: entity.lastMigrated
              });

              const validationResults = await this.dataValidator.validateEntity(dataEntity);
              const passedValidation = validationResults.filter(r => r.passed).length;
              const criticalIssues = validationResults.filter(r => !r.passed && r.severity === 'critical').length;
              const warnings = validationResults.filter(r => !r.passed && r.severity === 'warning').length;

              return {
                ...baseInfo,
                validation: {
                  totalChecks: validationResults.length,
                  passedChecks: passedValidation,
                  criticalIssues,
                  warnings,
                  overallScore: validationResults.length > 0
                    ? Math.round((passedValidation / validationResults.length) * 10000) / 100
                    : 100,
                  lastValidated: new Date().toISOString()
                }
              };
            } catch (error) {
              console.warn(`Validation failed for entity ${entity.entityName}:`, error);
              return {
                ...baseInfo,
                validation: {
                  totalChecks: 0,
                  passedChecks: 0,
                  criticalIssues: 1,
                  warnings: 0,
                  overallScore: 0,
                  lastValidated: new Date().toISOString()
                }
              };
            }
          }

          if (includeHistory) {
            const history = await this.getEntityMigrationHistory(entity.entityName);
            return {
              ...baseInfo,
              history
            };
          }

          return baseInfo;
        })
      );

      // Calculate summary statistics
      const summary = {
        totalEntities: totalItems,
        averageSuccessRate: totalItems > 0
          ? Math.round((entityCoverage.reduce((sum, e) => sum + e.successRate, 0) / totalItems) * 10000) / 100
          : 0,
        totalRecords: entityCoverage.reduce((sum, e) => sum + e.totalRecords, 0),
        totalMigratedRecords: entityCoverage.reduce((sum, e) => sum + e.migratedRecords, 0),
        totalFailedRecords: entityCoverage.reduce((sum, e) => sum + e.failedRecords, 0),
        performanceDistribution: this.calculatePerformanceDistribution(entityCoverage),
        topPerformers: entityCoverage
          .sort((a, b) => b.successRate - a.successRate)
          .slice(0, 5)
          .map(e => ({
            entityName: e.entityName,
            successRate: Math.round(e.successRate * 10000) / 100
          })),
        needsAttention: entityCoverage
          .filter(e => e.successRate < 0.95 || e.failedRecords > 0)
          .length
      };

      // Generate insights
      const insights = this.generateEntityInsights(entityCoverage, summary);

      const response = {
        entities,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        },
        summary,
        insights,
        filters: {
          domain: domain || null,
          minSuccessRate: minSuccessRate || null,
          minRecords: minRecords || null,
          sortBy,
          sortOrder
        },
        metadata: {
          includeValidation,
          includeHistory,
          lastUpdated: new Date().toISOString(),
          responseTime: Date.now() - startTime
        }
      };

      // Validate response structure
      this.validateEntitiesPerformanceResponse(response);

      res.status(200).json(response);
    } catch (error) {
      console.error('Error getting entities performance:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve entities performance',
        timestamp: new Date().toISOString()
      });
    }
  }

  private getEntityStatus(entity: any): string {
    const successRate = entity.successRate;
    const migrationRate = entity.totalRecords > 0 ? entity.migratedRecords / entity.totalRecords : 0;

    if (migrationRate === 1 && successRate >= 0.99) return 'completed';
    if (migrationRate > 0.95 && successRate >= 0.95) return 'nearly_complete';
    if (migrationRate > 0.50 && successRate >= 0.90) return 'in_progress';
    if (migrationRate > 0 || entity.failedRecords > 0) return 'partial';
    return 'pending';
  }

  private calculateEntityPerformance(entity: any): {
    score: number;
    grade: string;
    factors: {
      completeness: number;
      accuracy: number;
      efficiency: number;
    };
  } {
    const completeness = entity.totalRecords > 0 ? entity.migratedRecords / entity.totalRecords : 0;
    const accuracy = entity.successRate;

    // Efficiency based on records processed vs failed
    const totalProcessed = entity.migratedRecords + entity.failedRecords;
    const efficiency = totalProcessed > 0 ? entity.migratedRecords / totalProcessed : 0;

    // Weighted performance score
    const score = (completeness * 0.4) + (accuracy * 0.4) + (efficiency * 0.2);

    let grade: string;
    if (score >= 0.95) grade = 'A+';
    else if (score >= 0.90) grade = 'A';
    else if (score >= 0.85) grade = 'B+';
    else if (score >= 0.80) grade = 'B';
    else if (score >= 0.75) grade = 'C+';
    else if (score >= 0.70) grade = 'C';
    else if (score >= 0.65) grade = 'D+';
    else if (score >= 0.60) grade = 'D';
    else grade = 'F';

    return {
      score: Math.round(score * 10000) / 100,
      grade,
      factors: {
        completeness: Math.round(completeness * 10000) / 100,
        accuracy: Math.round(accuracy * 10000) / 100,
        efficiency: Math.round(efficiency * 10000) / 100
      }
    };
  }

  private calculatePerformanceDistribution(entities: any[]): {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  } {
    const distribution = { excellent: 0, good: 0, fair: 0, poor: 0 };

    entities.forEach(entity => {
      const successRate = entity.successRate;
      if (successRate >= 0.95) distribution.excellent++;
      else if (successRate >= 0.90) distribution.good++;
      else if (successRate >= 0.75) distribution.fair++;
      else distribution.poor++;
    });

    return distribution;
  }

  private generateEntityInsights(entities: any[], summary: any): string[] {
    const insights: string[] = [];

    if (summary.averageSuccessRate >= 95) {
      insights.push('Entity performance is excellent with high success rates across the board');
    } else if (summary.averageSuccessRate >= 90) {
      insights.push('Overall entity performance is good but some entities could be optimized');
    } else {
      insights.push('Entity performance needs improvement - review migration strategies');
    }

    if (summary.needsAttention > 0) {
      insights.push(`${summary.needsAttention} entities require attention due to low success rates or failures`);
    }

    const totalMigrationRate = summary.totalRecords > 0
      ? (summary.totalMigratedRecords / summary.totalRecords) * 100
      : 0;

    if (totalMigrationRate >= 95) {
      insights.push('Migration coverage is excellent with most data successfully migrated');
    } else if (totalMigrationRate >= 80) {
      insights.push('Migration coverage is good but some entities are incomplete');
    } else {
      insights.push('Migration coverage is low - consider prioritizing pending entities');
    }

    if (summary.topPerformers.length > 0) {
      const bestEntity = summary.topPerformers[0];
      insights.push(`${bestEntity.entityName} is the top performer with ${bestEntity.successRate}% success rate`);
    }

    const largeEntities = entities.filter(e => e.totalRecords > 10000);
    if (largeEntities.length > 0) {
      const avgLargeEntitySuccess = largeEntities.reduce((sum, e) => sum + e.successRate, 0) / largeEntities.length;
      if (avgLargeEntitySuccess >= 95) {
        insights.push('Large entities are performing well despite their size');
      } else {
        insights.push('Large entities may need special attention for optimization');
      }
    }

    return insights;
  }

  private async getEntityMigrationHistory(entityName: string): Promise<Array<{
    date: string;
    recordsMigrated: number;
    successRate: number;
    event: string;
  }>> {
    try {
      // This would query migration logs/history from the database
      // For now, returning a mock history
      const history = [
        {
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          recordsMigrated: 1000,
          successRate: 98.5,
          event: 'Initial migration batch'
        },
        {
          date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          recordsMigrated: 500,
          successRate: 99.2,
          event: 'Incremental update'
        },
        {
          date: new Date().toISOString(),
          recordsMigrated: 200,
          successRate: 99.8,
          event: 'Final cleanup'
        }
      ];

      return history;
    } catch (error) {
      console.warn(`Error getting history for entity ${entityName}:`, error);
      return [];
    }
  }

  private validateEntitiesPerformanceResponse(response: any): void {
    // Validate top-level structure
    const requiredFields = ['entities', 'pagination', 'summary', 'insights', 'filters', 'metadata'];

    for (const field of requiredFields) {
      if (!(field in response)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate entities array
    if (!Array.isArray(response.entities)) {
      throw new Error('entities must be an array');
    }

    // Validate each entity
    response.entities.forEach((entity: any, index: number) => {
      const requiredEntityFields = [
        'entityName', 'domainId', 'totalRecords', 'migratedRecords',
        'failedRecords', 'successRate', 'migrationRate', 'errorRate',
        'status', 'lastMigrated', 'performance'
      ];

      requiredEntityFields.forEach(field => {
        if (!(field in entity)) {
          throw new Error(`Missing required entity field at index ${index}: ${field}`);
        }
      });

      // Validate data types and constraints
      if (typeof entity.totalRecords !== 'number' || entity.totalRecords < 0) {
        throw new Error(`totalRecords at index ${index} must be a non-negative number`);
      }

      if (typeof entity.migratedRecords !== 'number' || entity.migratedRecords < 0) {
        throw new Error(`migratedRecords at index ${index} must be a non-negative number`);
      }

      if (typeof entity.failedRecords !== 'number' || entity.failedRecords < 0) {
        throw new Error(`failedRecords at index ${index} must be a non-negative number`);
      }

      if (typeof entity.successRate !== 'number' || entity.successRate < 0 || entity.successRate > 100) {
        throw new Error(`successRate at index ${index} must be between 0 and 100`);
      }

      if (typeof entity.migrationRate !== 'number' || entity.migrationRate < 0 || entity.migrationRate > 100) {
        throw new Error(`migrationRate at index ${index} must be between 0 and 100`);
      }

      if (typeof entity.errorRate !== 'number' || entity.errorRate < 0 || entity.errorRate > 100) {
        throw new Error(`errorRate at index ${index} must be between 0 and 100`);
      }

      // Validate status values
      const validStatuses = ['completed', 'nearly_complete', 'in_progress', 'partial', 'pending'];
      if (!validStatuses.includes(entity.status)) {
        throw new Error(`Invalid status at index ${index}: ${entity.status}`);
      }

      // Validate performance object
      if (!entity.performance || typeof entity.performance !== 'object') {
        throw new Error(`performance at index ${index} must be an object`);
      }

      const requiredPerformanceFields = ['score', 'grade', 'factors'];
      requiredPerformanceFields.forEach(field => {
        if (!(field in entity.performance)) {
          throw new Error(`Missing performance field at index ${index}: ${field}`);
        }
      });

      if (typeof entity.performance.score !== 'number' || entity.performance.score < 0 || entity.performance.score > 100) {
        throw new Error(`performance.score at index ${index} must be between 0 and 100`);
      }

      if (typeof entity.performance.grade !== 'string') {
        throw new Error(`performance.grade at index ${index} must be a string`);
      }

      // Validate timestamp
      if (entity.lastMigrated && isNaN(Date.parse(entity.lastMigrated))) {
        throw new Error(`Invalid lastMigrated timestamp at index ${index}`);
      }
    });

    // Validate pagination
    const requiredPaginationFields = ['currentPage', 'totalPages', 'totalItems', 'itemsPerPage', 'hasNextPage', 'hasPreviousPage'];

    requiredPaginationFields.forEach(field => {
      if (!(field in response.pagination)) {
        throw new Error(`Missing required pagination field: ${field}`);
      }
    });

    // Validate summary
    const requiredSummaryFields = [
      'totalEntities', 'averageSuccessRate', 'totalRecords', 'totalMigratedRecords',
      'totalFailedRecords', 'performanceDistribution', 'topPerformers', 'needsAttention'
    ];

    requiredSummaryFields.forEach(field => {
      if (!(field in response.summary)) {
        throw new Error(`Missing required summary field: ${field}`);
      }
    });

    // Validate summary data types
    if (typeof response.summary.totalEntities !== 'number' || response.summary.totalEntities < 0) {
      throw new Error('summary.totalEntities must be a non-negative number');
    }

    if (typeof response.summary.averageSuccessRate !== 'number' || response.summary.averageSuccessRate < 0 || response.summary.averageSuccessRate > 100) {
      throw new Error('summary.averageSuccessRate must be between 0 and 100');
    }

    // Validate performance distribution
    if (!response.summary.performanceDistribution || typeof response.summary.performanceDistribution !== 'object') {
      throw new Error('summary.performanceDistribution must be an object');
    }

    const requiredDistributionFields = ['excellent', 'good', 'fair', 'poor'];
    requiredDistributionFields.forEach(field => {
      if (!(field in response.summary.performanceDistribution)) {
        throw new Error(`Missing performance distribution field: ${field}`);
      }
      if (typeof response.summary.performanceDistribution[field] !== 'number' || response.summary.performanceDistribution[field] < 0) {
        throw new Error(`performance distribution ${field} must be a non-negative number`);
      }
    });

    // Validate top performers
    if (!Array.isArray(response.summary.topPerformers)) {
      throw new Error('summary.topPerformers must be an array');
    }

    // Validate insights
    if (!Array.isArray(response.insights)) {
      throw new Error('insights must be an array');
    }

    // Validate metadata
    const requiredMetadataFields = ['includeValidation', 'includeHistory', 'lastUpdated', 'responseTime'];
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
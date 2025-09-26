/**
 * Scripts Controller
 *
 * Handles script status and analysis endpoints.
 */

import { Request, Response } from 'express';
import { MigrationScriptAnalyzer } from '../services/migration-script-analyzer';
import { CoverageCalculator } from '../services/coverage-calculator';
import { MigrationScript, DataDomain } from '../models';
import { Pool } from 'pg';

export class ScriptsController {
  private readonly scriptAnalyzer: MigrationScriptAnalyzer;
  private readonly coverageCalculator: CoverageCalculator;
  private readonly dbPool: Pool;

  constructor(
    scriptAnalyzer: MigrationScriptAnalyzer,
    coverageCalculator: CoverageCalculator,
    dbPool: Pool
  ) {
    this.scriptAnalyzer = scriptAnalyzer;
    this.coverageCalculator = coverageCalculator;
    this.dbPool = dbPool;
  }

  /**
   * GET /scripts/status
   * Returns detailed status of all migration scripts
   */
  public async getScriptsStatus(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();

      // Parse query parameters
      const domain = req.query.domain as string;
      const category = req.query.category as string;
      const status = req.query.status as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200); // Max 200 items per page
      const includeMetrics = req.query.includeMetrics === 'true';

      // Analyze all scripts
      const scriptAnalysisResults = await this.scriptAnalyzer.analyzeAllScripts({
        includeTests: false,
        includeValidation: true,
        scanForDependencies: true
      });

      // Apply filters
      let filteredScripts = scriptAnalysisResults.map(result => result.script);

      if (domain) {
        filteredScripts = filteredScripts.filter(script =>
          script.domain.toLowerCase() === domain.toLowerCase()
        );
      }

      if (category) {
        filteredScripts = filteredScripts.filter(script =>
          script.category.toLowerCase() === category.toLowerCase()
        );
      }

      if (status) {
        filteredScripts = filteredScripts.filter(script =>
          script.status.toLowerCase() === status.toLowerCase()
        );
      }

      // Calculate pagination
      const totalItems = filteredScripts.length;
      const totalPages = Math.ceil(totalItems / limit);
      const offset = (page - 1) * limit;
      const paginatedScripts = filteredScripts.slice(offset, offset + limit);

      // Prepare response
      const scripts = await Promise.all(
        paginatedScripts.map(async (script) => {
          const baseInfo = {
            id: script.id,
            name: script.name,
            status: script.status,
            domain: script.domain,
            category: script.category,
            description: script.description,
            filePath: script.filePath,
            estimatedRecords: script.estimatedRecords,
            recordsProcessed: script.recordsProcessed || 0,
            successRate: script.successRate ? Math.round(script.successRate * 10000) / 100 : null,
            lastExecuted: script.lastExecuted,
            dependencies: script.dependencies || [],
            createdAt: script.createdAt,
            updatedAt: script.updatedAt
          };

          if (includeMetrics) {
            const metrics = await this.scriptAnalyzer.getScriptMetrics(script.name);
            return {
              ...baseInfo,
              metrics: metrics ? {
                linesOfCode: metrics.linesOfCode,
                cyclomaticComplexity: metrics.cyclomaticComplexity,
                maintainabilityIndex: Math.round(metrics.maintainabilityIndex * 100) / 100
              } : null
            };
          }

          return baseInfo;
        })
      );

      // Calculate summary statistics
      const summary = {
        totalScripts: totalItems,
        completedScripts: filteredScripts.filter(s => s.status === 'completed').length,
        inProgressScripts: filteredScripts.filter(s => s.status === 'in_progress').length,
        pendingScripts: filteredScripts.filter(s => s.status === 'pending').length,
        failedScripts: filteredScripts.filter(s => s.status === 'failed').length,
        averageSuccessRate: this.calculateAverageSuccessRate(filteredScripts),
        domainBreakdown: this.calculateDomainBreakdown(filteredScripts),
        categoryBreakdown: this.calculateCategoryBreakdown(filteredScripts)
      };

      const response = {
        scripts,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        },
        summary,
        filters: {
          domain: domain || null,
          category: category || null,
          status: status || null
        },
        lastUpdated: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };

      // Validate response structure
      this.validateScriptsStatusResponse(response);

      res.status(200).json(response);
    } catch (error) {
      console.error('Error getting scripts status:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve scripts status',
        timestamp: new Date().toISOString()
      });
    }
  }

  private calculateAverageSuccessRate(scripts: MigrationScript[]): number {
    const scriptsWithRates = scripts.filter(s => s.successRate !== null && s.successRate !== undefined);
    if (scriptsWithRates.length === 0) return 0;

    const sum = scriptsWithRates.reduce((acc, script) => acc + (script.successRate || 0), 0);
    return Math.round((sum / scriptsWithRates.length) * 10000) / 100; // Percentage with 2 decimals
  }

  private calculateDomainBreakdown(scripts: MigrationScript[]): Record<string, number> {
    const breakdown: Record<string, number> = {};

    Object.values(DataDomain).forEach(domain => {
      breakdown[domain.toLowerCase()] = scripts.filter(s => s.domain === domain).length;
    });

    return breakdown;
  }

  private calculateCategoryBreakdown(scripts: MigrationScript[]): Record<string, number> {
    const breakdown: Record<string, number> = {};

    scripts.forEach(script => {
      const category = script.category.toLowerCase();
      breakdown[category] = (breakdown[category] || 0) + 1;
    });

    return breakdown;
  }

  private validateScriptsStatusResponse(response: any): void {
    // Validate top-level structure
    const requiredFields = ['scripts', 'pagination', 'summary', 'filters', 'lastUpdated', 'responseTime'];

    for (const field of requiredFields) {
      if (!(field in response)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate scripts array
    if (!Array.isArray(response.scripts)) {
      throw new Error('scripts must be an array');
    }

    // Validate each script
    response.scripts.forEach((script: any, index: number) => {
      const requiredScriptFields = [
        'id', 'name', 'status', 'domain', 'category', 'description',
        'filePath', 'estimatedRecords', 'recordsProcessed', 'successRate',
        'lastExecuted', 'dependencies', 'createdAt', 'updatedAt'
      ];

      requiredScriptFields.forEach(field => {
        if (!(field in script)) {
          throw new Error(`Missing required script field at index ${index}: ${field}`);
        }
      });

      // Validate data types
      if (typeof script.id !== 'string') {
        throw new Error(`Script id at index ${index} must be a string`);
      }

      if (typeof script.estimatedRecords !== 'number' || script.estimatedRecords < 0) {
        throw new Error(`estimatedRecords at index ${index} must be a non-negative number`);
      }

      if (typeof script.recordsProcessed !== 'number' || script.recordsProcessed < 0) {
        throw new Error(`recordsProcessed at index ${index} must be a non-negative number`);
      }

      if (script.successRate !== null && (typeof script.successRate !== 'number' || script.successRate < 0 || script.successRate > 100)) {
        throw new Error(`successRate at index ${index} must be null or between 0 and 100`);
      }

      if (!Array.isArray(script.dependencies)) {
        throw new Error(`dependencies at index ${index} must be an array`);
      }

      // Validate status
      const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
      if (!validStatuses.includes(script.status)) {
        throw new Error(`Invalid status at index ${index}: ${script.status}`);
      }

      // Validate domain
      const validDomains = Object.values(DataDomain);
      if (!validDomains.includes(script.domain)) {
        throw new Error(`Invalid domain at index ${index}: ${script.domain}`);
      }

      // Validate timestamps
      if (script.lastExecuted && isNaN(Date.parse(script.lastExecuted))) {
        throw new Error(`Invalid lastExecuted timestamp at index ${index}`);
      }

      if (isNaN(Date.parse(script.createdAt))) {
        throw new Error(`Invalid createdAt timestamp at index ${index}`);
      }

      if (isNaN(Date.parse(script.updatedAt))) {
        throw new Error(`Invalid updatedAt timestamp at index ${index}`);
      }
    });

    // Validate pagination
    const requiredPaginationFields = ['currentPage', 'totalPages', 'totalItems', 'itemsPerPage', 'hasNextPage', 'hasPreviousPage'];

    requiredPaginationFields.forEach(field => {
      if (!(field in response.pagination)) {
        throw new Error(`Missing required pagination field: ${field}`);
      }
    });

    if (typeof response.pagination.currentPage !== 'number' || response.pagination.currentPage < 1) {
      throw new Error('currentPage must be a positive number');
    }

    if (typeof response.pagination.totalPages !== 'number' || response.pagination.totalPages < 0) {
      throw new Error('totalPages must be a non-negative number');
    }

    if (typeof response.pagination.totalItems !== 'number' || response.pagination.totalItems < 0) {
      throw new Error('totalItems must be a non-negative number');
    }

    // Validate summary
    const requiredSummaryFields = [
      'totalScripts', 'completedScripts', 'inProgressScripts', 'pendingScripts',
      'failedScripts', 'averageSuccessRate', 'domainBreakdown', 'categoryBreakdown'
    ];

    requiredSummaryFields.forEach(field => {
      if (!(field in response.summary)) {
        throw new Error(`Missing required summary field: ${field}`);
      }
    });

    // Validate summary counts
    Object.keys(response.summary).forEach(key => {
      if (key.endsWith('Scripts') && (typeof response.summary[key] !== 'number' || response.summary[key] < 0)) {
        throw new Error(`${key} must be a non-negative number`);
      }
    });

    if (typeof response.summary.averageSuccessRate !== 'number' || response.summary.averageSuccessRate < 0 || response.summary.averageSuccessRate > 100) {
      throw new Error('averageSuccessRate must be between 0 and 100');
    }

    // Validate filters
    const requiredFilterFields = ['domain', 'category', 'status'];

    requiredFilterFields.forEach(field => {
      if (!(field in response.filters)) {
        throw new Error(`Missing required filter field: ${field}`);
      }
    });

    // Validate timestamps
    if (isNaN(Date.parse(response.lastUpdated))) {
      throw new Error('lastUpdated must be a valid ISO timestamp');
    }

    if (typeof response.responseTime !== 'number' || response.responseTime < 0) {
      throw new Error('responseTime must be a non-negative number');
    }
  }
}
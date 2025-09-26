/**
 * Coverage Calculator Service
 *
 * Calculates migration coverage percentages across domains, categories, and entities.
 */

import { MigrationScript, DataDomain, DataEntity, CoverageReport } from '../models';

export interface CoverageBreakdown {
  overall: number;
  byDomain: Map<DataDomain, number>;
  byCategory: Map<string, number>;
  byStatus: Map<string, number>;
}

export interface DomainCoverage {
  domain: DataDomain;
  totalScripts: number;
  completedScripts: number;
  totalRecords: number;
  migratedRecords: number;
  averageSuccessRate: number;
  coverage: number;
}

export interface EntityCoverage {
  entityName: string;
  domainId: string;
  totalRecords: number;
  migratedRecords: number;
  failedRecords: number;
  successRate: number;
  lastMigrated?: string;
}

export class CoverageCalculator {
  private readonly scripts: Map<string, MigrationScript> = new Map();
  private readonly entities: Map<string, DataEntity> = new Map();

  public addScript(script: MigrationScript): void {
    this.scripts.set(script.id, script);
  }

  public addEntity(entity: DataEntity): void {
    this.entities.set(entity.id, entity);
  }

  public removeScript(scriptId: string): void {
    this.scripts.delete(scriptId);
  }

  public removeEntity(entityId: string): void {
    this.entities.delete(entityId);
  }

  public calculateOverallCoverage(): CoverageBreakdown {
    const allScripts = Array.from(this.scripts.values());

    if (allScripts.length === 0) {
      return this.getEmptyCoverage();
    }

    const completedScripts = allScripts.filter(s => s.status === 'completed');
    const overall = completedScripts.length / allScripts.length;

    return {
      overall,
      byDomain: this.calculateDomainCoverage(allScripts),
      byCategory: this.calculateCategoryCoverage(allScripts),
      byStatus: this.calculateStatusCoverage(allScripts)
    };
  }

  public calculateDomainCoverageDetails(): DomainCoverage[] {
    const domainMap = new Map<DataDomain, MigrationScript[]>();

    // Group scripts by domain
    Array.from(this.scripts.values()).forEach(script => {
      if (!domainMap.has(script.domain)) {
        domainMap.set(script.domain, []);
      }
      domainMap.get(script.domain)!.push(script);
    });

    const results: DomainCoverage[] = [];

    domainMap.forEach((scripts, domain) => {
      const completedScripts = scripts.filter(s => s.status === 'completed');
      const totalRecords = scripts.reduce((sum, s) => sum + (s.estimatedRecords || 0), 0);
      const migratedRecords = completedScripts.reduce((sum, s) => sum + (s.recordsProcessed || 0), 0);

      const successRates = completedScripts
        .map(s => s.successRate || 0)
        .filter(rate => rate > 0);

      const averageSuccessRate = successRates.length > 0
        ? successRates.reduce((sum, rate) => sum + rate, 0) / successRates.length
        : 0;

      results.push({
        domain,
        totalScripts: scripts.length,
        completedScripts: completedScripts.length,
        totalRecords,
        migratedRecords,
        averageSuccessRate,
        coverage: completedScripts.length / scripts.length
      });
    });

    return results.sort((a, b) => b.coverage - a.coverage);
  }

  public calculateEntityCoverage(): EntityCoverage[] {
    return Array.from(this.entities.values()).map(entity => ({
      entityName: entity.name,
      domainId: entity.domainId,
      totalRecords: entity.totalRecords,
      migratedRecords: entity.migratedRecords,
      failedRecords: entity.failedRecords,
      successRate: entity.getSuccessRate(),
      lastMigrated: entity.lastMigrated
    })).sort((a, b) => b.successRate - a.successRate);
  }

  public calculateWeightedCoverage(): number {
    const allScripts = Array.from(this.scripts.values());

    if (allScripts.length === 0) return 0;

    let weightedCompleted = 0;
    let totalWeight = 0;

    allScripts.forEach(script => {
      const weight = this.getScriptWeight(script);
      totalWeight += weight;

      if (script.status === 'completed') {
        const successFactor = script.successRate || 0;
        weightedCompleted += weight * successFactor;
      }
    });

    return totalWeight > 0 ? weightedCompleted / totalWeight : 0;
  }

  public calculateMigrationVelocity(timeWindow: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeWindow);

    const recentCompletions = Array.from(this.scripts.values())
      .filter(script => {
        if (!script.lastExecuted || script.status !== 'completed') return false;
        return new Date(script.lastExecuted) >= cutoffDate;
      });

    return recentCompletions.length / timeWindow;
  }

  public calculateRiskScore(): number {
    const allScripts = Array.from(this.scripts.values());
    const failedScripts = allScripts.filter(s => s.status === 'failed');
    const pendingScripts = allScripts.filter(s => s.status === 'pending');

    if (allScripts.length === 0) return 0;

    const failureRate = failedScripts.length / allScripts.length;
    const pendingRate = pendingScripts.length / allScripts.length;
    const complexityFactor = this.calculateAverageComplexity() / 100;

    return Math.min(1, (failureRate * 0.5) + (pendingRate * 0.3) + (complexityFactor * 0.2));
  }

  public generateCoverageReport(): CoverageReport {
    const allScripts = Array.from(this.scripts.values());
    const completedScripts = allScripts.filter(s => s.status === 'completed');

    const totalRecords = allScripts.reduce((sum, s) => sum + (s.estimatedRecords || 0), 0);
    const migratedRecords = completedScripts.reduce((sum, s) => sum + (s.recordsProcessed || 0), 0);

    const domainCoverage = this.calculateDomainCoverageDetails();

    return new CoverageReport({
      totalScripts: allScripts.length,
      completedScripts: completedScripts.length,
      totalRecords,
      migratedRecords,
      overallSuccessRate: this.calculateWeightedCoverage(),
      clinicalCoverage: this.getDomainCoverage(domainCoverage, DataDomain.CLINICAL),
      businessCoverage: this.getDomainCoverage(domainCoverage, DataDomain.BUSINESS),
      communicationsCoverage: this.getDomainCoverage(domainCoverage, DataDomain.COMMUNICATIONS),
      technicalCoverage: this.getDomainCoverage(domainCoverage, DataDomain.TECHNICAL)
    });
  }

  public calculateCompletionEstimate(): { estimatedDays: number; confidence: number } {
    const pendingScripts = Array.from(this.scripts.values())
      .filter(s => s.status === 'pending');

    if (pendingScripts.length === 0) {
      return { estimatedDays: 0, confidence: 1.0 };
    }

    const velocity = this.calculateMigrationVelocity();
    const complexityFactors = pendingScripts.map(s => this.getScriptComplexity(s));
    const averageComplexity = complexityFactors.reduce((sum, c) => sum + c, 0) / complexityFactors.length;

    const adjustedVelocity = velocity * (1 / Math.max(1, averageComplexity / 50));
    const estimatedDays = adjustedVelocity > 0 ? pendingScripts.length / adjustedVelocity : Infinity;

    const confidence = Math.min(1, velocity * 0.8 + 0.2);

    return {
      estimatedDays: Math.ceil(estimatedDays),
      confidence: Math.round(confidence * 100) / 100
    };
  }

  public findBottlenecks(): { domain: string; issue: string; impact: number }[] {
    const bottlenecks: { domain: string; issue: string; impact: number }[] = [];
    const domainCoverage = this.calculateDomainCoverageDetails();

    domainCoverage.forEach(coverage => {
      if (coverage.coverage < 0.8) {
        bottlenecks.push({
          domain: coverage.domain,
          issue: `Low completion rate: ${Math.round(coverage.coverage * 100)}%`,
          impact: (1 - coverage.coverage) * coverage.totalScripts
        });
      }

      if (coverage.averageSuccessRate < 0.95) {
        bottlenecks.push({
          domain: coverage.domain,
          issue: `Low success rate: ${Math.round(coverage.averageSuccessRate * 100)}%`,
          impact: (1 - coverage.averageSuccessRate) * coverage.completedScripts
        });
      }
    });

    return bottlenecks.sort((a, b) => b.impact - a.impact);
  }

  private calculateDomainCoverage(scripts: MigrationScript[]): Map<DataDomain, number> {
    const domainMap = new Map<DataDomain, { total: number; completed: number }>();

    scripts.forEach(script => {
      if (!domainMap.has(script.domain)) {
        domainMap.set(script.domain, { total: 0, completed: 0 });
      }

      const stats = domainMap.get(script.domain)!;
      stats.total++;
      if (script.status === 'completed') {
        stats.completed++;
      }
    });

    const result = new Map<DataDomain, number>();
    domainMap.forEach((stats, domain) => {
      result.set(domain, stats.total > 0 ? stats.completed / stats.total : 0);
    });

    return result;
  }

  private calculateCategoryCoverage(scripts: MigrationScript[]): Map<string, number> {
    const categoryMap = new Map<string, { total: number; completed: number }>();

    scripts.forEach(script => {
      if (!categoryMap.has(script.category)) {
        categoryMap.set(script.category, { total: 0, completed: 0 });
      }

      const stats = categoryMap.get(script.category)!;
      stats.total++;
      if (script.status === 'completed') {
        stats.completed++;
      }
    });

    const result = new Map<string, number>();
    categoryMap.forEach((stats, category) => {
      result.set(category, stats.total > 0 ? stats.completed / stats.total : 0);
    });

    return result;
  }

  private calculateStatusCoverage(scripts: MigrationScript[]): Map<string, number> {
    const statusMap = new Map<string, number>();
    const total = scripts.length;

    scripts.forEach(script => {
      const count = statusMap.get(script.status) || 0;
      statusMap.set(script.status, count + 1);
    });

    const result = new Map<string, number>();
    statusMap.forEach((count, status) => {
      result.set(status, total > 0 ? count / total : 0);
    });

    return result;
  }

  private getEmptyCoverage(): CoverageBreakdown {
    return {
      overall: 0,
      byDomain: new Map(),
      byCategory: new Map(),
      byStatus: new Map()
    };
  }

  private getScriptWeight(script: MigrationScript): number {
    let weight = 1;

    // Domain weighting
    switch (script.domain) {
      case DataDomain.CLINICAL:
        weight *= 1.5;
        break;
      case DataDomain.BUSINESS:
        weight *= 1.3;
        break;
      case DataDomain.COMMUNICATIONS:
        weight *= 1.1;
        break;
      case DataDomain.TECHNICAL:
        weight *= 1.0;
        break;
    }

    // Category weighting
    if (script.category === 'core') weight *= 1.4;
    if (script.category === 'critical-fix') weight *= 1.6;

    // Record volume weighting
    const recordFactor = Math.log10((script.estimatedRecords || 1) + 1) / 6;
    weight *= (1 + recordFactor);

    return weight;
  }

  private getScriptComplexity(script: MigrationScript): number {
    let complexity = 1;

    // Domain complexity
    switch (script.domain) {
      case DataDomain.CLINICAL:
        complexity *= 1.3;
        break;
      case DataDomain.BUSINESS:
        complexity *= 1.2;
        break;
      default:
        complexity *= 1.0;
        break;
    }

    // Record volume complexity
    const records = script.estimatedRecords || 1000;
    complexity *= Math.log10(records) / 3;

    // Dependency complexity
    if (script.dependencies && script.dependencies.length > 0) {
      complexity *= (1 + script.dependencies.length * 0.1);
    }

    return Math.max(1, complexity);
  }

  private calculateAverageComplexity(): number {
    const scripts = Array.from(this.scripts.values());
    if (scripts.length === 0) return 0;

    const complexities = scripts.map(s => this.getScriptComplexity(s));
    return complexities.reduce((sum, c) => sum + c, 0) / complexities.length;
  }

  private getDomainCoverage(domainCoverage: DomainCoverage[], domain: DataDomain): number {
    const coverage = domainCoverage.find(dc => dc.domain === domain);
    return coverage ? coverage.coverage : 0;
  }
}
/**
 * Migration Script Analyzer Service
 *
 * Analyzes migration scripts to extract metadata, status, and performance metrics.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { MigrationScript, MigrationStatus, DataDomain } from '../models';

export interface ScriptAnalysisResult {
  script: MigrationScript;
  dependencies: string[];
  estimatedRecords: number;
  complexityScore: number;
}

export interface AnalysisOptions {
  includeTests?: boolean;
  includeValidation?: boolean;
  scanForDependencies?: boolean;
}

export class MigrationScriptAnalyzer {
  private readonly scriptsPath: string;
  private readonly knownPatterns: Map<string, RegExp>;

  constructor(scriptsPath: string = './src') {
    this.scriptsPath = scriptsPath;
    this.knownPatterns = this.initializePatterns();
  }

  private initializePatterns(): Map<string, RegExp> {
    return new Map([
      ['recordCount', /(?:COUNT\(\*\)|pg_stat_get_tuples_returned|SELECT.*FROM.*dispatch_)/gi],
      ['batchSize', /BATCH_SIZE\s*=\s*(\d+)/gi],
      ['tableName', /dispatch_(\w+)/gi],
      ['dependencies', /(?:REFERENCES|JOIN|FROM)\s+(\w+)/gi],
      ['validation', /validate|verify|check/gi],
      ['rollback', /rollback|revert|undo/gi]
    ]);
  }

  public async analyzeAllScripts(options: AnalysisOptions = {}): Promise<ScriptAnalysisResult[]> {
    const scriptFiles = await this.discoverScripts();
    const results: ScriptAnalysisResult[] = [];

    for (const file of scriptFiles) {
      try {
        const result = await this.analyzeScript(file, options);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.warn(`Failed to analyze script ${file}:`, error);
      }
    }

    return results.sort((a, b) => b.complexityScore - a.complexityScore);
  }

  public async analyzeScript(filePath: string, options: AnalysisOptions = {}): Promise<ScriptAnalysisResult | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = this.extractFileName(filePath);

      const script = new MigrationScript({
        name: fileName,
        filePath: filePath,
        category: this.determineCategory(fileName, content),
        domain: this.determineDomain(fileName, content),
        status: this.determineStatus(content),
        description: this.extractDescription(content),
        estimatedRecords: this.estimateRecords(content),
        dependencies: options.scanForDependencies ? this.extractDependencies(content) : []
      });

      const dependencies = options.scanForDependencies ? this.extractDependencies(content) : [];
      const estimatedRecords = this.estimateRecords(content);
      const complexityScore = this.calculateComplexity(content, dependencies.length, estimatedRecords);

      return {
        script,
        dependencies,
        estimatedRecords,
        complexityScore
      };
    } catch (error) {
      console.error(`Error analyzing script ${filePath}:`, error);
      return null;
    }
  }

  public async getScriptMetrics(scriptName: string): Promise<{
    linesOfCode: number;
    cyclomaticComplexity: number;
    maintainabilityIndex: number;
  } | null> {
    try {
      const scriptPath = await this.findScriptPath(scriptName);
      if (!scriptPath) return null;

      const content = await fs.readFile(scriptPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim() && !line.trim().startsWith('//'));

      return {
        linesOfCode: lines.length,
        cyclomaticComplexity: this.calculateCyclomaticComplexity(content),
        maintainabilityIndex: this.calculateMaintainabilityIndex(content, lines.length)
      };
    } catch (error) {
      console.error(`Error getting metrics for script ${scriptName}:`, error);
      return null;
    }
  }

  private async discoverScripts(): Promise<string[]> {
    const scripts: string[] = [];

    try {
      await this.scanDirectory(this.scriptsPath, scripts);
    } catch (error) {
      console.error('Error discovering scripts:', error);
    }

    return scripts;
  }

  private async scanDirectory(dirPath: string, scripts: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name)) {
          await this.scanDirectory(fullPath, scripts);
        } else if (entry.isFile() && this.isMigrationScript(entry.name)) {
          scripts.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not scan directory ${dirPath}:`, error);
    }
  }

  private shouldSkipDirectory(name: string): boolean {
    return ['node_modules', '.git', 'dist', 'build', 'coverage'].includes(name);
  }

  private isMigrationScript(fileName: string): boolean {
    return (
      fileName.endsWith('.ts') &&
      (fileName.includes('migrate') || fileName.includes('dispatch') || fileName.includes('analyze'))
    );
  }

  private extractFileName(filePath: string): string {
    return filePath.split('/').pop()?.replace('.ts', '') || 'unknown';
  }

  private determineCategory(fileName: string, content: string): string {
    if (fileName.includes('office') || content.includes('dispatch_office')) return 'core';
    if (fileName.includes('profile') || content.includes('dispatch_profile')) return 'core';
    if (fileName.includes('doctor') || content.includes('dispatch_doctor')) return 'core';
    if (fileName.includes('patient') || content.includes('dispatch_patient')) return 'core';
    if (fileName.includes('order') || content.includes('dispatch_order')) return 'business';
    if (fileName.includes('message') || content.includes('dispatch_message')) return 'communications';
    if (fileName.includes('task') || content.includes('dispatch_task')) return 'business';
    if (fileName.includes('case') || content.includes('dispatch_case')) return 'specialized';
    if (fileName.includes('system') || fileName.includes('schema')) return 'system';
    if (fileName.includes('fix') || fileName.includes('repair')) return 'critical-fix';
    return 'specialized';
  }

  private determineDomain(fileName: string, content: string): DataDomain {
    if (fileName.includes('patient') || fileName.includes('doctor') || fileName.includes('treatment')) {
      return DataDomain.CLINICAL;
    }
    if (fileName.includes('order') || fileName.includes('product') || fileName.includes('payment')) {
      return DataDomain.BUSINESS;
    }
    if (fileName.includes('message') || fileName.includes('notification') || fileName.includes('comment')) {
      return DataDomain.COMMUNICATIONS;
    }
    return DataDomain.TECHNICAL;
  }

  private determineStatus(content: string): MigrationStatus {
    if (content.includes('TODO') || content.includes('FIXME')) {
      return MigrationStatus.PENDING;
    }
    if (content.includes('console.log') && content.includes('migrated successfully')) {
      return MigrationStatus.COMPLETED;
    }
    if (content.includes('try {') && content.includes('catch')) {
      return MigrationStatus.IN_PROGRESS;
    }
    return MigrationStatus.PENDING;
  }

  private extractDescription(content: string): string {
    const lines = content.split('\n');
    for (const line of lines.slice(0, 10)) {
      if (line.includes('*') && line.length > 10) {
        return line.replace(/^\s*\*\s*/, '').trim();
      }
    }
    return 'Migration script';
  }

  private estimateRecords(content: string): number {
    const batchSizeMatch = content.match(/BATCH_SIZE\s*=\s*(\d+)/);
    const countMatch = content.match(/(\d{1,6})\s*(?:records?|rows?)/i);

    if (countMatch) {
      return parseInt(countMatch[1], 10);
    }
    if (batchSizeMatch) {
      return parseInt(batchSizeMatch[1], 10) * 10; // Estimate
    }

    if (content.includes('dispatch_patient')) return 15000;
    if (content.includes('dispatch_order')) return 25000;
    if (content.includes('dispatch_task')) return 750000;
    if (content.includes('dispatch_case')) return 8000;

    return 1000; // Default estimate
  }

  private extractDependencies(content: string): string[] {
    const dependencies = new Set<string>();
    const dependencyPattern = this.knownPatterns.get('dependencies');

    if (dependencyPattern) {
      const matches = content.match(dependencyPattern);
      if (matches) {
        matches.forEach(match => {
          const table = match.replace(/(?:REFERENCES|JOIN|FROM)\s+/i, '').trim();
          if (table && !table.includes('(')) {
            dependencies.add(table);
          }
        });
      }
    }

    return Array.from(dependencies);
  }

  private calculateComplexity(content: string, dependencyCount: number, recordCount: number): number {
    let score = 0;

    // Base complexity
    score += content.split('\n').length * 0.1;

    // SQL complexity
    score += (content.match(/SELECT|INSERT|UPDATE|DELETE/gi) || []).length * 2;

    // Dependency complexity
    score += dependencyCount * 5;

    // Record volume complexity
    score += Math.log10(recordCount || 1) * 3;

    // Error handling complexity
    score += (content.match(/try|catch|throw/gi) || []).length * 1.5;

    // Transaction complexity
    score += (content.match(/BEGIN|COMMIT|ROLLBACK/gi) || []).length * 2;

    return Math.round(score * 10) / 10;
  }

  private calculateCyclomaticComplexity(content: string): number {
    const patterns = [
      /if\s*\(/gi,
      /else\s*if/gi,
      /while\s*\(/gi,
      /for\s*\(/gi,
      /switch\s*\(/gi,
      /case\s+/gi,
      /catch\s*\(/gi,
      /\?\s*:/gi // Ternary operator
    ];

    let complexity = 1; // Base complexity

    patterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    });

    return complexity;
  }

  private calculateMaintainabilityIndex(content: string, linesOfCode: number): number {
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(content);
    const halsteadVolume = this.estimateHalsteadVolume(content);

    // Simplified maintainability index calculation
    const mi = Math.max(0, 171 - 5.2 * Math.log(halsteadVolume) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(linesOfCode));

    return Math.round(mi * 10) / 10;
  }

  private estimateHalsteadVolume(content: string): number {
    const operators = content.match(/[+\-*/=<>!&|]+/g) || [];
    const operands = content.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];

    const n1 = new Set(operators).size; // Unique operators
    const n2 = new Set(operands).size;  // Unique operands
    const N1 = operators.length;         // Total operators
    const N2 = operands.length;          // Total operands

    const vocabulary = n1 + n2;
    const length = N1 + N2;

    return length * Math.log2(vocabulary || 1);
  }

  private async findScriptPath(scriptName: string): Promise<string | null> {
    const scripts = await this.discoverScripts();
    return scripts.find(path => path.includes(scriptName)) || null;
  }
}
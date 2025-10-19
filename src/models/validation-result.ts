/**
 * Validation Result Model
 * Comprehensive validation reporting for migration operations
 */

export interface ValidationResult {
  id: string;
  entityId: string;
  entityName: string;
  validationType: ValidationType;
  status: ValidationStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  checks: ValidationCheck[];
  summary: ValidationSummary;
  metadata: ValidationMetadata;
}

export type ValidationType =
  | 'record_count'
  | 'data_integrity'
  | 'referential_integrity'
  | 'data_type_validation'
  | 'business_rule_validation'
  | 'performance_validation'
  | 'security_validation'
  | 'completeness_check'
  | 'accuracy_check'
  | 'consistency_check'
  | 'custom_validation';

export type ValidationStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'warning'
  | 'skipped'
  | 'error';

export interface ValidationCheck {
  id: string;
  name: string;
  type: ValidationType;
  status: ValidationStatus;
  expected: any;
  actual: any;
  tolerance?: number;
  errorMessage?: string;
  warningMessage?: string;
  details?: ValidationCheckDetails;
  duration: number; // milliseconds
  retryCount: number;
}

export interface ValidationCheckDetails {
  query?: string;
  parameters?: Record<string, any>;
  resultSet?: any[];
  comparisonMethod?: 'exact' | 'range' | 'pattern' | 'custom';
  toleranceType?: 'absolute' | 'percentage';
  context?: Record<string, any>;
}

export interface ValidationSummary {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  errorChecks: number;
  overallStatus: ValidationStatus;
  criticalIssues: number;
  recommendations: string[];
  passRate: number; // percentage
}

export interface ValidationMetadata {
  sourceRecordCount?: number;
  targetRecordCount?: number;
  recordCountDifference?: number;
  recordCountDifferencePercentage?: number;
  dataIntegrityScore?: number;
  performanceMetrics?: PerformanceMetrics;
  securityChecks?: SecurityValidation[];
  businessRuleResults?: BusinessRuleResult[];
}

export interface PerformanceMetrics {
  queryExecutionTime: number; // milliseconds
  dataRetrievalTime: number; // milliseconds
  validationProcessingTime: number; // milliseconds
  memoryUsage?: number; // MB
  cpuUsage?: number; // percentage
  diskIoOperations?: number;
}

export interface SecurityValidation {
  checkName: string;
  status: ValidationStatus;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  remediation?: string;
}

export interface BusinessRuleResult {
  ruleName: string;
  ruleType: 'constraint' | 'calculation' | 'relationship' | 'format';
  status: ValidationStatus;
  violationCount: number;
  sampleViolations?: any[];
  impact: 'low' | 'medium' | 'high';
}

export class ValidationResultBuilder {
  private result: Partial<ValidationResult> = {};

  static create(id: string, entityId: string, entityName: string, type: ValidationType): ValidationResultBuilder {
    const builder = new ValidationResultBuilder();
    builder.result = {
      id,
      entityId,
      entityName,
      validationType: type,
      status: 'pending',
      startTime: new Date(),
      checks: [],
      summary: {
        totalChecks: 0,
        passedChecks: 0,
        failedChecks: 0,
        warningChecks: 0,
        skippedChecks: 0,
        errorChecks: 0,
        overallStatus: 'pending',
        criticalIssues: 0,
        recommendations: [],
        passRate: 0
      },
      metadata: {}
    };
    return builder;
  }

  addCheck(check: ValidationCheck): ValidationResultBuilder {
    this.result.checks!.push(check);
    this.updateSummary();
    return this;
  }

  updateStatus(status: ValidationStatus): ValidationResultBuilder {
    this.result.status = status;
    if (status !== 'pending' && status !== 'running' && !this.result.endTime) {
      this.result.endTime = new Date();
      this.result.duration = this.result.endTime.getTime() - this.result.startTime!.getTime();
    }
    return this;
  }

  setMetadata(metadata: Partial<ValidationMetadata>): ValidationResultBuilder {
    this.result.metadata = { ...this.result.metadata!, ...metadata };
    return this;
  }

  addRecommendation(recommendation: string): ValidationResultBuilder {
    this.result.summary!.recommendations.push(recommendation);
    return this;
  }

  private updateSummary(): void {
    const summary = this.result.summary!;
    const checks = this.result.checks!;

    summary.totalChecks = checks.length;
    summary.passedChecks = checks.filter(c => c.status === 'passed').length;
    summary.failedChecks = checks.filter(c => c.status === 'failed').length;
    summary.warningChecks = checks.filter(c => c.status === 'warning').length;
    summary.skippedChecks = checks.filter(c => c.status === 'skipped').length;
    summary.errorChecks = checks.filter(c => c.status === 'error').length;

    summary.criticalIssues = checks.filter(c =>
      c.status === 'failed' && (
        c.type === 'data_integrity' ||
        c.type === 'referential_integrity' ||
        c.type === 'security_validation'
      )
    ).length;

    summary.passRate = summary.totalChecks > 0
      ? (summary.passedChecks / summary.totalChecks) * 100
      : 0;

    // Determine overall status
    if (summary.failedChecks > 0 || summary.errorChecks > 0) {
      summary.overallStatus = 'failed';
    } else if (summary.warningChecks > 0) {
      summary.overallStatus = 'warning';
    } else if (summary.totalChecks > 0 && summary.passedChecks === summary.totalChecks) {
      summary.overallStatus = 'passed';
    } else {
      summary.overallStatus = 'running';
    }
  }

  build(): ValidationResult {
    if (!this.result.id || !this.result.entityId || !this.result.entityName) {
      throw new Error('Validation result must have id, entityId, and entityName');
    }
    this.updateSummary();
    return this.result as ValidationResult;
  }
}

// Validation check builder for common patterns
export class ValidationCheckBuilder {
  private check: Partial<ValidationCheck> = {};

  static create(id: string, name: string, type: ValidationType): ValidationCheckBuilder {
    const builder = new ValidationCheckBuilder();
    builder.check = {
      id,
      name,
      type,
      status: 'pending',
      retryCount: 0,
      duration: 0
    };
    return builder;
  }

  expected(value: any): ValidationCheckBuilder {
    this.check.expected = value;
    return this;
  }

  actual(value: any): ValidationCheckBuilder {
    this.check.actual = value;
    return this;
  }

  tolerance(value: number): ValidationCheckBuilder {
    this.check.tolerance = value;
    return this;
  }

  details(details: ValidationCheckDetails): ValidationCheckBuilder {
    this.check.details = details;
    return this;
  }

  execute<T>(validationFunction: () => T): ValidationCheckBuilder {
    const startTime = Date.now();
    try {
      const result = validationFunction();
      this.check.actual = result;

      // Determine status based on comparison
      if (this.compareValues(this.check.expected, this.check.actual, this.check.tolerance)) {
        this.check.status = 'passed';
      } else {
        this.check.status = 'failed';
        this.check.errorMessage = `Expected ${this.check.expected}, but got ${this.check.actual}`;
      }
    } catch (error) {
      this.check.status = 'error';
      this.check.errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    } finally {
      this.check.duration = Date.now() - startTime;
    }
    return this;
  }

  private compareValues(expected: any, actual: any, tolerance?: number): boolean {
    if (expected === actual) return true;

    if (typeof expected === 'number' && typeof actual === 'number' && tolerance !== undefined) {
      const diff = Math.abs(expected - actual);
      return diff <= tolerance || (diff / expected) * 100 <= tolerance;
    }

    return false;
  }

  build(): ValidationCheck {
    if (!this.check.id || !this.check.name || !this.check.type) {
      throw new Error('Validation check must have id, name, and type');
    }
    return this.check as ValidationCheck;
  }
}

// Preset validation configurations
export const ValidationPresets = {
  createRecordCountCheck: (entityName: string, expected: number, actual: number, tolerance: number = 1): ValidationCheck => {
    return ValidationCheckBuilder
      .create(`${entityName}-record-count`, `${entityName} Record Count Validation`, 'record_count')
      .expected(expected)
      .actual(actual)
      .tolerance(tolerance)
      .execute(() => actual)
      .build();
  },

  createDataIntegrityCheck: (entityName: string, fieldName: string): ValidationCheck => {
    return ValidationCheckBuilder
      .create(`${entityName}-${fieldName}-integrity`, `${entityName} ${fieldName} Data Integrity`, 'data_integrity')
      .details({
        query: `SELECT COUNT(*) FROM ${entityName} WHERE ${fieldName} IS NULL OR ${fieldName} = ''`,
        comparisonMethod: 'exact'
      })
      .build();
  },

  createReferentialIntegrityCheck: (
    entityName: string,
    foreignKey: string,
    referencedTable: string,
    referencedColumn: string = 'id'
  ): ValidationCheck => {
    return ValidationCheckBuilder
      .create(
        `${entityName}-${foreignKey}-ref-integrity`,
        `${entityName} ${foreignKey} Referential Integrity`,
        'referential_integrity'
      )
      .details({
        query: `
          SELECT COUNT(*) FROM ${entityName} e
          LEFT JOIN ${referencedTable} r ON e.${foreignKey} = r.${referencedColumn}
          WHERE e.${foreignKey} IS NOT NULL AND r.${referencedColumn} IS NULL
        `,
        comparisonMethod: 'exact'
      })
      .expected(0)
      .build();
  }
};

// Validation result analysis utilities
export const ValidationAnalyzer = {
  getCriticalIssues: (result: ValidationResult): ValidationCheck[] => {
    return result.checks.filter(check =>
      check.status === 'failed' && (
        check.type === 'data_integrity' ||
        check.type === 'referential_integrity' ||
        check.type === 'security_validation'
      )
    );
  },

  getFailureRate: (result: ValidationResult): number => {
    if (result.summary.totalChecks === 0) return 0;
    return (result.summary.failedChecks / result.summary.totalChecks) * 100;
  },

  hasBlockingIssues: (result: ValidationResult): boolean => {
    return result.summary.criticalIssues > 0;
  },

  generateReport: (result: ValidationResult): string => {
    const lines: string[] = [];
    lines.push(`Validation Report for ${result.entityName}`);
    lines.push(`Status: ${result.status}`);
    lines.push(`Duration: ${result.duration || 0}ms`);
    lines.push(`Pass Rate: ${result.summary.passRate.toFixed(2)}%`);
    lines.push(`Critical Issues: ${result.summary.criticalIssues}`);

    if (result.summary.recommendations.length > 0) {
      lines.push('\nRecommendations:');
      result.summary.recommendations.forEach(rec => lines.push(`- ${rec}`));
    }

    return lines.join('\n');
  }
};
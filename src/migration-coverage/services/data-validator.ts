/**
 * Data Validation Service
 *
 * Validates migrated data integrity, completeness, and business rule compliance.
 */

import { Pool } from 'pg';
import { DataEntity, MigrationMetrics, ExecutionLog, LogLevel, OperationType } from '../models';

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  query: string;
  expectedResult: 'zero' | 'positive' | 'equals' | 'custom';
  threshold?: number;
  severity: 'critical' | 'warning' | 'info';
}

export interface ValidationResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  actualValue: number;
  expectedValue?: number;
  severity: string;
  message: string;
  executionTime: number;
}

export interface ValidationSummary {
  totalRules: number;
  passedRules: number;
  failedRules: number;
  criticalFailures: number;
  warningCount: number;
  overallScore: number;
  executionTime: number;
}

export interface DataIntegrityCheck {
  entityName: string;
  checkType: 'referential' | 'uniqueness' | 'completeness' | 'business_rule';
  passed: boolean;
  details: string;
  affectedRecords: number;
}

export class DataValidator {
  private readonly sourcePool: Pool;
  private readonly targetPool: Pool;
  private readonly validationRules: Map<string, ValidationRule> = new Map();

  constructor(sourcePool: Pool, targetPool: Pool) {
    this.sourcePool = sourcePool;
    this.targetPool = targetPool;
    this.initializeStandardRules();
  }

  public async validateEntity(entity: DataEntity): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const entityRules = this.getEntityValidationRules(entity.name);

    for (const rule of entityRules) {
      try {
        const startTime = Date.now();
        const result = await this.executeValidationRule(rule, entity);
        const executionTime = Date.now() - startTime;

        results.push({
          ...result,
          executionTime
        });
      } catch (error) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          actualValue: 0,
          severity: rule.severity,
          message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          executionTime: 0
        });
      }
    }

    return results;
  }

  public async validateMigrationCompleteness(scriptId: string): Promise<DataIntegrityCheck[]> {
    const checks: DataIntegrityCheck[] = [];

    // Check referential integrity
    const referentialChecks = await this.checkReferentialIntegrity();
    checks.push(...referentialChecks);

    // Check data completeness
    const completenessChecks = await this.checkDataCompleteness(scriptId);
    checks.push(...completenessChecks);

    // Check uniqueness constraints
    const uniquenessChecks = await this.checkUniquenessConstraints();
    checks.push(...uniquenessChecks);

    // Check business rules
    const businessRuleChecks = await this.checkBusinessRules();
    checks.push(...businessRuleChecks);

    return checks;
  }

  public async validateCrossEntityConsistency(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const crossEntityRules = Array.from(this.validationRules.values())
      .filter(rule => rule.id.startsWith('cross_'));

    for (const rule of crossEntityRules) {
      try {
        const startTime = Date.now();
        const result = await this.executeCrossEntityRule(rule);
        const executionTime = Date.now() - startTime;

        results.push({
          ...result,
          executionTime
        });
      } catch (error) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          actualValue: 0,
          severity: rule.severity,
          message: `Cross-entity validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          executionTime: 0
        });
      }
    }

    return results;
  }

  public async generateValidationSummary(results: ValidationResult[]): Promise<ValidationSummary> {
    const totalRules = results.length;
    const passedRules = results.filter(r => r.passed).length;
    const failedRules = totalRules - passedRules;
    const criticalFailures = results.filter(r => !r.passed && r.severity === 'critical').length;
    const warningCount = results.filter(r => !r.passed && r.severity === 'warning').length;
    const executionTime = results.reduce((sum, r) => sum + r.executionTime, 0);

    let overallScore = 0;
    if (totalRules > 0) {
      const criticalWeight = 0.6;
      const warningWeight = 0.3;
      const infoWeight = 0.1;

      const criticalScore = (totalRules - criticalFailures) / totalRules * criticalWeight;
      const warningScore = (totalRules - warningCount) / totalRules * warningWeight;
      const infoScore = passedRules / totalRules * infoWeight;

      overallScore = criticalScore + warningScore + infoScore;
    }

    return {
      totalRules,
      passedRules,
      failedRules,
      criticalFailures,
      warningCount,
      overallScore: Math.round(overallScore * 1000) / 10, // Percentage with 1 decimal
      executionTime
    };
  }

  public async validateDataConsistency(sourceTable: string, targetTable: string): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      // Compare record counts
      const sourceCount = await this.getRecordCount(this.sourcePool, sourceTable);
      const targetCount = await this.getRecordCount(this.targetPool, targetTable);

      const passed = sourceCount === targetCount;
      const executionTime = Date.now() - startTime;

      return {
        ruleId: `consistency_${sourceTable}`,
        ruleName: `${sourceTable} Record Count Consistency`,
        passed,
        actualValue: targetCount,
        expectedValue: sourceCount,
        severity: 'critical',
        message: passed
          ? `Record counts match: ${sourceCount}`
          : `Record count mismatch: expected ${sourceCount}, got ${targetCount}`,
        executionTime
      };
    } catch (error) {
      return {
        ruleId: `consistency_${sourceTable}`,
        ruleName: `${sourceTable} Record Count Consistency`,
        passed: false,
        actualValue: 0,
        severity: 'critical',
        message: `Consistency check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        executionTime: Date.now() - startTime
      };
    }
  }

  public async validateBusinessRules(entityName: string): Promise<ValidationResult[]> {
    const businessRules = this.getBusinessRules(entityName);
    const results: ValidationResult[] = [];

    for (const rule of businessRules) {
      const startTime = Date.now();

      try {
        const result = await this.targetPool.query(rule.query);
        const actualValue = parseInt(result.rows[0]?.count || '0', 10);
        const passed = this.evaluateBusinessRule(rule, actualValue);

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed,
          actualValue,
          expectedValue: rule.threshold,
          severity: rule.severity,
          message: passed
            ? `Business rule passed: ${rule.description}`
            : `Business rule violation: ${rule.description} (${actualValue})`,
          executionTime: Date.now() - startTime
        });
      } catch (error) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          passed: false,
          actualValue: 0,
          severity: rule.severity,
          message: `Business rule check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          executionTime: Date.now() - startTime
        });
      }
    }

    return results;
  }

  private initializeStandardRules(): void {
    const rules: ValidationRule[] = [
      {
        id: 'null_primary_keys',
        name: 'No Null Primary Keys',
        description: 'Ensures all primary keys are non-null',
        query: 'SELECT COUNT(*) FROM {table} WHERE id IS NULL',
        expectedResult: 'zero',
        severity: 'critical'
      },
      {
        id: 'duplicate_primary_keys',
        name: 'No Duplicate Primary Keys',
        description: 'Ensures all primary keys are unique',
        query: 'SELECT COUNT(*) - COUNT(DISTINCT id) as duplicates FROM {table}',
        expectedResult: 'zero',
        severity: 'critical'
      },
      {
        id: 'legacy_id_preservation',
        name: 'Legacy ID Preservation',
        description: 'Ensures legacy IDs are preserved in metadata',
        query: 'SELECT COUNT(*) FROM {table} WHERE legacy_metadata IS NULL',
        expectedResult: 'zero',
        severity: 'warning'
      },
      {
        id: 'cross_office_patient_consistency',
        name: 'Office-Patient Consistency',
        description: 'Ensures patients belong to valid offices',
        query: `SELECT COUNT(*) FROM patients p
                LEFT JOIN offices o ON p.office_id = o.id
                WHERE o.id IS NULL`,
        expectedResult: 'zero',
        severity: 'critical'
      },
      {
        id: 'cross_doctor_patient_consistency',
        name: 'Doctor-Patient Consistency',
        description: 'Ensures patients have valid doctors',
        query: `SELECT COUNT(*) FROM patients p
                LEFT JOIN doctors d ON p.doctor_id = d.id
                WHERE p.doctor_id IS NOT NULL AND d.id IS NULL`,
        expectedResult: 'zero',
        severity: 'critical'
      },
      {
        id: 'order_patient_consistency',
        name: 'Order-Patient Consistency',
        description: 'Ensures orders belong to valid patients',
        query: `SELECT COUNT(*) FROM orders o
                LEFT JOIN patients p ON o.patient_id = p.id
                WHERE p.id IS NULL`,
        expectedResult: 'zero',
        severity: 'critical'
      }
    ];

    rules.forEach(rule => {
      this.validationRules.set(rule.id, rule);
    });
  }

  private getEntityValidationRules(entityName: string): ValidationRule[] {
    const allRules = Array.from(this.validationRules.values());
    return allRules.filter(rule =>
      rule.query.includes(entityName) || rule.id.includes(entityName.toLowerCase())
    );
  }

  private async executeValidationRule(rule: ValidationRule, entity: DataEntity): Promise<ValidationResult> {
    const query = rule.query.replace(/{table}/g, entity.targetTable || entity.name);
    const result = await this.targetPool.query(query);
    const actualValue = parseInt(result.rows[0]?.count || result.rows[0]?.duplicates || '0', 10);

    const passed = this.evaluateRule(rule, actualValue);

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed,
      actualValue,
      expectedValue: rule.threshold,
      severity: rule.severity,
      message: passed
        ? `Validation passed: ${rule.description}`
        : `Validation failed: ${rule.description} (${actualValue})`,
      executionTime: 0 // Will be set by caller
    };
  }

  private async executeCrossEntityRule(rule: ValidationRule): Promise<ValidationResult> {
    const result = await this.targetPool.query(rule.query);
    const actualValue = parseInt(result.rows[0]?.count || '0', 10);
    const passed = this.evaluateRule(rule, actualValue);

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed,
      actualValue,
      expectedValue: rule.threshold,
      severity: rule.severity,
      message: passed
        ? `Cross-entity validation passed: ${rule.description}`
        : `Cross-entity validation failed: ${rule.description} (${actualValue})`,
      executionTime: 0
    };
  }

  private evaluateRule(rule: ValidationRule, actualValue: number): boolean {
    switch (rule.expectedResult) {
      case 'zero':
        return actualValue === 0;
      case 'positive':
        return actualValue > 0;
      case 'equals':
        return actualValue === (rule.threshold || 0);
      case 'custom':
        return rule.threshold ? actualValue <= rule.threshold : true;
      default:
        return false;
    }
  }

  private evaluateBusinessRule(rule: ValidationRule, actualValue: number): boolean {
    return this.evaluateRule(rule, actualValue);
  }

  private async checkReferentialIntegrity(): Promise<DataIntegrityCheck[]> {
    const checks: DataIntegrityCheck[] = [];

    try {
      // Check patient-office references
      const patientOfficeResult = await this.targetPool.query(`
        SELECT COUNT(*) as count FROM patients p
        LEFT JOIN offices o ON p.office_id = o.id
        WHERE o.id IS NULL
      `);

      checks.push({
        entityName: 'patients',
        checkType: 'referential',
        passed: patientOfficeResult.rows[0].count === '0',
        details: 'Patient-Office referential integrity',
        affectedRecords: parseInt(patientOfficeResult.rows[0].count, 10)
      });

      // Check order-patient references
      const orderPatientResult = await this.targetPool.query(`
        SELECT COUNT(*) as count FROM orders o
        LEFT JOIN patients p ON o.patient_id = p.id
        WHERE p.id IS NULL
      `);

      checks.push({
        entityName: 'orders',
        checkType: 'referential',
        passed: orderPatientResult.rows[0].count === '0',
        details: 'Order-Patient referential integrity',
        affectedRecords: parseInt(orderPatientResult.rows[0].count, 10)
      });
    } catch (error) {
      console.error('Error checking referential integrity:', error);
    }

    return checks;
  }

  private async checkDataCompleteness(scriptId: string): Promise<DataIntegrityCheck[]> {
    const checks: DataIntegrityCheck[] = [];

    try {
      // Check for required fields completeness
      const entities = ['offices', 'patients', 'orders'];

      for (const entity of entities) {
        const result = await this.targetPool.query(`
          SELECT COUNT(*) as count FROM ${entity}
          WHERE id IS NULL OR created_at IS NULL
        `);

        checks.push({
          entityName: entity,
          checkType: 'completeness',
          passed: result.rows[0].count === '0',
          details: 'Required fields completeness',
          affectedRecords: parseInt(result.rows[0].count, 10)
        });
      }
    } catch (error) {
      console.error('Error checking data completeness:', error);
    }

    return checks;
  }

  private async checkUniquenessConstraints(): Promise<DataIntegrityCheck[]> {
    const checks: DataIntegrityCheck[] = [];

    try {
      const uniquenessChecks = [
        { entity: 'offices', field: 'id' },
        { entity: 'patients', field: 'id' },
        { entity: 'orders', field: 'id' },
        { entity: 'doctors', field: 'id' }
      ];

      for (const check of uniquenessChecks) {
        const result = await this.targetPool.query(`
          SELECT COUNT(*) - COUNT(DISTINCT ${check.field}) as duplicates
          FROM ${check.entity}
        `);

        checks.push({
          entityName: check.entity,
          checkType: 'uniqueness',
          passed: result.rows[0].duplicates === '0',
          details: `${check.field} uniqueness constraint`,
          affectedRecords: parseInt(result.rows[0].duplicates, 10)
        });
      }
    } catch (error) {
      console.error('Error checking uniqueness constraints:', error);
    }

    return checks;
  }

  private async checkBusinessRules(): Promise<DataIntegrityCheck[]> {
    const checks: DataIntegrityCheck[] = [];

    try {
      // Check that patients have valid birth dates
      const birthDateResult = await this.targetPool.query(`
        SELECT COUNT(*) as count FROM patients
        WHERE birth_date IS NULL OR birth_date > CURRENT_DATE
      `);

      checks.push({
        entityName: 'patients',
        checkType: 'business_rule',
        passed: birthDateResult.rows[0].count === '0',
        details: 'Valid birth dates business rule',
        affectedRecords: parseInt(birthDateResult.rows[0].count, 10)
      });

      // Check that orders have valid dates
      const orderDateResult = await this.targetPool.query(`
        SELECT COUNT(*) as count FROM orders
        WHERE created_at > CURRENT_TIMESTAMP
      `);

      checks.push({
        entityName: 'orders',
        checkType: 'business_rule',
        passed: orderDateResult.rows[0].count === '0',
        details: 'Valid order dates business rule',
        affectedRecords: parseInt(orderDateResult.rows[0].count, 10)
      });
    } catch (error) {
      console.error('Error checking business rules:', error);
    }

    return checks;
  }

  private async getRecordCount(pool: Pool, tableName: string): Promise<number> {
    const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
    return parseInt(result.rows[0].count, 10);
  }

  private getBusinessRules(entityName: string): ValidationRule[] {
    const businessRules = new Map<string, ValidationRule[]>([
      ['patients', [
        {
          id: 'patient_valid_birth_date',
          name: 'Valid Patient Birth Dates',
          description: 'Patients must have valid birth dates',
          query: 'SELECT COUNT(*) FROM patients WHERE birth_date IS NULL OR birth_date > CURRENT_DATE',
          expectedResult: 'zero',
          severity: 'critical'
        }
      ]],
      ['orders', [
        {
          id: 'order_valid_dates',
          name: 'Valid Order Dates',
          description: 'Orders must have valid creation dates',
          query: 'SELECT COUNT(*) FROM orders WHERE created_at > CURRENT_TIMESTAMP',
          expectedResult: 'zero',
          severity: 'warning'
        }
      ]]
    ]);

    return businessRules.get(entityName) || [];
  }
}
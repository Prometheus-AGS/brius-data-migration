// Migration Validation Report Model
// Handles validation results and reporting for data integrity checks

import { Pool, PoolClient } from 'pg';
import {
  MigrationValidationReport,
  ValidationType,
  ValidationReport,
  ValidationIssue,
  ValidationResponse,
  ValidationError
} from '../types/migration-types';

export class MigrationValidationReportModel {
  constructor(private db: Pool) {}

  /**
   * Create a new validation report
   */
  async create(report: Omit<MigrationValidationReport, 'id'>): Promise<MigrationValidationReport> {
    const query = `
      INSERT INTO migration_validation_reports (
        validation_type, source_entity, target_entity, records_validated,
        validation_passed, discrepancies_found, discrepancy_details,
        validation_criteria, execution_time_ms, generated_at, expires_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      report.validation_type,
      report.source_entity,
      report.target_entity,
      report.records_validated,
      report.validation_passed,
      report.discrepancies_found,
      JSON.stringify(report.discrepancy_details),
      JSON.stringify(report.validation_criteria),
      report.execution_time_ms,
      report.generated_at,
      report.expires_at,
      JSON.stringify(report.metadata)
    ];

    try {
      const result = await this.db.query(query, values);
      return this.mapRowToReport(result.rows[0]);
    } catch (error) {
      throw new ValidationError(`Failed to create validation report: ${error.message}`);
    }
  }

  /**
   * Find report by ID
   */
  async findById(id: string): Promise<MigrationValidationReport | null> {
    const query = 'SELECT * FROM migration_validation_reports WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rows.length > 0 ? this.mapRowToReport(result.rows[0]) : null;
    } catch (error) {
      throw new ValidationError(`Failed to find validation report: ${error.message}`, undefined, id);
    }
  }

  /**
   * Find reports by entity and validation type
   */
  async findByEntityAndType(
    entity: string,
    validationType?: ValidationType,
    includeExpired: boolean = false
  ): Promise<MigrationValidationReport[]> {
    let query = `
      SELECT * FROM migration_validation_reports
      WHERE (source_entity = $1 OR target_entity = $1)
    `;
    const values = [entity];
    let paramCount = 2;

    if (validationType) {
      query += ` AND validation_type = $${paramCount}`;
      values.push(validationType);
      paramCount++;
    }

    if (!includeExpired) {
      query += ` AND expires_at > NOW()`;
    }

    query += ' ORDER BY generated_at DESC';

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToReport(row));
    } catch (error) {
      throw new ValidationError(`Failed to find reports by entity and type: ${error.message}`, validationType, entity);
    }
  }

  /**
   * Get recent validation reports
   */
  async getRecentReports(
    limit: number = 50,
    validationType?: ValidationType
  ): Promise<MigrationValidationReport[]> {
    let query = 'SELECT * FROM migration_validation_reports';
    const values: any[] = [];

    if (validationType) {
      query += ' WHERE validation_type = $1';
      values.push(validationType);
    }

    query += ' ORDER BY generated_at DESC LIMIT $' + (values.length + 1);
    values.push(limit);

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToReport(row));
    } catch (error) {
      throw new ValidationError(`Failed to get recent reports: ${error.message}`, validationType);
    }
  }

  /**
   * Generate comprehensive validation response
   */
  async generateValidationResponse(
    validationType: ValidationType,
    entities: string[],
    reports: ValidationReport[]
  ): Promise<ValidationResponse> {
    const totalRecordsValidated = reports.reduce((sum, r) => sum + r.recordsChecked, 0);
    const totalDiscrepancies = reports.reduce((sum, r) => sum + r.issuesFound, 0);
    const validationPassed = totalDiscrepancies === 0;

    const startTime = Date.now();

    // Create database report entry
    const reportData: Omit<MigrationValidationReport, 'id'> = {
      validation_type: validationType,
      source_entity: entities.join(','),
      target_entity: entities.join(','),
      records_validated: totalRecordsValidated,
      validation_passed: validationPassed,
      discrepancies_found: totalDiscrepancies,
      discrepancy_details: { reports },
      validation_criteria: { entities, validation_type: validationType },
      execution_time_ms: Date.now() - startTime,
      generated_at: new Date(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expire in 7 days
      metadata: { entities_validated: entities.length }
    };

    const dbReport = await this.create(reportData);

    return {
      validationId: dbReport.id,
      validationType,
      recordsValidated: totalRecordsValidated,
      validationPassed,
      discrepanciesFound: totalDiscrepancies,
      executionTime: dbReport.execution_time_ms,
      reports,
      generatedAt: dbReport.generated_at
    };
  }

  /**
   * Get validation statistics
   */
  async getValidationStatistics(
    entity?: string,
    validationType?: ValidationType
  ): Promise<any> {
    let query = `
      SELECT
        validation_type,
        COUNT(*) as total_validations,
        COUNT(*) FILTER (WHERE validation_passed = true) as passed_validations,
        COUNT(*) FILTER (WHERE validation_passed = false) as failed_validations,
        AVG(execution_time_ms) as avg_execution_time,
        SUM(records_validated) as total_records_validated,
        SUM(discrepancies_found) as total_discrepancies
      FROM migration_validation_reports
      WHERE expires_at > NOW()
    `;
    const values: any[] = [];
    let paramCount = 1;

    if (entity) {
      query += ` AND (source_entity LIKE $${paramCount} OR target_entity LIKE $${paramCount})`;
      values.push(`%${entity}%`);
      paramCount++;
    }

    if (validationType) {
      query += ` AND validation_type = $${paramCount}`;
      values.push(validationType);
    }

    query += ' GROUP BY validation_type ORDER BY validation_type';

    try {
      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      throw new ValidationError(`Failed to get validation statistics: ${error.message}`, validationType, entity);
    }
  }

  /**
   * Generate comprehensive validation report
   */
  async generateComprehensiveReport(
    entities?: string[],
    includeExpired: boolean = false
  ): Promise<any> {
    let query = `
      SELECT
        validation_type,
        source_entity,
        target_entity,
        validation_passed,
        discrepancies_found,
        records_validated,
        execution_time_ms,
        generated_at,
        discrepancy_details
      FROM migration_validation_reports
    `;
    const values: any[] = [];

    if (!includeExpired) {
      query += ' WHERE expires_at > NOW()';
    } else {
      query += ' WHERE 1=1';
    }

    if (entities && entities.length > 0) {
      const entityConditions = entities.map((_, index) =>
        `(source_entity LIKE $${values.length + index + 1} OR target_entity LIKE $${values.length + index + 1})`
      ).join(' OR ');
      query += ` AND (${entityConditions})`;
      entities.forEach(entity => {
        values.push(`%${entity}%`);
      });
    }

    query += ' ORDER BY generated_at DESC';

    try {
      const result = await this.db.query(query, values);

      const summary = {
        total_validations: result.rows.length,
        passed_validations: result.rows.filter(r => r.validation_passed).length,
        failed_validations: result.rows.filter(r => !r.validation_passed).length,
        total_records_validated: result.rows.reduce((sum, r) => sum + parseInt(r.records_validated), 0),
        total_discrepancies: result.rows.reduce((sum, r) => sum + parseInt(r.discrepancies_found), 0),
        average_execution_time: result.rows.reduce((sum, r) => sum + parseInt(r.execution_time_ms), 0) / result.rows.length
      };

      const details = result.rows.map(row => ({
        validation_type: row.validation_type,
        entities: `${row.source_entity} -> ${row.target_entity}`,
        passed: row.validation_passed,
        discrepancies: parseInt(row.discrepancies_found),
        records_checked: parseInt(r.records_validated),
        execution_time_ms: parseInt(row.execution_time_ms),
        generated_at: row.generated_at,
        issues: row.discrepancy_details ?
          (typeof row.discrepancy_details === 'string'
            ? JSON.parse(row.discrepancy_details)
            : row.discrepancy_details) : []
      }));

      return { summary, details };
    } catch (error) {
      throw new ValidationError(`Failed to generate comprehensive report: ${error.message}`);
    }
  }

  /**
   * Cleanup expired reports
   */
  async cleanup(): Promise<number> {
    const query = 'DELETE FROM migration_validation_reports WHERE expires_at <= NOW()';

    try {
      const result = await this.db.query(query);
      return result.rowCount;
    } catch (error) {
      throw new ValidationError(`Failed to cleanup expired reports: ${error.message}`);
    }
  }

  /**
   * Check if entity needs validation
   */
  async needsValidation(
    entity: string,
    validationType: ValidationType,
    maxAgeHours: number = 24
  ): Promise<boolean> {
    const query = `
      SELECT COUNT(*) as recent_count
      FROM migration_validation_reports
      WHERE (source_entity = $1 OR target_entity = $1)
        AND validation_type = $2
        AND validation_passed = true
        AND generated_at > NOW() - INTERVAL '${maxAgeHours} hours'
        AND expires_at > NOW()
    `;

    try {
      const result = await this.db.query(query, [entity, validationType]);
      const recentValidations = parseInt(result.rows[0].recent_count);
      return recentValidations === 0;
    } catch (error) {
      // If query fails, assume validation is needed
      return true;
    }
  }

  /**
   * Get validation summary for dashboard
   */
  async getValidationSummary(): Promise<any> {
    const query = `
      SELECT
        validation_type,
        COUNT(*) as total_reports,
        COUNT(*) FILTER (WHERE validation_passed = true) as passed_reports,
        COUNT(*) FILTER (WHERE expires_at > NOW()) as active_reports,
        MAX(generated_at) as last_validation,
        AVG(execution_time_ms) as avg_execution_time
      FROM migration_validation_reports
      WHERE generated_at > NOW() - INTERVAL '30 days'
      GROUP BY validation_type
      ORDER BY validation_type
    `;

    try {
      const result = await this.db.query(query);
      return result.rows.map(row => ({
        validation_type: row.validation_type,
        total_reports: parseInt(row.total_reports),
        passed_reports: parseInt(row.passed_reports),
        active_reports: parseInt(row.active_reports),
        last_validation: row.last_validation,
        avg_execution_time: Math.round(parseFloat(row.avg_execution_time))
      }));
    } catch (error) {
      throw new ValidationError(`Failed to get validation summary: ${error.message}`);
    }
  }

  /**
   * Map database row to MigrationValidationReport object
   */
  private mapRowToReport(row: any): MigrationValidationReport {
    return {
      id: row.id,
      validation_type: row.validation_type as ValidationType,
      source_entity: row.source_entity,
      target_entity: row.target_entity,
      records_validated: parseInt(row.records_validated),
      validation_passed: row.validation_passed,
      discrepancies_found: parseInt(row.discrepancies_found),
      discrepancy_details: typeof row.discrepancy_details === 'string'
        ? JSON.parse(row.discrepancy_details)
        : row.discrepancy_details,
      validation_criteria: typeof row.validation_criteria === 'string'
        ? JSON.parse(row.validation_criteria)
        : row.validation_criteria,
      execution_time_ms: parseInt(row.execution_time_ms),
      generated_at: new Date(row.generated_at),
      expires_at: new Date(row.expires_at),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    };
  }
}
/**
 * CoverageReport Model
 *
 * High-level coverage summary across all data domains.
 */

import { v4 as uuidv4 } from 'uuid';

export interface CoverageReportData {
  id: string;
  reportDate: string;
  totalScripts: number;
  completedScripts: number;
  totalRecords: number;
  migratedRecords: number;
  overallSuccessRate: number;
  clinicalCoverage: number;
  businessCoverage: number;
  communicationsCoverage: number;
  technicalCoverage: number;
}

export class CoverageReport {
  public readonly id: string;
  public readonly reportDate: string;
  public readonly totalScripts: number;
  public readonly completedScripts: number;
  public readonly totalRecords: number;
  public readonly migratedRecords: number;
  public readonly overallSuccessRate: number;
  public readonly clinicalCoverage: number;
  public readonly businessCoverage: number;
  public readonly communicationsCoverage: number;
  public readonly technicalCoverage: number;

  constructor(data: Omit<Partial<CoverageReportData>, 'totalScripts' | 'totalRecords'> & {
    totalScripts: number;
    totalRecords: number;
  }) {
    this.id = data.id || uuidv4();
    this.reportDate = data.reportDate || new Date().toISOString();
    this.totalScripts = data.totalScripts;
    this.completedScripts = data.completedScripts || 0;
    this.totalRecords = data.totalRecords;
    this.migratedRecords = data.migratedRecords || 0;
    this.overallSuccessRate = data.overallSuccessRate || 0;
    this.clinicalCoverage = data.clinicalCoverage || 0;
    this.businessCoverage = data.businessCoverage || 0;
    this.communicationsCoverage = data.communicationsCoverage || 0;
    this.technicalCoverage = data.technicalCoverage || 0;

    this.validateData();
  }

  private validateData(): void {
    if (this.totalScripts < 0) {
      throw new Error('Total scripts must be non-negative');
    }

    if (this.completedScripts < 0 || this.completedScripts > this.totalScripts) {
      throw new Error('Completed scripts must be between 0 and total scripts');
    }

    if (this.totalRecords < 0) {
      throw new Error('Total records must be non-negative');
    }

    if (this.migratedRecords < 0 || this.migratedRecords > this.totalRecords) {
      throw new Error('Migrated records must be between 0 and total records');
    }

    const coverageFields = [
      this.overallSuccessRate,
      this.clinicalCoverage,
      this.businessCoverage,
      this.communicationsCoverage,
      this.technicalCoverage
    ];

    coverageFields.forEach((coverage, index) => {
      if (coverage < 0 || coverage > 1) {
        const fieldNames = ['overallSuccessRate', 'clinicalCoverage', 'businessCoverage', 'communicationsCoverage', 'technicalCoverage'];
        throw new Error(`${fieldNames[index]} must be between 0.0 and 1.0`);
      }
    });
  }

  public toJSON(): CoverageReportData {
    return {
      id: this.id,
      reportDate: this.reportDate,
      totalScripts: this.totalScripts,
      completedScripts: this.completedScripts,
      totalRecords: this.totalRecords,
      migratedRecords: this.migratedRecords,
      overallSuccessRate: this.overallSuccessRate,
      clinicalCoverage: this.clinicalCoverage,
      businessCoverage: this.businessCoverage,
      communicationsCoverage: this.communicationsCoverage,
      technicalCoverage: this.technicalCoverage
    };
  }

  public static fromDatabaseRow(row: any): CoverageReport {
    return new CoverageReport({
      id: row.id,
      reportDate: row.report_date,
      totalScripts: parseInt(row.total_scripts) || 0,
      completedScripts: parseInt(row.completed_scripts) || 0,
      totalRecords: parseInt(row.total_records) || 0,
      migratedRecords: parseInt(row.migrated_records) || 0,
      overallSuccessRate: parseFloat(row.overall_success_rate) || 0,
      clinicalCoverage: parseFloat(row.clinical_coverage) || 0,
      businessCoverage: parseFloat(row.business_coverage) || 0,
      communicationsCoverage: parseFloat(row.communications_coverage) || 0,
      technicalCoverage: parseFloat(row.technical_coverage) || 0
    });
  }
}
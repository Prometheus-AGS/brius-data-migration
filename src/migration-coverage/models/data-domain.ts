/**
 * DataDomain Model
 *
 * Categorizes data by business domain for comprehensive coverage tracking.
 */

import { v4 as uuidv4 } from 'uuid';
import { DataDomainType } from './migration-script';

export enum DomainPriority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export interface DataDomainData {
  id: string;
  name: DataDomainType;
  description: string;
  priority: DomainPriority;
  coveragePercentage: number;
  totalEntities?: number;
  migratedEntities?: number;
}

export class DataDomain {
  public readonly id: string;
  public readonly name: DataDomainType;
  public readonly description: string;
  public readonly priority: DomainPriority;
  public coveragePercentage: number;
  public totalEntities: number;
  public migratedEntities: number;

  constructor(data: Partial<DataDomainData> & { name: DataDomainType }) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.description = data.description || this.getDefaultDescription(data.name);
    this.priority = data.priority || this.getDefaultPriority(data.name);
    this.coveragePercentage = data.coveragePercentage || 0;
    this.totalEntities = data.totalEntities || 0;
    this.migratedEntities = data.migratedEntities || 0;

    this.validateData();
  }

  private validateData(): void {
    if (this.coveragePercentage < 0 || this.coveragePercentage > 1) {
      throw new Error('Coverage percentage must be between 0.0 and 1.0');
    }

    if (this.totalEntities < 0) {
      throw new Error('Total entities must be non-negative');
    }

    if (this.migratedEntities < 0) {
      throw new Error('Migrated entities must be non-negative');
    }

    if (this.migratedEntities > this.totalEntities) {
      throw new Error('Migrated entities cannot exceed total entities');
    }
  }

  private getDefaultDescription(domainType: DataDomainType): string {
    switch (domainType) {
      case DataDomainType.CLINICAL:
        return 'Clinical data including patient records, medical history, treatments, and orders';
      case DataDomainType.BUSINESS:
        return 'Business operational data including offices, payments, billing, and financial records';
      case DataDomainType.COMMUNICATIONS:
        return 'Communications data including messages, comments, notifications, and feedback';
      case DataDomainType.TECHNICAL:
        return 'Technical data including files, system metadata, configurations, and logs';
      default:
        return 'Data domain for migration coverage tracking';
    }
  }

  private getDefaultPriority(domainType: DataDomainType): DomainPriority {
    switch (domainType) {
      case DataDomainType.CLINICAL:
      case DataDomainType.BUSINESS:
        return DomainPriority.CRITICAL;
      case DataDomainType.COMMUNICATIONS:
        return DomainPriority.HIGH;
      case DataDomainType.TECHNICAL:
        return DomainPriority.MEDIUM;
      default:
        return DomainPriority.LOW;
    }
  }

  public updateCoverage(totalEntities: number, migratedEntities: number): void {
    this.totalEntities = totalEntities;
    this.migratedEntities = migratedEntities;
    this.coveragePercentage = totalEntities > 0 ? migratedEntities / totalEntities : 0;

    this.validateData();
  }

  public getCoveragePercentage(): number {
    return Math.round(this.coveragePercentage * 10000) / 100; // Return as percentage with 2 decimal places
  }

  public isFullyCovered(): boolean {
    return this.coveragePercentage >= 1.0;
  }

  public hasMinimumCoverage(minimumRate: number = 0.99): boolean {
    return this.coveragePercentage >= minimumRate;
  }

  public getStatus(): string {
    if (this.coveragePercentage >= 0.99) return 'excellent';
    if (this.coveragePercentage >= 0.95) return 'good';
    if (this.coveragePercentage >= 0.90) return 'fair';
    return 'needs_attention';
  }

  public toJSON(): DataDomainData {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      priority: this.priority,
      coveragePercentage: this.coveragePercentage,
      totalEntities: this.totalEntities,
      migratedEntities: this.migratedEntities
    };
  }

  public static fromDatabaseRow(row: any): DataDomain {
    return new DataDomain({
      id: row.id,
      name: row.name as DataDomainType,
      description: row.description,
      priority: row.priority as DomainPriority,
      coveragePercentage: parseFloat(row.coverage_percentage) || 0,
      totalEntities: parseInt(row.total_entities) || 0,
      migratedEntities: parseInt(row.migrated_entities) || 0
    });
  }

  public static createDefaultDomains(): DataDomain[] {
    return [
      new DataDomain({ name: DataDomainType.CLINICAL }),
      new DataDomain({ name: DataDomainType.BUSINESS }),
      new DataDomain({ name: DataDomainType.COMMUNICATIONS }),
      new DataDomain({ name: DataDomainType.TECHNICAL })
    ];
  }

  public static isValidDomainType(domain: string): domain is DataDomainType {
    return Object.values(DataDomainType).includes(domain as DataDomainType);
  }
}
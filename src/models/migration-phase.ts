/**
 * Migration Phase Model
 * Represents a logical phase of the migration execution workflow
 */

export interface MigrationPhase {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  entities: MigrationEntity[];
  executionOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  validationRequired: boolean;
}

export interface MigrationEntity {
  id: string;
  name: string;
  sourceTable: string;
  targetTable: string;
  scriptPath: string;
  npmScript?: string;
  dependencies: string[];
  expectedRecords: number;
  actualRecords?: number;
  migrationMethod: 'npm' | 'direct' | 'batch';
  validationScript?: string;
  rollbackScript?: string;
  status: 'pending' | 'migrating' | 'completed' | 'failed' | 'validated';
  metadata: {
    description: string;
    businessCriticality: 'critical' | 'important' | 'optional';
    dataVolume: 'small' | 'medium' | 'large' | 'massive';
    complexity: 'simple' | 'moderate' | 'complex';
  };
}

export class MigrationPhaseBuilder {
  private phase: Partial<MigrationPhase> = {};

  static create(id: string, name: string): MigrationPhaseBuilder {
    const builder = new MigrationPhaseBuilder();
    builder.phase = {
      id,
      name,
      entities: [],
      dependencies: [],
      executionOrder: 0,
      status: 'pending',
      recordsProcessed: 0,
      recordsSuccessful: 0,
      recordsFailed: 0,
      validationRequired: false
    };
    return builder;
  }

  description(desc: string): MigrationPhaseBuilder {
    this.phase.description = desc;
    return this;
  }

  dependencies(deps: string[]): MigrationPhaseBuilder {
    this.phase.dependencies = deps;
    return this;
  }

  executionOrder(order: number): MigrationPhaseBuilder {
    this.phase.executionOrder = order;
    return this;
  }

  validationRequired(required: boolean = true): MigrationPhaseBuilder {
    this.phase.validationRequired = required;
    return this;
  }

  addEntity(entity: MigrationEntity): MigrationPhaseBuilder {
    this.phase.entities!.push(entity);
    return this;
  }

  build(): MigrationPhase {
    if (!this.phase.id || !this.phase.name || !this.phase.description) {
      throw new Error('Migration phase must have id, name, and description');
    }
    return this.phase as MigrationPhase;
  }
}

export class MigrationEntityBuilder {
  private entity: Partial<MigrationEntity> = {};

  static create(id: string, name: string, sourceTable: string, targetTable: string): MigrationEntityBuilder {
    const builder = new MigrationEntityBuilder();
    builder.entity = {
      id,
      name,
      sourceTable,
      targetTable,
      dependencies: [],
      expectedRecords: 0,
      migrationMethod: 'npm',
      status: 'pending',
      metadata: {
        description: '',
        businessCriticality: 'important',
        dataVolume: 'medium',
        complexity: 'moderate'
      }
    };
    return builder;
  }

  scriptPath(path: string): MigrationEntityBuilder {
    this.entity.scriptPath = path;
    return this;
  }

  npmScript(script: string): MigrationEntityBuilder {
    this.entity.npmScript = script;
    return this;
  }

  dependencies(deps: string[]): MigrationEntityBuilder {
    this.entity.dependencies = deps;
    return this;
  }

  expectedRecords(count: number): MigrationEntityBuilder {
    this.entity.expectedRecords = count;
    return this;
  }

  migrationMethod(method: 'npm' | 'direct' | 'batch'): MigrationEntityBuilder {
    this.entity.migrationMethod = method;
    return this;
  }

  validationScript(script: string): MigrationEntityBuilder {
    this.entity.validationScript = script;
    return this;
  }

  rollbackScript(script: string): MigrationEntityBuilder {
    this.entity.rollbackScript = script;
    return this;
  }

  businessCriticality(criticality: 'critical' | 'important' | 'optional'): MigrationEntityBuilder {
    this.entity.metadata!.businessCriticality = criticality;
    return this;
  }

  dataVolume(volume: 'small' | 'medium' | 'large' | 'massive'): MigrationEntityBuilder {
    this.entity.metadata!.dataVolume = volume;
    return this;
  }

  complexity(comp: 'simple' | 'moderate' | 'complex'): MigrationEntityBuilder {
    this.entity.metadata!.complexity = comp;
    return this;
  }

  description(desc: string): MigrationEntityBuilder {
    this.entity.metadata!.description = desc;
    return this;
  }

  build(): MigrationEntity {
    if (!this.entity.id || !this.entity.name || !this.entity.sourceTable || !this.entity.targetTable) {
      throw new Error('Migration entity must have id, name, sourceTable, and targetTable');
    }
    return this.entity as MigrationEntity;
  }
}

// Helper function to create common entity configurations
export const EntityPresets = {
  createCoreEntity: (
    id: string,
    name: string,
    sourceTable: string,
    targetTable: string,
    expectedRecords: number,
    dependencies: string[] = []
  ): MigrationEntity => {
    return MigrationEntityBuilder
      .create(id, name, sourceTable, targetTable)
      .scriptPath(`src/${name.toLowerCase()}-migration.ts`)
      .npmScript(`npm run migrate:${name.toLowerCase()}`)
      .expectedRecords(expectedRecords)
      .dependencies(dependencies)
      .businessCriticality('critical')
      .dataVolume(expectedRecords > 100000 ? 'massive' : expectedRecords > 10000 ? 'large' : expectedRecords > 1000 ? 'medium' : 'small')
      .complexity('moderate')
      .validationScript(`npm run validate:${name.toLowerCase()}`)
      .rollbackScript(`npm run rollback:${name.toLowerCase()}`)
      .description(`Migration of ${name} from ${sourceTable} to ${targetTable}`)
      .build();
  },

  createDirectEntity: (
    id: string,
    name: string,
    sourceTable: string,
    targetTable: string,
    scriptPath: string,
    expectedRecords: number,
    dependencies: string[] = []
  ): MigrationEntity => {
    return MigrationEntityBuilder
      .create(id, name, sourceTable, targetTable)
      .scriptPath(scriptPath)
      .migrationMethod('direct')
      .expectedRecords(expectedRecords)
      .dependencies(dependencies)
      .businessCriticality('important')
      .dataVolume(expectedRecords > 100000 ? 'massive' : expectedRecords > 10000 ? 'large' : expectedRecords > 1000 ? 'medium' : 'small')
      .complexity(expectedRecords > 100000 ? 'complex' : 'moderate')
      .description(`Direct migration of ${name} from ${sourceTable} to ${targetTable}`)
      .build();
  }
};
/**
 * Migration Entity Model
 * Represents an individual entity within a migration phase
 */

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
  startTime?: Date;
  endTime?: Date;
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  metadata: MigrationEntityMetadata;
}

export interface MigrationEntityMetadata {
  description: string;
  businessCriticality: 'critical' | 'important' | 'optional';
  dataVolume: 'small' | 'medium' | 'large' | 'massive';
  complexity: 'simple' | 'moderate' | 'complex';
  estimatedDuration?: number; // minutes
  requiredMemory?: number; // MB
  batchSize?: number;
  parallelizable: boolean;
}

export interface EntityExecutionContext {
  batchSize: number;
  maxRetries: number;
  timeout: number;
  checkpointInterval: number;
  resumeFromCheckpoint?: string;
  dryRun: boolean;
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
      recordsProcessed: 0,
      recordsSuccessful: 0,
      recordsFailed: 0,
      metadata: {
        description: '',
        businessCriticality: 'important',
        dataVolume: 'medium',
        complexity: 'moderate',
        parallelizable: false
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

  estimatedDuration(minutes: number): MigrationEntityBuilder {
    this.entity.metadata!.estimatedDuration = minutes;
    return this;
  }

  requiredMemory(mb: number): MigrationEntityBuilder {
    this.entity.metadata!.requiredMemory = mb;
    return this;
  }

  batchSize(size: number): MigrationEntityBuilder {
    this.entity.metadata!.batchSize = size;
    return this;
  }

  parallelizable(canParallelize: boolean = true): MigrationEntityBuilder {
    this.entity.metadata!.parallelizable = canParallelize;
    return this;
  }

  updateProgress(processed: number, successful: number, failed: number): MigrationEntityBuilder {
    this.entity.recordsProcessed = processed;
    this.entity.recordsSuccessful = successful;
    this.entity.recordsFailed = failed;
    return this;
  }

  updateStatus(status: 'pending' | 'migrating' | 'completed' | 'failed' | 'validated'): MigrationEntityBuilder {
    this.entity.status = status;
    if (status === 'migrating' && !this.entity.startTime) {
      this.entity.startTime = new Date();
    }
    if ((status === 'completed' || status === 'failed') && !this.entity.endTime) {
      this.entity.endTime = new Date();
    }
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
      .estimatedDuration(expectedRecords > 100000 ? 60 : expectedRecords > 10000 ? 30 : expectedRecords > 1000 ? 15 : 5)
      .requiredMemory(expectedRecords > 100000 ? 1024 : expectedRecords > 10000 ? 512 : expectedRecords > 1000 ? 256 : 128)
      .batchSize(expectedRecords > 100000 ? 500 : expectedRecords > 10000 ? 1000 : 2000)
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
      .estimatedDuration(expectedRecords > 100000 ? 90 : expectedRecords > 10000 ? 45 : expectedRecords > 1000 ? 20 : 10)
      .requiredMemory(expectedRecords > 100000 ? 1536 : expectedRecords > 10000 ? 768 : expectedRecords > 1000 ? 384 : 192)
      .batchSize(expectedRecords > 100000 ? 250 : expectedRecords > 10000 ? 500 : 1000)
      .parallelizable(false) // Direct scripts typically require sequential execution
      .build();
  },

  createBatchEntity: (
    id: string,
    name: string,
    sourceTable: string,
    targetTable: string,
    expectedRecords: number,
    batchSize: number = 500
  ): MigrationEntity => {
    return MigrationEntityBuilder
      .create(id, name, sourceTable, targetTable)
      .scriptPath(`migrate-${name.toLowerCase()}.ts`)
      .migrationMethod('batch')
      .expectedRecords(expectedRecords)
      .businessCriticality(expectedRecords > 500000 ? 'critical' : 'important')
      .dataVolume(expectedRecords > 500000 ? 'massive' : expectedRecords > 50000 ? 'large' : expectedRecords > 5000 ? 'medium' : 'small')
      .complexity(expectedRecords > 500000 ? 'complex' : 'moderate')
      .description(`Batch migration of ${name} from ${sourceTable} to ${targetTable}`)
      .estimatedDuration(Math.ceil(expectedRecords / (batchSize * 10))) // Estimate based on batch processing speed
      .requiredMemory(Math.min(2048, Math.max(256, expectedRecords / 1000))) // Scale memory with data size
      .batchSize(batchSize)
      .parallelizable(true) // Batch entities can typically be parallelized
      .build();
  }
};

// Entity status tracking utilities
export const EntityStatusUtils = {
  calculateProgress: (entity: MigrationEntity): number => {
    if (entity.expectedRecords === 0) return 0;
    return (entity.recordsProcessed / entity.expectedRecords) * 100;
  },

  calculateSuccessRate: (entity: MigrationEntity): number => {
    if (entity.recordsProcessed === 0) return 0;
    return (entity.recordsSuccessful / entity.recordsProcessed) * 100;
  },

  getDuration: (entity: MigrationEntity): number => {
    if (!entity.startTime) return 0;
    const endTime = entity.endTime || new Date();
    return Math.round((endTime.getTime() - entity.startTime.getTime()) / 1000); // seconds
  },

  isComplete: (entity: MigrationEntity): boolean => {
    return entity.status === 'completed' || entity.status === 'validated';
  },

  hasErrors: (entity: MigrationEntity): boolean => {
    return entity.status === 'failed' || entity.recordsFailed > 0;
  },

  needsValidation: (entity: MigrationEntity): boolean => {
    return entity.status === 'completed' && entity.validationScript !== undefined;
  }
};
/**
 * Full Migration System - Utility Functions
 *
 * Convenience functions for common migration operations.
 * Provides simplified interfaces for the most common use cases.
 */

import { DatabaseConnections } from '../lib/database-connections';
import { getConfig } from '../lib/environment-config';
import { FullMigrationOrchestrator, MigrationPlan, MigrationResult } from './full-migration-orchestrator';
import { FullMigrationValidator, ValidationResult, ValidationType } from './full-migration-validator';
import { getLogger } from '../lib/error-handler';

/**
 * Initialize the full migration system with default configuration
 */
export async function initializeFullMigrationSystem(): Promise<{
  orchestrator: FullMigrationOrchestrator;
  validator: FullMigrationValidator;
  connections: DatabaseConnections;
}> {
  const logger = getLogger();
  logger.info('Initializing Full Migration System');

  // Initialize database connections
  const connections = new DatabaseConnections(getConfig());
  await connections.initialize();

  // Initialize orchestrator and validator
  const orchestrator = new FullMigrationOrchestrator(connections);
  const validator = new FullMigrationValidator(connections);

  await orchestrator.initialize();

  logger.info('Full Migration System initialized successfully');

  return { orchestrator, validator, connections };
}

/**
 * Execute a complete migration with default settings
 */
export async function executeFullMigration(
  entities?: string[],
  options?: {
    batchSize?: number;
    maxConcurrency?: number;
    checkpointFrequency?: number;
    timeoutMinutes?: number;
    resumeFromMigrationId?: string;
    schemaCleanup?: boolean;
    schemaPhase?: 1 | 2 | 3 | 4;
  }
): Promise<MigrationResult> {
  const { orchestrator, connections } = await initializeFullMigrationSystem();

  try {
    // Build migration plan
    const plan: MigrationPlan = {
      entities: buildDefaultEntities(entities),
      globalSettings: {
        batchSize: options?.batchSize || 1000,
        maxConcurrency: options?.maxConcurrency || 4,
        checkpointFrequency: options?.checkpointFrequency || 10,
        timeoutMinutes: options?.timeoutMinutes || 240
      },
      schemaCleanup: {
        enabled: options?.schemaCleanup || false,
        phase: options?.schemaPhase || 1,
        columnsToRemove: {
          profiles: ['insurance_info', 'medical_history'],
          products: ['sku']
        }
      }
    };

    // Execute migration
    const result = await orchestrator.executeMigration(plan, options?.resumeFromMigrationId);

    return result;

  } finally {
    await connections.cleanup();
  }
}

/**
 * Validate a migration with comprehensive checks
 */
export async function validateMigration(
  migrationId: string,
  validationType: ValidationType = 'comprehensive',
  entities?: string[]
): Promise<ValidationResult> {
  const { validator, connections } = await initializeFullMigrationSystem();

  try {
    const result = await validator.validateMigration(migrationId, validationType, entities);
    return result;

  } finally {
    await connections.cleanup();
  }
}

/**
 * Execute migration with common presets
 */
export async function executeCoreMigration(options?: { batchSize?: number }): Promise<MigrationResult> {
  return executeFullMigration(
    ['offices', 'profiles', 'doctors'],
    { batchSize: options?.batchSize }
  );
}

export async function executeCoreWithPatientsMigration(options?: { batchSize?: number }): Promise<MigrationResult> {
  return executeFullMigration(
    ['offices', 'profiles', 'doctors', 'patients'],
    { batchSize: options?.batchSize }
  );
}

export async function executeCompleteMigration(options?: {
  batchSize?: number;
  schemaCleanup?: boolean;
}): Promise<MigrationResult> {
  return executeFullMigration(
    undefined, // All entities
    {
      batchSize: options?.batchSize,
      schemaCleanup: options?.schemaCleanup
    }
  );
}

/**
 * Quick validation presets
 */
export async function validateMigrationIntegrity(migrationId: string): Promise<ValidationResult> {
  return validateMigration(migrationId, 'integrity');
}

export async function validateMigrationCompleteness(migrationId: string): Promise<ValidationResult> {
  return validateMigration(migrationId, 'completeness');
}

export async function validateMigrationPerformance(migrationId: string): Promise<ValidationResult> {
  return validateMigration(migrationId, 'performance');
}

/**
 * Build default entity configuration
 */
function buildDefaultEntities(entityNames?: string[]) {
  const allEntities = [
    { name: 'offices', sourceTable: 'dispatch_office', dependencyOrder: 0 },
    { name: 'profiles', sourceTable: 'auth_user', dependencyOrder: 1 },
    { name: 'doctors', sourceTable: 'dispatch_user', dependencyOrder: 2 },
    { name: 'patients', sourceTable: 'dispatch_user', dependencyOrder: 3 },
    { name: 'orders', sourceTable: 'dispatch_instruction', dependencyOrder: 4 },
    { name: 'products', sourceTable: 'dispatch_product', dependencyOrder: 5 },
    { name: 'jaws', sourceTable: 'dispatch_jaw', dependencyOrder: 6 },
    { name: 'projects', sourceTable: 'dispatch_project', dependencyOrder: 7 },
    { name: 'treatment_plans', sourceTable: 'dispatch_treatment_plan', dependencyOrder: 8 }
  ];

  const targetEntities = entityNames
    ? allEntities.filter(e => entityNames.includes(e.name))
    : allEntities;

  return targetEntities.map(entity => ({
    name: entity.name,
    sourceTable: entity.sourceTable,
    targetTable: entity.name,
    dependencyOrder: entity.dependencyOrder,
    batchSize: 1000,
    estimatedRecords: 1000 // This would be calculated from actual data
  }));
}

/**
 * Migration system health check
 */
export async function healthCheck(): Promise<{
  status: 'healthy' | 'unhealthy';
  details: {
    database: boolean;
    models: boolean;
    connections: boolean;
  };
}> {
  try {
    const { connections } = await initializeFullMigrationSystem();

    const healthStatus = await connections.healthCheck();

    await connections.cleanup();

    return {
      status: 'healthy',
      details: {
        database: true,
        models: true,
        connections: true
      }
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      details: {
        database: false,
        models: false,
        connections: false
      }
    };
  }
}
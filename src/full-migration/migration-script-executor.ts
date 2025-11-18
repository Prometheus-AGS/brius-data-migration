/**
 * Migration Script Executor
 *
 * Integrates the full migration orchestrator with existing TypeScript migration scripts.
 * Provides a standardized interface for executing legacy migration files within the
 * new orchestrated migration system.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger, MigrationBaseError, DatabaseError, ValidationError } from '../lib/error-handler';
import { MigrationEntity } from './full-migration-orchestrator';

export interface MigrationScriptResult {
  success: boolean;
  recordsProcessed: number;
  recordsFailed: number;
  lastProcessedId?: string;
  errorMessage?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface BatchExecutionOptions {
  batchSize: number;
  lastProcessedId?: string;
  dryRun?: boolean;
  timeout?: number;
  additionalArgs?: string[];
}

export class MigrationScriptExecutor {
  private logger = getLogger();
  private readonly scriptBasePath: string;
  private readonly nodeExecutable: string;

  constructor(scriptBasePath: string = 'src') {
    this.scriptBasePath = scriptBasePath;
    this.nodeExecutable = 'npx';
  }

  /**
   * Execute a migration script for a specific entity with batch processing
   */
  async executeMigrationScript(
    entityConfig: MigrationEntity,
    options: BatchExecutionOptions
  ): Promise<MigrationScriptResult> {
    try {
      this.logger.info('Executing migration script', {
        entity: entityConfig.name,
        script: entityConfig.migrationScript,
        batch_size: options.batchSize,
        last_processed_id: options.lastProcessedId
      });

      // Determine the migration approach based on existing scripts
      const migrationApproach = await this.determineMigrationApproach(entityConfig);

      switch (migrationApproach) {
        case 'npm_script':
          return await this.executeNpmScript(entityConfig, options);

        case 'direct_ts_file':
          return await this.executeTypeScriptFile(entityConfig, options);

        case 'custom_function':
          return await this.executeCustomFunction(entityConfig, options);

        default:
          throw new ValidationError(
            `No suitable migration approach found for entity: ${entityConfig.name}`,
            'MIGRATION_APPROACH_NOT_FOUND'
          );
      }

    } catch (error) {
      this.logger.error(`Migration script execution failed for ${entityConfig.name}`, error as Error);
      return {
        success: false,
        recordsProcessed: 0,
        recordsFailed: 0,
        errorMessage: (error as Error).message
      };
    }
  }

  /**
   * Execute validation script for an entity
   */
  async executeValidationScript(
    entityConfig: MigrationEntity,
    migrationId?: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      this.logger.info('Executing validation script', {
        entity: entityConfig.name,
        migration_id: migrationId
      });

      // Check if validation script exists
      if (!entityConfig.validationScript) {
        // Try to find validation npm script
        const validationScriptName = `validate:${entityConfig.name}`;
        const hasValidationScript = await this.hasNpmScript(validationScriptName);

        if (hasValidationScript) {
          const result = await this.executeCommand('npm', ['run', validationScriptName]);
          return {
            success: result.exitCode === 0,
            message: result.success ? 'Validation passed' : 'Validation failed',
            details: {
              stdout: result.stdout,
              stderr: result.stderr
            }
          };
        }

        return {
          success: true,
          message: 'No validation script found - skipping validation'
        };
      }

      // Execute custom validation script
      const result = await this.executeTypeScriptFile(entityConfig, {
        batchSize: 0,
        additionalArgs: ['validate', migrationId || '']
      });

      return {
        success: result.success,
        message: result.success ? 'Validation passed' : `Validation failed: ${result.errorMessage}`,
        details: result
      };

    } catch (error) {
      this.logger.error(`Validation script execution failed for ${entityConfig.name}`, error as Error);
      return {
        success: false,
        message: `Validation error: ${(error as Error).message}`
      };
    }
  }

  /**
   * Check if an entity supports rollback
   */
  async supportsRollback(entityConfig: MigrationEntity): Promise<boolean> {
    const rollbackScriptName = `rollback:${entityConfig.name}`;
    return await this.hasNpmScript(rollbackScriptName);
  }

  /**
   * Execute rollback for an entity
   */
  async executeRollback(entityConfig: MigrationEntity): Promise<MigrationScriptResult> {
    try {
      const rollbackScriptName = `rollback:${entityConfig.name}`;

      if (await this.hasNpmScript(rollbackScriptName)) {
        const result = await this.executeCommand('npm', ['run', rollbackScriptName]);
        return {
          success: result.exitCode === 0,
          recordsProcessed: 0, // Rollback doesn't process new records
          recordsFailed: result.exitCode === 0 ? 0 : 1,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        };
      }

      throw new ValidationError(
        `No rollback script found for entity: ${entityConfig.name}`,
        'ROLLBACK_SCRIPT_NOT_FOUND'
      );

    } catch (error) {
      return {
        success: false,
        recordsProcessed: 0,
        recordsFailed: 1,
        errorMessage: (error as Error).message
      };
    }
  }

  // Private methods

  private async determineMigrationApproach(entityConfig: MigrationEntity): Promise<string> {
    // Check for npm script first (most common approach)
    const npmScriptName = `migrate:${entityConfig.name}`;
    if (await this.hasNpmScript(npmScriptName)) {
      return 'npm_script';
    }

    // Check for direct TypeScript file
    if (entityConfig.migrationScript && await this.fileExists(entityConfig.migrationScript)) {
      return 'direct_ts_file';
    }

    // Look for common patterns
    const commonScriptPath = path.join(this.scriptBasePath, `${entityConfig.name}-migration.ts`);
    if (await this.fileExists(commonScriptPath)) {
      return 'direct_ts_file';
    }

    // Check for custom function approach
    if (entityConfig.migrationScript && entityConfig.migrationScript.includes('function')) {
      return 'custom_function';
    }

    return 'unknown';
  }

  private async executeNpmScript(
    entityConfig: MigrationEntity,
    options: BatchExecutionOptions
  ): Promise<MigrationScriptResult> {
    const scriptName = `migrate:${entityConfig.name}`;
    const args = ['run', scriptName];

    // Add additional arguments if provided
    if (options.additionalArgs && options.additionalArgs.length > 0) {
      args.push('--', ...options.additionalArgs);
    }

    const result = await this.executeCommand('npm', args, {
      timeout: options.timeout || 300000, // 5 minutes default
      env: {
        ...process.env,
        BATCH_SIZE: options.batchSize.toString(),
        LAST_PROCESSED_ID: options.lastProcessedId || '',
        DRY_RUN: options.dryRun ? 'true' : 'false'
      }
    });

    // Parse the output to extract statistics
    const stats = this.parseScriptOutput(result.stdout || '');

    return {
      success: result.exitCode === 0,
      recordsProcessed: stats.recordsProcessed,
      recordsFailed: stats.recordsFailed,
      lastProcessedId: stats.lastProcessedId,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      errorMessage: result.exitCode !== 0 ? result.stderr : undefined
    };
  }

  private async executeTypeScriptFile(
    entityConfig: MigrationEntity,
    options: BatchExecutionOptions
  ): Promise<MigrationScriptResult> {
    const scriptPath = entityConfig.migrationScript ||
                     path.join(this.scriptBasePath, `${entityConfig.name}-migration.ts`);

    const args = ['ts-node', scriptPath];

    // Add batch processing arguments
    if (options.batchSize > 0) {
      args.push('--batch-size', options.batchSize.toString());
    }

    if (options.lastProcessedId) {
      args.push('--last-processed-id', options.lastProcessedId);
    }

    if (options.dryRun) {
      args.push('--dry-run');
    }

    if (options.additionalArgs && options.additionalArgs.length > 0) {
      args.push(...options.additionalArgs);
    }

    const result = await this.executeCommand(this.nodeExecutable, args, {
      timeout: options.timeout || 300000
    });

    const stats = this.parseScriptOutput(result.stdout || '');

    return {
      success: result.exitCode === 0,
      recordsProcessed: stats.recordsProcessed,
      recordsFailed: stats.recordsFailed,
      lastProcessedId: stats.lastProcessedId,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      errorMessage: result.exitCode !== 0 ? result.stderr : undefined
    };
  }

  private async executeCustomFunction(
    entityConfig: MigrationEntity,
    options: BatchExecutionOptions
  ): Promise<MigrationScriptResult> {
    // This would handle custom function-based migrations
    // For now, throw an error as this needs specific implementation
    throw new ValidationError(
      'Custom function migration execution not implemented',
      'CUSTOM_FUNCTION_NOT_IMPLEMENTED'
    );
  }

  private async executeCommand(
    command: string,
    args: string[],
    options: { timeout?: number; env?: Record<string, string> } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string; success: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...options.env },
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Set timeout if specified
      let timeoutId: NodeJS.Timeout | null = null;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timeout after ${options.timeout}ms`));
        }, options.timeout);
      }

      child.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          success: code === 0
        });
      });

      child.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(new DatabaseError(
          `Command execution failed: ${error.message}`,
          'COMMAND_EXECUTION_ERROR',
          { command, args }
        ));
      });
    });
  }

  private parseScriptOutput(output: string): {
    recordsProcessed: number;
    recordsFailed: number;
    lastProcessedId?: string;
  } {
    let recordsProcessed = 0;
    let recordsFailed = 0;
    let lastProcessedId: string | undefined;

    // Parse common output patterns from existing migration scripts
    const lines = output.split('\n');

    for (const line of lines) {
      // Look for patterns like "✓ Processed 1000 records"
      const processedMatch = line.match(/✓.*?(\d+).*?(?:record|row|item)/i);
      if (processedMatch) {
        recordsProcessed += parseInt(processedMatch[1]);
      }

      // Look for patterns like "❌ Failed to process 5 records"
      const failedMatch = line.match(/❌.*?(\d+).*?(?:record|row|item|failed)/i);
      if (failedMatch) {
        recordsFailed += parseInt(failedMatch[1]);
      }

      // Look for "Last ID processed: xyz"
      const lastIdMatch = line.match(/last.*?(?:id|processed).*?[:\s](\S+)/i);
      if (lastIdMatch) {
        lastProcessedId = lastIdMatch[1];
      }

      // Look for JSON output with statistics
      if (line.trim().startsWith('{') && line.includes('processed')) {
        try {
          const stats = JSON.parse(line);
          if (stats.processed) recordsProcessed += stats.processed;
          if (stats.failed) recordsFailed += stats.failed;
          if (stats.lastId) lastProcessedId = stats.lastId;
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    return {
      recordsProcessed,
      recordsFailed,
      lastProcessedId
    };
  }

  private async hasNpmScript(scriptName: string): Promise<boolean> {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
      return !!(packageJson.scripts && packageJson.scripts[scriptName]);
    } catch {
      return false;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available migration scripts for all entities
   */
  async getAvailableMigrationScripts(): Promise<Record<string, {
    migrate: boolean;
    validate: boolean;
    rollback: boolean;
    scriptPath?: string;
  }>> {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};

    const entities = [
      'offices', 'profiles', 'doctors', 'patients', 'orders',
      'products', 'jaws', 'projects', 'treatment-plans'
    ];

    const result: Record<string, any> = {};

    for (const entity of entities) {
      const migrateScript = `migrate:${entity}`;
      const validateScript = `validate:${entity}`;
      const rollbackScript = `rollback:${entity}`;

      // Check for script files
      const commonScriptPath = path.join(this.scriptBasePath, `${entity}-migration.ts`);
      const scriptExists = await this.fileExists(commonScriptPath);

      result[entity] = {
        migrate: !!(scripts[migrateScript] || scriptExists),
        validate: !!scripts[validateScript],
        rollback: !!scripts[rollbackScript],
        scriptPath: scriptExists ? commonScriptPath : undefined
      };
    }

    return result;
  }

  /**
   * Validate that all required migration scripts exist for the given entities
   */
  async validateMigrationScripts(entityNames: string[]): Promise<{
    valid: boolean;
    missingScripts: string[];
    availableScripts: string[];
  }> {
    const availableScripts = await this.getAvailableMigrationScripts();
    const missingScripts: string[] = [];
    const foundScripts: string[] = [];

    for (const entityName of entityNames) {
      const entityScripts = availableScripts[entityName];

      if (!entityScripts || !entityScripts.migrate) {
        missingScripts.push(entityName);
      } else {
        foundScripts.push(entityName);
      }
    }

    return {
      valid: missingScripts.length === 0,
      missingScripts,
      availableScripts: foundScripts
    };
  }
}
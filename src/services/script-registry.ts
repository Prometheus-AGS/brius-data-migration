/**
 * Script Registry Service
 * Manages discovery, registration, and execution of migration scripts
 */

import { MigrationEntity } from '../models/migration-entity';
import { MigrationConfig } from '../models/migration-config';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ScriptMetadata {
  path: string;
  type: 'npm' | 'direct' | 'batch';
  entity: string;
  operation: 'migrate' | 'validate' | 'rollback' | 'analyze';
  dependencies: string[];
  estimatedRecords: number;
  lastModified: Date;
  fileSize: number;
  executable: boolean;
}

export interface ScriptExecutionContext {
  workingDirectory: string;
  environment: Record<string, string>;
  timeout: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ScriptExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  error?: Error;
}

export class ScriptRegistry {
  private scripts: Map<string, ScriptMetadata> = new Map();
  private config: MigrationConfig;
  private rootDirectory: string;

  constructor(config: MigrationConfig, rootDirectory: string = process.cwd()) {
    this.config = config;
    this.rootDirectory = rootDirectory;
  }

  /**
   * Discover and register all migration scripts in the project
   */
  async discoverScripts(): Promise<void> {
    this.scripts.clear();

    // Discover NPM scripts from package.json
    await this.discoverNpmScripts();

    // Discover direct TypeScript scripts
    await this.discoverDirectScripts();

    // Discover validation scripts
    await this.discoverValidationScripts();

    // Discover rollback scripts
    await this.discoverRollbackScripts();
  }

  /**
   * Register a script manually
   */
  registerScript(id: string, metadata: ScriptMetadata): void {
    this.scripts.set(id, metadata);
  }

  /**
   * Get script metadata by ID
   */
  getScript(id: string): ScriptMetadata | undefined {
    return this.scripts.get(id);
  }

  /**
   * Get all scripts of a specific type
   */
  getScriptsByType(type: 'npm' | 'direct' | 'batch'): ScriptMetadata[] {
    return Array.from(this.scripts.values()).filter(script => script.type === type);
  }

  /**
   * Get scripts for a specific entity
   */
  getScriptsForEntity(entity: string): ScriptMetadata[] {
    return Array.from(this.scripts.values()).filter(script => script.entity === entity);
  }

  /**
   * Get migration scripts in dependency order
   */
  getOrderedMigrationScripts(): ScriptMetadata[] {
    const migrationScripts = Array.from(this.scripts.values())
      .filter(script => script.operation === 'migrate');

    return this.sortByDependencies(migrationScripts);
  }

  /**
   * Validate that all required scripts exist
   */
  validateScripts(entities: MigrationEntity[]): { valid: boolean; missing: string[]; errors: string[] } {
    const missing: string[] = [];
    const errors: string[] = [];

    for (const entity of entities) {
      // Check migration script
      const migrationScript = this.findScriptForEntity(entity.name, 'migrate');
      if (!migrationScript) {
        missing.push(`Migration script for ${entity.name}`);
      } else if (!migrationScript.executable) {
        errors.push(`Migration script for ${entity.name} is not executable`);
      }

      // Check validation script if specified
      if (entity.validationScript) {
        const validationScript = this.findScriptForEntity(entity.name, 'validate');
        if (!validationScript) {
          missing.push(`Validation script for ${entity.name}`);
        }
      }

      // Check rollback script if specified
      if (entity.rollbackScript) {
        const rollbackScript = this.findScriptForEntity(entity.name, 'rollback');
        if (!rollbackScript) {
          missing.push(`Rollback script for ${entity.name}`);
        }
      }
    }

    return {
      valid: missing.length === 0 && errors.length === 0,
      missing,
      errors
    };
  }

  /**
   * Execute a script with proper context
   */
  async executeScript(
    scriptId: string,
    context: Partial<ScriptExecutionContext> = {}
  ): Promise<ScriptExecutionResult> {
    const script = this.scripts.get(scriptId);
    if (!script) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const executionContext: ScriptExecutionContext = {
      workingDirectory: this.rootDirectory,
      environment: { ...process.env },
      timeout: this.config.execution.timeout,
      logLevel: this.config.logging.level,
      ...context
    };

    const startTime = Date.now();

    try {
      let command: string;

      if (script.type === 'npm') {
        command = `npm run ${this.extractNpmScriptName(scriptId)}`;
      } else if (script.type === 'direct' || script.type === 'batch') {
        command = `npx ts-node ${script.path}`;
      } else {
        throw new Error(`Unknown script type: ${script.type}`);
      }

      const stdout = execSync(command, {
        cwd: executionContext.workingDirectory,
        env: executionContext.environment,
        timeout: executionContext.timeout,
        encoding: 'utf8'
      });

      const duration = Date.now() - startTime;

      return {
        success: true,
        exitCode: 0,
        stdout: stdout.toString(),
        stderr: '',
        duration
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        exitCode: error.status || 1,
        stdout: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || error.message,
        duration,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Get script execution statistics
   */
  getExecutionStats(): {
    totalScripts: number;
    npmScripts: number;
    directScripts: number;
    batchScripts: number;
    entitiesCovered: string[];
  } {
    const scripts = Array.from(this.scripts.values());
    const entities = new Set(scripts.map(s => s.entity));

    return {
      totalScripts: scripts.length,
      npmScripts: scripts.filter(s => s.type === 'npm').length,
      directScripts: scripts.filter(s => s.type === 'direct').length,
      batchScripts: scripts.filter(s => s.type === 'batch').length,
      entitiesCovered: Array.from(entities)
    };
  }

  /**
   * Discover NPM scripts from package.json
   */
  private async discoverNpmScripts(): Promise<void> {
    const packageJsonPath = path.join(this.rootDirectory, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};

    for (const [scriptName, command] of Object.entries(scripts)) {
      if (this.isMigrationScript(scriptName)) {
        const metadata = this.parseNpmScriptMetadata(scriptName, command as string);
        this.scripts.set(`npm:${scriptName}`, metadata);
      }
    }
  }

  /**
   * Discover direct TypeScript scripts
   */
  private async discoverDirectScripts(): Promise<void> {
    const scriptDirectories = ['', 'src', 'migrate', 'migrations'];

    for (const dir of scriptDirectories) {
      const fullPath = path.join(this.rootDirectory, dir);

      if (!fs.existsSync(fullPath)) {
        continue;
      }

      const files = fs.readdirSync(fullPath);

      for (const file of files) {
        if (file.endsWith('.ts') && this.isMigrationFile(file)) {
          const filePath = path.join(fullPath, file);
          const metadata = await this.parseDirectScriptMetadata(filePath, file);
          this.scripts.set(`direct:${file}`, metadata);
        }
      }
    }
  }

  /**
   * Discover validation scripts
   */
  private async discoverValidationScripts(): Promise<void> {
    const validationDir = path.join(this.rootDirectory, 'validation');

    if (!fs.existsSync(validationDir)) {
      return;
    }

    const files = fs.readdirSync(validationDir);

    for (const file of files) {
      if (file.endsWith('.ts') && file.includes('validate')) {
        const filePath = path.join(validationDir, file);
        const metadata = await this.parseValidationScriptMetadata(filePath, file);
        this.scripts.set(`validate:${file}`, metadata);
      }
    }
  }

  /**
   * Discover rollback scripts
   */
  private async discoverRollbackScripts(): Promise<void> {
    // Rollback scripts are typically NPM scripts or inferred from migration scripts
    const scripts = Array.from(this.scripts.keys());

    for (const scriptId of scripts) {
      if (scriptId.startsWith('npm:rollback:') || scriptId.includes('rollback')) {
        const script = this.scripts.get(scriptId);
        if (script) {
          script.operation = 'rollback';
        }
      }
    }
  }

  /**
   * Check if script name is a migration-related script
   */
  private isMigrationScript(scriptName: string): boolean {
    const migrationPatterns = [
      /^migrate:/,
      /^validate:/,
      /^rollback:/,
      /^dev:/,
      /migration/,
      /validate/,
      /rollback/
    ];

    return migrationPatterns.some(pattern => pattern.test(scriptName));
  }

  /**
   * Check if file is a migration script
   */
  private isMigrationFile(filename: string): boolean {
    const migrationPatterns = [
      /migrate-/,
      /.*-migration\.ts$/,
      /validate-/,
      /.*-validation\.ts$/,
      /analyze-/,
      /check-/,
      /create-.*-schema\.ts$/
    ];

    return migrationPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Parse NPM script metadata
   */
  private parseNpmScriptMetadata(scriptName: string, command: string): ScriptMetadata {
    const entity = this.extractEntityFromScriptName(scriptName);
    const operation = this.extractOperationFromScriptName(scriptName);

    return {
      path: scriptName,
      type: 'npm',
      entity,
      operation,
      dependencies: this.inferDependencies(entity),
      estimatedRecords: this.estimateRecordsForEntity(entity),
      lastModified: new Date(),
      fileSize: 0,
      executable: true
    };
  }

  /**
   * Parse direct script metadata
   */
  private async parseDirectScriptMetadata(filePath: string, filename: string): Promise<ScriptMetadata> {
    const stats = fs.statSync(filePath);
    const entity = this.extractEntityFromFilename(filename);
    const operation = this.extractOperationFromFilename(filename);

    return {
      path: filePath,
      type: filename.startsWith('migrate-') ? 'batch' : 'direct',
      entity,
      operation,
      dependencies: this.inferDependencies(entity),
      estimatedRecords: this.estimateRecordsForEntity(entity),
      lastModified: stats.mtime,
      fileSize: stats.size,
      executable: fs.access ? await this.checkExecutable(filePath) : true
    };
  }

  /**
   * Parse validation script metadata
   */
  private async parseValidationScriptMetadata(filePath: string, filename: string): Promise<ScriptMetadata> {
    const stats = fs.statSync(filePath);
    const entity = this.extractEntityFromFilename(filename);

    return {
      path: filePath,
      type: 'direct',
      entity,
      operation: 'validate',
      dependencies: [],
      estimatedRecords: 0,
      lastModified: stats.mtime,
      fileSize: stats.size,
      executable: await this.checkExecutable(filePath)
    };
  }

  /**
   * Extract entity name from script name
   */
  private extractEntityFromScriptName(scriptName: string): string {
    // Extract entity from patterns like "migrate:doctors", "validate:patients", etc.
    const match = scriptName.match(/(?:migrate|validate|rollback|dev):(.+)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Extract operation from script name
   */
  private extractOperationFromScriptName(scriptName: string): 'migrate' | 'validate' | 'rollback' | 'analyze' {
    if (scriptName.includes('validate')) return 'validate';
    if (scriptName.includes('rollback')) return 'rollback';
    if (scriptName.includes('analyze')) return 'analyze';
    return 'migrate';
  }

  /**
   * Extract entity name from filename
   */
  private extractEntityFromFilename(filename: string): string {
    // Handle various filename patterns
    const patterns = [
      /migrate-(.+)\.ts$/,
      /(.+)-migration\.ts$/,
      /validate-(.+)-migration\.ts$/,
      /analyze-(.+)\.ts$/,
      /(.+)-validation\.ts$/
    ];

    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        return match[1].replace(/-/g, '_');
      }
    }

    return filename.replace(/\.ts$/, '');
  }

  /**
   * Extract operation from filename
   */
  private extractOperationFromFilename(filename: string): 'migrate' | 'validate' | 'rollback' | 'analyze' {
    if (filename.includes('validate')) return 'validate';
    if (filename.includes('rollback')) return 'rollback';
    if (filename.includes('analyze')) return 'analyze';
    return 'migrate';
  }

  /**
   * Infer dependencies based on entity name
   */
  private inferDependencies(entity: string): string[] {
    const dependencyMap: Record<string, string[]> = {
      'doctors': ['offices'],
      'patients': ['doctors', 'offices'],
      'orders': ['patients', 'doctors'],
      'tasks': ['orders', 'patients'],
      'cases': ['patients', 'doctors'],
      'projects': ['patients'],
      'treatment_plans': ['patients'],
      'jaws': ['patients', 'orders'],
      'order_files': ['orders'],
      'case_files': ['cases']
    };

    return dependencyMap[entity] || [];
  }

  /**
   * Estimate record count for entity
   */
  private estimateRecordsForEntity(entity: string): number {
    const estimates: Record<string, number> = {
      'offices': 523,
      'profiles': 9751,
      'doctors': 1213,
      'patients': 7854,
      'orders': 23050,
      'tasks': 762604,
      'cases': 7853,
      'messages': 60944,
      'order_files': 294818,
      'jaws': 39771,
      'projects': 66918,
      'treatment_plans': 67782
    };

    return estimates[entity] || 1000;
  }

  /**
   * Check if file is executable
   */
  private async checkExecutable(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
  }

  /**
   * Extract NPM script name from script ID
   */
  private extractNpmScriptName(scriptId: string): string {
    return scriptId.replace('npm:', '');
  }

  /**
   * Find script for specific entity and operation
   */
  private findScriptForEntity(entity: string, operation: 'migrate' | 'validate' | 'rollback'): ScriptMetadata | undefined {
    return Array.from(this.scripts.values()).find(script =>
      script.entity === entity && script.operation === operation
    );
  }

  /**
   * Sort scripts by dependencies
   */
  private sortByDependencies(scripts: ScriptMetadata[]): ScriptMetadata[] {
    const sorted: ScriptMetadata[] = [];
    const processed = new Set<string>();

    const addScript = (script: ScriptMetadata) => {
      if (processed.has(script.entity)) return;

      // Add dependencies first
      for (const dep of script.dependencies) {
        const depScript = scripts.find(s => s.entity === dep);
        if (depScript && !processed.has(dep)) {
          addScript(depScript);
        }
      }

      sorted.push(script);
      processed.add(script.entity);
    };

    for (const script of scripts) {
      addScript(script);
    }

    return sorted;
  }
}
// Migration Analyzer Service
// Analyzes existing migration scripts to determine reusability for differential migration

import { Pool } from 'pg';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { MigrationCheckpointModel } from '../models/migration-checkpoint';
import {
  OperationType,
  CheckpointInfo,
  MigrationStats
} from '../types/migration-types';

export interface MigrationScript {
  filename: string;
  filepath: string;
  entityType: string;
  functions: string[];
  dependencies: string[];
  reusable: boolean;
  modifications_needed: string[];
  complexity_score: number;
}

export interface ScriptAnalysisResult {
  total_scripts: number;
  reusable_scripts: number;
  scripts_needing_modification: number;
  unsupported_scripts: number;
  analysis_details: MigrationScript[];
  recommendations: string[];
}

export class MigrationAnalyzerService {
  private checkpointModel: MigrationCheckpointModel;

  constructor(private db: Pool, private projectRoot: string = process.cwd()) {
    this.checkpointModel = new MigrationCheckpointModel(db);
  }

  /**
   * Analyze all migration scripts for reusability
   */
  async analyzeExistingScripts(): Promise<ScriptAnalysisResult> {
    const srcDir = join(this.projectRoot, 'src');
    const scriptFiles = this.findMigrationScripts(srcDir);

    const analyzedScripts: MigrationScript[] = [];
    const recommendations: string[] = [];

    for (const scriptPath of scriptFiles) {
      try {
        const analysis = await this.analyzeScript(scriptPath);
        analyzedScripts.push(analysis);
      } catch (error) {
        console.warn(`Failed to analyze script ${scriptPath}: ${error.message}`);
      }
    }

    // Generate recommendations based on analysis
    const reusableScripts = analyzedScripts.filter(s => s.reusable);
    const modificationNeeded = analyzedScripts.filter(s => !s.reusable && s.modifications_needed.length > 0);
    const unsupported = analyzedScripts.filter(s => !s.reusable && s.modifications_needed.length === 0);

    if (reusableScripts.length > 0) {
      recommendations.push(`${reusableScripts.length} scripts can be reused directly for differential migration`);
    }

    if (modificationNeeded.length > 0) {
      recommendations.push(`${modificationNeeded.length} scripts need modifications to support differential operations`);
    }

    if (unsupported.length > 0) {
      recommendations.push(`${unsupported.length} scripts are not suitable for differential migration and need complete rewrite`);
    }

    // Add specific recommendations
    const highComplexityScripts = analyzedScripts.filter(s => s.complexity_score > 7);
    if (highComplexityScripts.length > 0) {
      recommendations.push(`Scripts with high complexity scores should be prioritized for refactoring: ${highComplexityScripts.map(s => s.filename).join(', ')}`);
    }

    return {
      total_scripts: analyzedScripts.length,
      reusable_scripts: reusableScripts.length,
      scripts_needing_modification: modificationNeeded.length,
      unsupported_scripts: unsupported.length,
      analysis_details: analyzedScripts,
      recommendations
    };
  }

  /**
   * Analyze a specific migration script
   */
  async analyzeScript(scriptPath: string): Promise<MigrationScript> {
    const content = readFileSync(scriptPath, 'utf8');
    const filename = scriptPath.split('/').pop() || '';
    const entityType = this.extractEntityType(filename);

    const functions = this.extractFunctions(content);
    const dependencies = this.extractDependencies(content);
    const complexityScore = this.calculateComplexityScore(content);

    // Determine reusability and needed modifications
    const { reusable, modifications } = this.assessReusability(content, functions);

    return {
      filename,
      filepath: scriptPath,
      entityType,
      functions,
      dependencies,
      reusable,
      modifications_needed: modifications,
      complexity_score: complexityScore
    };
  }

  /**
   * Get checkpoint status for entities
   */
  async getCheckpointStatus(
    entityType?: string,
    operationType?: OperationType
  ): Promise<CheckpointInfo[]> {
    if (entityType) {
      const info = await this.checkpointModel.getCheckpointInfo(entityType, operationType);
      return info ? [info] : [];
    }

    // Get status for all entities
    const entities = ['offices', 'profiles', 'doctors', 'patients', 'orders', 'products', 'jaws', 'projects', 'treatment-plans'];
    const checkpoints: CheckpointInfo[] = [];

    for (const entity of entities) {
      try {
        const info = await this.checkpointModel.getCheckpointInfo(entity, operationType);
        if (info) {
          checkpoints.push(info);
        }
      } catch (error) {
        // Continue with other entities if one fails
        console.warn(`Failed to get checkpoint info for ${entity}:`, error.message);
      }
    }

    return checkpoints;
  }

  /**
   * Reset a checkpoint (use with caution)
   */
  async resetCheckpoint(checkpointId: string): Promise<boolean> {
    try {
      const checkpoint = await this.checkpointModel.findById(checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${checkpointId}`);
      }

      // Only allow reset of failed or paused checkpoints
      if (!['failed', 'paused'].includes(checkpoint.status)) {
        throw new Error(`Cannot reset checkpoint in status: ${checkpoint.status}`);
      }

      return await this.checkpointModel.delete(checkpointId);
    } catch (error) {
      throw new Error(`Failed to reset checkpoint: ${error.message}`);
    }
  }

  /**
   * Debug checkpoint issues
   */
  async debugCheckpoint(entityType: string): Promise<any> {
    const checkpoints = await this.checkpointModel.list({ entityType, limit: 5 });
    const latestCheckpoint = checkpoints[0];

    const debugInfo = {
      checkpoint_details: latestCheckpoint ? {
        id: latestCheckpoint.id,
        status: latestCheckpoint.status,
        progress: {
          records_processed: latestCheckpoint.records_processed,
          records_total: latestCheckpoint.records_total,
          percentage: latestCheckpoint.records_total
            ? Math.round((latestCheckpoint.records_processed / latestCheckpoint.records_total) * 100)
            : 0
        },
        timing: {
          started_at: latestCheckpoint.started_at,
          completed_at: latestCheckpoint.completed_at,
          duration_ms: latestCheckpoint.completed_at
            ? latestCheckpoint.completed_at.getTime() - latestCheckpoint.started_at.getTime()
            : Date.now() - latestCheckpoint.started_at.getTime()
        },
        last_processed_id: latestCheckpoint.last_processed_id,
        error_message: latestCheckpoint.error_message
      } : null,

      database_state: await this.getDatabaseState(entityType),
      recommendations: this.generateDebugRecommendations(latestCheckpoint, entityType)
    };

    return debugInfo;
  }

  /**
   * Get overall migration system status
   */
  async getSystemStatus(): Promise<any> {
    const entities = ['offices', 'profiles', 'doctors', 'patients', 'orders'];
    const entityStatuses = [];

    for (const entity of entities) {
      try {
        const checkpointInfo = await this.checkpointModel.getCheckpointInfo(entity);
        const lastMigrationQuery = `
          SELECT MAX(updated_at) as last_migration
          FROM migration_control
          WHERE entity_type = $1
        `;

        let lastMigration = null;
        try {
          const result = await this.db.query(lastMigrationQuery, [entity]);
          lastMigration = result.rows[0]?.last_migration;
        } catch (error) {
          // Ignore errors for legacy table access
        }

        entityStatuses.push({
          entity,
          checkpoint_info: checkpointInfo,
          last_migration_date: lastMigration,
          has_active_operations: checkpointInfo?.can_resume || false
        });
      } catch (error) {
        entityStatuses.push({
          entity,
          checkpoint_info: null,
          last_migration_date: null,
          has_active_operations: false,
          error: error.message
        });
      }
    }

    return {
      system_health: this.calculateSystemHealth(entityStatuses),
      entity_statuses: entityStatuses,
      last_updated: new Date()
    };
  }

  /**
   * Find migration scripts in the specified directory
   */
  private findMigrationScripts(directory: string): string[] {
    const scripts: string[] = [];

    try {
      const files = readdirSync(directory);

      for (const file of files) {
        const fullPath = join(directory, file);
        const stat = statSync(fullPath);

        if (stat.isFile() && file.endsWith('.ts') && this.isMigrationScript(file)) {
          scripts.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Could not read directory ${directory}: ${error.message}`);
    }

    // Also check root directory for additional migration files
    try {
      const rootFiles = readdirSync(this.projectRoot);
      for (const file of rootFiles) {
        if (file.endsWith('.ts') && this.isMigrationScript(file)) {
          const fullPath = join(this.projectRoot, file);
          scripts.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Could not read root directory: ${error.message}`);
    }

    return scripts;
  }

  /**
   * Check if a file is a migration script
   */
  private isMigrationScript(filename: string): boolean {
    const migrationPatterns = [
      /migrate-.+\.ts$/,
      /.*-migration\.ts$/,
      /validate-.+-migration\.ts$/,
      /.*-migration-.*\.ts$/,
      /analyze-.+\.ts$/
    ];

    return migrationPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Extract entity type from filename
   */
  private extractEntityType(filename: string): string {
    const patterns = [
      { pattern: /migrate-([^-]+)/, index: 1 },
      { pattern: /([^-]+)-migration/, index: 1 },
      { pattern: /validate-([^-]+)-migration/, index: 1 },
      { pattern: /analyze-([^-]+)/, index: 1 }
    ];

    for (const { pattern, index } of patterns) {
      const match = filename.match(pattern);
      if (match) {
        return match[index];
      }
    }

    return 'unknown';
  }

  /**
   * Extract function names from script content
   */
  private extractFunctions(content: string): string[] {
    const functionRegex = /(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)|(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s+)?\(/g;
    const functions: string[] = [];
    let match;

    while ((match = functionRegex.exec(content)) !== null) {
      const functionName = match[1] || match[2];
      if (functionName && !functions.includes(functionName)) {
        functions.push(functionName);
      }
    }

    return functions;
  }

  /**
   * Extract dependencies from script content
   */
  private extractDependencies(content: string): string[] {
    const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    const dependencies: string[] = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    while ((match = requireRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Calculate complexity score for a script
   */
  private calculateComplexityScore(content: string): number {
    let score = 0;

    // Basic metrics
    const lines = content.split('\n').length;
    score += Math.floor(lines / 100); // 1 point per 100 lines

    // Function complexity
    const functions = this.extractFunctions(content);
    score += functions.length * 0.5;

    // Database operations
    const dbOperations = (content.match(/\.query\(|\.execute\(|INSERT|UPDATE|DELETE|SELECT/gi) || []).length;
    score += dbOperations * 0.3;

    // Error handling
    const errorHandling = (content.match(/try\s*{|catch\s*\(|throw\s+/gi) || []).length;
    score += errorHandling * 0.2;

    // Batch processing indicators
    if (content.includes('batch') || content.includes('BATCH_SIZE')) {
      score += 1;
    }

    // Transaction handling
    if (content.includes('BEGIN') || content.includes('COMMIT') || content.includes('ROLLBACK')) {
      score += 1;
    }

    return Math.round(score * 10) / 10;
  }

  /**
   * Assess script reusability for differential migration
   */
  private assessReusability(content: string, functions: string[]): {
    reusable: boolean;
    modifications: string[];
  } {
    const modifications: string[] = [];
    let reusable = true;

    // Check for essential differential migration capabilities
    if (!content.includes('WHERE') && !content.includes('LEFT JOIN')) {
      modifications.push('Add differential query logic to identify missing records');
      reusable = false;
    }

    if (!functions.some(f => f.toLowerCase().includes('validate'))) {
      modifications.push('Add validation function to verify migration results');
    }

    if (!content.includes('metadata') && !content.includes('legacy_id')) {
      modifications.push('Add legacy ID preservation in metadata fields');
      reusable = false;
    }

    if (!content.includes('batch') && !content.includes('BATCH_SIZE')) {
      modifications.push('Add batch processing for large datasets');
    }

    if (!functions.some(f => f.toLowerCase().includes('rollback'))) {
      modifications.push('Add rollback functionality for error recovery');
    }

    // Check for checkpoint/resume capability
    if (!content.includes('checkpoint') && !content.includes('resume')) {
      modifications.push('Add checkpoint/resume capability for long operations');
    }

    // Check for proper error handling
    if (!content.includes('try') || !content.includes('catch')) {
      modifications.push('Add comprehensive error handling and logging');
    }

    // If too many modifications needed, consider it not reusable
    if (modifications.length > 4) {
      reusable = false;
    }

    return { reusable, modifications };
  }

  /**
   * Get database state for debugging
   */
  private async getDatabaseState(entityType: string): Promise<any> {
    try {
      // Get table information
      const tableQuery = `
        SELECT table_name, table_schema
        FROM information_schema.tables
        WHERE table_name LIKE '%${entityType}%'
          OR table_name = '${entityType}'
        ORDER BY table_name
      `;

      const tableResult = await this.db.query(tableQuery);

      // Get migration mappings info
      const mappingQuery = `
        SELECT COUNT(*) as mapping_count,
               MIN(migration_timestamp) as first_migration,
               MAX(migration_timestamp) as last_migration
        FROM migration_mappings
        WHERE entity_type = $1
      `;

      let mappingInfo = null;
      try {
        const mappingResult = await this.db.query(mappingQuery, [entityType]);
        mappingInfo = mappingResult.rows[0];
      } catch (error) {
        // Mapping table might not exist
      }

      return {
        tables: tableResult.rows,
        mapping_info: mappingInfo,
        query_timestamp: new Date()
      };
    } catch (error) {
      return {
        error: error.message,
        query_timestamp: new Date()
      };
    }
  }

  /**
   * Generate debug recommendations
   */
  private generateDebugRecommendations(
    checkpoint: any,
    entityType: string
  ): string[] {
    const recommendations: string[] = [];

    if (!checkpoint) {
      recommendations.push(`No checkpoint found for ${entityType} - safe to start new migration`);
      return recommendations;
    }

    switch (checkpoint.status) {
      case 'failed':
        recommendations.push('Check error message and resolve underlying issue');
        recommendations.push('Consider resetting checkpoint if issue is resolved');
        if (checkpoint.error_message) {
          recommendations.push(`Error details: ${checkpoint.error_message}`);
        }
        break;

      case 'paused':
        recommendations.push('Checkpoint is paused - safe to resume');
        recommendations.push(`Progress: ${checkpoint.records_processed}/${checkpoint.records_total} records`);
        break;

      case 'in_progress':
        const staleDuration = Date.now() - checkpoint.started_at.getTime();
        if (staleDuration > 30 * 60 * 1000) { // 30 minutes
          recommendations.push('Checkpoint appears stale (running > 30 minutes)');
          recommendations.push('Consider checking if process is still running or reset checkpoint');
        } else {
          recommendations.push('Checkpoint is actively running - wait for completion or interrupt gracefully');
        }
        break;

      case 'completed':
        recommendations.push('Previous migration completed successfully');
        recommendations.push('Run new differential migration to catch any new records');
        break;

      case 'pending':
        recommendations.push('Checkpoint is pending - safe to start or resume');
        break;
    }

    return recommendations;
  }

  /**
   * Calculate system health score
   */
  private calculateSystemHealth(entityStatuses: any[]): string {
    const totalEntities = entityStatuses.length;
    const healthyEntities = entityStatuses.filter(e =>
      !e.error && (!e.checkpoint_info || !e.checkpoint_info.can_resume)
    ).length;

    const healthPercentage = (healthyEntities / totalEntities) * 100;

    if (healthPercentage >= 90) return 'healthy';
    if (healthPercentage >= 70) return 'warning';
    return 'critical';
  }

  /**
   * Get migration statistics across all entities
   */
  async getMigrationStatistics(): Promise<MigrationStats> {
    try {
      const query = `
        SELECT
          operation_type,
          status,
          COUNT(*) as count,
          SUM(records_processed) as total_processed,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms
        FROM migration_checkpoints
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY operation_type, status
        ORDER BY operation_type, status
      `;

      const result = await this.db.query(query);

      // Aggregate statistics
      const totalProcessed = result.rows.reduce((sum, row) => sum + parseInt(row.total_processed || '0'), 0);
      const successful = result.rows
        .filter(row => row.status === 'completed')
        .reduce((sum, row) => sum + parseInt(row.count), 0);
      const failed = result.rows
        .filter(row => row.status === 'failed')
        .reduce((sum, row) => sum + parseInt(row.count), 0);
      const skipped = result.rows
        .filter(row => row.status === 'skipped')
        .reduce((sum, row) => sum + parseInt(row.count), 0);

      return {
        totalProcessed,
        successful,
        failed,
        skipped,
        duration: result.rows.reduce((sum, row) => sum + parseFloat(row.avg_duration_ms || '0'), 0)
      };
    } catch (error) {
      return {
        totalProcessed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        duration: 0
      };
    }
  }
}
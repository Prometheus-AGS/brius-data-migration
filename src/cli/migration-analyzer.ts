#!/usr/bin/env node

// Migration Analyzer CLI
// Command line interface for migration checkpoint management and debugging

import { Command } from 'commander';
import { Pool } from 'pg';
import { MigrationAnalyzerService } from '../services/migration-analyzer';
import {
  OperationType,
  CheckpointStatus,
  MigrationError
} from '../types/migration-types';

// Target database configuration
const targetDbConfig = {
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '54322'),
  database: process.env.TARGET_DB_NAME || 'postgres',
  user: process.env.TARGET_DB_USER || 'supabase_admin',
  password: process.env.TARGET_DB_PASSWORD || 'postgres'
};

// Available entity types
const VALID_ENTITIES = [
  'offices', 'profiles', 'doctors', 'patients', 'orders',
  'products', 'jaws', 'projects', 'treatment-plans'
];

// Available operation types
const OPERATION_TYPES = [
  'differential_migration',
  'sync_operation',
  'validation'
];

/**
 * Initialize database connection
 */
function initializeConnection(): Pool {
  return new Pool(targetDbConfig);
}

/**
 * Validate entity type
 */
function validateEntity(entity: string): void {
  if (!VALID_ENTITIES.includes(entity)) {
    console.error(`❌ Invalid entity type: ${entity}`);
    console.error(`Valid entities: ${VALID_ENTITIES.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Validate operation type
 */
function validateOperationType(operationType: string): OperationType {
  if (!OPERATION_TYPES.includes(operationType)) {
    console.error(`❌ Invalid operation type: ${operationType}`);
    console.error(`Valid types: ${OPERATION_TYPES.join(', ')}`);
    process.exit(1);
  }
  return operationType as OperationType;
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format date for display
 */
function formatDate(date: Date | string | undefined): string {
  if (!date) return 'Never';
  return new Date(date).toLocaleString();
}

/**
 * Get status emoji
 */
function getStatusEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    'pending': '⏳',
    'in_progress': '🔄',
    'completed': '✅',
    'failed': '❌',
    'paused': '⏸️'
  };
  return emojiMap[status] || '❓';
}

/**
 * Get health emoji
 */
function getHealthEmoji(health: string): string {
  const emojiMap: Record<string, string> = {
    'healthy': '💚',
    'warning': '⚠️',
    'critical': '🔴'
  };
  return emojiMap[health] || '❓';
}

/**
 * Display checkpoint information
 */
function displayCheckpoint(checkpoint: any, showDetails: boolean = false): void {
  const statusEmoji = getStatusEmoji(checkpoint.status);

  console.log(`${statusEmoji} ${checkpoint.entity_type || checkpoint.entityType} (${checkpoint.checkpoint_id || checkpoint.id || 'N/A'})`);
  console.log(`   Status: ${checkpoint.status}`);

  if (checkpoint.progress_percentage !== undefined) {
    console.log(`   Progress: ${checkpoint.progress_percentage}%`);
  }

  if (checkpoint.last_processed_id) {
    console.log(`   Last Processed ID: ${checkpoint.last_processed_id}`);
  }

  if (checkpoint.can_resume !== undefined) {
    console.log(`   Can Resume: ${checkpoint.can_resume ? 'Yes' : 'No'}`);
  }

  if (checkpoint.estimated_time_remaining) {
    console.log(`   Est. Time Remaining: ${formatDuration(checkpoint.estimated_time_remaining)}`);
  }

  if (showDetails) {
    if (checkpoint.records_processed !== undefined) {
      console.log(`   Records Processed: ${checkpoint.records_processed.toLocaleString()}`);
    }

    if (checkpoint.records_total !== undefined) {
      console.log(`   Total Records: ${checkpoint.records_total.toLocaleString()}`);
    }

    if (checkpoint.started_at) {
      console.log(`   Started: ${formatDate(checkpoint.started_at)}`);
    }

    if (checkpoint.completed_at) {
      console.log(`   Completed: ${formatDate(checkpoint.completed_at)}`);
    }

    if (checkpoint.error_message) {
      console.log(`   Error: ${checkpoint.error_message}`);
    }
  }

  console.log();
}

/**
 * Display system status
 */
function displaySystemStatus(status: any): void {
  const healthEmoji = getHealthEmoji(status.system_health);

  console.log(`🖥️  System Status: ${healthEmoji} ${status.system_health.toUpperCase()}`);
  console.log(`🕐 Last Updated: ${formatDate(status.last_updated)}`);
  console.log();

  if (status.entity_statuses && status.entity_statuses.length > 0) {
    console.log(`📊 Entity Status (${status.entity_statuses.length}):`);

    status.entity_statuses.forEach((entity: any) => {
      const hasOperations = entity.has_active_operations;
      const entityEmoji = entity.error ? '❌' : hasOperations ? '🔄' : '✅';

      console.log(`  ${entityEmoji} ${entity.entity.toUpperCase()}:`);

      if (entity.checkpoint_info) {
        console.log(`    Checkpoint: ${getStatusEmoji(entity.checkpoint_info.status)} ${entity.checkpoint_info.status}`);
        if (entity.checkpoint_info.progress_percentage !== undefined) {
          console.log(`    Progress: ${entity.checkpoint_info.progress_percentage}%`);
        }
      } else {
        console.log(`    Checkpoint: None`);
      }

      if (entity.last_migration_date) {
        console.log(`    Last Migration: ${formatDate(entity.last_migration_date)}`);
      }

      if (entity.error) {
        console.log(`    Error: ${entity.error}`);
      }

      console.log();
    });
  }
}

/**
 * Display debug information
 */
function displayDebugInfo(debugInfo: any, entityType: string): void {
  console.log(`🔍 Debug Information for ${entityType.toUpperCase()}:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (debugInfo.checkpoint_details) {
    const checkpoint = debugInfo.checkpoint_details;
    const statusEmoji = getStatusEmoji(checkpoint.status);

    console.log(`📍 Latest Checkpoint (${checkpoint.id}):`);
    console.log(`  ${statusEmoji} Status: ${checkpoint.status}`);

    if (checkpoint.progress) {
      console.log(`  📊 Progress: ${checkpoint.progress.percentage}%`);
      console.log(`  📈 Records: ${checkpoint.progress.records_processed.toLocaleString()} / ${checkpoint.progress.records_total?.toLocaleString() || 'Unknown'}`);
    }

    if (checkpoint.timing) {
      console.log(`  🕐 Started: ${formatDate(checkpoint.timing.started_at)}`);
      if (checkpoint.timing.completed_at) {
        console.log(`  🏁 Completed: ${formatDate(checkpoint.timing.completed_at)}`);
      }
      console.log(`  ⏱️  Duration: ${formatDuration(checkpoint.timing.duration_ms)}`);
    }

    if (checkpoint.last_processed_id) {
      console.log(`  🆔 Last Processed ID: ${checkpoint.last_processed_id}`);
    }

    if (checkpoint.error_message) {
      console.log(`  ❌ Error: ${checkpoint.error_message}`);
    }

  } else {
    console.log(`📍 No checkpoint data found for ${entityType}`);
  }

  console.log();

  if (debugInfo.database_state) {
    console.log(`💾 Database State:`);

    if (debugInfo.database_state.tables && debugInfo.database_state.tables.length > 0) {
      console.log(`  📊 Tables (${debugInfo.database_state.tables.length}):`);
      debugInfo.database_state.tables.forEach((table: any) => {
        console.log(`    • ${table.table_schema}.${table.table_name}`);
      });
    }

    if (debugInfo.database_state.mapping_info) {
      const mapping = debugInfo.database_state.mapping_info;
      console.log(`  🗺️  Mapping Info:`);
      console.log(`    Records: ${mapping.mapping_count || 0}`);
      if (mapping.first_migration) {
        console.log(`    First Migration: ${formatDate(mapping.first_migration)}`);
      }
      if (mapping.last_migration) {
        console.log(`    Last Migration: ${formatDate(mapping.last_migration)}`);
      }
    }

    if (debugInfo.database_state.error) {
      console.log(`  ❌ Database Error: ${debugInfo.database_state.error}`);
    }
  }

  console.log();

  if (debugInfo.recommendations && debugInfo.recommendations.length > 0) {
    console.log(`💡 Recommendations (${debugInfo.recommendations.length}):`);
    debugInfo.recommendations.forEach((rec: string, index: number) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
  } else {
    console.log(`💡 No specific recommendations available.`);
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Handle CLI errors
 */
function handleError(error: Error): never {
  console.error(`\n❌ Error: ${error.message}`);

  if (error instanceof MigrationError) {
    if (error.entityType) {
      console.error(`   Entity: ${error.entityType}`);
    }
  }

  process.exit(1);
}

/**
 * Create analyzer service instance
 */
function createAnalyzerService(): MigrationAnalyzerService {
  const db = initializeConnection();
  return new MigrationAnalyzerService(db);
}

// Create CLI program
const program = new Command();

program
  .name('migration-analyzer')
  .description('CLI for migration checkpoint management and debugging')
  .version('1.0.0');

// Checkpoint status command
program
  .command('checkpoint-status')
  .description('Get checkpoint status for entities')
  .option('-e, --entity <entity>', 'Specific entity to check')
  .option('-o, --operation <operation>', 'Filter by operation type')
  .option('-d, --details', 'Show detailed information', false)
  .action(async (options) => {
    try {
      if (options.entity) {
        validateEntity(options.entity);
      }

      let operationType: OperationType | undefined;
      if (options.operation) {
        operationType = validateOperationType(options.operation);
      }

      console.log('📊 Retrieving checkpoint status...\n');

      const analyzerService = createAnalyzerService();
      const checkpoints = await analyzerService.getCheckpointStatus(
        options.entity,
        operationType
      );

      if (checkpoints.length === 0) {
        if (options.entity) {
          console.log(`📭 No checkpoints found for ${options.entity}.`);
        } else {
          console.log('📭 No active checkpoints found.');
        }
        return;
      }

      console.log(`📍 Found ${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}:\n`);

      checkpoints.forEach(checkpoint => {
        displayCheckpoint(checkpoint, options.details);
      });

    } catch (error) {
      handleError(error as Error);
    }
  });

// Reset checkpoint command
program
  .command('reset-checkpoint')
  .description('Reset a failed or paused checkpoint')
  .requiredOption('-c, --checkpoint-id <id>', 'Checkpoint ID to reset')
  .option('-f, --force', 'Force reset without confirmation', false)
  .action(async (options) => {
    try {
      if (!options.force) {
        console.log(`⚠️  Are you sure you want to reset checkpoint ${options.checkpointId}?`);
        console.log('This will delete the checkpoint and any progress will be lost.');
        console.log('Use --force to skip this confirmation.');
        process.exit(1);
      }

      console.log(`🔄 Resetting checkpoint: ${options.checkpointId}`);

      const analyzerService = createAnalyzerService();
      const success = await analyzerService.resetCheckpoint(options.checkpointId);

      if (success) {
        console.log(`✅ Checkpoint reset successfully!`);
        console.log(`💡 You can now restart the migration for this entity.`);
      } else {
        console.log(`⚠️  Checkpoint reset may have failed. Check the checkpoint status.`);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Debug command
program
  .command('debug')
  .description('Debug checkpoint issues for an entity')
  .requiredOption('-e, --entity <entity>', 'Entity to debug')
  .action(async (options) => {
    try {
      validateEntity(options.entity);

      console.log(`🔍 Debugging checkpoint issues for ${options.entity}...\n`);

      const analyzerService = createAnalyzerService();
      const debugInfo = await analyzerService.debugCheckpoint(options.entity);

      displayDebugInfo(debugInfo, options.entity);

    } catch (error) {
      handleError(error as Error);
    }
  });

// System status command
program
  .command('system-status')
  .description('Get overall migration system status')
  .action(async (options) => {
    try {
      console.log('🖥️  Retrieving system status...\n');

      const analyzerService = createAnalyzerService();
      const status = await analyzerService.getSystemStatus();

      displaySystemStatus(status);

    } catch (error) {
      handleError(error as Error);
    }
  });

// List scripts command
program
  .command('list-scripts')
  .description('Analyze existing migration scripts')
  .option('-r, --reusable-only', 'Show only reusable scripts', false)
  .option('-d, --details', 'Show detailed script information', false)
  .action(async (options) => {
    try {
      console.log('📋 Analyzing existing migration scripts...\n');

      const analyzerService = createAnalyzerService();
      const analysis = await analyzerService.analyzeExistingScripts();

      console.log(`📊 Script Analysis Summary:`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📁 Total Scripts: ${analysis.total_scripts}`);
      console.log(`✅ Reusable: ${analysis.reusable_scripts}`);
      console.log(`🔧 Need Modification: ${analysis.scripts_needing_modification}`);
      console.log(`❌ Unsupported: ${analysis.unsupported_scripts}`);
      console.log();

      if (analysis.analysis_details && analysis.analysis_details.length > 0) {
        let scriptsToShow = analysis.analysis_details;

        if (options.reusableOnly) {
          scriptsToShow = analysis.analysis_details.filter(script => script.reusable);
          console.log(`📝 Reusable Scripts (${scriptsToShow.length}):`);
        } else {
          console.log(`📝 All Scripts (${scriptsToShow.length}):`);
        }

        scriptsToShow.forEach(script => {
          const statusEmoji = script.reusable ? '✅' : '🔧';
          console.log(`  ${statusEmoji} ${script.filename}`);
          console.log(`    Entity: ${script.entityType}`);
          console.log(`    Complexity: ${script.complexity_score}/10`);
          console.log(`    Functions: ${script.functions.length}`);

          if (options.details) {
            if (script.functions.length > 0) {
              console.log(`    Functions: ${script.functions.join(', ')}`);
            }

            if (script.dependencies.length > 0) {
              console.log(`    Dependencies: ${script.dependencies.join(', ')}`);
            }
          }

          if (script.modifications_needed && script.modifications_needed.length > 0) {
            console.log(`    Modifications needed:`);
            script.modifications_needed.forEach((mod: string) => {
              console.log(`      • ${mod}`);
            });
          }

          console.log();
        });
      }

      if (analysis.recommendations && analysis.recommendations.length > 0) {
        console.log(`💡 Recommendations:`);
        analysis.recommendations.forEach((rec: string, index: number) => {
          console.log(`  ${index + 1}. ${rec}`);
        });
      }

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show migration statistics')
  .action(async (options) => {
    try {
      console.log('📈 Retrieving migration statistics...\n');

      const analyzerService = createAnalyzerService();
      const stats = await analyzerService.getMigrationStatistics();

      console.log(`📊 Migration Statistics:`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📈 Total Processed: ${stats.totalProcessed.toLocaleString()}`);
      console.log(`✅ Successful: ${stats.successful.toLocaleString()}`);
      console.log(`❌ Failed: ${stats.failed.toLocaleString()}`);
      console.log(`⏭️  Skipped: ${stats.skipped.toLocaleString()}`);

      if (stats.duration) {
        console.log(`⏱️  Total Duration: ${formatDuration(stats.duration)}`);
      }

      if (stats.successful > 0 && stats.totalProcessed > 0) {
        const successRate = ((stats.successful / stats.totalProcessed) * 100).toFixed(1);
        console.log(`📊 Success Rate: ${successRate}%`);
      }

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Health check command
program
  .command('health-check')
  .description('Perform comprehensive system health check')
  .action(async (options) => {
    try {
      console.log('🏥 Performing system health check...\n');

      const analyzerService = createAnalyzerService();

      // Get system status
      const systemStatus = await analyzerService.getSystemStatus();

      // Get checkpoint status for all entities
      const checkpoints = await analyzerService.getCheckpointStatus();

      // Display overall health
      const healthEmoji = getHealthEmoji(systemStatus.system_health);
      console.log(`🏥 Overall Health: ${healthEmoji} ${systemStatus.system_health.toUpperCase()}`);
      console.log();

      // Check for issues
      const issues = [];
      const warnings = [];

      // Check for failed checkpoints
      const failedCheckpoints = checkpoints.filter(cp =>
        systemStatus.entity_statuses?.find((es: any) =>
          es.entity === cp.entity_type && es.checkpoint_info?.status === 'failed'
        )
      );

      if (failedCheckpoints.length > 0) {
        issues.push(`${failedCheckpoints.length} entities have failed checkpoints`);
      }

      // Check for stale operations
      const staleOperations = checkpoints.filter(cp => {
        const entity = systemStatus.entity_statuses?.find((es: any) => es.entity === cp.entity_type);
        return entity?.checkpoint_info?.status === 'in_progress' && cp.estimated_time_remaining === undefined;
      });

      if (staleOperations.length > 0) {
        warnings.push(`${staleOperations.length} entities may have stale operations`);
      }

      // Display issues and warnings
      if (issues.length > 0) {
        console.log(`🚨 Issues Found (${issues.length}):`);
        issues.forEach((issue, index) => {
          console.log(`  ${index + 1}. ${issue}`);
        });
        console.log();
      }

      if (warnings.length > 0) {
        console.log(`⚠️  Warnings (${warnings.length}):`);
        warnings.forEach((warning, index) => {
          console.log(`  ${index + 1}. ${warning}`);
        });
        console.log();
      }

      if (issues.length === 0 && warnings.length === 0) {
        console.log(`✅ No issues detected. System is healthy!`);
      }

      // Show summary
      console.log(`📊 Summary:`);
      console.log(`  Total Entities: ${systemStatus.entity_statuses?.length || 0}`);
      console.log(`  Active Operations: ${checkpoints.filter(cp => cp.can_resume).length}`);
      console.log(`  Failed Operations: ${failedCheckpoints.length}`);
      console.log(`  Last Updated: ${formatDate(systemStatus.last_updated)}`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { program };
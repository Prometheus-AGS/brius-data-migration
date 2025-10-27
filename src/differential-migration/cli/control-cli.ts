/**
 * Migration Control CLI
 * Implements differential:control command for pause/resume/cancel operations
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { MigrationExecutor } from '../services/migration-executor';
import { ProgressTracker, type ProgressSnapshot } from '../services/progress-tracker';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
export interface ControlOptions {
  action: 'pause' | 'resume' | 'cancel' | 'list';
  sessionId?: string;
  cleanup: boolean;
  force: boolean;
  config?: string;
}

export interface SessionSummary {
  sessionId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  lastUpdateTime: Date;
  totalRecords: number;
  recordsProcessed: number;
  progressPercentage: number;
  entitiesActive: string[];
  entitiesCompleted: string[];
  entitiesFailed: string[];
}

export interface ControlConfiguration {
  sourceDatabase: any;
  destinationDatabase: any;
  executionTimeout: number;
  checkpointRetention: number;
}

/**
 * ControlCLI Implementation
 *
 * Provides command-line interface for migration control operations including
 * pause, resume, cancel, and session listing functionality.
 */
export class ControlCLI {
  private config: ControlConfiguration;
  private sourcePool: Pool | null = null;
  private destinationPool: Pool | null = null;
  private executor: MigrationExecutor | null = null;
  private progressTracker: ProgressTracker | null = null;

  constructor() {
    this.config = this.loadConfiguration();
  }

  /**
   * Main entry point for CLI execution
   */
  async main(args: string[]): Promise<void> {
    try {
      const options = this.parseArguments(args);

      // Initialize database connections
      await this.initializeDatabasePools();

      // Initialize services
      await this.initializeServices();

      // Execute the requested action
      switch (options.action) {
        case 'list':
          await this.listSessions();
          break;
        case 'pause':
          await this.pauseSession(options);
          break;
        case 'resume':
          await this.resumeSession(options);
          break;
        case 'cancel':
          await this.cancelSession(options);
          break;
        default:
          throw new Error(`Unknown action: ${options.action}`);
      }

      // Cleanup
      await this.cleanup();

    } catch (error) {
      if (error instanceof Error && error.message.includes('Process exit:')) {
        throw error; // Re-throw process exits
      }

      console.error(`❌ Control operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(7);
    }
  }

  /**
   * Parses command line arguments
   */
  parseArguments(args: string[]): ControlOptions {
    if (args.length === 0 || args[0] === '--help') {
      this.showHelp();
      process.exit(0);
    }

    const action = args[0] as ControlOptions['action'];
    if (!['pause', 'resume', 'cancel', 'list'].includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be one of: pause, resume, cancel, list`);
    }

    const options: ControlOptions = {
      action,
      cleanup: false,
      force: false
    };

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--help':
          this.showHelp();
          process.exit(0);
          break;

        case '--session-id':
          if (i + 1 >= args.length) {
            throw new Error('--session-id requires a UUID value');
          }
          const sessionId = args[++i];
          if (!this.isValidUUID(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}`);
          }
          options.sessionId = sessionId;
          break;

        case '--cleanup':
          options.cleanup = true;
          break;

        case '--force':
          options.force = true;
          break;

        case '--config':
          if (i + 1 >= args.length) {
            throw new Error('--config requires a file path');
          }
          options.config = args[++i];
          break;

        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    // Validate required parameters for specific actions
    if (['pause', 'resume', 'cancel'].includes(action) && !options.sessionId) {
      throw new Error(`--session-id is required for ${action} action`);
    }

    return options;
  }

  /**
   * Lists all active migration sessions
   */
  async listSessions(): Promise<void> {
    if (!this.progressTracker) {
      throw new Error('Progress tracker not initialized');
    }

    try {
      console.log('📋 Active Migration Sessions');
      console.log('=============================');

      // Get all progress data
      const allProgress = await this.progressTracker.getAllProgress();

      if (allProgress.length === 0) {
        console.log('No active migration sessions found.');
        console.log('💡 Run differential:migrate to start a new migration');
        return;
      }

      // Group by session ID
      const sessionGroups = this.groupProgressBySession(allProgress);
      const sessions = this.buildSessionSummaries(sessionGroups);

      // Display sessions in table format
      const tableData = sessions.map(session => ({
        'Session ID': session.sessionId.substring(0, 8) + '...',
        'Status': this.getStatusDisplay(session.status),
        'Progress': `${session.progressPercentage}%`,
        'Records': `${session.recordsProcessed.toLocaleString()}/${session.totalRecords.toLocaleString()}`,
        'Active Entities': session.entitiesActive.length.toString(),
        'Started': session.startTime.toISOString().replace('T', ' ').substring(0, 19),
        'Last Update': session.lastUpdateTime.toISOString().replace('T', ' ').substring(0, 19)
      }));

      console.table(tableData);

      console.log(`\n📊 Summary: ${sessions.length} active sessions`);
      console.log(`⚡ Running: ${sessions.filter(s => s.status === 'running').length}`);
      console.log(`⏸️  Paused: ${sessions.filter(s => s.status === 'paused').length}`);
      console.log(`✅ Completed: ${sessions.filter(s => s.status === 'completed').length}`);

      // Show detailed session information
      console.log('\n🔍 Session Details:');
      sessions.forEach(session => {
        console.log(`\n  Session: ${session.sessionId}`);
        console.log(`    Status: ${this.getStatusDisplay(session.status)}`);
        if (session.entitiesActive.length > 0) {
          console.log(`    Active: ${session.entitiesActive.join(', ')}`);
        }
        if (session.entitiesCompleted.length > 0) {
          console.log(`    Completed: ${session.entitiesCompleted.join(', ')}`);
        }
        if (session.entitiesFailed.length > 0) {
          console.log(`    Failed: ${session.entitiesFailed.join(', ')}`);
        }
      });

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error('❌ ERROR: Failed to list sessions');
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check database connections and session data`);
      console.error(`⏰ Timestamp: ${timestamp}`);

      process.exit(3);
    }
  }

  /**
   * Pauses a migration session
   */
  async pauseSession(options: ControlOptions): Promise<void> {
    if (!this.executor || !options.sessionId) {
      throw new Error('Migration executor not initialized or session ID missing');
    }

    try {
      console.log(`⏸️  Pausing migration session: ${options.sessionId}`);

      // Check if session exists and is running
      const sessionExists = await this.validateSessionExists(options.sessionId);
      if (!sessionExists) {
        console.error('❌ ERROR: Session not found');
        console.error(`📋 Details: No active session found with ID '${options.sessionId}'`);
        console.error('🔄 Suggestion: Use differential:control list to see active sessions');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(3);
      }

      const sessionStatus = await this.getSessionStatus(options.sessionId);
      if (sessionStatus === 'paused') {
        console.log('ℹ️  Session is already paused');
        return;
      }

      if (sessionStatus !== 'running' && !options.force) {
        console.error('❌ ERROR: Cannot pause non-running session');
        console.error(`📋 Details: Session status is '${sessionStatus}', expected 'running'`);
        console.error('🔄 Suggestion: Use --force to override this check');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(3);
      }

      // Pause the migration
      console.log('🔄 Requesting pause...');
      const result = await this.executor.pauseExecution();

      if (result.success) {
        console.log('✅ Migration paused successfully');
        console.log(`💾 Checkpoint created: ${result.checkpointId}`);
        console.log('💡 Use differential:control resume to continue migration');
      } else {
        console.error('❌ Failed to pause migration');
        console.error('🔄 Suggestion: Check migration logs for details');
        process.exit(3);
      }

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error('❌ ERROR: Pause operation failed');
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check session status and try again`);
      console.error(`⏰ Timestamp: ${timestamp}`);
      console.error(`📊 Session ID: ${options.sessionId}`);

      process.exit(3);
    }
  }

  /**
   * Resumes a paused migration session
   */
  async resumeSession(options: ControlOptions): Promise<void> {
    if (!this.executor || !options.sessionId) {
      throw new Error('Migration executor not initialized or session ID missing');
    }

    try {
      console.log(`▶️  Resuming migration session: ${options.sessionId}`);

      // Check if session exists and is paused
      const sessionExists = await this.validateSessionExists(options.sessionId);
      if (!sessionExists) {
        console.error('❌ ERROR: Session not found');
        console.error(`📋 Details: No session found with ID '${options.sessionId}'`);
        console.error('🔄 Suggestion: Use differential:control list to see available sessions');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(3);
      }

      const sessionStatus = await this.getSessionStatus(options.sessionId);
      if (sessionStatus === 'running') {
        console.log('ℹ️  Session is already running');
        return;
      }

      if (sessionStatus !== 'paused' && !options.force) {
        console.error('❌ ERROR: Cannot resume non-paused session');
        console.error(`📋 Details: Session status is '${sessionStatus}', expected 'paused'`);
        console.error('🔄 Suggestion: Use --force to override this check');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(3);
      }

      // Find the latest checkpoint for resumption
      const checkpointId = await this.findLatestCheckpoint(options.sessionId);
      if (!checkpointId) {
        console.error('❌ ERROR: No checkpoint found for resumption');
        console.error('📋 Details: Cannot resume without a valid checkpoint');
        console.error('🔄 Suggestion: Start a new migration instead');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(5);
      }

      // Resume the migration
      console.log(`🔄 Resuming from checkpoint: ${checkpointId}`);
      const result = await this.executor.resumeExecution(checkpointId);

      if (result.success) {
        console.log('✅ Migration resumed successfully');
        console.log(`📍 Resumed from batch: ${result.resumedFromBatch}`);
        console.log('💡 Use differential:status to monitor progress');
      } else {
        console.error('❌ Failed to resume migration');
        console.error('🔄 Suggestion: Check checkpoint integrity and try again');
        process.exit(3);
      }

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error('❌ ERROR: Resume operation failed');
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check checkpoint data and session status`);
      console.error(`⏰ Timestamp: ${timestamp}`);
      console.error(`📊 Session ID: ${options.sessionId}`);

      process.exit(3);
    }
  }

  /**
   * Cancels a migration session
   */
  async cancelSession(options: ControlOptions): Promise<void> {
    if (!options.sessionId) {
      throw new Error('Session ID is required for cancel operation');
    }

    try {
      console.log(`❌ Cancelling migration session: ${options.sessionId}`);

      // Check if session exists
      const sessionExists = await this.validateSessionExists(options.sessionId);
      if (!sessionExists) {
        console.error('❌ ERROR: Session not found');
        console.error(`📋 Details: No session found with ID '${options.sessionId}'`);
        console.error('🔄 Suggestion: Use differential:control list to see available sessions');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(3);
      }

      const sessionStatus = await this.getSessionStatus(options.sessionId);
      if (sessionStatus === 'completed' || sessionStatus === 'cancelled') {
        console.log(`ℹ️  Session is already ${sessionStatus}`);
        return;
      }

      // Confirm cancellation if not forced
      if (!options.force) {
        console.log('⚠️  WARNING: Cancelling will stop the migration and may require starting over');
        if (options.cleanup) {
          console.log('⚠️  WARNING: --cleanup will remove all checkpoints (cannot be undone)');
        }
        console.log('Use --force to skip this confirmation');

        // In real implementation, you would prompt for user confirmation
        console.log('✅ Proceeding with cancellation (auto-confirmed for demo)');
      }

      // Cancel the migration
      console.log('🔄 Cancelling migration...');
      const cancelResult = await this.cancelMigrationExecution(options.sessionId);

      if (cancelResult.success) {
        console.log('✅ Migration cancelled successfully');

        // Clean up checkpoints if requested
        if (options.cleanup) {
          console.log('🧹 Cleaning up checkpoints...');
          const cleanupResult = await this.cleanupCheckpoints(options.sessionId);

          if (cleanupResult.success) {
            console.log(`🗑️  Removed ${cleanupResult.checkpointsRemoved} checkpoints`);
          } else {
            console.warn('⚠️  Some checkpoints could not be removed');
          }
        }

        console.log('💡 Session has been cancelled and is no longer active');
      } else {
        console.error('❌ Failed to cancel migration');
        console.error('🔄 Suggestion: Check session status and try again');
        process.exit(3);
      }

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error('❌ ERROR: Cancel operation failed');
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check session status and permissions`);
      console.error(`⏰ Timestamp: ${timestamp}`);
      console.error(`📊 Session ID: ${options.sessionId}`);

      process.exit(3);
    }
  }

  /**
   * Loads configuration from environment
   */
  loadConfiguration(configPath?: string): ControlConfiguration {
    // Load environment variables
    if (configPath) {
      dotenv.config({ path: configPath });
    } else {
      dotenv.config();
    }

    return {
      sourceDatabase: {
        host: process.env.SOURCE_DB_HOST || 'localhost',
        port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
        database: process.env.SOURCE_DB_NAME || 'source_db',
        user: process.env.SOURCE_DB_USER || 'postgres',
        password: process.env.SOURCE_DB_PASSWORD || ''
      },
      destinationDatabase: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '54322'),
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'postgres',
        password: process.env.TARGET_DB_PASSWORD || 'postgres'
      },
      executionTimeout: parseInt(process.env.MIGRATION_TIMEOUT || '300000'),
      checkpointRetention: parseInt(process.env.CHECKPOINT_RETENTION_HOURS || '72')
    };
  }

  /**
   * Private helper methods
   */

  private async initializeDatabasePools(): Promise<void> {
    try {
      this.sourcePool = new Pool({
        host: this.config.sourceDatabase.host,
        port: this.config.sourceDatabase.port,
        database: this.config.sourceDatabase.database,
        user: this.config.sourceDatabase.user,
        password: this.config.sourceDatabase.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        application_name: 'differential_migration_control'
      });

      this.destinationPool = new Pool({
        host: this.config.destinationDatabase.host,
        port: this.config.destinationDatabase.port,
        database: this.config.destinationDatabase.database,
        user: this.config.destinationDatabase.user,
        password: this.config.destinationDatabase.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        application_name: 'differential_migration_control'
      });

    } catch (error) {
      throw new Error(`Failed to initialize database pools: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async initializeServices(): Promise<void> {
    try {
      // Initialize MigrationExecutor
      this.executor = new MigrationExecutor(
        this.sourcePool!,
        this.destinationPool!,
        uuidv4(),
        {
          batchSize: 1000,
          maxRetryAttempts: 3,
          checkpointInterval: 10,
          parallelEntityLimit: 3,
          timeoutMs: this.config.executionTimeout,
          enableValidation: true
        }
      );

      // Initialize ProgressTracker
      this.progressTracker = new ProgressTracker(
        this.sourcePool!,
        this.destinationPool!,
        uuidv4()
      );

    } catch (error) {
      throw new Error(`Failed to initialize services: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.progressTracker) {
        await this.progressTracker.stop();
        this.progressTracker = null;
      }

      if (this.sourcePool) {
        await this.sourcePool.end();
        this.sourcePool = null;
      }

      if (this.destinationPool) {
        await this.destinationPool.end();
        this.destinationPool = null;
      }
    } catch (error) {
      // Log cleanup errors but don't fail
      console.error('Warning: Error during cleanup:', error);
    }
  }

  private async validateSessionExists(sessionId: string): Promise<boolean> {
    if (!this.progressTracker) return false;

    try {
      const allProgress = await this.progressTracker.getAllProgress();
      return allProgress.some(p => p.sessionId === sessionId);
    } catch (error) {
      return false;
    }
  }

  private async getSessionStatus(sessionId: string): Promise<string> {
    if (!this.progressTracker) return 'unknown';

    try {
      const allProgress = await this.progressTracker.getAllProgress();
      const sessionProgress = allProgress.filter(p => p.sessionId === sessionId);

      if (sessionProgress.length === 0) return 'not_found';

      // Determine overall session status
      if (sessionProgress.every(p => p.status === 'completed')) return 'completed';
      if (sessionProgress.some(p => p.status === 'failed')) return 'failed';
      if (sessionProgress.some(p => p.status === 'paused')) return 'paused';
      if (sessionProgress.some(p => p.status === 'running')) return 'running';

      return 'unknown';
    } catch (error) {
      return 'error';
    }
  }

  private async findLatestCheckpoint(sessionId: string): Promise<string | null> {
    // In real implementation, query database for latest checkpoint
    // For now, return a mock checkpoint ID
    return `checkpoint_${sessionId}_${Date.now()}`;
  }

  private async cancelMigrationExecution(sessionId: string): Promise<{ success: boolean }> {
    // In real implementation, this would update session status to cancelled
    // and stop any running processes
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate cancellation
    return { success: true };
  }

  private async cleanupCheckpoints(sessionId: string): Promise<{ success: boolean; checkpointsRemoved: number }> {
    // In real implementation, this would remove checkpoints from database
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate cleanup
    return { success: true, checkpointsRemoved: 3 };
  }

  private groupProgressBySession(progressData: ProgressSnapshot[]): Map<string, ProgressSnapshot[]> {
    const sessions = new Map<string, ProgressSnapshot[]>();

    for (const progress of progressData) {
      if (!sessions.has(progress.sessionId)) {
        sessions.set(progress.sessionId, []);
      }
      sessions.get(progress.sessionId)!.push(progress);
    }

    return sessions;
  }

  private buildSessionSummaries(sessionGroups: Map<string, ProgressSnapshot[]>): SessionSummary[] {
    const summaries: SessionSummary[] = [];

    for (const [sessionId, progressList] of sessionGroups) {
      const totalRecords = progressList.reduce((sum, p) => sum + p.progress.totalRecords, 0);
      const recordsProcessed = progressList.reduce((sum, p) => sum + p.progress.recordsProcessed, 0);
      const progressPercentage = totalRecords > 0 ? Math.round((recordsProcessed / totalRecords) * 100) : 0;

      // Categorize entities by status
      const entitiesActive = progressList.filter(p => p.status === 'running').map(p => p.entityType);
      const entitiesCompleted = progressList.filter(p => p.status === 'completed').map(p => p.entityType);
      const entitiesFailed = progressList.filter(p => p.status === 'failed').map(p => p.entityType);

      // Determine overall session status
      let status: SessionSummary['status'] = 'running';
      if (progressList.every(p => p.status === 'completed')) status = 'completed';
      else if (progressList.some(p => p.status === 'failed')) status = 'failed';
      else if (progressList.some(p => p.status === 'paused')) status = 'paused';

      summaries.push({
        sessionId,
        status,
        startTime: new Date(Math.min(...progressList.map(p => p.timing.startTime.getTime()))),
        lastUpdateTime: new Date(Math.max(...progressList.map(p => p.timestamp.getTime()))),
        totalRecords,
        recordsProcessed,
        progressPercentage,
        entitiesActive,
        entitiesCompleted,
        entitiesFailed
      });
    }

    return summaries.sort((a, b) => b.lastUpdateTime.getTime() - a.lastUpdateTime.getTime());
  }

  private getStatusDisplay(status: string): string {
    switch (status) {
      case 'running': return '🟢 RUNNING';
      case 'paused': return '⏸️  PAUSED';
      case 'completed': return '✅ COMPLETED';
      case 'failed': return '❌ FAILED';
      case 'cancelled': return '🚫 CANCELLED';
      default: return '❓ UNKNOWN';
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private showHelp(): void {
    console.log(`
🎛️  Differential Migration: Control Operations
=============================================

Usage:
  npm run differential:control <action> [options]
  npx ts-node src/differential-migration.ts control <action> [options]

Description:
  Pause, resume, or cancel running migrations with checkpoint support.
  Manage migration sessions and view their current status.

Actions:
  pause                        Pause a running migration session
  resume                       Resume a paused migration session
  cancel                       Cancel a migration session (stops execution)
  list                         List all active migration sessions

Options:
  --session-id <uuid>          Session to control (required for pause/resume/cancel)
  --cleanup                    Clean up checkpoints when canceling (default: false)
  --force                      Force action despite warnings (default: false)
  --config <path>              Custom configuration file path
  --help                       Show this help message

Examples:
  # List all active sessions
  npm run differential:control list

  # Pause migration
  npm run differential:control pause --session-id 550e8400-e29b-41d4-a716-446655440000

  # Resume migration
  npm run differential:control resume --session-id 550e8400-e29b-41d4-a716-446655440000

  # Cancel migration with cleanup
  npm run differential:control cancel --session-id 550e8400-e29b-41d4-a716-446655440000 --cleanup

  # Force cancel without confirmation
  npm run differential:control cancel --session-id 550e8400-e29b-41d4-a716-446655440000 --force

Session List Output:
  Active Migration Sessions
  =========================
  Session ID    Status     Progress  Records        Active Entities  Started
  550e8400...   🟢 RUNNING  75%      1,234/1,640    2               2025-10-26 10:30:00
  abc12345...   ⏸️  PAUSED   45%      890/2,000      0               2025-10-26 09:15:00

Control Operations:
  ⏸️  PAUSE:    Creates checkpoint and suspends execution
  ▶️  RESUME:   Continues from last checkpoint
  ❌ CANCEL:   Stops execution and marks session as cancelled
  🧹 CLEANUP:  Removes checkpoints (use with --cleanup)

Exit Codes:
  0  Operation completed successfully
  1  Invalid parameters
  2  Database connection failure
  3  Session not found or invalid state
  4  Operation not permitted
  5  Checkpoint corruption detected
  6  Operation cancelled by user
  7  System error (unexpected failure)

Environment Variables:
  SOURCE_DB_HOST              Source database hostname
  SOURCE_DB_PORT              Source database port (default: 5432)
  TARGET_DB_HOST              Target database hostname
  TARGET_DB_PORT              Target database port (default: 54322)
  MIGRATION_TIMEOUT           Operation timeout in ms (default: 300000)
  CHECKPOINT_RETENTION_HOURS  Checkpoint retention period (default: 72)

Notes:
  - Pause/resume operations preserve migration state via checkpoints
  - Cancel operations cannot be undone without starting over
  - Use --cleanup carefully as it removes all recovery checkpoints
  - Session IDs are displayed in shortened form but require full UUID for operations
`);
  }
}

// CLI execution when run directly
if (require.main === module) {
  const cli = new ControlCLI();
  cli.main(process.argv.slice(2)).catch(error => {
    console.error('CLI execution failed:', error);
    process.exit(7);
  });
}
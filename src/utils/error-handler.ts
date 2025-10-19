/**
 * T007: Error handling system
 * Standardized error handling and recovery for migrations
 */

import {
  MigrationErrorHandler,
  MigrationContext,
  ErrorHandlingResult,
  ErrorRecovery
} from '../interfaces/migration-types';

export class StandardErrorHandler implements MigrationErrorHandler {
  /**
   * Handle migration error with context
   */
  async handleError(error: Error, context: MigrationContext): Promise<ErrorHandlingResult> {
    const errorType = this.classifyError(error);
    const isRecoverable = this.isRecoverable(error, context);

    console.error(`❌ Error in ${context.serviceName} (${context.operationPhase}):`);
    console.error(`   Table: ${context.tableName}, Batch: ${context.batchNumber}, Record: ${context.recordNumber}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Type: ${errorType}, Recoverable: ${isRecoverable}`);

    switch (errorType) {
      case 'CONNECTION':
        return {
          canContinue: false,
          shouldRetry: true,
          recoveryAction: 'Retry database connection',
          abortMigration: false,
          userNotificationRequired: true
        };

      case 'FOREIGN_KEY':
        return {
          canContinue: true,
          shouldRetry: false,
          skipCurrentRecord: true,
          recoveryAction: 'Skip record with missing foreign key reference'
        };

      case 'DUPLICATE_KEY':
        return {
          canContinue: true,
          shouldRetry: false,
          skipCurrentRecord: true,
          recoveryAction: 'Skip duplicate record (already exists in target)'
        };

      case 'DATA_TYPE':
        return {
          canContinue: true,
          shouldRetry: false,
          skipCurrentRecord: true,
          recoveryAction: 'Skip record with data type mismatch'
        };

      case 'TIMEOUT':
        return {
          canContinue: false,
          shouldRetry: true,
          recoveryAction: 'Retry with smaller batch size',
          userNotificationRequired: true
        };

      case 'MEMORY':
        return {
          canContinue: false,
          shouldRetry: true,
          recoveryAction: 'Reduce batch size and retry',
          userNotificationRequired: true
        };

      case 'DISK_SPACE':
        return {
          canContinue: false,
          shouldRetry: false,
          abortMigration: true,
          recoveryAction: 'Free up disk space and restart migration',
          userNotificationRequired: true
        };

      case 'PERMISSION':
        return {
          canContinue: false,
          shouldRetry: false,
          abortMigration: true,
          recoveryAction: 'Check database permissions and credentials',
          userNotificationRequired: true
        };

      default:
        return {
          canContinue: false,
          shouldRetry: true,
          recoveryAction: 'Unknown error - manual intervention required',
          userNotificationRequired: true
        };
    }
  }

  /**
   * Determine if error is recoverable
   */
  isRecoverable(error: Error, context: MigrationContext): boolean {
    const errorType = this.classifyError(error);

    // Recoverable error types
    const recoverableErrors = [
      'CONNECTION',
      'TIMEOUT',
      'MEMORY',
      'FOREIGN_KEY',
      'DUPLICATE_KEY',
      'DATA_TYPE'
    ];

    return recoverableErrors.includes(errorType);
  }

  /**
   * Generate error recovery plan
   */
  generateRecoveryPlan(error: Error, context: MigrationContext): ErrorRecovery {
    const isRecoverable = this.isRecoverable(error, context);

    if (!isRecoverable) {
      return {
        canRecover: false,
        lastSuccessfulBatch: 0,
        lastSuccessfulRecord: 0,
        resumeFromBatch: 0,
        resumeFromRecord: 0,
        errorContext: {
          error: error.message,
          context,
          timestamp: new Date()
        }
      };
    }

    // For recoverable errors, plan to resume from current or previous batch
    const resumeFromBatch = Math.max(0, context.batchNumber - 1);
    const resumeFromRecord = Math.max(0, context.recordNumber - 1);

    return {
      canRecover: true,
      lastSuccessfulBatch: context.batchNumber - 1,
      lastSuccessfulRecord: context.recordNumber - 1,
      resumeFromBatch,
      resumeFromRecord,
      errorContext: {
        error: error.message,
        context,
        recoverySuggestion: this.getRecoverySuggestion(error),
        timestamp: new Date()
      }
    };
  }

  /**
   * Classify error type for appropriate handling
   */
  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('econnrefused') || message.includes('connection') || message.includes('timeout')) {
      return 'CONNECTION';
    }
    if (message.includes('foreign key') || message.includes('violates foreign key')) {
      return 'FOREIGN_KEY';
    }
    if (message.includes('duplicate key') || message.includes('unique constraint')) {
      return 'DUPLICATE_KEY';
    }
    if (message.includes('invalid input syntax') || message.includes('type') || message.includes('cast')) {
      return 'DATA_TYPE';
    }
    if (message.includes('timeout') || message.includes('statement timeout')) {
      return 'TIMEOUT';
    }
    if (message.includes('out of memory') || message.includes('memory')) {
      return 'MEMORY';
    }
    if (message.includes('no space') || message.includes('disk') || message.includes('storage')) {
      return 'DISK_SPACE';
    }
    if (message.includes('permission') || message.includes('access denied') || message.includes('authentication')) {
      return 'PERMISSION';
    }

    return 'UNKNOWN';
  }

  /**
   * Get recovery suggestion based on error type
   */
  private getRecoverySuggestion(error: Error): string {
    const errorType = this.classifyError(error);

    switch (errorType) {
      case 'CONNECTION':
        return 'Check database server status and network connectivity. Verify credentials.';
      case 'FOREIGN_KEY':
        return 'Ensure prerequisite tables are migrated. Check foreign key relationships.';
      case 'DUPLICATE_KEY':
        return 'This is normal for idempotent migrations. Records already exist in target.';
      case 'DATA_TYPE':
        return 'Check data type compatibility between source and target schemas.';
      case 'TIMEOUT':
        return 'Reduce BATCH_SIZE in .env file and retry. Consider increasing database timeout.';
      case 'MEMORY':
        return 'Reduce BATCH_SIZE to consume less memory during processing.';
      case 'DISK_SPACE':
        return 'Free up disk space on database server and local system.';
      case 'PERMISSION':
        return 'Verify database user has required permissions for read/write operations.';
      default:
        return 'Review error details and logs for specific recovery steps.';
    }
  }

  /**
   * Log error with full context
   */
  static logError(error: Error, context: MigrationContext): void {
    console.error('\n=== MIGRATION ERROR ===');
    console.error(`Service: ${context.serviceName}`);
    console.error(`Table: ${context.tableName}`);
    console.error(`Phase: ${context.operationPhase}`);
    console.error(`Batch: ${context.batchNumber}`);
    console.error(`Record: ${context.recordNumber}`);
    console.error(`Time: ${context.timestamp.toISOString()}`);
    console.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error(`Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    if (context.additionalContext) {
      console.error(`Context: ${JSON.stringify(context.additionalContext, null, 2)}`);
    }
    console.error('=====================\n');
  }
}

// Error type classification
export type ErrorType =
  | 'CONNECTION'
  | 'FOREIGN_KEY'
  | 'DUPLICATE_KEY'
  | 'DATA_TYPE'
  | 'TIMEOUT'
  | 'MEMORY'
  | 'DISK_SPACE'
  | 'PERMISSION'
  | 'UNKNOWN';

// Foreign key validation interface
export interface ForeignKeyCheck {
  foreignKeyField: string;
  referencedTable: string;
  description?: string;
}

// Data integrity check interface
export interface IntegrityCheck {
  query: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: string;
}
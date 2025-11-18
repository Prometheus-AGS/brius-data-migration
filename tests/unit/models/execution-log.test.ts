/**
 * Unit Tests: MigrationExecutionLog Model
 * Tests log entry creation, level validation, context data serialization
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the model interfaces (will be implemented after tests)
type OperationType = 'baseline_analysis' | 'differential_detection' | 'record_migration' | 'validation' | 'checkpoint_save' | 'checkpoint_restore';
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface MigrationExecutionLog {
  id: string;
  migration_session_id: string;
  entity_type: string | null;
  operation_type: OperationType;
  record_id: string | null;
  log_level: LogLevel;
  message: string;
  error_details: object | null;
  performance_data: object | null;
  context_data: object;
  timestamp: Date;
  created_at: Date;
}

interface MigrationExecutionLogCreateInput {
  migration_session_id: string;
  entity_type?: string | null;
  operation_type: OperationType;
  record_id?: string | null;
  log_level?: LogLevel;
  message: string;
  error_details?: object | null;
  performance_data?: object | null;
  context_data?: object;
  timestamp?: Date;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockMigrationExecutionLog {
  static create(input: MigrationExecutionLogCreateInput): MigrationExecutionLog {
    // Basic validation
    if (!input.migration_session_id || !input.operation_type || !input.message) {
      throw new Error('migration_session_id, operation_type, and message are required');
    }

    const now = new Date();

    return {
      id: diffMigrationTestUtils.generateTestUUID(),
      migration_session_id: input.migration_session_id,
      entity_type: input.entity_type || null,
      operation_type: input.operation_type,
      record_id: input.record_id || null,
      log_level: input.log_level || 'info',
      message: input.message,
      error_details: input.error_details || null,
      performance_data: input.performance_data || null,
      context_data: input.context_data || {},
      timestamp: input.timestamp || now,
      created_at: now
    };
  }

  static validate(log: MigrationExecutionLog): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate operation_type
    const validOperationTypes: OperationType[] = [
      'baseline_analysis', 'differential_detection', 'record_migration',
      'validation', 'checkpoint_save', 'checkpoint_restore'
    ];

    if (!validOperationTypes.includes(log.operation_type)) {
      errors.push('Invalid operation_type');
    }

    // Validate log_level
    const validLogLevels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    if (!validLogLevels.includes(log.log_level)) {
      errors.push('Invalid log_level');
    }

    // Validate message is not empty
    if (!log.message || log.message.trim().length === 0) {
      errors.push('Message cannot be empty');
    }

    // Validate timestamp is reasonable (not more than 1 hour in the future)
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (log.timestamp > oneHourFromNow) {
      errors.push('Timestamp cannot be more than 1 hour in the future');
    }

    // Validate entity_type if provided
    if (log.entity_type) {
      const validEntityTypes = [
        'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
        'cases', 'files', 'case_files', 'messages', 'message_files',
        'jaw', 'dispatch_records', 'system_messages', 'message_attachments'
      ];

      if (!validEntityTypes.includes(log.entity_type)) {
        errors.push('Invalid entity_type');
      }
    }

    // Validate error_details structure for error logs
    if (log.log_level === 'error' && log.error_details) {
      if (typeof log.error_details !== 'object') {
        errors.push('error_details must be an object for error logs');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static createInfoLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
      performanceData?: object;
    } = {}
  ): MigrationExecutionLog {
    return MockMigrationExecutionLog.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'info',
      message: message,
      context_data: options.contextData,
      performance_data: options.performanceData
    });
  }

  static createErrorLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    errorDetails: object,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
    } = {}
  ): MigrationExecutionLog {
    return MockMigrationExecutionLog.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'error',
      message: message,
      error_details: errorDetails,
      context_data: options.contextData
    });
  }

  static createWarningLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
    } = {}
  ): MigrationExecutionLog {
    return MockMigrationExecutionLog.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'warn',
      message: message,
      context_data: options.contextData
    });
  }

  static createDebugLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
      performanceData?: object;
    } = {}
  ): MigrationExecutionLog {
    return MockMigrationExecutionLog.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'debug',
      message: message,
      context_data: options.contextData,
      performance_data: options.performanceData
    });
  }

  static filterLogsByLevel(logs: MigrationExecutionLog[], level: LogLevel): MigrationExecutionLog[] {
    return logs.filter(log => log.log_level === level);
  }

  static filterLogsByOperation(logs: MigrationExecutionLog[], operationType: OperationType): MigrationExecutionLog[] {
    return logs.filter(log => log.operation_type === operationType);
  }

  static filterLogsByEntity(logs: MigrationExecutionLog[], entityType: string): MigrationExecutionLog[] {
    return logs.filter(log => log.entity_type === entityType);
  }

  static getLogsSummary(logs: MigrationExecutionLog[]): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byOperation: Record<OperationType, number>;
    errorCount: number;
    warningCount: number;
  } {
    const summary = {
      total: logs.length,
      byLevel: {
        error: 0,
        warn: 0,
        info: 0,
        debug: 0
      } as Record<LogLevel, number>,
      byOperation: {
        baseline_analysis: 0,
        differential_detection: 0,
        record_migration: 0,
        validation: 0,
        checkpoint_save: 0,
        checkpoint_restore: 0
      } as Record<OperationType, number>,
      errorCount: 0,
      warningCount: 0
    };

    logs.forEach(log => {
      summary.byLevel[log.log_level]++;
      summary.byOperation[log.operation_type]++;

      if (log.log_level === 'error') summary.errorCount++;
      if (log.log_level === 'warn') summary.warningCount++;
    });

    return summary;
  }
}

describe('MigrationExecutionLog Model', () => {
  const testSessionId = diffMigrationTestUtils.generateTestUUID();

  describe('Creation and Basic Validation', () => {
    test('should create valid log entry with required fields', () => {
      const input: MigrationExecutionLogCreateInput = {
        migration_session_id: testSessionId,
        operation_type: 'record_migration',
        message: 'Successfully migrated record'
      };

      const log = MockMigrationExecutionLog.create(input);

      expect(log).toBeDefined();
      expect(log.id).toBeDefined();
      expect(log.migration_session_id).toBe(testSessionId);
      expect(log.operation_type).toBe('record_migration');
      expect(log.message).toBe('Successfully migrated record');
      expect(log.entity_type).toBeNull();
      expect(log.record_id).toBeNull();
      expect(log.log_level).toBe('info'); // Default
      expect(log.error_details).toBeNull();
      expect(log.performance_data).toBeNull();
      expect(log.context_data).toEqual({});
      expect(log.timestamp).toBeInstanceOf(Date);
      expect(log.created_at).toBeInstanceOf(Date);
    });

    test('should create log entry with all optional fields', () => {
      const customTimestamp = new Date('2025-10-26T10:00:00Z');
      const errorDetails = { error_code: 'VALIDATION_FAILED', details: 'Invalid data format' };
      const performanceData = { duration_ms: 1500, memory_usage_mb: 45 };
      const contextData = { batch_number: 5, total_records: 1000 };

      const input: MigrationExecutionLogCreateInput = {
        migration_session_id: testSessionId,
        entity_type: 'patients',
        operation_type: 'validation',
        record_id: 'patient-123',
        log_level: 'error',
        message: 'Validation failed for patient record',
        error_details: errorDetails,
        performance_data: performanceData,
        context_data: contextData,
        timestamp: customTimestamp
      };

      const log = MockMigrationExecutionLog.create(input);

      expect(log.entity_type).toBe('patients');
      expect(log.record_id).toBe('patient-123');
      expect(log.log_level).toBe('error');
      expect(log.error_details).toEqual(errorDetails);
      expect(log.performance_data).toEqual(performanceData);
      expect(log.context_data).toEqual(contextData);
      expect(log.timestamp).toEqual(customTimestamp);
    });

    test('should throw error when required fields are missing', () => {
      expect(() => {
        MockMigrationExecutionLog.create({} as MigrationExecutionLogCreateInput);
      }).toThrow('migration_session_id, operation_type, and message are required');

      expect(() => {
        MockMigrationExecutionLog.create({
          migration_session_id: testSessionId
        } as MigrationExecutionLogCreateInput);
      }).toThrow('migration_session_id, operation_type, and message are required');

      expect(() => {
        MockMigrationExecutionLog.create({
          migration_session_id: testSessionId,
          operation_type: 'record_migration'
        } as MigrationExecutionLogCreateInput);
      }).toThrow('migration_session_id, operation_type, and message are required');
    });
  });

  describe('Validation Rules', () => {
    test('should pass validation for valid log entry', () => {
      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        entity_type: 'offices',
        operation_type: 'record_migration',
        record_id: 'office-456',
        log_level: 'info',
        message: 'Successfully migrated office record'
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid operation_type', () => {
      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        operation_type: 'invalid_operation' as OperationType,
        message: 'Test message'
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid operation_type');
    });

    test('should fail validation for invalid log_level', () => {
      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        operation_type: 'record_migration',
        log_level: 'invalid_level' as LogLevel,
        message: 'Test message'
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid log_level');
    });

    test('should fail validation for empty message', () => {
      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        operation_type: 'record_migration',
        message: '   ' // Only whitespace
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Message cannot be empty');
    });

    test('should fail validation for future timestamp', () => {
      const futureTimestamp = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours in future

      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        operation_type: 'record_migration',
        message: 'Test message',
        timestamp: futureTimestamp
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Timestamp cannot be more than 1 hour in the future');
    });

    test('should fail validation for invalid entity_type', () => {
      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        entity_type: 'invalid_entity',
        operation_type: 'record_migration',
        message: 'Test message'
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid entity_type');
    });

    test('should accumulate multiple validation errors', () => {
      const log = MockMigrationExecutionLog.create({
        migration_session_id: testSessionId,
        entity_type: 'invalid_entity',
        operation_type: 'invalid_operation' as OperationType,
        log_level: 'invalid_level' as LogLevel,
        message: ''
      });

      const validation = MockMigrationExecutionLog.validate(log);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(4);
      expect(validation.errors).toContain('Invalid entity_type');
      expect(validation.errors).toContain('Invalid operation_type');
      expect(validation.errors).toContain('Invalid log_level');
      expect(validation.errors).toContain('Message cannot be empty');
    });
  });

  describe('Convenience Creation Methods', () => {
    test('should create info log correctly', () => {
      const log = MockMigrationExecutionLog.createInfoLog(
        testSessionId,
        'baseline_analysis',
        'Baseline analysis completed successfully',
        {
          entityType: 'offices',
          contextData: { analyzed_records: 1000 },
          performanceData: { duration_ms: 2500 }
        }
      );

      expect(log.log_level).toBe('info');
      expect(log.operation_type).toBe('baseline_analysis');
      expect(log.entity_type).toBe('offices');
      expect(log.message).toBe('Baseline analysis completed successfully');
      expect(log.context_data).toEqual({ analyzed_records: 1000 });
      expect(log.performance_data).toEqual({ duration_ms: 2500 });
      expect(log.error_details).toBeNull();
    });

    test('should create error log correctly', () => {
      const errorDetails = {
        error_code: 'DB_CONNECTION_FAILED',
        stack_trace: 'Error at line 42...',
        retry_attempts: 3
      };

      const log = MockMigrationExecutionLog.createErrorLog(
        testSessionId,
        'record_migration',
        'Failed to migrate patient record',
        errorDetails,
        {
          entityType: 'patients',
          recordId: 'patient-789',
          contextData: { batch_position: 15 }
        }
      );

      expect(log.log_level).toBe('error');
      expect(log.operation_type).toBe('record_migration');
      expect(log.entity_type).toBe('patients');
      expect(log.record_id).toBe('patient-789');
      expect(log.message).toBe('Failed to migrate patient record');
      expect(log.error_details).toEqual(errorDetails);
      expect(log.context_data).toEqual({ batch_position: 15 });
    });

    test('should create warning log correctly', () => {
      const log = MockMigrationExecutionLog.createWarningLog(
        testSessionId,
        'validation',
        'Record has missing optional field',
        {
          entityType: 'doctors',
          recordId: 'doctor-456',
          contextData: { missing_field: 'phone', impact: 'low' }
        }
      );

      expect(log.log_level).toBe('warn');
      expect(log.operation_type).toBe('validation');
      expect(log.entity_type).toBe('doctors');
      expect(log.record_id).toBe('doctor-456');
      expect(log.message).toBe('Record has missing optional field');
      expect(log.context_data).toEqual({ missing_field: 'phone', impact: 'low' });
    });

    test('should create debug log correctly', () => {
      const log = MockMigrationExecutionLog.createDebugLog(
        testSessionId,
        'checkpoint_save',
        'Checkpoint saved successfully',
        {
          entityType: 'orders',
          contextData: { checkpoint_id: 'cp-123', batch_size: 500 },
          performanceData: { save_time_ms: 150 }
        }
      );

      expect(log.log_level).toBe('debug');
      expect(log.operation_type).toBe('checkpoint_save');
      expect(log.entity_type).toBe('orders');
      expect(log.message).toBe('Checkpoint saved successfully');
      expect(log.context_data).toEqual({ checkpoint_id: 'cp-123', batch_size: 500 });
      expect(log.performance_data).toEqual({ save_time_ms: 150 });
    });
  });

  describe('Filtering and Analysis Methods', () => {
    let testLogs: MigrationExecutionLog[];

    beforeEach(() => {
      testLogs = [
        MockMigrationExecutionLog.createInfoLog(testSessionId, 'baseline_analysis', 'Analysis started'),
        MockMigrationExecutionLog.createErrorLog(testSessionId, 'record_migration', 'Migration failed', { error: 'connection' }),
        MockMigrationExecutionLog.createWarningLog(testSessionId, 'validation', 'Missing field', { entityType: 'patients' }),
        MockMigrationExecutionLog.createDebugLog(testSessionId, 'checkpoint_save', 'Checkpoint saved'),
        MockMigrationExecutionLog.createInfoLog(testSessionId, 'record_migration', 'Record migrated', { entityType: 'offices' }),
        MockMigrationExecutionLog.createErrorLog(testSessionId, 'validation', 'Validation error', { error: 'format' }, { entityType: 'doctors' })
      ];
    });

    test('should filter logs by level correctly', () => {
      const errorLogs = MockMigrationExecutionLog.filterLogsByLevel(testLogs, 'error');
      const infoLogs = MockMigrationExecutionLog.filterLogsByLevel(testLogs, 'info');
      const debugLogs = MockMigrationExecutionLog.filterLogsByLevel(testLogs, 'debug');

      expect(errorLogs).toHaveLength(2);
      expect(infoLogs).toHaveLength(2);
      expect(debugLogs).toHaveLength(1);

      expect(errorLogs.every(log => log.log_level === 'error')).toBe(true);
      expect(infoLogs.every(log => log.log_level === 'info')).toBe(true);
    });

    test('should filter logs by operation type correctly', () => {
      const migrationLogs = MockMigrationExecutionLog.filterLogsByOperation(testLogs, 'record_migration');
      const validationLogs = MockMigrationExecutionLog.filterLogsByOperation(testLogs, 'validation');
      const checkpointLogs = MockMigrationExecutionLog.filterLogsByOperation(testLogs, 'checkpoint_save');

      expect(migrationLogs).toHaveLength(2);
      expect(validationLogs).toHaveLength(2);
      expect(checkpointLogs).toHaveLength(1);

      expect(migrationLogs.every(log => log.operation_type === 'record_migration')).toBe(true);
    });

    test('should filter logs by entity type correctly', () => {
      const patientLogs = MockMigrationExecutionLog.filterLogsByEntity(testLogs, 'patients');
      const officeLogs = MockMigrationExecutionLog.filterLogsByEntity(testLogs, 'offices');
      const doctorLogs = MockMigrationExecutionLog.filterLogsByEntity(testLogs, 'doctors');

      expect(patientLogs).toHaveLength(1);
      expect(officeLogs).toHaveLength(1);
      expect(doctorLogs).toHaveLength(1);

      expect(patientLogs[0].entity_type).toBe('patients');
      expect(officeLogs[0].entity_type).toBe('offices');
      expect(doctorLogs[0].entity_type).toBe('doctors');
    });

    test('should generate logs summary correctly', () => {
      const summary = MockMigrationExecutionLog.getLogsSummary(testLogs);

      expect(summary.total).toBe(6);
      expect(summary.errorCount).toBe(2);
      expect(summary.warningCount).toBe(1);

      expect(summary.byLevel).toEqual({
        error: 2,
        warn: 1,
        info: 2,
        debug: 1
      });

      expect(summary.byOperation).toEqual({
        baseline_analysis: 1,
        differential_detection: 0,
        record_migration: 2,
        validation: 2,
        checkpoint_save: 1,
        checkpoint_restore: 0
      });
    });
  });

  describe('Real-world Logging Scenarios', () => {
    test('should handle batch processing log scenario', () => {
      const batchLogs = [
        MockMigrationExecutionLog.createInfoLog(
          testSessionId,
          'record_migration',
          'Starting batch migration',
          {
            entityType: 'offices',
            contextData: { batch_number: 1, batch_size: 100, total_batches: 10 }
          }
        ),
        MockMigrationExecutionLog.createDebugLog(
          testSessionId,
          'record_migration',
          'Processing record',
          {
            entityType: 'offices',
            recordId: 'office-001',
            contextData: { record_position: 1 },
            performanceData: { processing_time_ms: 45 }
          }
        ),
        MockMigrationExecutionLog.createWarningLog(
          testSessionId,
          'validation',
          'Record missing optional email field',
          {
            entityType: 'offices',
            recordId: 'office-002',
            contextData: { validation_rule: 'email_format', impact: 'low' }
          }
        ),
        MockMigrationExecutionLog.createInfoLog(
          testSessionId,
          'record_migration',
          'Batch completed successfully',
          {
            entityType: 'offices',
            contextData: { batch_number: 1, records_processed: 100, records_failed: 0 },
            performanceData: { batch_duration_ms: 4500, throughput_per_sec: 22.2 }
          }
        )
      ];

      // Validate all logs
      batchLogs.forEach(log => {
        const validation = MockMigrationExecutionLog.validate(log);
        expect(validation.isValid).toBe(true);
      });

      // Analyze the batch
      const summary = MockMigrationExecutionLog.getLogsSummary(batchLogs);
      expect(summary.total).toBe(4);
      expect(summary.errorCount).toBe(0);
      expect(summary.warningCount).toBe(1);
      expect(summary.byOperation.record_migration).toBe(2);
      expect(summary.byOperation.validation).toBe(1);
    });

    test('should handle error recovery log scenario', () => {
      const recoveryLogs = [
        MockMigrationExecutionLog.createErrorLog(
          testSessionId,
          'record_migration',
          'Database connection lost during migration',
          {
            error_code: 'CONNECTION_LOST',
            original_error: 'ECONNRESET',
            affected_records: 50
          },
          {
            entityType: 'patients',
            contextData: { batch_number: 5, connection_pool: 'source_db' }
          }
        ),
        MockMigrationExecutionLog.createInfoLog(
          testSessionId,
          'checkpoint_save',
          'Checkpoint saved before retry',
          {
            entityType: 'patients',
            contextData: { checkpoint_id: 'cp-recovery-001', records_processed: 450 }
          }
        ),
        MockMigrationExecutionLog.createInfoLog(
          testSessionId,
          'record_migration',
          'Retrying migration from checkpoint',
          {
            entityType: 'patients',
            contextData: { retry_attempt: 1, resume_from_record: 451 }
          }
        ),
        MockMigrationExecutionLog.createInfoLog(
          testSessionId,
          'record_migration',
          'Recovery successful, migration resumed',
          {
            entityType: 'patients',
            contextData: { total_records_recovered: 50 },
            performanceData: { recovery_time_ms: 2000 }
          }
        )
      ];

      // Validate recovery scenario
      const summary = MockMigrationExecutionLog.getLogsSummary(recoveryLogs);
      expect(summary.errorCount).toBe(1);
      expect(summary.byOperation.checkpoint_save).toBe(1);
      expect(summary.byOperation.record_migration).toBe(3);

      const errorLog = recoveryLogs[0];
      expect(errorLog.error_details).toHaveProperty('error_code', 'CONNECTION_LOST');
      expect(errorLog.error_details).toHaveProperty('affected_records', 50);
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestLogEntry({
        operation_type: 'differential_detection',
        log_level: 'debug'
      });

      expect(testData.operation_type).toBe('differential_detection');
      expect(testData.log_level).toBe('debug');
      expect(testData.migration_session_id).toBeDefined();
    });
  });
});
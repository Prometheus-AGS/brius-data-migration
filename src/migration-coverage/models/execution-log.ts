/**
 * ExecutionLog Model
 *
 * Audit trail for all migration operations and system events.
 */

import { v4 as uuidv4 } from 'uuid';

export enum OperationType {
  MIGRATE = 'migrate',
  VALIDATE = 'validate',
  ROLLBACK = 'rollback',
  FIX = 'fix'
}

export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug'
}

export interface ExecutionLogData {
  id: string;
  scriptId?: string;
  operationType: OperationType;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: any;
  userId?: string;
}

export class ExecutionLog {
  public readonly id: string;
  public readonly scriptId?: string;
  public readonly operationType: OperationType;
  public readonly timestamp: string;
  public readonly level: LogLevel;
  public readonly message: string;
  public readonly context?: any;
  public readonly userId?: string;

  constructor(data: Partial<ExecutionLogData> & { operationType: OperationType; message: string }) {
    this.id = data.id || uuidv4();
    this.scriptId = data.scriptId;
    this.operationType = data.operationType;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.level = data.level || LogLevel.INFO;
    this.message = data.message;
    this.context = data.context;
    this.userId = data.userId;

    this.validateData();
  }

  private validateData(): void {
    if (!this.message || !this.message.trim()) {
      throw new Error('Log message is required');
    }

    if (isNaN(Date.parse(this.timestamp))) {
      throw new Error('Timestamp must be a valid ISO date string');
    }
  }

  public toJSON(): ExecutionLogData {
    return {
      id: this.id,
      scriptId: this.scriptId,
      operationType: this.operationType,
      timestamp: this.timestamp,
      level: this.level,
      message: this.message,
      context: this.context,
      userId: this.userId
    };
  }

  public static fromDatabaseRow(row: any): ExecutionLog {
    return new ExecutionLog({
      id: row.id,
      scriptId: row.script_id,
      operationType: row.operation_type as OperationType,
      timestamp: row.timestamp,
      level: row.level as LogLevel,
      message: row.message,
      context: row.context ? JSON.parse(row.context) : undefined,
      userId: row.user_id
    });
  }
}
/**
 * Migration Event Publishing System
 *
 * Provides comprehensive event publishing capabilities for the database migration system.
 * Supports real-time progress tracking, error alerting, and performance monitoring
 * with multiple publishing targets and reliable delivery.
 */

import { EventEmitter } from 'events';
import { getLogger, Logger, generateCorrelationId } from './error-handler';
import { getConfig } from './environment-config';
import {
  MigrationStatus,
  EntityStatus,
  ErrorSeverity,
  ErrorCategory
} from '../models/migration-models';

// ===== EVENT TYPES AND SCHEMAS =====

export enum MigrationEventType {
  MIGRATION_STARTED = 'migration_started',
  MIGRATION_PROGRESS = 'migration_progress',
  MIGRATION_COMPLETED = 'migration_completed',
  MIGRATION_FAILED = 'migration_failed',
  MIGRATION_PAUSED = 'migration_paused',

  ENTITY_STARTED = 'entity_started',
  ENTITY_PROGRESS = 'entity_progress',
  ENTITY_COMPLETED = 'entity_completed',
  ENTITY_FAILED = 'entity_failed',

  BATCH_STARTED = 'batch_started',
  BATCH_COMPLETED = 'batch_completed',
  BATCH_FAILED = 'batch_failed',
  BATCH_RETRY = 'batch_retry',

  ERROR_OCCURRED = 'error_occurred',
  ERROR_THRESHOLD_BREACHED = 'error_threshold_breached',
  ERROR_RESOLVED = 'error_resolved',

  PERFORMANCE_MILESTONE = 'performance_milestone',
  PERFORMANCE_ANOMALY = 'performance_anomaly',
  THROUGHPUT_UPDATE = 'throughput_update',

  CHECKPOINT_CREATED = 'checkpoint_created',
  CHECKPOINT_RESTORED = 'checkpoint_restored',

  SCHEMA_OPERATION_STARTED = 'schema_operation_started',
  SCHEMA_OPERATION_COMPLETED = 'schema_operation_completed',
  SCHEMA_OPERATION_FAILED = 'schema_operation_failed',

  VALIDATION_STARTED = 'validation_started',
  VALIDATION_COMPLETED = 'validation_completed',
  VALIDATION_FAILED = 'validation_failed',

  SYSTEM_HEALTH_CHECK = 'system_health_check',
  CIRCUIT_BREAKER_OPENED = 'circuit_breaker_opened',
  CIRCUIT_BREAKER_CLOSED = 'circuit_breaker_closed'
}

export enum EventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export enum EventTarget {
  CONSOLE = 'console',
  FILE = 'file',
  WEBHOOK = 'webhook',
  DATABASE = 'database',
  METRICS = 'metrics'
}

// ===== BASE EVENT INTERFACE =====

export interface BaseEvent {
  event_id: string;
  event_type: MigrationEventType;
  migration_id: string;
  timestamp: Date;
  severity: EventSeverity;
  correlation_id?: string;
  source: string;
  version: string;
  environment: string;
}

// ===== SPECIFIC EVENT INTERFACES =====

export interface MigrationStartedEvent extends BaseEvent {
  event_type: MigrationEventType.MIGRATION_STARTED;
  data: {
    migration_type: string;
    total_entities: number;
    configuration: Record<string, any>;
    created_by: string;
  };
}

export interface MigrationProgressEvent extends BaseEvent {
  event_type: MigrationEventType.MIGRATION_PROGRESS;
  data: {
    progress_percentage: number;
    completed_entities: number;
    total_entities: number;
    current_entity?: string;
    estimated_completion?: Date;
    throughput_records_per_second?: number;
  };
}

export interface MigrationCompletedEvent extends BaseEvent {
  event_type: MigrationEventType.MIGRATION_COMPLETED;
  data: {
    duration_ms: number;
    total_records_processed: number;
    total_records_failed: number;
    success_rate_percentage: number;
    final_status: MigrationStatus;
    summary: Record<string, any>;
  };
}

export interface EntityProgressEvent extends BaseEvent {
  event_type: MigrationEventType.ENTITY_PROGRESS;
  data: {
    entity_name: string;
    target_entity: string;
    status: EntityStatus;
    records_processed: number;
    records_total: number;
    records_failed: number;
    progress_percentage: number;
    throughput_per_second: number;
    current_batch?: number;
    estimated_completion?: Date;
  };
}

export interface BatchProcessingEvent extends BaseEvent {
  event_type: MigrationEventType.BATCH_STARTED | MigrationEventType.BATCH_COMPLETED | MigrationEventType.BATCH_FAILED;
  data: {
    entity_name: string;
    batch_number: number;
    batch_size: number;
    records_successful?: number;
    records_failed?: number;
    processing_duration_ms?: number;
    retry_count?: number;
    error_summary?: string;
  };
}

export interface ErrorEvent extends BaseEvent {
  event_type: MigrationEventType.ERROR_OCCURRED | MigrationEventType.ERROR_THRESHOLD_BREACHED;
  data: {
    entity_name?: string;
    batch_id?: string;
    error_type: string;
    error_code: string;
    error_message: string;
    error_category: ErrorCategory;
    error_severity: ErrorSeverity;
    source_record_id?: string;
    recovery_strategy: string;
    context: Record<string, any>;
  };
}

export interface PerformanceEvent extends BaseEvent {
  event_type: MigrationEventType.PERFORMANCE_MILESTONE | MigrationEventType.PERFORMANCE_ANOMALY | MigrationEventType.THROUGHPUT_UPDATE;
  data: {
    entity_name?: string;
    metric_name: string;
    metric_value: number;
    metric_unit: string;
    baseline_value?: number;
    threshold_value?: number;
    anomaly_type?: 'spike' | 'drop' | 'timeout' | 'memory';
    performance_context: Record<string, any>;
  };
}

export interface CheckpointEvent extends BaseEvent {
  event_type: MigrationEventType.CHECKPOINT_CREATED | MigrationEventType.CHECKPOINT_RESTORED;
  data: {
    entity_name: string;
    checkpoint_id: string;
    checkpoint_type: string;
    batch_number: number;
    records_processed: number;
    is_resumable: boolean;
    system_state_size_bytes?: number;
  };
}

export interface SchemaOperationEvent extends BaseEvent {
  event_type: MigrationEventType.SCHEMA_OPERATION_STARTED | MigrationEventType.SCHEMA_OPERATION_COMPLETED | MigrationEventType.SCHEMA_OPERATION_FAILED;
  data: {
    operation_type: string;
    table_name: string;
    column_name?: string;
    risk_level: string;
    backup_created?: boolean;
    rollback_available?: boolean;
    validation_passed?: boolean;
  };
}

export interface ValidationEvent extends BaseEvent {
  event_type: MigrationEventType.VALIDATION_STARTED | MigrationEventType.VALIDATION_COMPLETED | MigrationEventType.VALIDATION_FAILED;
  data: {
    validation_type: string;
    entity_name?: string;
    records_validated?: number;
    issues_found?: number;
    validation_passed: boolean;
    execution_duration_ms?: number;
    validation_criteria: Record<string, any>;
  };
}

export interface SystemHealthEvent extends BaseEvent {
  event_type: MigrationEventType.SYSTEM_HEALTH_CHECK | MigrationEventType.CIRCUIT_BREAKER_OPENED | MigrationEventType.CIRCUIT_BREAKER_CLOSED;
  data: {
    component_name: string;
    health_status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: Record<string, any>;
    threshold_breached?: string;
    recovery_action?: string;
  };
}

// Union type for all events
export type MigrationEvent =
  | MigrationStartedEvent
  | MigrationProgressEvent
  | MigrationCompletedEvent
  | EntityProgressEvent
  | BatchProcessingEvent
  | ErrorEvent
  | PerformanceEvent
  | CheckpointEvent
  | SchemaOperationEvent
  | ValidationEvent
  | SystemHealthEvent;

// ===== EVENT PUBLISHER CONFIGURATION =====

export interface EventTarget {
  name: string;
  type: 'console' | 'file' | 'webhook' | 'database' | 'metrics';
  enabled: boolean;
  config: Record<string, any>;
  eventFilter?: (event: MigrationEvent) => boolean;
  transformer?: (event: MigrationEvent) => any;
}

export interface EventPublisherConfig {
  enabled: boolean;
  targets: EventTarget[];
  retryAttempts: number;
  retryDelayMs: number;
  bufferSize: number;
  flushIntervalMs: number;
  enableEventHistory: boolean;
  eventHistoryMaxSize: number;
  enableMetrics: boolean;
}

// ===== EVENT PUBLISHER CLASS =====

export class EventPublisher extends EventEmitter {
  private config: EventPublisherConfig;
  private logger: Logger;
  private eventBuffer: MigrationEvent[] = [];
  private eventHistory: MigrationEvent[] = [];
  private flushTimer?: NodeJS.Timeout;
  private metrics: Map<string, number> = new Map();
  private readonly version = '1.0.0';

  constructor(config?: Partial<EventPublisherConfig>) {
    super();
    this.logger = getLogger();

    const appConfig = getConfig();

    this.config = {
      enabled: true,
      targets: [
        {
          name: 'console',
          type: 'console',
          enabled: true,
          config: {},
          eventFilter: (event) => event.severity !== EventSeverity.INFO // Only show warnings and errors
        },
        {
          name: 'file',
          type: 'file',
          enabled: true,
          config: {
            filename: 'migration-events.log',
            directory: appConfig.logging.logDirectory
          }
        }
      ],
      retryAttempts: 3,
      retryDelayMs: 1000,
      bufferSize: 100,
      flushIntervalMs: 5000, // 5 seconds
      enableEventHistory: true,
      eventHistoryMaxSize: 1000,
      enableMetrics: true,
      ...config
    };

    this.startPeriodicFlush();
  }

  /**
   * Publish migration event
   */
  async publishEvent(eventType: MigrationEventType, migrationId: string, data: any, options?: {
    severity?: EventSeverity;
    correlationId?: string;
    entityName?: string;
  }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const event = this.createEvent(eventType, migrationId, data, options);

    // Add to history if enabled
    if (this.config.enableEventHistory) {
      this.addToHistory(event);
    }

    // Update metrics
    if (this.config.enableMetrics) {
      this.updateMetrics(event);
    }

    // Add to buffer
    this.eventBuffer.push(event);

    // Emit for local listeners
    this.emit('event', event);
    this.emit(eventType, event);

    // Flush immediately for critical events
    if (event.severity === EventSeverity.CRITICAL || event.severity === EventSeverity.ERROR) {
      await this.flush();
    } else if (this.eventBuffer.length >= this.config.bufferSize) {
      await this.flush();
    }
  }

  /**
   * Publish migration started event
   */
  async publishMigrationStarted(
    migrationId: string,
    migrationType: string,
    totalEntities: number,
    configuration: Record<string, any>,
    createdBy: string,
    correlationId?: string
  ): Promise<void> {
    await this.publishEvent(MigrationEventType.MIGRATION_STARTED, migrationId, {
      migration_type: migrationType,
      total_entities: totalEntities,
      configuration,
      created_by: createdBy
    }, { severity: EventSeverity.INFO, correlationId });
  }

  /**
   * Publish migration progress event
   */
  async publishMigrationProgress(
    migrationId: string,
    progressPercentage: number,
    completedEntities: number,
    totalEntities: number,
    options?: {
      currentEntity?: string;
      estimatedCompletion?: Date;
      throughput?: number;
      correlationId?: string;
    }
  ): Promise<void> {
    await this.publishEvent(MigrationEventType.MIGRATION_PROGRESS, migrationId, {
      progress_percentage: progressPercentage,
      completed_entities: completedEntities,
      total_entities: totalEntities,
      current_entity: options?.currentEntity,
      estimated_completion: options?.estimatedCompletion,
      throughput_records_per_second: options?.throughput
    }, { severity: EventSeverity.INFO, correlationId: options?.correlationId });
  }

  /**
   * Publish entity progress event
   */
  async publishEntityProgress(
    migrationId: string,
    entityName: string,
    targetEntity: string,
    status: EntityStatus,
    recordsProcessed: number,
    recordsTotal: number,
    recordsFailed: number,
    throughputPerSecond: number,
    options?: {
      currentBatch?: number;
      estimatedCompletion?: Date;
      correlationId?: string;
    }
  ): Promise<void> {
    const progressPercentage = recordsTotal > 0 ? Math.round((recordsProcessed / recordsTotal) * 100) : 0;

    await this.publishEvent(MigrationEventType.ENTITY_PROGRESS, migrationId, {
      entity_name: entityName,
      target_entity: targetEntity,
      status,
      records_processed: recordsProcessed,
      records_total: recordsTotal,
      records_failed: recordsFailed,
      progress_percentage: progressPercentage,
      throughput_per_second: throughputPerSecond,
      current_batch: options?.currentBatch,
      estimated_completion: options?.estimatedCompletion
    }, {
      severity: status === EntityStatus.FAILED ? EventSeverity.ERROR : EventSeverity.INFO,
      correlationId: options?.correlationId,
      entityName
    });
  }

  /**
   * Publish error event
   */
  async publishError(
    migrationId: string,
    errorType: string,
    errorCode: string,
    errorMessage: string,
    errorCategory: ErrorCategory,
    errorSeverity: ErrorSeverity,
    options?: {
      entityName?: string;
      batchId?: string;
      sourceRecordId?: string;
      recoveryStrategy?: string;
      context?: Record<string, any>;
      correlationId?: string;
    }
  ): Promise<void> {
    await this.publishEvent(MigrationEventType.ERROR_OCCURRED, migrationId, {
      entity_name: options?.entityName,
      batch_id: options?.batchId,
      error_type: errorType,
      error_code: errorCode,
      error_message: errorMessage,
      error_category: errorCategory,
      error_severity: errorSeverity,
      source_record_id: options?.sourceRecordId,
      recovery_strategy: options?.recoveryStrategy || 'unknown',
      context: options?.context || {}
    }, {
      severity: this.mapErrorSeverity(errorSeverity),
      correlationId: options?.correlationId,
      entityName: options?.entityName
    });
  }

  /**
   * Publish performance milestone
   */
  async publishPerformanceMilestone(
    migrationId: string,
    metricName: string,
    metricValue: number,
    metricUnit: string,
    options?: {
      entityName?: string;
      baselineValue?: number;
      thresholdValue?: number;
      context?: Record<string, any>;
      correlationId?: string;
    }
  ): Promise<void> {
    await this.publishEvent(MigrationEventType.PERFORMANCE_MILESTONE, migrationId, {
      entity_name: options?.entityName,
      metric_name: metricName,
      metric_value: metricValue,
      metric_unit: metricUnit,
      baseline_value: options?.baselineValue,
      threshold_value: options?.thresholdValue,
      performance_context: options?.context || {}
    }, {
      severity: EventSeverity.INFO,
      correlationId: options?.correlationId,
      entityName: options?.entityName
    });
  }

  /**
   * Publish checkpoint event
   */
  async publishCheckpoint(
    migrationId: string,
    eventType: MigrationEventType.CHECKPOINT_CREATED | MigrationEventType.CHECKPOINT_RESTORED,
    entityName: string,
    checkpointId: string,
    checkpointType: string,
    batchNumber: number,
    recordsProcessed: number,
    isResumable: boolean,
    options?: {
      systemStateSizeBytes?: number;
      correlationId?: string;
    }
  ): Promise<void> {
    await this.publishEvent(eventType, migrationId, {
      entity_name: entityName,
      checkpoint_id: checkpointId,
      checkpoint_type: checkpointType,
      batch_number: batchNumber,
      records_processed: recordsProcessed,
      is_resumable: isResumable,
      system_state_size_bytes: options?.systemStateSizeBytes
    }, {
      severity: EventSeverity.INFO,
      correlationId: options?.correlationId,
      entityName
    });
  }

  /**
   * Create structured event
   */
  private createEvent(
    eventType: MigrationEventType,
    migrationId: string,
    data: any,
    options?: {
      severity?: EventSeverity;
      correlationId?: string;
      entityName?: string;
    }
  ): MigrationEvent {
    const config = getConfig();

    return {
      event_id: generateCorrelationId(),
      event_type: eventType,
      migration_id: migrationId,
      timestamp: new Date(),
      severity: options?.severity || EventSeverity.INFO,
      correlation_id: options?.correlationId,
      source: 'migration-system',
      version: this.version,
      environment: config.environment,
      data
    } as MigrationEvent;
  }

  /**
   * Flush buffered events to all targets
   */
  async flush(): Promise<void> {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const eventsToFlush = [...this.eventBuffer];
    this.eventBuffer = [];

    await Promise.allSettled(
      this.config.targets
        .filter(target => target.enabled)
        .map(target => this.publishToTarget(target, eventsToFlush))
    );
  }

  /**
   * Publish events to specific target
   */
  private async publishToTarget(target: EventTarget, events: MigrationEvent[]): Promise<void> {
    try {
      // Apply event filter if configured
      const filteredEvents = target.eventFilter
        ? events.filter(target.eventFilter)
        : events;

      if (filteredEvents.length === 0) {
        return;
      }

      // Apply transformer if configured
      const transformedEvents = target.transformer
        ? filteredEvents.map(target.transformer)
        : filteredEvents;

      await this.publishToTargetWithRetry(target, transformedEvents);

    } catch (error) {
      this.logger.error(`Failed to publish to target ${target.name}`, error, {
        target_name: target.name,
        target_type: target.type,
        event_count: events.length
      });
    }
  }

  /**
   * Publish to target with retry logic
   */
  private async publishToTargetWithRetry(target: EventTarget, events: any[]): Promise<void> {
    let attempt = 1;
    let lastError: Error;

    while (attempt <= this.config.retryAttempts) {
      try {
        await this.executeTargetPublish(target, events);
        return;

      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          attempt++;
        }
      }
    }

    throw lastError!;
  }

  /**
   * Execute actual publishing to target
   */
  private async executeTargetPublish(target: EventTarget, events: any[]): Promise<void> {
    switch (target.type) {
      case 'console':
        await this.publishToConsole(events);
        break;
      case 'file':
        await this.publishToFile(target.config, events);
        break;
      case 'webhook':
        await this.publishToWebhook(target.config, events);
        break;
      case 'database':
        await this.publishToDatabase(target.config, events);
        break;
      case 'metrics':
        await this.publishToMetrics(target.config, events);
        break;
      default:
        throw new Error(`Unknown target type: ${target.type}`);
    }
  }

  /**
   * Publish to console
   */
  private async publishToConsole(events: MigrationEvent[]): Promise<void> {
    events.forEach(event => {
      const message = `🔔 ${event.event_type}: ${event.migration_id}`;
      const details = JSON.stringify(event.data, null, 2);

      switch (event.severity) {
        case EventSeverity.INFO:
          console.info(`${message}\n${details}`);
          break;
        case EventSeverity.WARNING:
          console.warn(`${message}\n${details}`);
          break;
        case EventSeverity.ERROR:
        case EventSeverity.CRITICAL:
          console.error(`${message}\n${details}`);
          break;
      }
    });
  }

  /**
   * Publish to file
   */
  private async publishToFile(config: any, events: MigrationEvent[]): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');

    const directory = config.directory || './logs';
    const filename = config.filename || 'migration-events.log';
    const filepath = path.join(directory, filename);

    // Ensure directory exists
    await fs.mkdir(directory, { recursive: true });

    // Format events as JSONL (one JSON object per line)
    const content = events
      .map(event => JSON.stringify({
        ...event,
        timestamp: event.timestamp.toISOString()
      }))
      .join('\n') + '\n';

    await fs.appendFile(filepath, content);
  }

  /**
   * Publish to webhook
   */
  private async publishToWebhook(config: any, events: MigrationEvent[]): Promise<void> {
    // This would implement HTTP webhook publishing
    // For now, just log that it would happen
    this.logger.debug(`Would publish ${events.length} events to webhook: ${config.url}`);
  }

  /**
   * Publish to database
   */
  private async publishToDatabase(config: any, events: MigrationEvent[]): Promise<void> {
    // This would implement database event storage
    // For now, just log that it would happen
    this.logger.debug(`Would store ${events.length} events in database`);
  }

  /**
   * Publish to metrics system
   */
  private async publishToMetrics(config: any, events: MigrationEvent[]): Promise<void> {
    // This would implement metrics/monitoring system integration
    // For now, just log that it would happen
    this.logger.debug(`Would publish ${events.length} events to metrics system`);
  }

  /**
   * Add event to history
   */
  private addToHistory(event: MigrationEvent): void {
    this.eventHistory.push(event);

    // Trim history if it exceeds max size
    if (this.eventHistory.length > this.config.eventHistoryMaxSize) {
      this.eventHistory = this.eventHistory.slice(-this.config.eventHistoryMaxSize);
    }
  }

  /**
   * Update metrics based on event
   */
  private updateMetrics(event: MigrationEvent): void {
    const eventTypeKey = `events.${event.event_type}`;
    const severityKey = `events.severity.${event.severity}`;

    this.metrics.set(eventTypeKey, (this.metrics.get(eventTypeKey) || 0) + 1);
    this.metrics.set(severityKey, (this.metrics.get(severityKey) || 0) + 1);
    this.metrics.set('events.total', (this.metrics.get('events.total') || 0) + 1);
  }

  /**
   * Map error severity to event severity
   */
  private mapErrorSeverity(errorSeverity: ErrorSeverity): EventSeverity {
    switch (errorSeverity) {
      case ErrorSeverity.LOW:
        return EventSeverity.INFO;
      case ErrorSeverity.MEDIUM:
        return EventSeverity.WARNING;
      case ErrorSeverity.HIGH:
        return EventSeverity.ERROR;
      case ErrorSeverity.CRITICAL:
        return EventSeverity.CRITICAL;
      default:
        return EventSeverity.INFO;
    }
  }

  /**
   * Start periodic flush timer
   */
  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(async () => {
      try {
        await this.flush();
      } catch (error) {
        this.logger.error('Periodic flush failed', error);
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Get event history
   */
  getEventHistory(filter?: {
    eventType?: MigrationEventType;
    migrationId?: string;
    severity?: EventSeverity;
    limit?: number;
  }): MigrationEvent[] {
    let filteredHistory = [...this.eventHistory];

    if (filter?.eventType) {
      filteredHistory = filteredHistory.filter(e => e.event_type === filter.eventType);
    }

    if (filter?.migrationId) {
      filteredHistory = filteredHistory.filter(e => e.migration_id === filter.migrationId);
    }

    if (filter?.severity) {
      filteredHistory = filteredHistory.filter(e => e.severity === filter.severity);
    }

    if (filter?.limit) {
      filteredHistory = filteredHistory.slice(-filter.limit);
    }

    return filteredHistory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get event metrics
   */
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  /**
   * Clear event history and metrics
   */
  clearHistory(): void {
    this.eventHistory = [];
    this.metrics.clear();
  }

  /**
   * Shutdown event publisher
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.flush();
    this.removeAllListeners();
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ===== SINGLETON INSTANCE =====

let globalEventPublisher: EventPublisher | null = null;

/**
 * Get global event publisher instance
 */
export function getEventPublisher(): EventPublisher {
  if (!globalEventPublisher) {
    globalEventPublisher = new EventPublisher();
  }
  return globalEventPublisher;
}

/**
 * Initialize event publisher with specific configuration
 */
export function initializeEventPublisher(config?: Partial<EventPublisherConfig>): EventPublisher {
  globalEventPublisher = new EventPublisher(config);
  return globalEventPublisher;
}

// ===== UTILITY FUNCTIONS =====

/**
 * Create event publisher with custom targets
 */
export function createEventPublisher(targets: EventTarget[]): EventPublisher {
  return new EventPublisher({ targets });
}

/**
 * Create console-only event publisher
 */
export function createConsoleEventPublisher(): EventPublisher {
  return new EventPublisher({
    targets: [{
      name: 'console',
      type: 'console',
      enabled: true,
      config: {}
    }]
  });
}

/**
 * Create file-only event publisher
 */
export function createFileEventPublisher(filename: string, directory?: string): EventPublisher {
  return new EventPublisher({
    targets: [{
      name: 'file',
      type: 'file',
      enabled: true,
      config: { filename, directory }
    }]
  });
}

// ===== EVENT LISTENER HELPERS =====

/**
 * Listen for specific migration events
 */
export function onMigrationEvent(
  eventType: MigrationEventType,
  listener: (event: MigrationEvent) => void
): void {
  getEventPublisher().on(eventType, listener);
}

/**
 * Listen for all migration events
 */
export function onAnyMigrationEvent(listener: (event: MigrationEvent) => void): void {
  getEventPublisher().on('event', listener);
}

/**
 * Listen for error events only
 */
export function onErrorEvents(listener: (event: ErrorEvent) => void): void {
  const publisher = getEventPublisher();

  publisher.on(MigrationEventType.ERROR_OCCURRED, listener);
  publisher.on(MigrationEventType.ERROR_THRESHOLD_BREACHED, listener);
}

/**
 * Listen for progress events only
 */
export function onProgressEvents(listener: (event: MigrationProgressEvent | EntityProgressEvent) => void): void {
  const publisher = getEventPublisher();

  publisher.on(MigrationEventType.MIGRATION_PROGRESS, listener);
  publisher.on(MigrationEventType.ENTITY_PROGRESS, listener);
}
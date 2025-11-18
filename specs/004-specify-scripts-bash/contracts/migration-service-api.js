"use strict";
/**
 * Migration Service API Contract
 * Final Database Migration Phase - Remaining Tables
 *
 * This defines the standardized API that all migration services must implement
 * for consistent execution, monitoring, and reporting.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_PRIORITIES = exports.MIGRATION_ORDER = exports.MIGRATION_CONSTANTS = void 0;
// ===== CONSTANTS =====
/**
 * Standard Configuration Constants
 */
exports.MIGRATION_CONSTANTS = {
    DEFAULT_BATCH_SIZE: 500,
    MAX_BATCH_SIZE: 2000,
    MIN_BATCH_SIZE: 10,
    DEFAULT_TIMEOUT: 300000, // 5 minutes
    MAX_RETRY_ATTEMPTS: 3,
    PROGRESS_UPDATE_INTERVAL: 1000, // 1 second
    LOG_ROTATION_SIZE: 100000000, // 100MB
};
/**
 * Table Migration Order
 * Defines the required order for dependency management
 */
exports.MIGRATION_ORDER = [
    'template_view_groups',
    'template_view_roles',
    'technicians',
    'technician_roles',
    'brackets',
    'treatment_discussions',
    'order_cases',
    'message_attachments',
    'purchases'
];
/**
 * Migration Priorities
 */
exports.MIGRATION_PRIORITIES = {
    CRITICAL: ['message_attachments', 'technicians', 'technician_roles'],
    IMPORTANT: ['brackets', 'order_cases', 'purchases', 'treatment_discussions'],
    OPTIONAL: ['template_view_groups', 'template_view_roles']
};
//# sourceMappingURL=migration-service-api.js.map
/**
 * T002: Shared configuration builder
 * Manages environment-based configuration for all migration scripts
 */

import * as dotenv from 'dotenv';
import { MigrationConfig, ConfigValidationResult, ConfigurationIssue } from '../interfaces/migration-types';

// Load environment variables
dotenv.config();

export class MigrationConfigBuilder {
  /**
   * Build configuration from environment variables
   */
  static buildFromEnv(): MigrationConfig {
    return {
      sourceDb: {
        host: process.env.SOURCE_DB_HOST || 'localhost',
        port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
        database: process.env.SOURCE_DB_NAME || 'source_db',
        user: process.env.SOURCE_DB_USER || 'postgres',
        password: process.env.SOURCE_DB_PASSWORD || ''
      },
      targetDb: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '5432'),
        database: process.env.TARGET_DB_NAME || 'target_db',
        user: process.env.TARGET_DB_USER || 'postgres',
        password: process.env.TARGET_DB_PASSWORD || ''
      },
      batchSize: parseInt(process.env.BATCH_SIZE || '500'),
      testMode: process.env.TEST_MODE === 'true',
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
      migrationTimeout: parseInt(process.env.MIGRATION_TIMEOUT || '300000')
    };
  }

  /**
   * Validate configuration settings
   */
  static validateConfig(config: MigrationConfig): ConfigValidationResult {
    const issues: ConfigurationIssue[] = [];
    const warnings: string[] = [];

    // Validate source database config
    if (!config.sourceDb.host) {
      issues.push({
        setting: 'SOURCE_DB_HOST',
        issue: 'Missing source database host',
        severity: 'error'
      });
    }

    if (!config.sourceDb.password) {
      issues.push({
        setting: 'SOURCE_DB_PASSWORD',
        issue: 'Missing source database password',
        severity: 'error'
      });
    }

    // Validate target database config
    if (!config.targetDb.host) {
      issues.push({
        setting: 'TARGET_DB_HOST',
        issue: 'Missing target database host',
        severity: 'error'
      });
    }

    if (!config.targetDb.password) {
      issues.push({
        setting: 'TARGET_DB_PASSWORD',
        issue: 'Missing target database password',
        severity: 'error'
      });
    }

    // Validate batch size
    if (config.batchSize < 10 || config.batchSize > 2000) {
      issues.push({
        setting: 'BATCH_SIZE',
        issue: `Batch size ${config.batchSize} is outside recommended range (10-2000)`,
        severity: 'warning',
        suggestedValue: '500'
      });
    }

    // Add warnings for development environment
    if (config.testMode) {
      warnings.push('Running in TEST_MODE - only processing limited records');
    }

    if (config.sourceDb.host === config.targetDb.host) {
      warnings.push('Source and target databases are on the same host - ensure different database names');
    }

    return {
      valid: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      warnings
    };
  }

  /**
   * Get default configuration values
   */
  static getDefaults(): Partial<MigrationConfig> {
    return {
      batchSize: 500,
      testMode: false,
      maxRetryAttempts: 3,
      migrationTimeout: 300000 // 5 minutes
    };
  }

  /**
   * Print configuration summary (safe - no passwords)
   */
  static printConfigSummary(config: MigrationConfig): void {
    console.log('Migration Configuration:');
    console.log(`  Source: ${config.sourceDb.host}:${config.sourceDb.port}/${config.sourceDb.database}`);
    console.log(`  Target: ${config.targetDb.host}:${config.targetDb.port}/${config.targetDb.database}`);
    console.log(`  Batch Size: ${config.batchSize}`);
    console.log(`  Test Mode: ${config.testMode}`);
    console.log(`  Max Retries: ${config.maxRetryAttempts}`);
    console.log(`  Timeout: ${config.migrationTimeout}ms`);
  }
}
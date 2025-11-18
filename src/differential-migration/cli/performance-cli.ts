/**
 * Performance Monitoring CLI
 *
 * Provides real-time performance dashboard and optimization controls
 * for differential migration operations
 */

import { PerformanceOptimizationService, type OptimizationSummary } from '../services/performance-optimization-service';
import { PoolConfig } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface PerformanceCliOptions {
  watch?: boolean;
  refresh?: number;
  format?: 'table' | 'json' | 'compact';
  entity?: string;
  history?: number;
  alerts?: boolean;
  recommendations?: boolean;
  health?: boolean;
  optimize?: boolean;
  config?: string;
}

export class PerformanceCLI {
  private performanceService: PerformanceOptimizationService | null = null;
  private sourceDbConfig: PoolConfig;
  private destinationDbConfig: PoolConfig;

  constructor() {
    this.sourceDbConfig = {
      host: process.env.SOURCE_DB_HOST || 'localhost',
      port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
      database: process.env.SOURCE_DB_NAME || 'source_db',
      user: process.env.SOURCE_DB_USER || 'postgres',
      password: process.env.SOURCE_DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };

    this.destinationDbConfig = {
      host: process.env.TARGET_DB_HOST || 'localhost',
      port: parseInt(process.env.TARGET_DB_PORT || '54322'),
      database: process.env.TARGET_DB_NAME || 'target_db',
      user: process.env.TARGET_DB_USER || 'postgres',
      password: process.env.TARGET_DB_PASSWORD || '',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };
  }

  /**
   * Main CLI entry point
   */
  async main(args: string[]): Promise<void> {
    try {
      const options = this.parseArguments(args);

      await this.initializeService();

      if (options.health) {
        await this.showHealthCheck();
      } else if (options.optimize) {
        await this.runOptimization();
      } else if (options.watch) {
        await this.runWatchMode(options);
      } else {
        await this.showPerformanceSnapshot(options);
      }

    } catch (error) {
      console.error('❌ Performance monitoring error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  private parseArguments(args: string[]): PerformanceCliOptions {
    const options: PerformanceCliOptions = {
      format: 'table',
      refresh: 5,
      history: 10
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--help':
          this.showHelp();
          process.exit(0);
          break;

        case '--watch':
          options.watch = true;
          break;

        case '--refresh':
          if (i + 1 >= args.length) throw new Error('--refresh requires a value');
          options.refresh = parseInt(args[++i]);
          if (options.refresh < 1) throw new Error('--refresh must be at least 1 second');
          break;

        case '--format':
          if (i + 1 >= args.length) throw new Error('--format requires a value');
          const format = args[++i];
          if (!['table', 'json', 'compact'].includes(format)) {
            throw new Error('--format must be table, json, or compact');
          }
          options.format = format as 'table' | 'json' | 'compact';
          break;

        case '--entity':
          if (i + 1 >= args.length) throw new Error('--entity requires a value');
          options.entity = args[++i];
          break;

        case '--history':
          if (i + 1 >= args.length) throw new Error('--history requires a value');
          options.history = parseInt(args[++i]);
          break;

        case '--alerts':
          options.alerts = true;
          break;

        case '--recommendations':
          options.recommendations = true;
          break;

        case '--health':
          options.health = true;
          break;

        case '--optimize':
          options.optimize = true;
          break;

        case '--config':
          if (i + 1 >= args.length) throw new Error('--config requires a file path');
          options.config = args[++i];
          break;

        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    return options;
  }

  private async initializeService(): Promise<void> {
    try {
      this.performanceService = new PerformanceOptimizationService(
        this.sourceDbConfig,
        this.destinationDbConfig
      );

      // Setup event handlers for real-time monitoring
      this.performanceService.on('performance_alert', (alert) => {
        this.displayAlert(alert);
      });

      this.performanceService.on('memory_leak_alert', (data) => {
        console.log(`🚨 Memory leak detected! Growth rate: ${data.growthRate.toFixed(1)}MB/min`);
      });

      this.performanceService.on('batch_size_optimized', (data) => {
        console.log(`⚡ Batch size optimized: ${data.previousSize} → ${data.newSize} (${data.reason})`);
      });

    } catch (error) {
      throw new Error(`Failed to initialize performance service: ${error.message}`);
    }
  }

  private async showPerformanceSnapshot(options: PerformanceCliOptions): Promise<void> {
    if (!this.performanceService) return;

    const summary = this.performanceService.generateOptimizationSummary();

    switch (options.format) {
      case 'json':
        console.log(JSON.stringify(summary, null, 2));
        break;
      case 'compact':
        this.displayCompactSummary(summary);
        break;
      default:
        this.displayTableSummary(summary, options);
    }
  }

  private displayTableSummary(summary: OptimizationSummary, options: PerformanceCliOptions): void {
    console.log(`\n📊 Performance Dashboard`);
    console.log(`======================`);
    console.log(`Timestamp: ${summary.timestamp.toLocaleString()}`);
    console.log(`Health Status: ${this.getHealthStatusEmoji(summary.healthStatus)} ${summary.healthStatus.toUpperCase()}`);

    // Performance Metrics
    console.log(`\n📈 Performance Metrics:`);
    console.log(`┌─────────────────────────┬──────────────┐`);
    console.log(`│ Records Processed       │ ${summary.performanceMetrics.totalRecordsProcessed.toLocaleString().padStart(12)} │`);
    console.log(`│ Current Throughput      │ ${summary.performanceMetrics.recordsPerSecond.toFixed(1).padStart(8)} /sec │`);
    console.log(`│ Peak Throughput         │ ${summary.performanceMetrics.peakThroughput.toFixed(1).padStart(8)} /sec │`);
    console.log(`│ Average Batch Time      │ ${summary.performanceMetrics.averageBatchTime.toFixed(0).padStart(9)}ms │`);
    console.log(`│ Error Rate              │ ${summary.performanceMetrics.errorRate.toFixed(2).padStart(10)}% │`);
    console.log(`└─────────────────────────┴──────────────┘`);

    // Memory Metrics
    console.log(`\n🧠 Memory Metrics:`);
    console.log(`┌─────────────────────────┬──────────────┐`);
    console.log(`│ Heap Used               │ ${summary.memoryMetrics.heapUsed.toFixed(1).padStart(9)} MB │`);
    console.log(`│ Heap Total              │ ${summary.memoryMetrics.heapTotal.toFixed(1).padStart(9)} MB │`);
    console.log(`│ Memory Pressure         │ ${summary.memoryMetrics.memoryPressure.padStart(12)} │`);
    console.log(`│ Heap Utilization        │ ${(summary.memoryMetrics.heapUtilization * 100).toFixed(1).padStart(10)}% │`);
    console.log(`│ RSS                     │ ${summary.memoryMetrics.rss.toFixed(1).padStart(9)} MB │`);
    console.log(`└─────────────────────────┴──────────────┘`);

    // Connection Pool Metrics
    console.log(`\n🔗 Connection Pool Metrics:`);
    console.log(`┌─────────────────────────┬──────────────┐`);
    console.log(`│ Active Connections      │ ${summary.connectionPoolMetrics.activeConnections.toString().padStart(12)} │`);
    console.log(`│ Idle Connections        │ ${summary.connectionPoolMetrics.idleConnections.toString().padStart(12)} │`);
    console.log(`│ Pool Utilization        │ ${(summary.connectionPoolMetrics.poolUtilization * 100).toFixed(1).padStart(10)}% │`);
    console.log(`│ Avg Connection Time     │ ${summary.connectionPoolMetrics.avgConnectionTime.toFixed(0).padStart(9)}ms │`);
    console.log(`│ Query Success Rate      │ ${((summary.connectionPoolMetrics.successfulQueries / Math.max(1, summary.connectionPoolMetrics.totalQueries)) * 100).toFixed(1).padStart(10)}% │`);
    console.log(`└─────────────────────────┴──────────────┘`);

    // Current Configuration
    console.log(`\n⚙️  Current Configuration:`);
    console.log(`┌─────────────────────────┬──────────────┐`);
    console.log(`│ Batch Size              │ ${summary.currentOptimizations.batchSize.toString().padStart(12)} │`);
    console.log(`│ Parallelism             │ ${summary.currentOptimizations.parallelism.toString().padStart(12)} │`);
    console.log(`│ Connection Pool Size    │ ${summary.currentOptimizations.connectionPoolSize.toString().padStart(12)} │`);
    console.log(`│ Memory Configuration    │ ${summary.currentOptimizations.memoryConfiguration.padStart(12)} │`);
    console.log(`└─────────────────────────┴──────────────┘`);

    // Alerts
    if (options.alerts && summary.alerts.length > 0) {
      console.log(`\n🚨 Active Alerts:`);
      summary.alerts.forEach((alert, index) => {
        const severityEmoji = alert.severity === 'critical' ? '🔴' : '🟡';
        console.log(`${severityEmoji} [${alert.type.toUpperCase()}] ${alert.message}`);
        if (options.recommendations) {
          alert.recommendations.forEach(rec => console.log(`   • ${rec}`));
        }
      });
    }

    // Recommendations
    if (options.recommendations && summary.recommendations.immediate.length > 0) {
      console.log(`\n💡 Immediate Recommendations:`);
      summary.recommendations.immediate.forEach(rec => {
        console.log(`   • ${rec}`);
      });
    }
  }

  private displayCompactSummary(summary: OptimizationSummary): void {
    const health = this.getHealthStatusEmoji(summary.healthStatus);
    console.log(`${health} ${summary.healthStatus} | ` +
      `${summary.performanceMetrics.totalRecordsProcessed.toLocaleString()} records | ` +
      `${summary.performanceMetrics.recordsPerSecond.toFixed(1)}/sec | ` +
      `${summary.memoryMetrics.heapUsed.toFixed(1)}MB | ` +
      `${(summary.connectionPoolMetrics.poolUtilization * 100).toFixed(1)}% pool | ` +
      `${summary.alerts.length} alerts`);
  }

  private getHealthStatusEmoji(status: string): string {
    switch (status) {
      case 'optimal': return '🟢';
      case 'good': return '🔵';
      case 'warning': return '🟡';
      case 'critical': return '🔴';
      default: return '⚪';
    }
  }

  private displayAlert(alert: any): void {
    const severityEmoji = alert.severity === 'critical' ? '🔴' : '🟡';
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${severityEmoji} ${alert.type.toUpperCase()}: ${alert.message}`);
  }

  private async showHealthCheck(): Promise<void> {
    if (!this.performanceService) return;

    console.log('🏥 System Health Check');
    console.log('======================');

    const health = await this.performanceService.getHealthCheck();

    console.log(`Overall Status: ${this.getHealthStatusEmoji(health.overall)} ${health.overall.toUpperCase()}`);
    console.log(`Performance: ${this.getHealthStatusEmoji(health.performance)} ${health.performance}`);
    console.log(`Memory: ${this.getHealthStatusEmoji(health.memory)} ${health.memory}`);
    console.log(`Connection Pool: ${this.getHealthStatusEmoji(health.connectionPool)} ${health.connectionPool}`);

    if (health.recommendations.length > 0) {
      console.log(`\n💡 Health Recommendations:`);
      health.recommendations.forEach(rec => console.log(`   • ${rec}`));
    }
  }

  private async runOptimization(): Promise<void> {
    if (!this.performanceService) return;

    console.log('⚡ Running Performance Optimization...');
    console.log('====================================');

    const before = this.performanceService.getCurrentOptimization();

    // Force optimization would be implemented here
    // For now, display current optimization status

    console.log('Current Configuration:');
    console.log(`  Batch Size: ${before.batchSize}`);
    console.log(`  Parallelism: ${before.parallelism}`);
    console.log(`  Connection Pool: ${before.connectionPoolSize}`);
    console.log(`  Memory: ${before.memoryConfiguration}`);

    const summary = this.performanceService.generateOptimizationSummary();

    if (summary.recommendations.immediate.length > 0) {
      console.log(`\n🎯 Optimization Opportunities:`);
      summary.recommendations.immediate.forEach(rec => console.log(`   • ${rec}`));
    } else {
      console.log(`\n✅ System is already optimally configured`);
    }
  }

  private async runWatchMode(options: PerformanceCliOptions): Promise<void> {
    if (!this.performanceService) return;

    console.log(`📊 Performance Monitor - Watch Mode (refresh: ${options.refresh}s)`);
    console.log('========================================================');
    console.log('Press Ctrl+C to exit\n');

    let iteration = 0;

    const watchInterval = setInterval(async () => {
      try {
        // Clear screen and show cursor position
        process.stdout.write('\\x1Bc'); // Clear screen

        iteration++;
        console.log(`📊 Performance Dashboard - Update #${iteration}`);
        console.log(`Last Updated: ${new Date().toLocaleTimeString()}`);
        console.log('='.repeat(60));

        const summary = this.performanceService!.generateOptimizationSummary();

        // Show real-time metrics
        this.displayRealTimeMetrics(summary);

        // Show entity-specific metrics if requested
        if (options.entity) {
          this.displayEntityMetrics(options.entity);
        }

        // Show alerts in watch mode
        if (summary.alerts.length > 0) {
          console.log(`\n🚨 Active Alerts (${summary.alerts.length}):`);
          summary.alerts.slice(-3).forEach(alert => {
            const emoji = alert.severity === 'critical' ? '🔴' : '🟡';
            console.log(`${emoji} ${alert.message}`);
          });
        }

        console.log(`\nPress Ctrl+C to exit | Next update in ${options.refresh}s`);

      } catch (error) {
        console.error(`Watch mode error: ${error.message}`);
      }
    }, options.refresh! * 1000);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      clearInterval(watchInterval);
      console.log('\n👋 Performance monitoring stopped');
      process.exit(0);
    });

    // Keep process running
    await new Promise(() => {}); // Infinite promise
  }

  private displayRealTimeMetrics(summary: OptimizationSummary): void {
    const perf = summary.performanceMetrics;
    const memory = summary.memoryMetrics;
    const pool = summary.connectionPoolMetrics;

    // Performance bar visualization
    const throughputBar = this.createProgressBar(
      perf.recordsPerSecond,
      this.performanceService!.getCurrentOptimization().batchSize * 2,
      20
    );

    const memoryBar = this.createProgressBar(
      memory.heapUsed,
      memory.heapLimit,
      20
    );

    const poolBar = this.createProgressBar(
      pool.activeConnections,
      pool.totalConnections,
      20
    );

    console.log(`\n📊 Real-time Metrics:`);
    console.log(`Throughput: [${throughputBar}] ${perf.recordsPerSecond.toFixed(1)}/sec`);
    console.log(`Memory:     [${memoryBar}] ${memory.heapUsed.toFixed(1)}MB / ${memory.heapLimit.toFixed(0)}MB`);
    console.log(`Pool:       [${poolBar}] ${pool.activeConnections}/${pool.totalConnections} connections`);
    console.log(`Health:     ${this.getHealthStatusEmoji(summary.healthStatus)} ${summary.healthStatus.toUpperCase()}`);
  }

  private displayEntityMetrics(entityType: string): void {
    if (!this.performanceService) return;

    const profile = this.performanceService.getEntityPerformanceProfile(entityType);

    if (profile) {
      console.log(`\n🏢 ${entityType.toUpperCase()} Performance Profile:`);
      console.log(`┌─────────────────────────┬──────────────┐`);
      console.log(`│ Optimal Batch Size      │ ${profile.optimalBatchSize.toString().padStart(12)} │`);
      console.log(`│ Optimal Parallelism     │ ${profile.optimalParallelism.toString().padStart(12)} │`);
      console.log(`│ Avg Throughput          │ ${profile.avgRecordsPerSecond.toFixed(1).padStart(8)}/sec │`);
      console.log(`│ Avg Memory Usage        │ ${profile.avgMemoryUsage.toFixed(1).padStart(9)} MB │`);
      console.log(`│ Error Rate              │ ${profile.errorRate.toFixed(2).padStart(10)}% │`);
      console.log(`└─────────────────────────┴──────────────┘`);
    } else {
      console.log(`\n❌ No performance profile available for '${entityType}'`);
    }
  }

  private createProgressBar(current: number, max: number, width: number): string {
    const percentage = Math.min(current / max, 1);
    const filled = Math.floor(percentage * width);
    const empty = width - filled;

    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private async cleanup(): Promise<void> {
    if (this.performanceService) {
      await this.performanceService.stop();
    }
  }

  private showHelp(): void {
    console.log(`
⚡ Differential Migration: Performance Monitor
==============================================

Usage:
  npm run performance:monitor [options]
  npx ts-node src/differential-migration/cli/performance-cli.ts [options]

Description:
  Provides comprehensive performance monitoring, optimization recommendations,
  and real-time dashboard for differential migration operations.

Commands:
  (default)                 Show current performance snapshot
  --health                  Run comprehensive health check
  --optimize                Analyze and display optimization opportunities
  --watch                   Real-time monitoring dashboard

Options:
  --format <format>         Output format: table, json, compact (default: table)
  --refresh <seconds>       Refresh interval for watch mode (default: 5)
  --entity <name>           Show metrics for specific entity type
  --history <number>        Number of historical data points (default: 10)
  --alerts                  Include active performance alerts
  --recommendations         Include optimization recommendations
  --config <path>           Custom configuration file path
  --help                    Show this help message

Examples:
  # Real-time performance dashboard
  npm run performance:monitor --watch --refresh 3

  # Health check with recommendations
  npm run performance:monitor --health --recommendations

  # Entity-specific monitoring
  npm run performance:monitor --entity "patients" --format compact

  # JSON output for automation
  npm run performance:monitor --format json --alerts

  # Optimization analysis
  npm run performance:monitor --optimize --verbose

Performance Thresholds (configurable):
  - Memory Usage: 512 MB maximum
  - Throughput: 50 records/second minimum
  - Error Rate: 5% maximum
  - Response Time: 5 seconds maximum
  - CPU Usage: 80% maximum
  - Connection Pool: 80% utilization maximum

For more information, see the API documentation and integration guide.
`);
  }
}

// CLI entry point
if (require.main === module) {
  const cli = new PerformanceCLI();
  cli.main(process.argv.slice(2)).catch(error => {
    console.error('Performance CLI error:', error);
    process.exit(1);
  });
}
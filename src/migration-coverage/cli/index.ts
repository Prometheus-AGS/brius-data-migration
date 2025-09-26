#!/usr/bin/env node

/**
 * Migration Coverage CLI
 *
 * Command-line interface for the Migration Coverage API
 */

import { Command } from 'commander';
import axios, { AxiosInstance } from 'axios';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';

// CLI version
const VERSION = '1.0.0';

// Default API configuration
let API_BASE_URL = 'http://localhost:3000';
let API_KEY: string | undefined;

// Axios instance
let api: AxiosInstance;

// Initialize CLI
function initializeCLI() {
  // Load configuration from file if exists
  const configPath = path.join(process.cwd(), '.migration-coverage.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      API_BASE_URL = config.apiUrl || API_BASE_URL;
      API_KEY = config.apiKey;
    } catch (error) {
      console.warn(chalk.yellow('Warning: Could not load configuration file'));
    }
  }

  // Create axios instance
  api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY && { 'X-API-Key': API_KEY })
    }
  });

  // Add response interceptor for error handling
  api.interceptors.response.use(
    response => response,
    error => {
      if (error.response) {
        const { status, data } = error.response;
        console.error(chalk.red(`API Error (${status}): ${data.message || data.error || 'Unknown error'}`));
      } else if (error.request) {
        console.error(chalk.red('Network Error: Could not connect to API'));
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  );
}

// Utility functions
function formatPercentage(value: number): string {
  const color = value >= 95 ? chalk.green : value >= 80 ? chalk.yellow : chalk.red;
  return color(`${value.toFixed(1)}%`);
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatStatus(status: string): string {
  const colors: Record<string, any> = {
    healthy: chalk.green,
    degraded: chalk.yellow,
    unhealthy: chalk.red,
    completed: chalk.green,
    in_progress: chalk.blue,
    pending: chalk.yellow,
    failed: chalk.red
  };
  return (colors[status] || chalk.gray)(status);
}

// Commands
async function healthCommand() {
  const spinner = ora('Checking system health...').start();

  try {
    const response = await api.get('/health');
    const health = response.data;

    spinner.stop();

    console.log('\n' + chalk.bold('System Health Status'));
    console.log('='.repeat(50));

    // Overall status
    console.log(`Status: ${formatStatus(health.status)}`);
    console.log(`Uptime: ${formatDuration(health.uptime * 1000)}`);
    console.log(`Version: ${health.version}`);
    console.log(`Environment: ${health.environment}`);
    console.log(`Response Time: ${formatDuration(health.responseTime)}\n`);

    // Components table
    if (health.components && health.components.length > 0) {
      const table = new Table({
        head: ['Component', 'Status', 'Response Time', 'Details'],
        colWidths: [15, 12, 15, 30]
      });

      health.components.forEach((component: any) => {
        table.push([
          component.component,
          formatStatus(component.status),
          formatDuration(component.responseTime),
          component.details ? JSON.stringify(component.details, null, 0).substring(0, 25) + '...' : '-'
        ]);
      });

      console.log(table.toString());
    }

    // System metrics
    if (health.systemMetrics) {
      console.log('\n' + chalk.bold('System Metrics'));
      console.log('-'.repeat(30));
      console.log(`Node Version: ${health.systemMetrics.nodeVersion}`);
      console.log(`Platform: ${health.systemMetrics.platform} (${health.systemMetrics.arch})`);
      console.log(`Process ID: ${health.systemMetrics.processId}`);

      if (health.systemMetrics.memoryUsage) {
        const mem = health.systemMetrics.memoryUsage;
        console.log(`Memory: ${mem.heapUsed}MB / ${mem.heapTotal}MB (RSS: ${mem.rss}MB)`);
      }
    }

  } catch (error) {
    spinner.fail('Health check failed');
  }
}

async function summaryCommand() {
  const spinner = ora('Fetching coverage summary...').start();

  try {
    const response = await api.get('/coverage/summary');
    const summary = response.data;

    spinner.stop();

    console.log('\n' + chalk.bold('Migration Coverage Summary'));
    console.log('='.repeat(50));

    // Overall progress
    const progress = (summary.completedScripts / summary.totalScripts) * 100;
    console.log(`Progress: ${formatPercentage(progress)} (${summary.completedScripts}/${summary.totalScripts} scripts)`);
    console.log(`Records: ${formatNumber(summary.migratedRecords)}/${formatNumber(summary.totalRecords)} migrated`);
    console.log(`Success Rate: ${formatPercentage(summary.overallSuccessRate)}`);
    console.log(`Risk Level: ${formatStatus(summary.riskAssessment.level)} (${summary.riskAssessment.score.toFixed(2)})`);

    // Timeline
    if (summary.timeline.estimatedCompletionDays !== null) {
      console.log(`ETA: ${summary.timeline.estimatedCompletionDays} days (${formatPercentage(summary.timeline.confidence * 100)} confidence)`);
    } else {
      console.log('ETA: Unable to estimate');
    }

    // Domain coverage
    console.log('\n' + chalk.bold('Domain Coverage'));
    console.log('-'.repeat(30));
    const domains = summary.domainCoverage;
    Object.entries(domains).forEach(([domain, coverage]) => {
      console.log(`${domain.padEnd(15)}: ${formatPercentage(coverage as number)}`);
    });

    console.log(`\nResponse Time: ${formatDuration(summary.responseTime)}`);
    console.log(`Last Updated: ${new Date(summary.lastUpdated).toLocaleString()}`);

  } catch (error) {
    spinner.fail('Failed to fetch coverage summary');
  }
}

async function scriptsCommand(options: any) {
  const spinner = ora('Fetching scripts status...').start();

  try {
    const params: any = {
      page: options.page || 1,
      limit: options.limit || 20
    };

    if (options.domain) params.domain = options.domain;
    if (options.status) params.status = options.status;
    if (options.category) params.category = options.category;

    const response = await api.get('/scripts/status', { params });
    const data = response.data;

    spinner.stop();

    console.log('\n' + chalk.bold('Migration Scripts Status'));
    console.log('='.repeat(50));

    // Summary
    const summary = data.summary;
    console.log(`Total: ${summary.totalScripts} | Completed: ${chalk.green(summary.completedScripts)} | ` +
      `In Progress: ${chalk.blue(summary.inProgressScripts)} | Pending: ${chalk.yellow(summary.pendingScripts)} | ` +
      `Failed: ${chalk.red(summary.failedScripts)}`);
    console.log(`Average Success Rate: ${formatPercentage(summary.averageSuccessRate)}\n`);

    // Scripts table
    if (data.scripts.length > 0) {
      const table = new Table({
        head: ['Name', 'Status', 'Domain', 'Records', 'Success Rate', 'Last Executed'],
        colWidths: [25, 12, 15, 12, 12, 20]
      });

      data.scripts.forEach((script: any) => {
        table.push([
          script.name.length > 22 ? script.name.substring(0, 22) + '...' : script.name,
          formatStatus(script.status),
          script.domain,
          formatNumber(script.recordsProcessed || 0),
          script.successRate ? formatPercentage(script.successRate) : '-',
          script.lastExecuted ? new Date(script.lastExecuted).toLocaleDateString() : '-'
        ]);
      });

      console.log(table.toString());

      // Pagination info
      const pagination = data.pagination;
      console.log(`\nPage ${pagination.currentPage} of ${pagination.totalPages} ` +
        `(${pagination.totalItems} total items)`);

      if (pagination.hasNextPage) {
        console.log(chalk.dim(`Use --page ${pagination.currentPage + 1} to see more`));
      }
    } else {
      console.log('No scripts found matching the criteria.');
    }

  } catch (error) {
    spinner.fail('Failed to fetch scripts status');
  }
}

async function validateCommand(options: any) {
  const spinner = ora('Starting validation...').start();

  try {
    // Start validation job
    const requestBody: any = {
      includeIntegrityChecks: !options.noIntegrity,
      includeCrossEntity: !options.noCrossEntity
    };

    if (options.entities) {
      requestBody.entities = options.entities.split(',');
    }

    const response = await api.post('/validation/run', requestBody);
    const jobData = response.data;

    spinner.succeed(`Validation job started: ${jobData.jobId}`);
    console.log(`Estimated duration: ${jobData.estimatedDuration}`);

    if (options.wait) {
      // Poll for results
      const pollSpinner = ora('Waiting for validation to complete...').start();

      let attempts = 0;
      const maxAttempts = 60; // 5 minutes max

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

        try {
          const resultResponse = await api.get(`/validation/results/${jobData.jobId}`);
          const result = resultResponse.data;

          if (result.status === 'completed') {
            pollSpinner.succeed('Validation completed!');
            displayValidationResults(result);
            break;
          } else if (result.status === 'failed') {
            pollSpinner.fail('Validation failed');
            console.error(chalk.red(result.error || 'Unknown error'));
            break;
          } else {
            pollSpinner.text = `Validation in progress... (${result.progress || 0}%)`;
          }
        } catch (error) {
          // Continue polling on error
        }

        attempts++;
      }

      if (attempts >= maxAttempts) {
        pollSpinner.warn('Validation is taking longer than expected');
        console.log(`Check status with: migration-coverage validation results ${jobData.jobId}`);
      }
    } else {
      console.log(`\nCheck results with: migration-coverage validation results ${jobData.jobId}`);
    }

  } catch (error) {
    spinner.fail('Failed to start validation');
  }
}

async function validationResultsCommand(jobId: string) {
  const spinner = ora('Fetching validation results...').start();

  try {
    const response = await api.get(`/validation/results/${jobId}`);
    const result = response.data;

    spinner.stop();

    console.log('\n' + chalk.bold(`Validation Results - ${jobId}`));
    console.log('='.repeat(60));

    console.log(`Status: ${formatStatus(result.status)}`);
    console.log(`Started: ${new Date(result.startTime).toLocaleString()}`);

    if (result.endTime) {
      console.log(`Completed: ${new Date(result.endTime).toLocaleString()}`);
      console.log(`Duration: ${formatDuration(result.duration)}`);
    }

    if (result.status === 'completed' && result.summary) {
      displayValidationResults(result);
    } else if (result.status === 'running') {
      console.log(`Progress: ${result.progress || 0}%`);
      if (result.estimatedCompletion) {
        console.log(`ETA: ${new Date(result.estimatedCompletion).toLocaleString()}`);
      }
    } else if (result.status === 'failed') {
      console.error(chalk.red(`Error: ${result.error || 'Unknown error'}`));
    }

  } catch (error) {
    spinner.fail('Failed to fetch validation results');
  }
}

function displayValidationResults(result: any) {
  const summary = result.summary;

  console.log('\n' + chalk.bold('Validation Summary'));
  console.log('-'.repeat(40));
  console.log(`Overall Score: ${formatPercentage(summary.overallScore)}`);
  console.log(`Rules: ${chalk.green(summary.passedRules)}/${summary.totalRules} passed`);

  if (summary.criticalFailures > 0) {
    console.log(`Critical Failures: ${chalk.red(summary.criticalFailures)}`);
  }

  if (summary.warningCount > 0) {
    console.log(`Warnings: ${chalk.yellow(summary.warningCount)}`);
  }

  console.log(`Execution Time: ${formatDuration(summary.executionTime)}`);

  // Integrity checks
  if (result.integrityChecks) {
    const ic = result.integrityChecks;
    console.log('\n' + chalk.bold('Integrity Checks'));
    console.log('-'.repeat(30));
    console.log(`Total: ${ic.total} | Passed: ${chalk.green(ic.passed)} | Failed: ${chalk.red(ic.failed)}`);
  }

  // Recommendations
  if (result.recommendations && result.recommendations.length > 0) {
    console.log('\n' + chalk.bold('Recommendations'));
    console.log('-'.repeat(30));
    result.recommendations.forEach((rec: string, index: number) => {
      console.log(`${index + 1}. ${rec}`);
    });
  }
}

async function reportCommand(options: any) {
  const spinner = ora('Generating report...').start();

  try {
    const params: any = {
      type: options.type || 'comprehensive',
      format: options.format || 'json',
      includeDetails: options.details || false,
      includeValidation: options.validation || false,
      saveToFile: options.save || false
    };

    const response = await api.get('/reports/generate', { params });

    spinner.stop();

    if (params.format === 'json') {
      const report = response.data;
      console.log('\n' + chalk.bold(`${report.reportType.toUpperCase()} Report`));
      console.log('='.repeat(50));
      console.log(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
      console.log(`Response Time: ${formatDuration(report.responseTime)}`);

      if (report.savedPath) {
        console.log(`Saved to: ${report.savedPath}`);
      }

      console.log('\n' + JSON.stringify(report.content, null, 2));
    } else {
      // For non-JSON formats, save to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `migration-report-${params.type}-${timestamp}.${params.format}`;

      fs.writeFileSync(filename, response.data);
      console.log(chalk.green(`Report saved to: ${filename}`));
    }

  } catch (error) {
    spinner.fail('Failed to generate report');
  }
}

async function configCommand() {
  const questions = [
    {
      type: 'input',
      name: 'apiUrl',
      message: 'API Base URL:',
      default: API_BASE_URL
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key (optional):',
      default: API_KEY || ''
    }
  ];

  const answers = await inquirer.prompt(questions);

  const config = {
    apiUrl: answers.apiUrl,
    ...(answers.apiKey && { apiKey: answers.apiKey })
  };

  const configPath = path.join(process.cwd(), '.migration-coverage.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(chalk.green(`Configuration saved to ${configPath}`));
}

// Main CLI setup
function main() {
  initializeCLI();

  const program = new Command();

  program
    .name('migration-coverage')
    .description('CLI for Migration Coverage API')
    .version(VERSION);

  // Health command
  program
    .command('health')
    .description('Check system health status')
    .action(healthCommand);

  // Summary command
  program
    .command('summary')
    .alias('status')
    .description('Get migration coverage summary')
    .action(summaryCommand);

  // Scripts command
  program
    .command('scripts')
    .description('List migration scripts status')
    .option('-d, --domain <domain>', 'Filter by domain')
    .option('-s, --status <status>', 'Filter by status')
    .option('-c, --category <category>', 'Filter by category')
    .option('-p, --page <page>', 'Page number', parseInt)
    .option('-l, --limit <limit>', 'Items per page', parseInt)
    .action(scriptsCommand);

  // Validation commands
  const validationCmd = program
    .command('validation')
    .description('Validation commands');

  validationCmd
    .command('run')
    .description('Start a validation job')
    .option('-e, --entities <entities>', 'Comma-separated list of entities')
    .option('--no-integrity', 'Skip integrity checks')
    .option('--no-cross-entity', 'Skip cross-entity validation')
    .option('-w, --wait', 'Wait for completion')
    .action(validateCommand);

  validationCmd
    .command('results <jobId>')
    .description('Get validation results')
    .action(validationResultsCommand);

  // Report command
  program
    .command('report')
    .description('Generate migration report')
    .option('-t, --type <type>', 'Report type (comprehensive, coverage, executive, detailed)', 'comprehensive')
    .option('-f, --format <format>', 'Output format (json, html, markdown, csv)', 'json')
    .option('-d, --details', 'Include detailed information')
    .option('-v, --validation', 'Include validation results')
    .option('-s, --save', 'Save to file')
    .action(reportCommand);

  // Config command
  program
    .command('config')
    .description('Configure CLI settings')
    .action(configCommand);

  // Parse command line arguments
  program.parse();
}

// Run CLI if this file is executed directly
if (require.main === module) {
  main();
}

export { main };
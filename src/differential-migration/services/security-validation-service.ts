/**
 * Security Validation Service
 *
 * Integrates security management and error handling for comprehensive
 * production-ready security measures in differential migration operations
 */

import { SecurityManager, type SecurityConfig, type SecurityValidationResult, type PIIDetectionResult } from '../lib/security-manager';
import { MigrationErrorHandler, type MigrationError, type RetryConfig, type ErrorHandlingMetrics } from '../lib/error-handler';
import { Pool, PoolConfig } from 'pg';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

export interface SecurityValidationConfig {
  security: SecurityConfig;
  errorHandling: RetryConfig;

  // Production security settings
  production: {
    enforceStrictValidation: boolean;
    requireSecureConnections: boolean;
    enableThreatDetection: boolean;
    auditAllOperations: boolean;
    dataRetentionDays: number;
  };

  // Compliance requirements
  compliance: {
    enableGDPR: boolean;
    enableHIPAA: boolean;
    enableSOX: boolean;
    dataClassification: boolean;
    encryptionAtRest: boolean;
  };
}

export interface SecurityReport {
  timestamp: Date;
  sessionId: string;
  overallSecurityScore: number; // 0-100

  securityValidation: SecurityValidationResult;
  piiAnalysis: {
    tablesScanned: string[];
    piiFieldsDetected: PIIDetectionResult[];
    maskingApplied: boolean;
    complianceIssues: string[];
  };

  errorAnalysis: {
    totalErrors: number;
    securityRelatedErrors: number;
    errorsByType: Record<string, number>;
    criticalErrors: MigrationError[];
    recoverabilityScore: number;
  };

  complianceStatus: {
    gdprCompliant: boolean;
    hipaaCompliant: boolean;
    soxCompliant: boolean;
    dataResidencyCompliant: boolean;
    auditTrailComplete: boolean;
  };

  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
}

export interface ThreatDetectionResult {
  threats: Array<{
    type: 'sql_injection' | 'data_exfiltration' | 'unauthorized_access' | 'anomalous_behavior';
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: any;
    timestamp: Date;
  }>;
  riskScore: number; // 0-100
  recommendedActions: string[];
}

/**
 * Security Validation Service
 *
 * Comprehensive security validation and threat detection for migration operations
 */
export class SecurityValidationService extends EventEmitter {
  private securityManager: SecurityManager;
  private errorHandler: MigrationErrorHandler;
  private config: SecurityValidationConfig;
  private sessionId: string;

  private securityEvents: Array<{
    timestamp: Date;
    event: string;
    severity: string;
    details: any;
  }> = [];

  private readonly DEFAULT_CONFIG: SecurityValidationConfig = {
    security: {
      enforceSSL: true,
      connectionEncryption: true,
      certificateValidation: true,
      minTLSVersion: '1.2',
      credentialValidation: true,
      allowHardcodedCredentials: false,
      credentialRotationDays: 90,
      enableDataMasking: true,
      piiDetection: true,
      maskingLevel: 'partial',
      auditLogging: true,
      enableRoleBasedAccess: false,
      requiredPermissions: ['read', 'write', 'migrate'],
      sessionTimeout: 120,
      enforceDataResidency: false,
      logDataMovements: true,
      enableComplianceReporting: true
    },
    errorHandling: {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      exponentialBackoff: true,
      jitterEnabled: true,
      retryableErrorTypes: ['network', 'system', 'connection_timeout']
    },
    production: {
      enforceStrictValidation: true,
      requireSecureConnections: true,
      enableThreatDetection: true,
      auditAllOperations: true,
      dataRetentionDays: 365
    },
    compliance: {
      enableGDPR: false,
      enableHIPAA: true,  // Assuming medical data
      enableSOX: false,
      dataClassification: true,
      encryptionAtRest: false
    }
  };

  constructor(config?: Partial<SecurityValidationConfig>) {
    super();

    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.sessionId = crypto.randomUUID();

    this.securityManager = new SecurityManager(this.config.security);
    this.errorHandler = new MigrationErrorHandler(this.config.errorHandling);

    this.setupSecurityEventHandlers();
  }

  private setupSecurityEventHandlers(): void {
    // Setup event handlers for security monitoring
    this.errorHandler.on?.('error_classified', (error: MigrationError) => {
      if (error.type === 'data_integrity' || error.severity === 'critical') {
        this.logSecurityEvent('critical_error', 'critical', {
          errorId: error.id,
          type: error.type,
          message: error.message
        });
      }
    });
  }

  /**
   * Perform comprehensive security validation
   */
  async performSecurityValidation(
    sourceDbConfig: PoolConfig,
    destinationDbConfig: PoolConfig,
    tablesToValidate: string[]
  ): Promise<SecurityReport> {
    console.log('🔒 Starting comprehensive security validation...');

    const startTime = Date.now();

    try {
      // 1. Validate database connection security
      const sourceSecurityValidation = this.securityManager.validateConnectionSecurity(sourceDbConfig);
      const destSecurityValidation = this.securityManager.validateConnectionSecurity(destinationDbConfig);

      // Combined validation result
      const securityValidation: SecurityValidationResult = {
        isValid: sourceSecurityValidation.isValid && destSecurityValidation.isValid,
        issues: [...sourceSecurityValidation.issues, ...destSecurityValidation.issues],
        recommendations: [...sourceSecurityValidation.recommendations, ...destSecurityValidation.recommendations],
        complianceScore: Math.floor((sourceSecurityValidation.complianceScore + destSecurityValidation.complianceScore) / 2)
      };

      // 2. PII Detection and Analysis
      const piiAnalysis = await this.performPIIAnalysis(sourceDbConfig, destinationDbConfig, tablesToValidate);

      // 3. Error Analysis
      const errorMetrics = this.errorHandler.getErrorMetrics();
      const securityRelatedErrors = this.errorHandler.getErrors({
        type: 'data_integrity'
      }).length + this.errorHandler.getErrors({
        type: 'validation'
      }).length;

      const criticalErrors = this.errorHandler.getErrors({
        severity: 'critical'
      });

      const errorAnalysis = {
        totalErrors: errorMetrics.totalErrors,
        securityRelatedErrors,
        errorsByType: errorMetrics.errorsByType,
        criticalErrors,
        recoverabilityScore: this.calculateRecoverabilityScore(criticalErrors)
      };

      // 4. Compliance Status Assessment
      const complianceStatus = this.assessComplianceStatus(piiAnalysis.piiFieldsDetected);

      // 5. Generate Security Score
      const overallSecurityScore = this.calculateOverallSecurityScore(
        securityValidation,
        piiAnalysis,
        errorAnalysis,
        complianceStatus
      );

      // 6. Generate Recommendations
      const recommendations = this.generateSecurityRecommendations(
        securityValidation,
        piiAnalysis,
        errorAnalysis,
        complianceStatus
      );

      const report: SecurityReport = {
        timestamp: new Date(),
        sessionId: this.sessionId,
        overallSecurityScore,
        securityValidation,
        piiAnalysis,
        errorAnalysis,
        complianceStatus,
        recommendations
      };

      const validationTime = Date.now() - startTime;
      this.logSecurityEvent('security_validation_completed', 'info', {
        validationTimeMs: validationTime,
        securityScore: overallSecurityScore,
        tablesValidated: tablesToValidate.length
      });

      console.log(`✅ Security validation completed in ${validationTime}ms`);
      console.log(`🔒 Overall Security Score: ${overallSecurityScore}/100`);

      return report;

    } catch (error) {
      this.logSecurityEvent('security_validation_failed', 'critical', {
        error: error.message,
        stackTrace: error.stack
      });

      throw new Error(`Security validation failed: ${error.message}`);
    }
  }

  private async performPIIAnalysis(
    sourceDbConfig: PoolConfig,
    destinationDbConfig: PoolConfig,
    tables: string[]
  ): Promise<{
    tablesScanned: string[];
    piiFieldsDetected: PIIDetectionResult[];
    maskingApplied: boolean;
    complianceIssues: string[];
  }> {
    console.log('🔍 Performing PII analysis...');

    const piiFieldsDetected: PIIDetectionResult[] = [];
    const complianceIssues: string[] = [];

    if (!this.config.security.piiDetection) {
      return {
        tablesScanned: [],
        piiFieldsDetected: [],
        maskingApplied: false,
        complianceIssues: ['PII detection is disabled']
      };
    }

    try {
      const sourcePool = new Pool(sourceDbConfig);

      for (const table of tables) {
        try {
          const piiResults = await this.securityManager.detectPII(sourcePool, table, 100);
          piiFieldsDetected.push(...piiResults);

          // Check compliance requirements
          if (this.config.compliance.enableHIPAA && piiResults.length > 0) {
            const healthcarePII = piiResults.filter(pii =>
              pii.piiType === 'date_of_birth' || pii.piiType === 'ssn' || pii.piiType === 'name'
            );

            if (healthcarePII.length > 0 && !this.config.security.enableDataMasking) {
              complianceIssues.push(`HIPAA compliance risk: Healthcare PII detected in ${table} without masking`);
            }
          }

          if (this.config.compliance.enableGDPR && piiResults.length > 0) {
            const personalData = piiResults.filter(pii =>
              pii.piiType === 'email' || pii.piiType === 'name' || pii.piiType === 'phone'
            );

            if (personalData.length > 0) {
              complianceIssues.push(`GDPR compliance: Personal data detected in ${table} - ensure data subject rights`);
            }
          }

        } catch (error) {
          complianceIssues.push(`Failed to analyze ${table}: ${error.message}`);
        }
      }

      await sourcePool.end();

      console.log(`📊 PII Analysis: ${piiFieldsDetected.length} PII fields detected across ${tables.length} tables`);

      return {
        tablesScanned: tables,
        piiFieldsDetected,
        maskingApplied: this.config.security.enableDataMasking,
        complianceIssues
      };

    } catch (error) {
      throw new Error(`PII analysis failed: ${error.message}`);
    }
  }

  private assessComplianceStatus(piiFields: PIIDetectionResult[]): SecurityReport['complianceStatus'] {
    const gdprCompliant = !this.config.compliance.enableGDPR ||
      (piiFields.length === 0 || this.config.security.enableDataMasking);

    const hipaaCompliant = !this.config.compliance.enableHIPAA ||
      (this.config.security.enableDataMasking && this.config.security.auditLogging);

    const soxCompliant = !this.config.compliance.enableSOX ||
      this.config.security.auditLogging;

    const dataResidencyCompliant = !this.config.security.enforceDataResidency ||
      this.validateDataResidency();

    const auditTrailComplete = this.config.security.auditLogging &&
      this.securityEvents.length > 0;

    return {
      gdprCompliant,
      hipaaCompliant,
      soxCompliant,
      dataResidencyCompliant,
      auditTrailComplete
    };
  }

  private validateDataResidency(): boolean {
    // Simplified data residency validation
    // In production, this would validate that data stays within required geographic boundaries
    return true;
  }

  private calculateOverallSecurityScore(
    securityValidation: SecurityValidationResult,
    piiAnalysis: any,
    errorAnalysis: any,
    complianceStatus: any
  ): number {
    let score = securityValidation.complianceScore;

    // Deduct points for PII without masking
    if (piiAnalysis.piiFieldsDetected.length > 0 && !piiAnalysis.maskingApplied) {
      score -= 15;
    }

    // Deduct points for security-related errors
    if (errorAnalysis.securityRelatedErrors > 0) {
      score -= Math.min(20, errorAnalysis.securityRelatedErrors * 5);
    }

    // Deduct points for compliance failures
    const complianceFailures = Object.values(complianceStatus).filter(status => !status).length;
    score -= complianceFailures * 10;

    // Bonus points for proactive security measures
    if (this.config.security.enableDataMasking && this.config.security.piiDetection) {
      score += 5;
    }
    if (this.config.security.auditLogging) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  private generateSecurityRecommendations(
    securityValidation: SecurityValidationResult,
    piiAnalysis: any,
    errorAnalysis: any,
    complianceStatus: any
  ): SecurityReport['recommendations'] {
    const immediate: string[] = [];
    const shortTerm: string[] = [];
    const longTerm: string[] = [];

    // Immediate security issues
    const criticalIssues = securityValidation.issues.filter(issue => issue.severity === 'critical');
    if (criticalIssues.length > 0) {
      immediate.push('Resolve critical security issues before proceeding with migration');
      immediate.push(...criticalIssues.map(issue => issue.recommendation));
    }

    if (errorAnalysis.criticalErrors.length > 0) {
      immediate.push('Investigate and resolve critical migration errors');
    }

    if (piiAnalysis.piiFieldsDetected.length > 0 && !piiAnalysis.maskingApplied) {
      immediate.push('Enable data masking for PII fields to ensure compliance');
    }

    // Short-term improvements
    if (!complianceStatus.auditTrailComplete) {
      shortTerm.push('Implement comprehensive audit logging');
    }

    if (securityValidation.complianceScore < 80) {
      shortTerm.push('Implement missing security controls to improve compliance score');
    }

    if (!this.config.security.enforceSSL) {
      shortTerm.push('Enable SSL/TLS encryption for all database connections');
    }

    // Long-term strategic improvements
    longTerm.push('Implement automated security testing in CI/CD pipeline');
    longTerm.push('Establish security monitoring and alerting system');
    longTerm.push('Conduct regular security assessments and penetration testing');

    if (this.config.compliance.enableGDPR || this.config.compliance.enableHIPAA) {
      longTerm.push('Implement data subject rights management (access, deletion, portability)');
    }

    return { immediate, shortTerm, longTerm };
  }

  private calculateRecoverabilityScore(criticalErrors: MigrationError[]): number {
    if (criticalErrors.length === 0) return 100;

    const recoverableErrors = criticalErrors.filter(err =>
      err.retryable || err.resolution?.action === 'retry'
    ).length;

    return Math.floor((recoverableErrors / criticalErrors.length) * 100);
  }

  /**
   * Perform threat detection analysis
   */
  performThreatDetection(migrationContext: {
    sourceQueries: string[];
    inputData: any[];
    userActions: string[];
  }): ThreatDetectionResult {
    const threats: ThreatDetectionResult['threats'] = [];

    // SQL Injection detection
    migrationContext.sourceQueries.forEach((query, index) => {
      const sqlInjectionPatterns = [
        /(\bUNION\b.*\bSELECT\b)/i,
        /(\bOR\b\s*\d+\s*=\s*\d+)/i,
        /(;.*--)|(\/\*.*\*\/)/i,
        /(\bEXEC\b|\bEXECUTE\b)/i
      ];

      const suspiciousPattern = sqlInjectionPatterns.find(pattern => pattern.test(query));
      if (suspiciousPattern) {
        threats.push({
          type: 'sql_injection',
          severity: 'high',
          description: `Potential SQL injection detected in query ${index + 1}`,
          evidence: { query: query.substring(0, 100), pattern: suspiciousPattern.source },
          timestamp: new Date()
        });
      }
    });

    // Anomalous behavior detection
    if (migrationContext.userActions.length > 100) {
      threats.push({
        type: 'anomalous_behavior',
        severity: 'medium',
        description: 'Unusual number of user actions detected',
        evidence: { actionCount: migrationContext.userActions.length },
        timestamp: new Date()
      });
    }

    // Data exfiltration detection (simplified)
    const largeDataRequests = migrationContext.inputData.filter(data =>
      JSON.stringify(data).length > 10000
    ).length;

    if (largeDataRequests > 10) {
      threats.push({
        type: 'data_exfiltration',
        severity: 'medium',
        description: 'Multiple large data requests detected',
        evidence: { largeRequestCount: largeDataRequests },
        timestamp: new Date()
      });
    }

    // Calculate risk score
    const riskScore = this.calculateRiskScore(threats);

    // Generate recommendations
    const recommendedActions = this.generateThreatRecommendations(threats);

    return {
      threats,
      riskScore,
      recommendedActions
    };
  }

  private calculateRiskScore(threats: ThreatDetectionResult['threats']): number {
    if (threats.length === 0) return 0;

    const severityWeights = {
      low: 10,
      medium: 25,
      high: 50,
      critical: 100
    };

    const totalRisk = threats.reduce((sum, threat) => {
      return sum + severityWeights[threat.severity];
    }, 0);

    return Math.min(100, totalRisk);
  }

  private generateThreatRecommendations(threats: ThreatDetectionResult['threats']): string[] {
    const recommendations: string[] = [];

    const threatTypes = new Set(threats.map(t => t.type));

    if (threatTypes.has('sql_injection')) {
      recommendations.push('Review and sanitize all database queries');
      recommendations.push('Implement parameterized queries for all user inputs');
    }

    if (threatTypes.has('data_exfiltration')) {
      recommendations.push('Implement data access monitoring and rate limiting');
      recommendations.push('Review data export permissions and audit logs');
    }

    if (threatTypes.has('unauthorized_access')) {
      recommendations.push('Strengthen access controls and authentication');
      recommendations.push('Implement session management and timeout policies');
    }

    if (threatTypes.has('anomalous_behavior')) {
      recommendations.push('Implement behavioral monitoring and alerting');
      recommendations.push('Review user activity patterns for legitimacy');
    }

    return recommendations;
  }

  /**
   * Execute secure migration operation
   */
  async executeSecureMigration<T>(
    operation: () => Promise<T>,
    context: {
      entityType: string;
      operationName: string;
      recordIds?: string[];
    }
  ): Promise<{ success: boolean; result?: T; securityEvents: any[] }> {
    const securityEvents: any[] = [];

    try {
      // Log operation start
      this.logSecurityEvent('migration_operation_started', 'info', {
        entityType: context.entityType,
        operationName: context.operationName,
        recordCount: context.recordIds?.length || 0
      });

      // Execute with error handling
      const operationResult = await this.errorHandler.executeWithRetry(operation, context);

      if (operationResult.success) {
        this.logSecurityEvent('migration_operation_completed', 'info', {
          entityType: context.entityType,
          operationName: context.operationName,
          success: true
        });

        return {
          success: true,
          result: operationResult.result,
          securityEvents: [...this.securityEvents]
        };
      } else {
        this.logSecurityEvent('migration_operation_failed', 'high', {
          entityType: context.entityType,
          operationName: context.operationName,
          error: operationResult.error?.message,
          errorType: operationResult.error?.type
        });

        return {
          success: false,
          securityEvents: [...this.securityEvents]
        };
      }

    } catch (error) {
      this.logSecurityEvent('migration_operation_exception', 'critical', {
        entityType: context.entityType,
        operationName: context.operationName,
        error: error.message,
        stackTrace: error.stack
      });

      throw error;
    }
  }

  /**
   * Validate and sanitize migration parameters
   */
  validateMigrationParameters(params: any): {
    isValid: boolean;
    sanitizedParams: any;
    securityIssues: string[];
  } {
    const validationResult = this.securityManager.validateInput(params, {});

    this.logSecurityEvent('parameter_validation', 'info', {
      isValid: validationResult.isValid,
      issueCount: validationResult.issues.length
    });

    return {
      isValid: validationResult.isValid,
      sanitizedParams: validationResult.sanitizedInput,
      securityIssues: validationResult.issues
    };
  }

  private logSecurityEvent(event: string, severity: string, details: any): void {
    const securityEvent = {
      timestamp: new Date(),
      event,
      severity,
      details: {
        ...details,
        sessionId: this.sessionId
      }
    };

    this.securityEvents.push(securityEvent);

    // Keep only last 1000 events
    if (this.securityEvents.length > 1000) {
      this.securityEvents.shift();
    }

    // Emit security event
    this.emit('security_event', securityEvent);

    // Log critical events immediately
    if (severity === 'critical') {
      console.error(`🚨 CRITICAL SECURITY EVENT: ${event}`, details);
    }
  }

  /**
   * Get security event log
   */
  getSecurityEvents(criteria?: {
    severity?: string;
    eventType?: string;
    since?: Date;
    limit?: number;
  }): any[] {
    let events = [...this.securityEvents];

    if (criteria) {
      if (criteria.severity) {
        events = events.filter(event => event.severity === criteria.severity);
      }
      if (criteria.eventType) {
        events = events.filter(event => event.event.includes(criteria.eventType!));
      }
      if (criteria.since) {
        events = events.filter(event => event.timestamp >= criteria.since!);
      }
      if (criteria.limit) {
        events = events.slice(-criteria.limit);
      }
    }

    return events;
  }

  /**
   * Generate security compliance certificate
   */
  generateComplianceCertificate(): {
    certificateId: string;
    issuedDate: Date;
    validUntil: Date;
    complianceLevel: 'basic' | 'standard' | 'advanced';
    certifiedControls: string[];
    limitations: string[];
  } {
    const report = this.securityManager.generateComplianceReport();

    const complianceLevel = report.complianceScore >= 90 ? 'advanced' :
                           report.complianceScore >= 75 ? 'standard' : 'basic';

    const certifiedControls: string[] = [];
    if (this.config.security.enforceSSL) certifiedControls.push('SSL/TLS Encryption');
    if (this.config.security.credentialValidation) certifiedControls.push('Credential Management');
    if (this.config.security.enableDataMasking) certifiedControls.push('Data Masking');
    if (this.config.security.auditLogging) certifiedControls.push('Audit Logging');

    const limitations = report.recommendations;

    return {
      certificateId: crypto.randomUUID(),
      issuedDate: new Date(),
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      complianceLevel,
      certifiedControls,
      limitations
    };
  }

  /**
   * Cleanup and finalize security validation
   */
  async cleanup(): Promise<void> {
    // Generate final security report
    const finalEvents = this.securityEvents.length;
    const criticalEvents = this.securityEvents.filter(event => event.severity === 'critical').length;

    this.logSecurityEvent('security_session_completed', 'info', {
      totalEvents: finalEvents,
      criticalEvents,
      sessionDuration: Date.now() - parseInt(this.sessionId.split('-')[1] || '0')
    });

    console.log(`🔒 Security session completed: ${finalEvents} events logged, ${criticalEvents} critical`);

    this.removeAllListeners();
  }
}
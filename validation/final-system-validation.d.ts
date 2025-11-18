/**
 * T029: Final system validation script
 * Comprehensive validation across all migrated tables and system readiness assessment
 */
import { SystemValidationResult } from '../src/interfaces/migration-types';
export declare class FinalSystemValidator {
    private connectionManager;
    private validator;
    private reportGenerator;
    private readonly FINAL_MIGRATION_TABLES;
    constructor();
    validateFinalSystem(): Promise<SystemValidationResult>;
    private validateDatabaseConnectivity;
    private validateDatabaseSchemas;
    private validateCoreDependencies;
    private validateIndividualTable;
    private basicTableValidation;
    private validateCrossTableRelationships;
    private validateSystemPerformance;
    private validateOverallDataIntegrity;
    private determineOverallStatus;
    private generateSystemSummary;
    private generateRecommendedActions;
    private generateFinalSystemReport;
}
declare function main(): Promise<void>;
export { main as validateFinalSystem, FinalSystemValidator };
//# sourceMappingURL=final-system-validation.d.ts.map
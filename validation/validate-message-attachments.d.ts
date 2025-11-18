/**
 * T028: Message attachments validation script
 * Comprehensive validation for migrated message attachment records
 */
import { ValidationResult } from '../src/interfaces/migration-types';
export declare class MessageAttachmentsValidator {
    private connectionManager;
    private validator;
    private reportGenerator;
    constructor();
    validate(): Promise<ValidationResult>;
    private validateCompleteness;
    private validateForeignKeys;
    private validateDataIntegrity;
    private validateBusinessRules;
    private validateAttachmentSpecificRules;
    private combineValidationResults;
    private generateValidationReport;
    getValidationSummary(): Promise<{
        totalRecords: number;
        validRecords: number;
        issues: {
            errors: number;
            warnings: number;
            info: number;
        };
        status: 'passed' | 'failed';
        attachmentTypeDistribution: {
            [type: string]: number;
        };
        averageFileSize: number;
        largeFileCount: number;
    }>;
}
declare function main(): Promise<void>;
export { main as validateMessageAttachments };
//# sourceMappingURL=validate-message-attachments.d.ts.map
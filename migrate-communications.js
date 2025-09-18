"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var pg_1 = require("pg");
var dotenv = require("dotenv");
dotenv.config();
// Source database connection
var sourceClient = new pg_1.Client({
    host: process.env.SOURCE_DB_HOST,
    port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
    database: process.env.SOURCE_DB_NAME,
    user: process.env.SOURCE_DB_USER,
    password: process.env.SOURCE_DB_PASSWORD,
});
// Target database connection
var targetClient = new pg_1.Client({
    host: process.env.TARGET_DB_HOST,
    port: parseInt(process.env.TARGET_DB_PORT || '5432'),
    database: process.env.TARGET_DB_NAME,
    user: process.env.TARGET_DB_USER,
    password: process.env.TARGET_DB_PASSWORD,
});
var BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500');
var TEST_MODE = process.env.TEST_MODE === 'true';
function buildLookupMappings() {
    return __awaiter(this, void 0, void 0, function () {
        var caseResult, caseMapping, _i, _a, row, authorResult, authorMapping, _b, _c, row;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    console.log('Building lookup mappings...');
                    return [4 /*yield*/, targetClient.query("\n    SELECT id, legacy_patient_id \n    FROM cases \n    WHERE legacy_patient_id IS NOT NULL\n  ")];
                case 1:
                    caseResult = _d.sent();
                    caseMapping = new Map();
                    for (_i = 0, _a = caseResult.rows; _i < _a.length; _i++) {
                        row = _a[_i];
                        caseMapping.set(row.legacy_patient_id, row.id);
                    }
                    console.log("  Built ".concat(caseMapping.size, " case mappings"));
                    return [4 /*yield*/, targetClient.query("\n    SELECT id, legacy_user_id \n    FROM profiles \n    WHERE legacy_user_id IS NOT NULL\n  ")];
                case 2:
                    authorResult = _d.sent();
                    authorMapping = new Map();
                    for (_b = 0, _c = authorResult.rows; _b < _c.length; _b++) {
                        row = _c[_b];
                        authorMapping.set(row.legacy_user_id, row.id);
                    }
                    console.log("  Built ".concat(authorMapping.size, " author profile mappings"));
                    return [2 /*return*/, { caseMapping: caseMapping, authorMapping: authorMapping }];
            }
        });
    });
}
function migrateClinicalCommunications(records, caseMapping, authorMapping) {
    return __awaiter(this, void 0, void 0, function () {
        var insertData, skipped, _i, records_1, record, caseId, authorId, communicationType, fields_1, values, query, queryParams, _a, insertData_1, data, result, error_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    insertData = [];
                    skipped = 0;
                    for (_i = 0, records_1 = records; _i < records_1.length; _i++) {
                        record = records_1[_i];
                        caseId = caseMapping.get(record.target_id);
                        authorId = record.author_id ? authorMapping.get(record.author_id) : null;
                        if (!caseId) {
                            skipped++;
                            continue;
                        }
                        communicationType = record.type === 3 ? 'clinical_note' : 'image';
                        insertData.push({
                            legacy_record_id: record.id,
                            case_id: caseId,
                            author_profile: authorId,
                            communication_type: communicationType,
                            payload: JSON.stringify({
                                text: record.text,
                                extra: null,
                                legacy_type: record.type
                            }),
                            created_at: record.created_at,
                            updated_at: record.created_at
                        });
                    }
                    if (insertData.length === 0) {
                        return [2 /*return*/, { success: 0, skipped: skipped, errors: 0 }];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    fields_1 = ['legacy_record_id', 'case_id', 'author_profile', 'communication_type', 'payload', 'created_at', 'updated_at'];
                    values = insertData.map(function (_, index) {
                        var base = index * fields_1.length;
                        return "(".concat(fields_1.map(function (_, i) { return "$".concat(base + i + 1); }).join(', '), ")");
                    }).join(', ');
                    query = "\n      INSERT INTO clinical_communications (".concat(fields_1.join(', '), ")\n      VALUES ").concat(values, "\n      ON CONFLICT (legacy_record_id) DO NOTHING\n    ");
                    queryParams = [];
                    for (_a = 0, insertData_1 = insertData; _a < insertData_1.length; _a++) {
                        data = insertData_1[_a];
                        queryParams.push(data.legacy_id, data.case_id, data.author_profile, data.communication_type, data.payload, data.created_at, data.updated_at);
                    }
                    return [4 /*yield*/, targetClient.query(query, queryParams)];
                case 2:
                    result = _b.sent();
                    return [2 /*return*/, { success: result.rowCount || 0, skipped: skipped, errors: 0 }];
                case 3:
                    error_1 = _b.sent();
                    console.error('    Clinical communications batch error:', error_1);
                    return [2 /*return*/, { success: 0, skipped: skipped, errors: insertData.length }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function migrateTeamCommunications(records, caseMapping, authorMapping) {
    return __awaiter(this, void 0, void 0, function () {
        var insertData, skipped, _i, records_2, record, caseId, authorId, fields_2, values, query, queryParams, _a, insertData_2, data, result, error_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    insertData = [];
                    skipped = 0;
                    for (_i = 0, records_2 = records; _i < records_2.length; _i++) {
                        record = records_2[_i];
                        caseId = caseMapping.get(record.target_id);
                        authorId = record.author_id ? authorMapping.get(record.author_id) : null;
                        if (!caseId) {
                            skipped++;
                            continue;
                        }
                        insertData.push({
                            legacy_record_id: record.id,
                            case_id: caseId,
                            author_profile: authorId,
                            message: record.text,
                            created_at: record.created_at,
                            updated_at: record.created_at
                        });
                    }
                    if (insertData.length === 0) {
                        return [2 /*return*/, { success: 0, skipped: skipped, errors: 0 }];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    fields_2 = ['legacy_record_id', 'case_id', 'author_profile', 'message', 'created_at', 'updated_at'];
                    values = insertData.map(function (_, index) {
                        var base = index * fields_2.length;
                        return "(".concat(fields_2.map(function (_, i) { return "$".concat(base + i + 1); }).join(', '), ")");
                    }).join(', ');
                    query = "\n      INSERT INTO team_communications (".concat(fields_2.join(', '), ")\n      VALUES ").concat(values, "\n      ON CONFLICT (legacy_record_id) DO NOTHING\n    ");
                    queryParams = [];
                    for (_a = 0, insertData_2 = insertData; _a < insertData_2.length; _a++) {
                        data = insertData_2[_a];
                        queryParams.push(data.legacy_id, data.case_id, data.author_profile, data.message, data.created_at, data.updated_at);
                    }
                    return [4 /*yield*/, targetClient.query(query, queryParams)];
                case 2:
                    result = _b.sent();
                    return [2 /*return*/, { success: result.rowCount || 0, skipped: skipped, errors: 0 }];
                case 3:
                    error_2 = _b.sent();
                    console.error('    Team communications batch error:', error_2);
                    return [2 /*return*/, { success: 0, skipped: skipped, errors: insertData.length }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function migrateSystemMessages(records, caseMapping) {
    return __awaiter(this, void 0, void 0, function () {
        var insertData, skipped, _i, records_3, record, caseId, fields_3, values, query, queryParams, _a, insertData_3, data, result, error_3;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    insertData = [];
                    skipped = 0;
                    for (_i = 0, records_3 = records; _i < records_3.length; _i++) {
                        record = records_3[_i];
                        caseId = caseMapping.get(record.target_id);
                        if (!caseId) {
                            skipped++;
                            continue;
                        }
                        insertData.push({
                            legacy_record_id: record.id,
                            case_id: caseId,
                            message_code: record.type,
                            message_text: record.text,
                            created_at: record.created_at,
                            updated_at: record.created_at
                        });
                    }
                    if (insertData.length === 0) {
                        return [2 /*return*/, { success: 0, skipped: skipped, errors: 0 }];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    fields_3 = ['legacy_record_id', 'case_id', 'message_code', 'message_text', 'created_at', 'updated_at'];
                    values = insertData.map(function (_, index) {
                        var base = index * fields_3.length;
                        return "(".concat(fields_3.map(function (_, i) { return "$".concat(base + i + 1); }).join(', '), ")");
                    }).join(', ');
                    query = "\n      INSERT INTO system_messages (".concat(fields_3.join(', '), ")\n      VALUES ").concat(values, "\n      ON CONFLICT (legacy_record_id) DO NOTHING\n    ");
                    queryParams = [];
                    for (_a = 0, insertData_3 = insertData; _a < insertData_3.length; _a++) {
                        data = insertData_3[_a];
                        queryParams.push(data.legacy_id, data.case_id, data.message_code, data.message_text, data.created_at, data.updated_at);
                    }
                    return [4 /*yield*/, targetClient.query(query, queryParams)];
                case 2:
                    result = _b.sent();
                    return [2 /*return*/, { success: result.rowCount || 0, skipped: skipped, errors: 0 }];
                case 3:
                    error_3 = _b.sent();
                    console.error('    System messages batch error:', error_3);
                    return [2 /*return*/, { success: 0, skipped: skipped, errors: insertData.length }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function migrateCommunications() {
    return __awaiter(this, void 0, void 0, function () {
        var _a, caseMapping, authorMapping, countsResult, _i, _b, row, totalRecords, totalSuccess, totalSkipped, totalErrors, types, _c, types_1, typeGroup, typeList, processed, typeCountResult, typeTotal, limit, maxRecords, currentBatchSize, batchResult, records, result, progressPercent, error_4;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 17, 18, 21]);
                    return [4 /*yield*/, sourceClient.connect()];
                case 1:
                    _d.sent();
                    return [4 /*yield*/, targetClient.connect()];
                case 2:
                    _d.sent();
                    console.log('Connected to both databases');
                    return [4 /*yield*/, buildLookupMappings()];
                case 3:
                    _a = _d.sent(), caseMapping = _a.caseMapping, authorMapping = _a.authorMapping;
                    return [4 /*yield*/, sourceClient.query("\n      SELECT \n        type,\n        COUNT(*) as count\n      FROM dispatch_record \n      WHERE type IN (3,4,5,6,8)\n      GROUP BY type\n      ORDER BY type\n    ")];
                case 4:
                    countsResult = _d.sent();
                    console.log('\nDispatch record counts by type:');
                    for (_i = 0, _b = countsResult.rows; _i < _b.length; _i++) {
                        row = _b[_i];
                        console.log("  Type ".concat(row.type, ": ").concat(row.count.toLocaleString()));
                    }
                    console.log('');
                    totalRecords = countsResult.rows.reduce(function (sum, row) { return sum + parseInt(row.count); }, 0);
                    if (TEST_MODE) {
                        console.log('🧪 Running in TEST MODE - processing only first 10 records per type\n');
                    }
                    totalSuccess = 0;
                    totalSkipped = 0;
                    totalErrors = 0;
                    types = [
                        { types: [3, 4], name: 'Clinical Communications', migrator: migrateClinicalCommunications },
                        { types: [6], name: 'Team Communications', migrator: migrateTeamCommunications },
                        { types: [5, 8], name: 'System Messages', migrator: migrateSystemMessages }
                    ];
                    _c = 0, types_1 = types;
                    _d.label = 5;
                case 5:
                    if (!(_c < types_1.length)) return [3 /*break*/, 16];
                    typeGroup = types_1[_c];
                    console.log("\n\uD83D\uDCE8 Migrating ".concat(typeGroup.name, "..."));
                    typeList = typeGroup.types.join(',');
                    processed = 0;
                    return [4 /*yield*/, sourceClient.query("\n        SELECT COUNT(*) as total \n        FROM dispatch_record \n        WHERE type IN (".concat(typeList, ")\n      "))];
                case 6:
                    typeCountResult = _d.sent();
                    typeTotal = parseInt(typeCountResult.rows[0].total);
                    limit = TEST_MODE ? Math.min(10, BATCH_SIZE) : BATCH_SIZE;
                    maxRecords = TEST_MODE ? 10 : typeTotal;
                    _d.label = 7;
                case 7:
                    if (!(processed < maxRecords)) return [3 /*break*/, 15];
                    currentBatchSize = Math.min(limit, maxRecords - processed);
                    console.log("  Processing batch: ".concat(processed + 1, " to ").concat(processed + currentBatchSize));
                    return [4 /*yield*/, sourceClient.query("\n          SELECT id, type, target_id, author_id, text, created_at\n          FROM dispatch_record\n          WHERE type IN (".concat(typeList, ")\n          ORDER BY id\n          LIMIT $1 OFFSET $2\n        "), [currentBatchSize, processed])];
                case 8:
                    batchResult = _d.sent();
                    records = batchResult.rows;
                    if (records.length === 0) {
                        return [3 /*break*/, 15];
                    }
                    result = void 0;
                    if (!(typeGroup.types.includes(3) || typeGroup.types.includes(4))) return [3 /*break*/, 10];
                    return [4 /*yield*/, migrateClinicalCommunications(records, caseMapping, authorMapping)];
                case 9:
                    result = _d.sent();
                    return [3 /*break*/, 14];
                case 10:
                    if (!typeGroup.types.includes(6)) return [3 /*break*/, 12];
                    return [4 /*yield*/, migrateTeamCommunications(records, caseMapping, authorMapping)];
                case 11:
                    result = _d.sent();
                    return [3 /*break*/, 14];
                case 12: return [4 /*yield*/, migrateSystemMessages(records, caseMapping)];
                case 13:
                    result = _d.sent();
                    _d.label = 14;
                case 14:
                    totalSuccess += result.success;
                    totalSkipped += result.skipped;
                    totalErrors += result.errors;
                    if (result.errors === 0) {
                        console.log("    Successfully inserted ".concat(result.success, " records"));
                    }
                    processed += records.length;
                    progressPercent = ((processed / typeTotal) * 100).toFixed(1);
                    console.log("  Progress: ".concat(progressPercent, "% (").concat(processed, "/").concat(typeTotal, ")\n"));
                    return [3 /*break*/, 7];
                case 15:
                    _c++;
                    return [3 /*break*/, 5];
                case 16:
                    console.log('=== Communication Migration Complete ===');
                    console.log("Total processed: ".concat(totalRecords));
                    console.log("Successfully migrated: ".concat(totalSuccess));
                    console.log("Skipped: ".concat(totalSkipped));
                    console.log("Errors: ".concat(totalErrors));
                    return [3 /*break*/, 21];
                case 17:
                    error_4 = _d.sent();
                    console.error('Migration failed:', error_4);
                    process.exit(1);
                    return [3 /*break*/, 21];
                case 18: return [4 /*yield*/, sourceClient.end()];
                case 19:
                    _d.sent();
                    return [4 /*yield*/, targetClient.end()];
                case 20:
                    _d.sent();
                    return [7 /*endfinally*/];
                case 21: return [2 /*return*/];
            }
        });
    });
}
// Run migration
migrateCommunications();

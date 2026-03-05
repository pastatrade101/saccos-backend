const crypto = require("crypto");

const { adminSupabase } = require("../../config/supabase");
const env = require("../../config/env");
const AppError = require("../../utils/app-error");
const { assertTenantAccess, assertBranchAccess } = require("../../services/user-context.service");
const { assertRateLimit } = require("../../services/rate-limit.service");
const { logAudit } = require("../../services/audit.service");
const financeService = require("../finance/finance.service");
const { ensureMemberAccounts, provisionMemberLogin } = require("../members/members.service");
const { parseCsvBuffer, toCsv } = require("../../utils/csv");

const SUPPORTED_HEADERS = [
    "full_name",
    "email",
    "phone",
    "member_no",
    "member_id",
    "national_id",
    "branch_code",
    "status",
    "opening_savings",
    "cumulative_savings",
    "opening_shares",
    "opening_savings_date",
    "opening_shares_date",
    "withdrawal_amount",
    "withdrawal_date",
    "notes",
    "loan_id",
    "loan_amount",
    "interest_rate",
    "term_months",
    "loan_status",
    "loan_disbursed_at",
    "repayment_amount",
    "repayment_date"
];

function isMissingDeletedAtColumn(error) {
    const message = error?.message || "";
    return error?.code === "42703" && message.toLowerCase().includes("deleted_at");
}

function normalizeString(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
}

function parseMoney(value) {
    const normalized = normalizeString(value);

    if (!normalized) {
        return 0;
    }

    const amount = Number(normalized);

    if (!Number.isFinite(amount) || amount < 0) {
        throw new AppError(400, "INVALID_IMPORT_AMOUNT", "Opening balances must be numeric and non-negative.");
    }

    return amount;
}

function parseOptionalPositiveNumber(value, fieldName) {
    const normalized = normalizeString(value);

    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new AppError(400, "INVALID_IMPORT_NUMBER", `${fieldName} must be a positive number when provided.`);
    }

    return parsed;
}

function parseOptionalTimestamp(value, fieldName) {
    const normalized = normalizeString(value);

    if (!normalized) {
        return null;
    }

    const parsed = new Date(normalized);

    if (Number.isNaN(parsed.getTime())) {
        throw new AppError(400, "INVALID_IMPORT_DATE", `${fieldName} must be a valid date or ISO timestamp.`);
    }

    return parsed.toISOString();
}

function normalizeImportRow(raw) {
    return {
        full_name: normalizeString(raw.full_name),
        email: normalizeString(raw.email)?.toLowerCase() || null,
        phone: normalizeString(raw.phone),
        member_no: normalizeString(raw.member_no) || normalizeString(raw.member_id),
        national_id: normalizeString(raw.national_id),
        branch_code: normalizeString(raw.branch_code),
        status: normalizeString(raw.status) || "active",
        opening_savings: normalizeString(raw.opening_savings) || normalizeString(raw.cumulative_savings) || "0",
        opening_shares: normalizeString(raw.opening_shares) || "0",
        opening_savings_date: normalizeString(raw.opening_savings_date),
        opening_shares_date: normalizeString(raw.opening_shares_date),
        withdrawal_amount: normalizeString(raw.withdrawal_amount) || "0",
        withdrawal_date: normalizeString(raw.withdrawal_date),
        notes: normalizeString(raw.notes),
        loan_id: normalizeString(raw.loan_id),
        loan_amount: normalizeString(raw.loan_amount),
        interest_rate: normalizeString(raw.interest_rate),
        term_months: normalizeString(raw.term_months),
        loan_status: normalizeString(raw.loan_status),
        loan_disbursed_at: normalizeString(raw.loan_disbursed_at),
        repayment_amount: normalizeString(raw.repayment_amount) || "0",
        repayment_date: normalizeString(raw.repayment_date)
    };
}

function generatePassword() {
    const lowers = "abcdefghjkmnpqrstuvwxyz";
    const uppers = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const numbers = "23456789";
    const symbols = "!@#$%^&*()-_=+";
    const all = `${lowers}${uppers}${numbers}${symbols}`;

    const picks = [
        lowers[crypto.randomInt(0, lowers.length)],
        uppers[crypto.randomInt(0, uppers.length)],
        numbers[crypto.randomInt(0, numbers.length)],
        symbols[crypto.randomInt(0, symbols.length)]
    ];

    for (let index = picks.length; index < 14; index += 1) {
        picks.push(all[crypto.randomInt(0, all.length)]);
    }

    return picks
        .sort(() => crypto.randomInt(-1, 2))
        .join("");
}

async function resolveBranch({ tenantId, actor, branchCode, defaultBranchId }) {
    if (branchCode) {
        const { data, error } = await adminSupabase
            .from("branches")
            .select("id, code, tenant_id")
            .eq("tenant_id", tenantId)
            .eq("code", branchCode)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) {
            throw new AppError(500, "BRANCH_LOOKUP_FAILED", "Unable to resolve branch from CSV.", error);
        }

        if (!data) {
            throw new AppError(400, "BRANCH_NOT_FOUND", `Branch code ${branchCode} was not found.`);
        }

        assertBranchAccess({ auth: actor }, data.id);
        return data.id;
    }

    const fallbackBranchId = defaultBranchId || actor.branchIds?.[0] || null;

    if (!fallbackBranchId) {
        throw new AppError(400, "BRANCH_REQUIRED", "A default branch is required for member import.");
    }

    assertBranchAccess({ auth: actor }, fallbackBranchId);
    return fallbackBranchId;
}

async function resolveImportJobBranchId({ tenantId, actor, defaultBranchId }) {
    if (defaultBranchId) {
        return defaultBranchId;
    }

    if (actor.branchIds?.length) {
        return actor.branchIds[0];
    }

    const { data, error } = await adminSupabase
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error || !data?.id) {
        throw new AppError(400, "BRANCH_REQUIRED", "A default branch is required for member import.");
    }

    return data.id;
}

async function findExistingMember({ tenantId, memberNo, email, phone }) {
    if (memberNo) {
        const { data, error } = await adminSupabase
            .from("members")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("member_no", memberNo)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) {
            throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to look up member by member number.", error);
        }

        if (data) {
            return data;
        }
    }

    if (email) {
        const { data, error } = await adminSupabase
            .from("members")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("email", email)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) {
            throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to look up member by email.", error);
        }

        if (data) {
            return data;
        }
    }

    if (phone) {
        const { data, error } = await adminSupabase
            .from("members")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("phone", phone)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) {
            throw new AppError(500, "MEMBER_LOOKUP_FAILED", "Unable to look up member by phone.", error);
        }

        if (data) {
            return data;
        }
    }

    return null;
}

async function upsertMember({ actor, tenantId, branchId, row }) {
    const memberNo = normalizeString(row.member_no);
    const email = normalizeString(row.email)?.toLowerCase() || null;
    const phone = normalizeString(row.phone);
    const nationalId = normalizeString(row.national_id);
    const notes = normalizeString(row.notes);
    const status = normalizeString(row.status) || "active";

    const existing = await findExistingMember({
        tenantId,
        memberNo,
        email,
        phone
    });

    if (existing) {
        const { data, error } = await adminSupabase
            .from("members")
            .update({
                branch_id: branchId,
                full_name: row.full_name,
                email,
                phone,
                member_no: memberNo,
                national_id: nationalId,
                notes,
                status
            })
            .eq("id", existing.id)
            .select("*")
            .single();

        if (error || !data) {
            throw new AppError(500, "MEMBER_UPDATE_FAILED", "Unable to update member from import.", error);
        }

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "members",
            entityType: "member",
            entityId: data.id,
            action: "MEMBER_UPDATED",
            beforeData: existing,
            afterData: data
        });

        await ensureMemberAccounts({
            tenantId,
            branchId,
            member: data
        });

        return { member: data, created: false };
    }

    const { data, error } = await adminSupabase
        .from("members")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            full_name: row.full_name,
            email,
            phone,
            member_no: memberNo,
            national_id: nationalId,
            notes,
            status
        })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "MEMBER_CREATE_FAILED", "Unable to create member from import.", error);
    }

    await ensureMemberAccounts({
        tenantId,
        branchId,
        member: data
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "members",
        entityType: "member",
        entityId: data.id,
        action: "MEMBER_CREATED",
        afterData: data
    });

    return { member: data, created: true };
}

async function getMemberProductAccount(memberId, productType) {
    let { data, error } = await adminSupabase
        .from("member_accounts")
        .select("id")
        .eq("member_id", memberId)
        .eq("product_type", productType)
        .is("deleted_at", null)
        .maybeSingle();

    // Backward compatibility for environments where member_accounts.deleted_at is missing.
    if (error && isMissingDeletedAtColumn(error)) {
        ({ data, error } = await adminSupabase
            .from("member_accounts")
            .select("id")
            .eq("member_id", memberId)
            .eq("product_type", productType)
            .maybeSingle());
    }

    if (error || !data) {
        throw new AppError(500, "MEMBER_ACCOUNT_LOOKUP_FAILED", `Unable to load ${productType} account.`, error);
    }

    return data.id;
}

async function backdateJournal(journalId, occurredAt) {
    if (!journalId || !occurredAt) {
        return;
    }

    const { error } = await adminSupabase
        .from("journal_entries")
        .update({
            entry_date: occurredAt.slice(0, 10),
            posted_at: occurredAt,
            created_at: occurredAt,
            updated_at: occurredAt
        })
        .eq("id", journalId);

    if (error) {
        throw new AppError(500, "IMPORT_JOURNAL_BACKDATE_FAILED", "Unable to backdate imported journal.", error);
    }
}

async function backdateMemberTransaction({ journalId, accountId, transactionType, occurredAt }) {
    if (!journalId || !accountId || !transactionType || !occurredAt) {
        return;
    }

    const { error } = await adminSupabase
        .from("member_account_transactions")
        .update({
            created_at: occurredAt
        })
        .eq("journal_id", journalId)
        .eq("member_account_id", accountId)
        .eq("transaction_type", transactionType);

    if (error) {
        throw new AppError(500, "IMPORT_MEMBER_TX_BACKDATE_FAILED", "Unable to backdate imported member transaction.", error);
    }
}

async function backdateLoanRecords({ loanId, journalId, reference, occurredAt, transactionType }) {
    if (!loanId || !occurredAt) {
        return;
    }

    const { error: loanError } = await adminSupabase
        .from("loans")
        .update({
            created_at: occurredAt,
            updated_at: occurredAt,
            disbursed_at: occurredAt
        })
        .eq("id", loanId);

    if (loanError) {
        throw new AppError(500, "IMPORT_LOAN_BACKDATE_FAILED", "Unable to backdate imported loan.", loanError);
    }

    const { error: loanAccountError } = await adminSupabase
        .from("loan_accounts")
        .update({
            created_at: occurredAt,
            updated_at: occurredAt
        })
        .eq("loan_id", loanId);

    if (loanAccountError) {
        throw new AppError(500, "IMPORT_LOAN_ACCOUNT_BACKDATE_FAILED", "Unable to backdate imported loan account.", loanAccountError);
    }

    await backdateJournal(journalId, occurredAt);

    let query = adminSupabase
        .from("loan_account_transactions")
        .update({
            created_at: occurredAt
        })
        .eq("loan_id", loanId)
        .eq("transaction_type", transactionType);

    if (reference) {
        query = query.eq("reference", reference);
    }

    const { error: transactionError } = await query;

    if (transactionError) {
        throw new AppError(500, "IMPORT_LOAN_TX_BACKDATE_FAILED", "Unable to backdate imported loan activity.", transactionError);
    }
}

async function postOpeningBalances({ actor, tenantId, member, openingSavings, openingSavingsDate, openingShares, openingSharesDate }) {
    if (openingSavings > 0) {
        const accountId = await getMemberProductAccount(member.id, "savings");
        const result = await financeService.deposit(actor, {
            tenant_id: tenantId,
            account_id: accountId,
            amount: openingSavings,
            teller_id: actor.user.id,
            reference: "OPENING_BALANCE",
            description: `Opening savings balance import for ${member.full_name}`
        });

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "journal_entries",
            entityType: "journal_entry",
            entityId: result.journal_id || null,
            action: "OPENING_BALANCE_POSTED",
            afterData: {
                member_id: member.id,
                account_id: accountId,
                product_type: "savings",
                amount: openingSavings
            }
        });

        await backdateJournal(result.journal_id || null, openingSavingsDate);
        await backdateMemberTransaction({
            journalId: result.journal_id || null,
            accountId,
            transactionType: "deposit",
            occurredAt: openingSavingsDate
        });
    }

    if (openingShares > 0) {
        const shareAccountId = await getMemberProductAccount(member.id, "shares");
        const result = await financeService.shareContribution(actor, {
            tenant_id: tenantId,
            account_id: shareAccountId,
            amount: openingShares,
            teller_id: actor.user.id,
            reference: "OPENING_BALANCE",
            description: `Opening shares balance import for ${member.full_name}`
        });

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "journal_entries",
            entityType: "journal_entry",
            entityId: result.journal_id || null,
            action: "OPENING_BALANCE_POSTED",
            afterData: {
                member_id: member.id,
                account_id: shareAccountId,
                product_type: "shares",
                amount: openingShares
            }
        });

        await backdateJournal(result.journal_id || null, openingSharesDate);
        await backdateMemberTransaction({
            journalId: result.journal_id || null,
            accountId: shareAccountId,
            transactionType: "share_contribution",
            occurredAt: openingSharesDate
        });
    }
}

async function createImportJob({ tenantId, branchId, createdBy }) {
    const { data, error } = await adminSupabase
        .from("import_jobs")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            created_by: createdBy,
            status: "pending"
        })
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "IMPORT_JOB_CREATE_FAILED", "Unable to create import job.", error);
    }

    return data;
}

async function insertJobRow(row) {
    const { error } = await adminSupabase.from("import_job_rows").insert(row);

    if (error) {
        throw new AppError(500, "IMPORT_JOB_ROW_WRITE_FAILED", "Unable to write import row result.", error);
    }
}

async function updateImportJob(jobId, payload) {
    const { data, error } = await adminSupabase
        .from("import_jobs")
        .update(payload)
        .eq("id", jobId)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "IMPORT_JOB_UPDATE_FAILED", "Unable to update import job.", error);
    }

    return data;
}

async function uploadCsv(path, csvContent) {
    const bucket = adminSupabase.storage.from(env.importsBucket);
    const upload = await bucket.upload(path, Buffer.from(csvContent, "utf8"), {
        contentType: "text/csv",
        upsert: true
    });

    if (upload.error) {
        throw new AppError(500, "IMPORT_EXPORT_UPLOAD_FAILED", "Unable to upload import export.", upload.error);
    }
}

async function findImportedLoanByReference({ tenantId, reference }) {
    if (!reference) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("loan_account_transactions")
        .select("loan_id, reference")
        .eq("tenant_id", tenantId)
        .eq("transaction_type", "loan_disbursement")
        .eq("reference", reference)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOAN_LOOKUP_FAILED", "Unable to verify existing imported loan.", error);
    }

    return data || null;
}

async function postImportedLoan({ actor, tenantId, branchId, member, row }) {
    const loanAmount = parseOptionalPositiveNumber(row.loan_amount, "loan_amount");

    if (!loanAmount) {
        return null;
    }

    const loanStatus = (normalizeString(row.loan_status) || "active").toLowerCase();

    if (loanStatus !== "active") {
        throw new AppError(
            400,
            "UNSUPPORTED_IMPORTED_LOAN_STATUS",
            "CSV loan import currently supports only active loans."
        );
    }

    const interestRate = parseOptionalPositiveNumber(row.interest_rate, "interest_rate");
    const termMonths = parseOptionalPositiveNumber(row.term_months, "term_months");

    if (!interestRate || !termMonths) {
        throw new AppError(
            400,
            "IMPORTED_LOAN_FIELDS_REQUIRED",
            "interest_rate and term_months are required when loan_amount is provided."
        );
    }

    const externalLoanReference = normalizeString(row.loan_id);
    const existingImportedLoan = await findImportedLoanByReference({
        tenantId,
        reference: externalLoanReference
    });

    if (existingImportedLoan) {
        return {
            skipped: true,
            reference: externalLoanReference,
            loan_id: existingImportedLoan.loan_id
        };
    }

    const result = await financeService.loanDisburse(
        actor,
        {
            tenant_id: tenantId,
            member_id: member.id,
            branch_id: branchId,
            principal_amount: loanAmount,
            annual_interest_rate: interestRate,
            term_count: Math.round(termMonths),
            repayment_frequency: "monthly",
            reference: externalLoanReference || `IMPORT-LOAN-${member.member_no || member.id}`,
            description: `Imported loan opening balance for ${member.full_name}`
        },
        { skipWorkflow: true }
    );

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loans",
        entityType: "loan",
        entityId: result.loan_id || null,
        action: "LOAN_IMPORT_POSTED",
        afterData: {
            member_id: member.id,
            loan_reference: externalLoanReference || null,
            loan_number: result.loan_number || null,
            loan_amount: loanAmount,
            interest_rate: interestRate,
            term_months: Math.round(termMonths)
        }
    });

    const loanDisbursedAt = parseOptionalTimestamp(row.loan_disbursed_at, "loan_disbursed_at");

    await backdateLoanRecords({
        loanId: result.loan_id || null,
        journalId: result.journal_id || null,
        reference: externalLoanReference || `IMPORT-LOAN-${member.member_no || member.id}`,
        occurredAt: loanDisbursedAt,
        transactionType: "loan_disbursement"
    });

    return result;
}

async function postImportedWithdrawal({ actor, tenantId, member, row }) {
    const withdrawalAmount = parseOptionalPositiveNumber(row.withdrawal_amount, "withdrawal_amount");

    if (!withdrawalAmount) {
        return null;
    }

    const savingsAccountId = await getMemberProductAccount(member.id, "savings");
    const result = await financeService.withdraw(actor, {
        tenant_id: tenantId,
        account_id: savingsAccountId,
        amount: withdrawalAmount,
        teller_id: actor.user.id,
        reference: `IMPORT-WDL-${member.member_no || member.id}`,
        description: `Imported withdrawal activity for ${member.full_name}`
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "journal_entries",
        entityType: "journal_entry",
        entityId: result.journal_id || null,
        action: "WITHDRAWAL_IMPORT_POSTED",
        afterData: {
            member_id: member.id,
            account_id: savingsAccountId,
            amount: withdrawalAmount
        }
    });

    const withdrawalDate = parseOptionalTimestamp(row.withdrawal_date, "withdrawal_date");

    await backdateJournal(result.journal_id || null, withdrawalDate);
    await backdateMemberTransaction({
        journalId: result.journal_id || null,
        accountId: savingsAccountId,
        transactionType: "withdrawal",
        occurredAt: withdrawalDate
    });

    return result;
}

async function postImportedRepayment({ actor, tenantId, row, loanId }) {
    const repaymentAmount = parseOptionalPositiveNumber(row.repayment_amount, "repayment_amount");

    if (!repaymentAmount) {
        return null;
    }

    if (!loanId) {
        throw new AppError(
            400,
            "IMPORTED_REPAYMENT_LOAN_REQUIRED",
            "repayment_amount requires a loan in the same row or a previously imported loan reference."
        );
    }

    const result = await financeService.loanRepay(actor, {
        tenant_id: tenantId,
        loan_id: loanId,
        amount: repaymentAmount,
        user_id: actor.user.id,
        reference: `IMPORT-REPAY-${normalizeString(row.loan_id) || loanId}`,
        description: "Imported loan repayment activity"
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "loans",
        entityType: "loan",
        entityId: loanId,
        action: "LOAN_REPAYMENT_IMPORT_POSTED",
        afterData: {
            loan_id: loanId,
            amount: repaymentAmount
        }
    });

    const repaymentDate = parseOptionalTimestamp(row.repayment_date, "repayment_date");

    await backdateLoanRecords({
        loanId,
        journalId: result.journal_id || null,
        reference: `IMPORT-REPAY-${normalizeString(row.loan_id) || loanId}`,
        occurredAt: repaymentDate,
        transactionType: "loan_repayment"
    });

    return result;
}

async function createSignedUrl(path) {
    const bucket = adminSupabase.storage.from(env.importsBucket);
    const signed = await bucket.createSignedUrl(path, 60 * 10);

    if (signed.error || !signed.data?.signedUrl) {
        throw new AppError(500, "IMPORT_EXPORT_SIGN_FAILED", "Unable to sign import export.", signed.error);
    }

    return signed.data.signedUrl;
}

function ensureCsvHeaders(headers) {
    const missingCore = ["full_name"].filter((header) => !headers.includes(header));

    if (missingCore.length) {
        throw new AppError(400, "IMPORT_HEADERS_INVALID", `CSV is missing required columns: ${missingCore.join(", ")}`);
    }

    const unsupportedHeaders = headers.filter((header) => !SUPPORTED_HEADERS.includes(header));

    if (unsupportedHeaders.length) {
        throw new AppError(
            400,
            "IMPORT_HEADERS_UNSUPPORTED",
            `CSV contains unsupported columns: ${unsupportedHeaders.join(", ")}`
        );
    }
}

function validatePreviewRow(normalizedRow, options) {
    const errors = [];

    if (!normalizedRow.full_name) {
        errors.push("full_name is required.");
    }

    if (options.create_portal_account && !normalizedRow.email) {
        errors.push("email is required when create_portal_account is enabled.");
    }

    try {
        parseMoney(normalizedRow.opening_savings);
    } catch (error) {
        errors.push(error.message);
    }

    try {
        parseMoney(normalizedRow.opening_shares);
    } catch (error) {
        errors.push(error.message);
    }

    try {
        parseOptionalPositiveNumber(normalizedRow.loan_amount, "loan_amount");
    } catch (error) {
        errors.push(error.message);
    }

    try {
        parseOptionalPositiveNumber(normalizedRow.interest_rate, "interest_rate");
    } catch (error) {
        errors.push(error.message);
    }

    try {
        parseOptionalPositiveNumber(normalizedRow.term_months, "term_months");
    } catch (error) {
        errors.push(error.message);
    }

    try {
        parseOptionalPositiveNumber(normalizedRow.withdrawal_amount, "withdrawal_amount");
    } catch (error) {
        errors.push(error.message);
    }

    try {
        parseOptionalPositiveNumber(normalizedRow.repayment_amount, "repayment_amount");
    } catch (error) {
        errors.push(error.message);
    }

    return errors;
}

async function previewMemberImport({ actor, fileBuffer, options }) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const { headers, rows } = parseCsvBuffer(fileBuffer);
    ensureCsvHeaders(headers);

    const memberNoSeen = new Set();
    const emailSeen = new Set();
    const phoneSeen = new Set();

    const previewRows = rows.map((rowEntry) => {
        const normalized = normalizeImportRow(rowEntry.raw);
        const errors = validatePreviewRow(normalized, options);

        if (normalized.member_no) {
            const key = normalized.member_no.toLowerCase();
            if (memberNoSeen.has(key)) {
                errors.push("Duplicate member_no in uploaded CSV.");
            } else {
                memberNoSeen.add(key);
            }
        }

        if (normalized.email) {
            const key = normalized.email.toLowerCase();
            if (emailSeen.has(key)) {
                errors.push("Duplicate email in uploaded CSV.");
            } else {
                emailSeen.add(key);
            }
        }

        if (normalized.phone) {
            const key = normalized.phone;
            if (phoneSeen.has(key)) {
                errors.push("Duplicate phone in uploaded CSV.");
            } else {
                phoneSeen.add(key);
            }
        }

        return {
            row_number: rowEntry.rowNumber,
            data: normalized,
            errors
        };
    });

    const invalidRows = previewRows.filter((row) => row.errors.length > 0).length;

    return {
        headers,
        total_rows: rows.length,
        valid_rows: rows.length - invalidRows,
        invalid_rows: invalidRows,
        rows: previewRows
    };
}

async function runMemberImportJob({ jobId, actor, fileBuffer, options, requestMeta }) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const defaultBranchId = await resolveImportJobBranchId({
        tenantId,
        actor,
        defaultBranchId: options.default_branch_id || null
    });

    if (defaultBranchId) {
        assertBranchAccess({ auth: actor }, defaultBranchId);
    }

    try {
        await updateImportJob(jobId, {
            status: "processing"
        });

        const { headers, rows } = parseCsvBuffer(fileBuffer);
        ensureCsvHeaders(headers);

        const credentialsRows = [];
        let successRows = 0;
        let failedRows = 0;

        for (const rowEntry of rows) {
            try {
                const normalizedRow = normalizeImportRow(rowEntry.raw);
                const fullName = normalizedRow.full_name;
                const email = normalizedRow.email;

                if (!fullName) {
                    throw new AppError(400, "FULL_NAME_REQUIRED", "full_name is required.");
                }

                if (options.create_portal_account && !email) {
                    throw new AppError(400, "EMAIL_REQUIRED", "email is required when create_portal_account is enabled.");
                }

                const branchId = await resolveBranch({
                    tenantId,
                    actor,
                    branchCode: normalizedRow.branch_code,
                    defaultBranchId
                });

                const upserted = await upsertMember({
                    actor,
                    tenantId,
                    branchId,
                    row: {
                        ...normalizedRow,
                        full_name: fullName
                    }
                });

                const openingSavings = parseMoney(normalizedRow.opening_savings);
                const openingShares = parseMoney(normalizedRow.opening_shares);
                const openingSavingsDate = parseOptionalTimestamp(normalizedRow.opening_savings_date, "opening_savings_date");
                const openingSharesDate = parseOptionalTimestamp(normalizedRow.opening_shares_date, "opening_shares_date");

                if (openingSavings > 0 || openingShares > 0) {
                    await postOpeningBalances({
                        actor,
                        tenantId,
                        member: upserted.member,
                        openingSavings,
                        openingSavingsDate,
                        openingShares,
                        openingSharesDate
                    });
                }

                const importedLoan = await postImportedLoan({
                    actor,
                    tenantId,
                    branchId,
                    member: upserted.member,
                    row: normalizedRow
                });

                await postImportedWithdrawal({
                    actor,
                    tenantId,
                    member: upserted.member,
                    row: normalizedRow
                });

                await postImportedRepayment({
                    actor,
                    tenantId,
                    row: normalizedRow,
                    loanId: importedLoan?.loan_id || null
                });

                let authUserId = upserted.member.user_id || null;

                if (options.create_portal_account) {
                    assertRateLimit({
                        key: `member-import-auth:${actor.user.id}`,
                        max: env.authUserCreateRateLimitMax,
                        windowMs: env.authUserCreateRateLimitWindowMs,
                        code: "AUTH_USER_CREATE_RATE_LIMIT",
                        message: "Too many member portal accounts are being created. Try again later."
                    });

                    const tempPassword = generatePassword();
                    const loginResult = await provisionMemberLogin(actor, upserted.member, {
                        email,
                        send_invite: false,
                        password: tempPassword,
                        branch_id: branchId,
                        must_change_password: true
                    });

                    authUserId = loginResult.user.id;

                    if (!loginResult.already_exists) {
                        credentialsRows.push({
                            full_name: upserted.member.full_name,
                            email,
                            member_no: upserted.member.member_no || "",
                            temp_password: tempPassword
                        });
                    }

                    await logAudit({
                        tenantId,
                        actorUserId: actor.user.id,
                        table: "user_profiles",
                        entityType: "user_profile",
                        entityId: authUserId,
                        action: "MEMBER_PORTAL_CREATED",
                        ip: requestMeta.ip,
                        userAgent: requestMeta.userAgent,
                        afterData: {
                            member_id: upserted.member.id,
                            email
                        }
                    });
                }

                await insertJobRow({
                    job_id: jobId,
                    row_number: rowEntry.rowNumber,
                    raw: rowEntry.raw,
                    status: "success",
                    member_id: upserted.member.id,
                    auth_user_id: authUserId
                });

                successRows += 1;
            } catch (error) {
                failedRows += 1;
                await insertJobRow({
                    job_id: jobId,
                    row_number: rowEntry.rowNumber,
                    raw: rowEntry.raw,
                    status: "failed",
                    error: error.message || "Import row failed."
                });
            }
        }

        let credentialsPath = null;
        let credentialsDownloadUrl = null;

        if (credentialsRows.length) {
            const credentialsCsv = toCsv(
                ["full_name", "email", "member_no", "temp_password"],
                credentialsRows
            );
            credentialsPath = `tenant/${tenantId}/imports/${jobId}/credentials.csv`;
            await uploadCsv(credentialsPath, credentialsCsv);
        }

        const completedJob = await updateImportJob(jobId, {
            status: failedRows === rows.length && rows.length > 0 ? "failed" : "completed",
            total_rows: rows.length,
            success_rows: successRows,
            failed_rows: failedRows,
            credentials_path: credentialsPath,
            completed_at: new Date().toISOString()
        });

        await logAudit({
            tenantId,
            actorUserId: actor.user.id,
            table: "import_jobs",
            entityType: "import_job",
            entityId: jobId,
            action: "IMPORT_MEMBERS_COMPLETED",
            ip: requestMeta.ip,
            userAgent: requestMeta.userAgent,
            afterData: {
                total_rows: rows.length,
                success_rows: successRows,
                failed_rows: failedRows,
                credentials_path: credentialsPath
            }
        });

        return {
            job_id: completedJob.id,
            total_rows: completedJob.total_rows,
            success_rows: completedJob.success_rows,
            failed_rows: completedJob.failed_rows
        };
    } catch (error) {
        await updateImportJob(jobId, {
            status: "failed",
            completed_at: new Date().toISOString()
        });

        throw error;
    }
}

async function processMemberImport({ actor, fileBuffer, options, requestMeta }) {
    const tenantId = actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const defaultBranchId = await resolveImportJobBranchId({
        tenantId,
        actor,
        defaultBranchId: options.default_branch_id || null
    });

    if (defaultBranchId) {
        assertBranchAccess({ auth: actor }, defaultBranchId);
    }

    const job = await createImportJob({
        tenantId,
        branchId: defaultBranchId,
        createdBy: actor.user.id
    });

    await logAudit({
        tenantId,
        actorUserId: actor.user.id,
        table: "import_jobs",
        entityType: "import_job",
        entityId: job.id,
        action: "IMPORT_MEMBERS_STARTED",
        ip: requestMeta.ip,
        userAgent: requestMeta.userAgent,
        afterData: {
            create_portal_account: options.create_portal_account
        }
    });

    setImmediate(() => {
        void runMemberImportJob({
            jobId: job.id,
            actor,
            fileBuffer,
            options,
            requestMeta
        }).catch(() => {});
    });

    return {
        job_id: job.id,
        total_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        status: "pending"
    };
}

async function getImportJob(actor, jobId) {
    const { data, error } = await adminSupabase
        .from("import_jobs")
        .select("*")
        .eq("id", jobId)
        .eq("tenant_id", actor.tenantId)
        .single();

    if (error || !data) {
        throw new AppError(404, "IMPORT_JOB_NOT_FOUND", "Import job was not found.", error);
    }

    return data;
}

async function listImportRows(actor, jobId, query) {
    await getImportJob(actor, jobId);
    const page = query.page || 1;
    const limit = query.limit || 25;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let rowsQuery = adminSupabase
        .from("import_job_rows")
        .select("*", { count: "exact" })
        .eq("job_id", jobId)
        .order("row_number", { ascending: true })
        .range(from, to);

    if (query.status) {
        rowsQuery = rowsQuery.eq("status", query.status);
    }

    const { data, error, count } = await rowsQuery;

    if (error) {
        throw new AppError(500, "IMPORT_JOB_ROWS_FAILED", "Unable to load import job rows.", error);
    }

    return {
        items: data || [],
        total: count || 0,
        page,
        limit
    };
}

async function getFailuresCsv(actor, jobId) {
    await getImportJob(actor, jobId);

    const { data, error } = await adminSupabase
        .from("import_job_rows")
        .select("row_number, error, raw")
        .eq("job_id", jobId)
        .eq("status", "failed")
        .order("row_number", { ascending: true });

    if (error) {
        throw new AppError(500, "IMPORT_FAILURES_FAILED", "Unable to load import failures.", error);
    }

    const rows = (data || []).map((row) => ({
        row_number: row.row_number,
        error: row.error || "",
        raw_data: JSON.stringify(row.raw || {})
    }));

    return toCsv(["row_number", "error", "raw_data"], rows);
}

async function getCredentialsDownloadUrl(actor, jobId) {
    const job = await getImportJob(actor, jobId);

    if (!job.credentials_path) {
        throw new AppError(404, "IMPORT_CREDENTIALS_NOT_FOUND", "Credentials export is not available for this import.");
    }

    return createSignedUrl(job.credentials_path);
}

module.exports = {
    previewMemberImport,
    processMemberImport,
    getImportJob,
    listImportRows,
    getFailuresCsv,
    getCredentialsDownloadUrl
};

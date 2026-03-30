const crypto = require("crypto");

const { adminSupabase } = require("../config/supabase");
const env = require("../config/env");
const { SMS_TRIGGER_EVENT_TYPES } = require("../modules/notification-settings/notification-settings.constants");
const {
    createInAppNotifications,
    filterRecipientsByNotificationPreference
} = require("../modules/notifications/notifications.service");
const { getSubscriptionStatus } = require("./subscription.service");
const { normalizePhone } = require("./otp.service");
const { sendTransactionalSms } = require("./sms.service");

function isMissingRelationError(error) {
    const code = String(error?.code || "");
    return code === "PGRST205" || code === "42P01" || code === "42703";
}

function formatAmount(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0";
    return new Intl.NumberFormat("en-TZ", {
        maximumFractionDigits: 0
    }).format(numeric);
}

function shortId(value) {
    return String(value || "").slice(0, 8);
}

function buildReference(eventKey, userId) {
    const hash = crypto
        .createHash("sha256")
        .update(`${eventKey}:${userId}:${Date.now()}`)
        .digest("hex")
        .slice(0, 10);

    return `alert-${hash}`;
}

const smsTriggerCache = new Map();
const SMS_TRIGGER_CACHE_TTL_MS = 30 * 1000;

function invalidateSmsTriggerCache(tenantId = null) {
    if (tenantId) {
        smsTriggerCache.delete(tenantId);
        return;
    }
    smsTriggerCache.clear();
}

async function loadSmsTriggerMap(tenantId) {
    const cached = smsTriggerCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.map;
    }

    const { data, error } = await adminSupabase
        .from("sms_trigger_settings")
        .select("event_type, enabled")
        .eq("tenant_id", tenantId);

    if (error) {
        if (isMissingRelationError(error)) {
            return null;
        }
        throw error;
    }

    const map = new Map();
    for (const row of data || []) {
        map.set(String(row.event_type), Boolean(row.enabled));
    }
    smsTriggerCache.set(tenantId, {
        map,
        expiresAt: Date.now() + SMS_TRIGGER_CACHE_TTL_MS
    });

    return map;
}

async function isSmsTriggerEnabled(tenantId, eventType) {
    if (!eventType || !tenantId) {
        return false;
    }

    try {
        const subscription = await getSubscriptionStatus(tenantId);
        if (!subscription?.isUsable || !subscription?.features?.sms_trigger_controls_enabled) {
            return false;
        }
    } catch (error) {
        console.warn("[branch-alerts] subscription check failed", {
            tenantId,
            message: error?.message || "unknown_error"
        });
        return false;
    }

    if (!SMS_TRIGGER_EVENT_TYPES.includes(eventType)) {
        return true;
    }

    try {
        const map = await loadSmsTriggerMap(tenantId);
        if (map === null) {
            return true;
        }
        if (!map.has(eventType)) {
            return true;
        }

        return Boolean(map.get(eventType));
    } catch (error) {
        console.warn("[branch-alerts] sms trigger settings lookup failed", {
            tenantId,
            eventType,
            message: error?.message || "unknown_error"
        });
        return true;
    }
}

async function loadBranchManagerRecipients({ tenantId, branchId, excludeUserIds = [] }) {
    return loadRoleRecipients({
        tenantId,
        branchId,
        role: "branch_manager",
        excludeUserIds
    });
}

async function loadRoleRecipients({
    tenantId,
    branchId = null,
    role,
    excludeUserIds = [],
    restrictToUserIds = []
}) {
    let scopedUserIds = [];

    if (branchId) {
        const { data: assignments, error: assignmentError } = await adminSupabase
            .from("branch_staff_assignments")
            .select("user_id")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .is("deleted_at", null);

        if (!assignmentError) {
            scopedUserIds = Array.from(new Set((assignments || []).map((row) => row.user_id).filter(Boolean)));
        }
    }

    if (Array.isArray(restrictToUserIds) && restrictToUserIds.length) {
        scopedUserIds = Array.from(new Set([
            ...scopedUserIds,
            ...restrictToUserIds.filter(Boolean)
        ]));
    }

    let profilesQuery = adminSupabase
        .from("user_profiles")
        .select("user_id, full_name, phone")
        .eq("tenant_id", tenantId)
        .eq("role", role)
        .eq("is_active", true)
        .is("deleted_at", null);

    if (scopedUserIds.length) {
        profilesQuery = profilesQuery.in("user_id", scopedUserIds);
    }

    const { data: profiles, error: profilesError } = await profilesQuery;
    if (profilesError) {
        throw profilesError;
    }

    const excluded = new Set((excludeUserIds || []).filter(Boolean));

    return (profiles || [])
        .filter((row) => row.user_id && !excluded.has(row.user_id))
        .map((row) => {
            try {
                return {
                    user_id: row.user_id,
                    full_name: row.full_name || "Branch Manager",
                    phone: normalizePhone(row.phone || "")
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

async function loadRecipientsByUserIds({ tenantId, userIds = [], excludeUserIds = [] }) {
    const distinctUserIds = Array.from(new Set((userIds || []).filter(Boolean)));
    if (!distinctUserIds.length) {
        return [];
    }

    const { data: profiles, error } = await adminSupabase
        .from("user_profiles")
        .select("user_id, full_name, phone, role")
        .eq("tenant_id", tenantId)
        .in("user_id", distinctUserIds)
        .eq("is_active", true)
        .is("deleted_at", null);

    if (error) {
        throw error;
    }

    const excluded = new Set((excludeUserIds || []).filter(Boolean));
    const allowed = new Set(distinctUserIds);

    return (profiles || [])
        .filter((row) => row.user_id && !excluded.has(row.user_id) && allowed.has(row.user_id))
        .map((row) => {
            try {
                return {
                    user_id: row.user_id,
                    full_name: row.full_name || "Staff",
                    role: row.role || null,
                    phone: normalizePhone(row.phone || "")
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function loadDirectPhoneRecipients({ phones = [] }) {
    return Array.from(new Set((phones || []).filter(Boolean)))
        .map((phone) => {
            try {
                return {
                    user_id: null,
                    full_name: "Applicant",
                    phone: normalizePhone(phone)
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

async function createDispatchRow({
    tenantId,
    branchId,
    eventType,
    eventKey,
    message,
    metadata,
    target
}) {
    const { data, error } = await adminSupabase
        .from("notification_dispatches")
        .insert({
            tenant_id: tenantId,
            branch_id: branchId || null,
            event_type: eventType,
            event_key: eventKey,
            channel: "sms",
            target_user_id: target.user_id || null,
            target_phone: target.phone,
            message,
            metadata: metadata || {},
            status: "pending"
        })
        .select("id")
        .single();

    if (error) {
        if (String(error.code || "") === "23505") {
            return null;
        }
        throw error;
    }

    return data?.id || null;
}

async function markDispatchStatus(dispatchId, patch) {
    const { error } = await adminSupabase
        .from("notification_dispatches")
        .update(patch)
        .eq("id", dispatchId);

    if (error && !isMissingRelationError(error)) {
        throw error;
    }
}

async function notifyBranchManagers({
    tenantId,
    branchId = null,
    eventType,
    eventKey,
    message,
    metadata = {},
    excludeUserIds = []
}) {
    try {
        const recipients = await loadBranchManagerRecipients({
            tenantId,
            branchId,
            excludeUserIds
        });

        if (!recipients.length) {
            return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0, in_app_delivered: 0, in_app_skipped: 0 };
        }

        const inAppResult = await createInAppNotifications({
            tenantId,
            branchId,
            eventType,
            eventKey,
            message,
            metadata,
            recipients
        });

        if (!env.branchAlertSmsEnabled) {
            return { enabled: false, delivered: 0, skipped: 0, failed: 0, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
        }

        const muted = !(await isSmsTriggerEnabled(tenantId, eventType));
        if (muted) {
            return { enabled: true, muted: true, delivered: 0, skipped: 0, failed: 0, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
        }

        const smsRecipients = await filterRecipientsByNotificationPreference({
            tenantId,
            eventType,
            recipients,
            channel: "sms"
        });

        let delivered = 0;
        let skipped = Math.max(0, recipients.length - smsRecipients.length);
        let failed = 0;

        for (const recipient of smsRecipients) {
            const dispatchId = await createDispatchRow({
                tenantId,
                branchId,
                eventType,
                eventKey,
                message,
                metadata,
                target: recipient
            }).catch((error) => {
                if (isMissingRelationError(error)) {
                    return null;
                }
                throw error;
            });

            if (!dispatchId) {
                skipped += 1;
                continue;
            }

            try {
                const providerPayload = await sendTransactionalSms({
                    to: recipient.phone,
                    text: message,
                    reference: buildReference(eventKey, recipient.user_id)
                });

                await markDispatchStatus(dispatchId, {
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    provider_payload: providerPayload || {}
                });
                delivered += 1;
            } catch (error) {
                await markDispatchStatus(dispatchId, {
                    status: "failed",
                    failed_at: new Date().toISOString(),
                    error_message: error?.message || "SMS send failed."
                }).catch(() => null);
                failed += 1;
            }
        }

        return { enabled: true, delivered, skipped, failed, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
    } catch (error) {
        if (!isMissingRelationError(error)) {
            console.warn("[branch-alerts] dispatch failed", {
                eventType,
                eventKey,
                message: error?.message || "unknown_error"
            });
        }
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0, in_app_delivered: 0, in_app_skipped: 0 };
    }
}

async function notifyRoleUsers({
    tenantId,
    branchId = null,
    role,
    eventType,
    eventKey,
    message,
    metadata = {},
    excludeUserIds = [],
    restrictToUserIds = []
}) {
    try {
        const recipients = await loadRoleRecipients({
            tenantId,
            branchId,
            role,
            excludeUserIds,
            restrictToUserIds
        });

        if (!recipients.length) {
            return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0, in_app_delivered: 0, in_app_skipped: 0 };
        }

        const inAppResult = await createInAppNotifications({
            tenantId,
            branchId,
            eventType,
            eventKey,
            message,
            metadata,
            recipients
        });

        if (!env.branchAlertSmsEnabled) {
            return { enabled: false, delivered: 0, skipped: 0, failed: 0, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
        }

        const muted = !(await isSmsTriggerEnabled(tenantId, eventType));
        if (muted) {
            return { enabled: true, muted: true, delivered: 0, skipped: 0, failed: 0, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
        }

        const smsRecipients = await filterRecipientsByNotificationPreference({
            tenantId,
            eventType,
            recipients,
            channel: "sms"
        });

        let delivered = 0;
        let skipped = Math.max(0, recipients.length - smsRecipients.length);
        let failed = 0;

        for (const recipient of smsRecipients) {
            const dispatchId = await createDispatchRow({
                tenantId,
                branchId,
                eventType,
                eventKey,
                message,
                metadata,
                target: recipient
            }).catch((error) => {
                if (isMissingRelationError(error)) {
                    return null;
                }
                throw error;
            });

            if (!dispatchId) {
                skipped += 1;
                continue;
            }

            try {
                const providerPayload = await sendTransactionalSms({
                    to: recipient.phone,
                    text: message,
                    reference: buildReference(eventKey, recipient.user_id)
                });

                await markDispatchStatus(dispatchId, {
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    provider_payload: providerPayload || {}
                });
                delivered += 1;
            } catch (error) {
                await markDispatchStatus(dispatchId, {
                    status: "failed",
                    failed_at: new Date().toISOString(),
                    error_message: error?.message || "SMS send failed."
                }).catch(() => null);
                failed += 1;
            }
        }

        return { enabled: true, delivered, skipped, failed, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
    } catch (error) {
        if (!isMissingRelationError(error)) {
            console.warn("[branch-alerts] dispatch failed", {
                role,
                eventType,
                eventKey,
                message: error?.message || "unknown_error"
            });
        }
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0, in_app_delivered: 0, in_app_skipped: 0 };
    }
}

async function notifyUsersById({
    tenantId,
    branchId = null,
    userIds = [],
    eventType,
    eventKey,
    message,
    metadata = {},
    excludeUserIds = []
}) {
    try {
        const recipients = await loadRecipientsByUserIds({
            tenantId,
            userIds,
            excludeUserIds
        });

        if (!recipients.length) {
            return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0, in_app_delivered: 0, in_app_skipped: 0 };
        }

        const inAppResult = await createInAppNotifications({
            tenantId,
            branchId,
            eventType,
            eventKey,
            message,
            metadata,
            recipients
        });

        if (!env.branchAlertSmsEnabled) {
            return { enabled: false, delivered: 0, skipped: 0, failed: 0, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
        }

        const muted = !(await isSmsTriggerEnabled(tenantId, eventType));
        if (muted) {
            return { enabled: true, muted: true, delivered: 0, skipped: 0, failed: 0, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
        }

        const smsRecipients = await filterRecipientsByNotificationPreference({
            tenantId,
            eventType,
            recipients,
            channel: "sms"
        });

        let delivered = 0;
        let skipped = Math.max(0, recipients.length - smsRecipients.length);
        let failed = 0;

        for (const recipient of smsRecipients) {
            const dispatchId = await createDispatchRow({
                tenantId,
                branchId,
                eventType,
                eventKey,
                message,
                metadata,
                target: recipient
            }).catch((error) => {
                if (isMissingRelationError(error)) {
                    return null;
                }
                throw error;
            });

            if (!dispatchId) {
                skipped += 1;
                continue;
            }

            try {
                const providerPayload = await sendTransactionalSms({
                    to: recipient.phone,
                    text: message,
                    reference: buildReference(eventKey, recipient.user_id)
                });

                await markDispatchStatus(dispatchId, {
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    provider_payload: providerPayload || {}
                });
                delivered += 1;
            } catch (error) {
                await markDispatchStatus(dispatchId, {
                    status: "failed",
                    failed_at: new Date().toISOString(),
                    error_message: error?.message || "SMS send failed."
                }).catch(() => null);
                failed += 1;
            }
        }

        return { enabled: true, delivered, skipped, failed, in_app_delivered: inAppResult.delivered, in_app_skipped: inAppResult.skipped };
    } catch (error) {
        if (!isMissingRelationError(error)) {
            console.warn("[branch-alerts] direct dispatch failed", {
                eventType,
                eventKey,
                message: error?.message || "unknown_error"
            });
        }
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0, in_app_delivered: 0, in_app_skipped: 0 };
    }
}

async function notifyDirectPhones({
    tenantId,
    branchId = null,
    phones = [],
    eventType,
    eventKey,
    message,
    metadata = {}
}) {
    if (!env.branchAlertSmsEnabled) {
        return { enabled: false, delivered: 0, skipped: 0, failed: 0 };
    }

    const muted = !(await isSmsTriggerEnabled(tenantId, eventType));
    if (muted) {
        return { enabled: true, muted: true, delivered: 0, skipped: 0, failed: 0 };
    }

    try {
        const recipients = loadDirectPhoneRecipients({ phones });

        if (!recipients.length) {
            return { enabled: true, delivered: 0, skipped: 0, failed: 0 };
        }

        let delivered = 0;
        let skipped = 0;
        let failed = 0;

        for (const recipient of recipients) {
            const dispatchId = await createDispatchRow({
                tenantId,
                branchId,
                eventType,
                eventKey,
                message,
                metadata,
                target: recipient
            }).catch((error) => {
                if (isMissingRelationError(error)) {
                    return null;
                }
                throw error;
            });

            if (!dispatchId) {
                skipped += 1;
                continue;
            }

            try {
                const providerPayload = await sendTransactionalSms({
                    to: recipient.phone,
                    text: message,
                    reference: buildReference(eventKey, recipient.phone)
                });

                await markDispatchStatus(dispatchId, {
                    status: "sent",
                    sent_at: new Date().toISOString(),
                    provider_payload: providerPayload || {}
                });
                delivered += 1;
            } catch (error) {
                await markDispatchStatus(dispatchId, {
                    status: "failed",
                    failed_at: new Date().toISOString(),
                    error_message: error?.message || "SMS send failed."
                }).catch(() => null);
                failed += 1;
            }
        }

        return { enabled: true, delivered, skipped, failed };
    } catch (error) {
        if (!isMissingRelationError(error)) {
            console.warn("[branch-alerts] direct phone dispatch failed", {
                eventType,
                eventKey,
                message: error?.message || "unknown_error"
            });
        }
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }
}

async function notifyApprovalRequestPending({ actor, request }) {
    const operationLabel = request?.operation_key === "finance.loan_disburse"
        ? "loan disbursement"
        : request?.operation_key === "finance.withdraw"
            ? "high-value withdrawal"
            : "high-risk operation";

    const amountText = formatAmount(request?.requested_amount);
    const message = `Action required: ${operationLabel} approval (TZS ${amountText}) pending. Ref ${shortId(request?.id)}.`;

    return notifyBranchManagers({
        tenantId: request?.tenant_id || actor?.tenantId,
        branchId: request?.branch_id || null,
        eventType: "approval_request_pending",
        eventKey: `approval_request_pending:${request?.id}`,
        message,
        metadata: {
            approval_request_id: request?.id,
            operation_key: request?.operation_key,
            requested_amount: request?.requested_amount
        },
        excludeUserIds: [request?.maker_user_id]
    });
}

async function notifyDefaultCaseOpened({ actor, defaultCase }) {
    const message = `Flag: loan ${defaultCase?.loans?.loan_number || shortId(defaultCase?.loan_id)} is delinquent (${defaultCase?.dpd_days || 0} DPD).`;

    return notifyBranchManagers({
        tenantId: defaultCase?.tenant_id || actor?.tenantId,
        branchId: defaultCase?.branch_id || null,
        eventType: "default_case_opened",
        eventKey: `default_case_opened:${defaultCase?.id}`,
        message,
        metadata: {
            default_case_id: defaultCase?.id,
            loan_id: defaultCase?.loan_id,
            dpd_days: defaultCase?.dpd_days
        }
    });
}

async function notifyDefaultCaseClaimReady({ actor, defaultCase }) {
    const message = `Action required: default case ${shortId(defaultCase?.id)} moved to claim-ready. Start guarantor claim workflow.`;

    return notifyBranchManagers({
        tenantId: defaultCase?.tenant_id || actor?.tenantId,
        branchId: defaultCase?.branch_id || null,
        eventType: "default_case_claim_ready",
        eventKey: `default_case_claim_ready:${defaultCase?.id}`,
        message,
        metadata: {
            default_case_id: defaultCase?.id,
            loan_id: defaultCase?.loan_id
        }
    });
}

async function notifyGuarantorClaimSubmitted({ actor, claim }) {
    const message = `Action required: guarantor claim submitted (TZS ${formatAmount(claim?.claim_amount)}). Ref ${shortId(claim?.id)}.`;

    return notifyBranchManagers({
        tenantId: claim?.tenant_id || actor?.tenantId,
        branchId: claim?.branch_id || null,
        eventType: "guarantor_claim_submitted",
        eventKey: `guarantor_claim_submitted:${claim?.id}`,
        message,
        metadata: {
            guarantor_claim_id: claim?.id,
            claim_amount: claim?.claim_amount
        },
        excludeUserIds: [claim?.claimed_by]
    });
}

async function notifyLoanOfficersNewApplication({ actor, application }) {
    const amount = formatAmount(application?.requested_amount || application?.recommended_amount || 0);
    const message = `New loan app ${shortId(application?.id)} submitted (TZS ${amount}). Please appraise.`;

    return notifyRoleUsers({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        role: "loan_officer",
        eventType: "loan_application_submitted",
        eventKey: `loan_application_submitted:${application?.id}`,
        message,
        metadata: {
            loan_application_id: application?.id,
            member_id: application?.member_id,
            requested_amount: application?.requested_amount || null
        },
        excludeUserIds: [actor?.user?.id]
    });
}

async function notifyBranchManagersNewMemberApplication({ actor, application }) {
    const applicantName = String(application?.full_name || "Applicant").trim();
    const reference = application?.application_no || shortId(application?.id);
    const branchLabel = application?.branch_id ? ` in ${application.branch_name || "the branch"}` : "";
    const message = `New member application ${reference} from ${applicantName}${branchLabel}. Review required.`;

    return notifyBranchManagers({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        eventType: "member_application_submitted",
        eventKey: `member_application_submitted:${application?.id}:${application?.updated_at || application?.created_at || Date.now()}`,
        message,
        metadata: {
            member_application_id: application?.id,
            application_no: application?.application_no || null,
            branch_id: application?.branch_id || null,
            applicant_name: applicantName,
            applicant_phone: application?.phone || null,
            status: application?.status || null
        }
    });
}

async function notifyLoanOfficersReappraisalNeeded({ actor, application, reason = "" }) {
    const message = `Loan app ${shortId(application?.id)} rejected. Reason: ${reason || "see review notes"}.`;

    return notifyRoleUsers({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        role: "loan_officer",
        eventType: "loan_application_rejected",
        eventKey: `loan_application_rejected:${application?.id}:${application?.updated_at || Date.now()}`,
        message,
        metadata: {
            loan_application_id: application?.id,
            rejection_reason: reason || null
        },
        excludeUserIds: [actor?.user?.id]
    });
}

async function notifyLoanOfficersApprovedForDisbursement({ actor, application }) {
    const amount = formatAmount(application?.recommended_amount || application?.requested_amount || 0);
    const message = `Loan app ${shortId(application?.id)} approved (TZS ${amount}). Ready for disbursement.`;

    return notifyRoleUsers({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        role: "loan_officer",
        eventType: "loan_application_ready_for_disbursement",
        eventKey: `loan_application_ready_for_disbursement:${application?.id}`,
        message,
        metadata: {
            loan_application_id: application?.id,
            approved_at: application?.approved_at || null
        },
        excludeUserIds: [actor?.user?.id]
    });
}

async function notifyMemberLoanApplicationApproved({ actor, application }) {
    const memberUserId = application?.members?.user_id;
    if (!memberUserId) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const amount = formatAmount(application?.recommended_amount || application?.requested_amount || 0);
    const reference = application?.external_reference || shortId(application?.id);
    const message = `Dear ${application?.members?.full_name || "member"}, your loan application ${reference} for TZS ${amount} has been approved and is ready for disbursement processing.`;

    return notifyUsersById({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        userIds: [memberUserId],
        eventType: "member_loan_application_approved",
        eventKey: `member_loan_application_approved:${application?.id}:${application?.approved_at || Date.now()}`,
        message: message.slice(0, 300),
        metadata: {
            loan_application_id: application?.id,
            member_id: application?.member_id,
            external_reference: application?.external_reference || null,
            approved_at: application?.approved_at || null
        }
    });
}

async function notifyMemberLoanApplicationRejected({ actor, application }) {
    const memberUserId = application?.members?.user_id;
    if (!memberUserId) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const reference = application?.external_reference || shortId(application?.id);
    const reason = String(application?.rejection_reason || "").trim() || "Please review the branch feedback and update the application.";
    const notes = String(application?.approval_notes || "").trim();
    const details = notes ? `${reason}. Notes: ${notes}` : reason;
    const message = `Dear ${application?.members?.full_name || "member"}, your loan application ${reference} was not approved. Reason: ${details}`;

    return notifyUsersById({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        userIds: [memberUserId],
        eventType: "member_loan_application_rejected",
        eventKey: `member_loan_application_rejected:${application?.id}:${application?.rejected_at || Date.now()}`,
        message: message.slice(0, 300),
        metadata: {
            loan_application_id: application?.id,
            member_id: application?.member_id,
            external_reference: application?.external_reference || null,
            rejection_reason: application?.rejection_reason || null,
            approval_notes: application?.approval_notes || null
        }
    });
}

async function notifyMemberLoanDisbursed({ actor, application, disbursement = {} }) {
    const memberUserId = application?.members?.user_id;
    if (!memberUserId) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const amount = formatAmount(application?.recommended_amount || application?.requested_amount || 0);
    const reference = application?.external_reference || shortId(application?.id);
    const loanNumber = disbursement?.loan_number || application?.loan_id || shortId(application?.id);
    const message = `Dear ${application?.members?.full_name || "member"}, your loan ${reference} for TZS ${amount} has been disbursed successfully. Loan number: ${loanNumber}.`;

    return notifyUsersById({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        userIds: [memberUserId],
        eventType: "member_loan_disbursed",
        eventKey: `member_loan_disbursed:${application?.id}:${application?.disbursed_at || Date.now()}`,
        message: message.slice(0, 300),
        metadata: {
            loan_application_id: application?.id,
            member_id: application?.member_id,
            external_reference: application?.external_reference || null,
            loan_id: application?.loan_id || null,
            loan_number: disbursement?.loan_number || null,
            journal_id: disbursement?.journal_id || null
        }
    });
}

async function notifyBranchManagersLoanDisbursed({ actor, application, disbursement = {} }) {
    const amount = formatAmount(application?.recommended_amount || application?.requested_amount || 0);
    const reference = application?.external_reference || shortId(application?.id);
    const loanNumber = disbursement?.loan_number || application?.loan_id || shortId(application?.id);
    const memberName = application?.members?.full_name || "Unknown member";
    const message = `Loan disbursed: ${memberName}, ref ${reference}, TZS ${amount}, loan ${loanNumber}.`;

    return notifyBranchManagers({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        eventType: "branch_manager_loan_disbursed",
        eventKey: `branch_manager_loan_disbursed:${application?.id}:${application?.disbursed_at || Date.now()}`,
        message: message.slice(0, 300),
        metadata: {
            loan_application_id: application?.id,
            member_id: application?.member_id,
            external_reference: application?.external_reference || null,
            loan_id: application?.loan_id || null,
            loan_number: disbursement?.loan_number || null,
            journal_id: disbursement?.journal_id || null
        },
        excludeUserIds: [actor?.user?.id]
    });
}

async function notifyLoanOfficerGuarantorDeclined({ actor, application, guarantorMemberId = null }) {
    if (!application?.appraised_by) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const message = `Guarantor declined for loan app ${shortId(application?.id)}. Re-appraisal required.`;

    return notifyUsersById({
        tenantId: application?.tenant_id || actor?.tenantId,
        branchId: application?.branch_id || null,
        userIds: [application.appraised_by],
        eventType: "loan_guarantor_declined",
        eventKey: `loan_guarantor_declined:${application?.id}:${guarantorMemberId || "unknown"}`,
        message,
        metadata: {
            loan_application_id: application?.id,
            guarantor_member_id: guarantorMemberId
        },
        excludeUserIds: [actor?.user?.id]
    });
}

async function notifyLoanOfficersDefaultFlag({ actor, defaultCase }) {
    const message = `Default flag: loan ${defaultCase?.loans?.loan_number || shortId(defaultCase?.loan_id)} hit ${defaultCase?.dpd_days || 0} DPD.`;

    return notifyRoleUsers({
        tenantId: defaultCase?.tenant_id || actor?.tenantId,
        branchId: defaultCase?.branch_id || null,
        role: "loan_officer",
        eventType: "loan_default_flag",
        eventKey: `loan_default_flag:${defaultCase?.id}`,
        message,
        metadata: {
            default_case_id: defaultCase?.id,
            loan_id: defaultCase?.loan_id,
            dpd_days: defaultCase?.dpd_days
        },
        excludeUserIds: [actor?.user?.id]
    });
}

async function notifyTellerWithdrawalApprovalRequired({ actor, request }) {
    if (!request?.maker_user_id) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const message = `Withdrawal request pending approval (TZS ${formatAmount(request?.requested_amount)}). Ref ${shortId(request?.id)}.`;

    return notifyUsersById({
        tenantId: request?.tenant_id || actor?.tenantId,
        branchId: request?.branch_id || null,
        userIds: [request.maker_user_id],
        eventType: "withdrawal_approval_required",
        eventKey: `withdrawal_approval_required:${request?.id}`,
        message,
        metadata: {
            approval_request_id: request?.id,
            operation_key: request?.operation_key,
            requested_amount: request?.requested_amount
        }
    });
}

async function notifyApprovalOutcomeToMaker({ actor, request, outcome = "approved" }) {
    if (!request?.maker_user_id) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const operationLabel = request?.operation_key === "finance.loan_disburse"
        ? "loan disbursement"
        : request?.operation_key === "finance.withdraw"
            ? "withdrawal"
            : "operation";

    let message = `${operationLabel} approval updated. Ref ${shortId(request?.id)}.`;
    if (outcome === "approved") {
        message = `${operationLabel} approval granted. You can execute now. Ref ${shortId(request?.id)}.`;
    } else if (outcome === "rejected") {
        message = `${operationLabel} approval rejected. Ref ${shortId(request?.id)}.`;
    } else if (outcome === "expired") {
        message = `${operationLabel} approval expired. Create a new request. Ref ${shortId(request?.id)}.`;
    }

    return notifyUsersById({
        tenantId: request?.tenant_id || actor?.tenantId,
        branchId: request?.branch_id || null,
        userIds: [request.maker_user_id],
        eventType: `approval_${outcome}`,
        eventKey: `approval_${outcome}:${request?.id}`,
        message,
        metadata: {
            approval_request_id: request?.id,
            operation_key: request?.operation_key,
            requested_amount: request?.requested_amount,
            status: request?.status || outcome
        }
    });
}

async function notifyTellerCashMismatch({ actor, session, variance }) {
    const tellerUserId = session?.teller_user_id;
    if (!tellerUserId || Number(variance || 0) === 0) {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const amount = formatAmount(Math.abs(Number(variance || 0)));
    const direction = Number(variance || 0) > 0 ? "over" : "short";
    const message = `Cash close mismatch: TZS ${amount} ${direction}. Session ${shortId(session?.id)}.`;

    return notifyUsersById({
        tenantId: session?.tenant_id || actor?.tenantId,
        branchId: session?.branch_id || null,
        userIds: [tellerUserId],
        eventType: "teller_cash_mismatch",
        eventKey: `teller_cash_mismatch:${session?.id}:${session?.closed_at || Date.now()}`,
        message,
        metadata: {
            teller_session_id: session?.id,
            variance: Number(variance || 0)
        }
    });
}

async function notifyTellerTransactionPostFailed({ actor, tenantId, branchId, operation, amount, reason }) {
    if (actor?.role !== "teller") {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const message = `Transaction failed (${operation})${amount ? ` TZS ${formatAmount(amount)}` : ""}. ${String(reason || "Retry required.")}`.slice(0, 300);

    return notifyUsersById({
        tenantId: tenantId || actor?.tenantId,
        branchId: branchId || null,
        userIds: [actor?.user?.id],
        eventType: "teller_transaction_post_failed",
        eventKey: `teller_transaction_post_failed:${operation}:${actor?.user?.id}:${Date.now()}`,
        message,
        metadata: {
            operation,
            amount: Number(amount || 0),
            reason: reason || null
        }
    });
}

async function notifyTellerTransactionBlocked({ actor, tenantId, branchId, operation, reason }) {
    if (actor?.role !== "teller") {
        return { enabled: env.branchAlertSmsEnabled, delivered: 0, skipped: 0, failed: 0 };
    }

    const message = `Transaction blocked (${operation}): ${String(reason || "policy restriction")}`.slice(0, 300);

    return notifyUsersById({
        tenantId: tenantId || actor?.tenantId,
        branchId: branchId || null,
        userIds: [actor?.user?.id],
        eventType: "teller_transaction_blocked",
        eventKey: `teller_transaction_blocked:${operation}:${actor?.user?.id}:${Date.now()}`,
        message,
        metadata: {
            operation,
            reason: reason || null
        }
    });
}

async function notifyMemberRepaymentDueSoon({
    tenantId,
    branchId = null,
    memberUserId,
    memberId = null,
    scheduleId,
    loanId = null,
    loanNumber = null,
    dueDate,
    amount
}) {
    if (!tenantId || !memberUserId || !scheduleId || !dueDate) {
        return { in_app_delivered: 0, in_app_skipped: 0 };
    }

    const amountText = formatAmount(amount);
    const message = `Your repayment of TZS ${amountText} for loan ${loanNumber || shortId(loanId)} is due on ${dueDate}.`;

    return notifyUsersById({
        tenantId,
        branchId,
        userIds: [memberUserId],
        eventType: "member_repayment_due_soon",
        eventKey: `member_repayment_due_soon:${scheduleId}`,
        message,
        metadata: {
            member_id: memberId,
            loan_id: loanId,
            loan_schedule_id: scheduleId,
            due_date: dueDate,
            amount: Number(amount || 0)
        }
    });
}

async function notifyRepaymentOverdue({
    tenantId,
    branchId = null,
    memberUserId = null,
    memberId = null,
    scheduleId,
    loanId = null,
    loanNumber = null,
    dueDate,
    amount,
    daysPastDue = 0
}) {
    if (!tenantId || !scheduleId || !dueDate) {
        return {
            member_in_app_delivered: 0,
            member_in_app_skipped: 0,
            staff_in_app_delivered: 0,
            staff_in_app_skipped: 0
        };
    }

    const amountText = formatAmount(amount);
    const memberMessage = `Your repayment of TZS ${amountText} for loan ${loanNumber || shortId(loanId)} is overdue since ${dueDate}. Please settle it as soon as possible.`;
    const staffMessage = `Loan ${loanNumber || shortId(loanId)} repayment is overdue by ${daysPastDue} day(s). Outstanding amount is TZS ${amountText}, due on ${dueDate}.`;

    let memberResult = { in_app_delivered: 0, in_app_skipped: 0 };
    if (memberUserId) {
        memberResult = await notifyUsersById({
            tenantId,
            branchId,
            userIds: [memberUserId],
            eventType: "member_repayment_overdue",
            eventKey: `member_repayment_overdue:${scheduleId}`,
            message: memberMessage,
            metadata: {
                member_id: memberId,
                loan_id: loanId,
                loan_schedule_id: scheduleId,
                due_date: dueDate,
                amount: Number(amount || 0),
                days_past_due: Number(daysPastDue || 0)
            }
        });
    }

    const [branchManagerResult, loanOfficerResult] = await Promise.all([
        notifyRoleUsers({
            tenantId,
            branchId,
            role: "branch_manager",
            eventType: "branch_repayment_overdue",
            eventKey: `branch_repayment_overdue:${scheduleId}`,
            message: staffMessage,
            metadata: {
                member_id: memberId,
                loan_id: loanId,
                loan_schedule_id: scheduleId,
                due_date: dueDate,
                amount: Number(amount || 0),
                days_past_due: Number(daysPastDue || 0)
            }
        }),
        notifyRoleUsers({
            tenantId,
            branchId,
            role: "loan_officer",
            eventType: "branch_repayment_overdue",
            eventKey: `branch_repayment_overdue:${scheduleId}`,
            message: staffMessage,
            metadata: {
                member_id: memberId,
                loan_id: loanId,
                loan_schedule_id: scheduleId,
                due_date: dueDate,
                amount: Number(amount || 0),
                days_past_due: Number(daysPastDue || 0)
            }
        })
    ]);

    return {
        member_in_app_delivered: Number(memberResult?.in_app_delivered || 0),
        member_in_app_skipped: Number(memberResult?.in_app_skipped || 0),
        staff_in_app_delivered: Number(branchManagerResult?.in_app_delivered || 0) + Number(loanOfficerResult?.in_app_delivered || 0),
        staff_in_app_skipped: Number(branchManagerResult?.in_app_skipped || 0) + Number(loanOfficerResult?.in_app_skipped || 0)
    };
}

async function notifyBranchManagersLiquidityWarning({
    tenantId,
    branchId,
    branchName = null,
    liquidityStatus,
    availableForLoans = 0,
    freezeThreshold = 0,
    liquidityPercent = 0
}) {
    if (!tenantId || !branchId || !["warning", "risk"].includes(String(liquidityStatus || ""))) {
        return { in_app_delivered: 0, in_app_skipped: 0 };
    }

    try {
        const recipients = await loadBranchManagerRecipients({ tenantId, branchId });
        if (!recipients.length) {
            return { in_app_delivered: 0, in_app_skipped: 0 };
        }

        const eventType = liquidityStatus === "risk" ? "branch_liquidity_risk" : "branch_liquidity_warning";
        const branchLabel = branchName || "This branch";
        const amountText = formatAmount(availableForLoans);
        const freezeText = formatAmount(freezeThreshold);
        const percentText = Number(liquidityPercent || 0).toFixed(0);
        const message = liquidityStatus === "risk"
            ? `${branchLabel} is in critical liquidity territory. Available loan pool is TZS ${amountText} at ${percentText}% liquidity, close to the freeze threshold of TZS ${freezeText}.`
            : `${branchLabel} loan liquidity is tightening. Available loan pool is TZS ${amountText} at ${percentText}% liquidity against a freeze threshold of TZS ${freezeText}.`;

        const inAppResult = await createInAppNotifications({
            tenantId,
            branchId,
            eventType,
            eventKey: `${eventType}:${branchId}:${new Date().toISOString().slice(0, 10)}`,
            message,
            metadata: {
                branch_id: branchId,
                liquidity_status: liquidityStatus,
                available_for_loans: Number(availableForLoans || 0),
                freeze_threshold: Number(freezeThreshold || 0),
                liquidity_percent: Number(liquidityPercent || 0)
            },
            recipients
        });

        return {
            in_app_delivered: inAppResult.delivered,
            in_app_skipped: inAppResult.skipped
        };
    } catch (error) {
        if (!isMissingRelationError(error)) {
            console.warn("[branch-alerts] liquidity warning dispatch failed", {
                tenantId,
                branchId,
                liquidityStatus,
                message: error?.message || "unknown_error"
            });
        }
        return { in_app_delivered: 0, in_app_skipped: 0 };
    }
}

module.exports = {
    invalidateSmsTriggerCache,
    notifyApprovalRequestPending,
    notifyDefaultCaseOpened,
    notifyDefaultCaseClaimReady,
    notifyGuarantorClaimSubmitted,
    notifyBranchManagersNewMemberApplication,
    notifyLoanOfficersNewApplication,
    notifyLoanOfficersReappraisalNeeded,
    notifyLoanOfficersApprovedForDisbursement,
    notifyDirectPhones,
    notifyMemberLoanApplicationApproved,
    notifyMemberLoanApplicationRejected,
    notifyMemberLoanDisbursed,
    notifyBranchManagersLoanDisbursed,
    notifyLoanOfficerGuarantorDeclined,
    notifyLoanOfficersDefaultFlag,
    notifyTellerWithdrawalApprovalRequired,
    notifyApprovalOutcomeToMaker,
    notifyTellerCashMismatch,
    notifyTellerTransactionPostFailed,
    notifyTellerTransactionBlocked,
    notifyBranchManagersLiquidityWarning,
    notifyMemberRepaymentDueSoon,
    notifyRepaymentOverdue
};

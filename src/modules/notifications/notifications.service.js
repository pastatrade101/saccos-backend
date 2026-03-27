const { adminSupabase } = require("../../config/supabase");
const { ROLES } = require("../../constants/roles");
const { assertTenantAccess } = require("../../services/user-context.service");
const AppError = require("../../utils/app-error");
const { NOTIFICATION_PREFERENCE_CATALOG, NOTIFICATION_PREFERENCE_EVENT_TYPES } = require("./notifications.constants");

const LISTABLE_STATUSES = new Set(["unread", "read", "archived"]);
const RECENT_LIMIT = 5;

const EVENT_CATALOG = {
    approval_request_pending: {
        title: "Approval required",
        severity: "warning",
        actionLabel: "Review approvals",
        actionRoute: "/approvals",
        entityType: "approval_request",
        entityIdKey: "approval_request_id"
    },
    default_case_opened: {
        title: "Loan default flagged",
        severity: "critical",
        actionLabel: "Review follow-ups",
        actionRoute: "/follow-ups",
        entityType: "default_case",
        entityIdKey: "default_case_id"
    },
    default_case_claim_ready: {
        title: "Claim-ready default case",
        severity: "warning",
        actionLabel: "Open follow-ups",
        actionRoute: "/follow-ups",
        entityType: "default_case",
        entityIdKey: "default_case_id"
    },
    guarantor_claim_submitted: {
        title: "Guarantor claim submitted",
        severity: "warning",
        actionLabel: "Open follow-ups",
        actionRoute: "/follow-ups",
        entityType: "guarantor_claim",
        entityIdKey: "guarantor_claim_id"
    },
    loan_application_submitted: {
        title: "New loan application",
        severity: "info",
        actionLabel: "Open loans",
        actionRoute: "/loans",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    loan_application_rejected: {
        title: "Loan application rejected",
        severity: "warning",
        actionLabel: "Open loans",
        actionRoute: "/loans",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    loan_application_ready_for_disbursement: {
        title: "Ready for disbursement",
        severity: "success",
        actionLabel: "Open loans",
        actionRoute: "/loans",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    member_loan_application_approved: {
        title: "Loan approved",
        severity: "success",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    member_loan_application_rejected: {
        title: "Loan not approved",
        severity: "warning",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    member_loan_disbursed: {
        title: "Loan disbursed",
        severity: "success",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    branch_manager_loan_disbursed: {
        title: "Loan disbursed",
        severity: "success",
        actionLabel: "Open loans",
        actionRoute: "/loans",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    loan_guarantor_declined: {
        title: "Guarantor declined",
        severity: "warning",
        actionLabel: "Open loans",
        actionRoute: "/loans",
        entityType: "loan_application",
        entityIdKey: "loan_application_id"
    },
    loan_default_flag: {
        title: "Loan default flagged",
        severity: "critical",
        actionLabel: "Review follow-ups",
        actionRoute: "/follow-ups",
        entityType: "default_case",
        entityIdKey: "default_case_id"
    },
    withdrawal_approval_required: {
        title: "Withdrawal awaiting approval",
        severity: "warning",
        actionLabel: "Open approvals",
        actionRoute: "/approvals",
        entityType: "approval_request",
        entityIdKey: "approval_request_id"
    },
    approval_approved: {
        title: "Approval granted",
        severity: "success",
        actionLabel: "Open approvals",
        actionRoute: "/approvals",
        entityType: "approval_request",
        entityIdKey: "approval_request_id"
    },
    approval_rejected: {
        title: "Approval rejected",
        severity: "warning",
        actionLabel: "Open approvals",
        actionRoute: "/approvals",
        entityType: "approval_request",
        entityIdKey: "approval_request_id"
    },
    approval_expired: {
        title: "Approval expired",
        severity: "warning",
        actionLabel: "Open approvals",
        actionRoute: "/approvals",
        entityType: "approval_request",
        entityIdKey: "approval_request_id"
    },
    teller_cash_mismatch: {
        title: "Cash mismatch",
        severity: "critical",
        actionLabel: "Open cash desk",
        actionRoute: "/cash",
        entityType: "teller_session",
        entityIdKey: "teller_session_id"
    },
    teller_transaction_post_failed: {
        title: "Transaction failed",
        severity: "critical",
        actionLabel: "Open cash desk",
        actionRoute: "/cash",
        entityType: "cash_transaction",
        entityIdKey: null
    },
    teller_transaction_blocked: {
        title: "Transaction blocked",
        severity: "warning",
        actionLabel: "Open cash desk",
        actionRoute: "/cash",
        entityType: "cash_transaction",
        entityIdKey: null
    },
    member_application_approved: {
        title: "Membership approved",
        severity: "success",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "member_application",
        entityIdKey: "member_application_id"
    },
    member_membership_activated: {
        title: "Membership active",
        severity: "success",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "member",
        entityIdKey: "member_id"
    },
    member_payment_posted: {
        title: "Payment posted",
        severity: "success",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "payment_order",
        entityIdKey: "payment_order_id"
    },
    member_payment_failed: {
        title: "Payment failed",
        severity: "warning",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "payment_order",
        entityIdKey: "payment_order_id"
    },
    member_payment_expired: {
        title: "Payment expired",
        severity: "warning",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "payment_order",
        entityIdKey: "payment_order_id"
    },
    branch_liquidity_warning: {
        title: "Liquidity warning",
        severity: "warning",
        actionLabel: "Open products",
        actionRoute: "/products",
        entityType: "branch",
        entityIdKey: "branch_id"
    },
    branch_liquidity_risk: {
        title: "Critical liquidity",
        severity: "critical",
        actionLabel: "Open products",
        actionRoute: "/products",
        entityType: "branch",
        entityIdKey: "branch_id"
    },
    member_repayment_due_soon: {
        title: "Repayment due soon",
        severity: "warning",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "loan_schedule",
        entityIdKey: "loan_schedule_id"
    },
    member_repayment_overdue: {
        title: "Repayment overdue",
        severity: "critical",
        actionLabel: "Open portal",
        actionRoute: "/portal",
        entityType: "loan_schedule",
        entityIdKey: "loan_schedule_id"
    },
    branch_repayment_overdue: {
        title: "Overdue repayment",
        severity: "critical",
        actionLabel: "Open loans",
        actionRoute: "/loans",
        entityType: "loan_schedule",
        entityIdKey: "loan_schedule_id"
    },
    audit_case_critical: {
        title: "Critical audit case",
        severity: "critical",
        actionLabel: "Open exceptions",
        actionRoute: "/auditor/exceptions",
        entityType: "audit_case",
        entityIdKey: "audit_case_id"
    }
};

function isMissingPreferenceTableError(error) {
    return ["PGRST205", "42P01", "42703"].includes(String(error?.code || ""));
}

function getPreferenceCatalogForRole(role) {
    return NOTIFICATION_PREFERENCE_CATALOG.filter((item) => (item.roles || []).includes(role));
}

function getPreferenceCatalogItem(eventType) {
    return NOTIFICATION_PREFERENCE_CATALOG.find((item) => item.event_type === eventType) || null;
}

async function loadPreferenceOverrides({ tenantId, userIds = [], eventTypes = [] }) {
    const distinctUserIds = Array.from(new Set((userIds || []).filter(Boolean)));
    const distinctEventTypes = Array.from(new Set((eventTypes || []).filter(Boolean)));

    if (!tenantId || !distinctUserIds.length || !distinctEventTypes.length) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("user_notification_preferences")
        .select("user_id, event_type, in_app_enabled, sms_enabled, toast_enabled")
        .eq("tenant_id", tenantId)
        .in("user_id", distinctUserIds)
        .in("event_type", distinctEventTypes);

    if (error) {
        if (isMissingPreferenceTableError(error)) {
            return null;
        }
        throw error;
    }

    return new Map(
        (data || []).map((row) => [
            `${row.user_id}:${row.event_type}`,
            {
                in_app_enabled: Boolean(row.in_app_enabled),
                sms_enabled: Boolean(row.sms_enabled),
                toast_enabled: Boolean(row.toast_enabled)
            }
        ])
    );
}

async function filterRecipientsByNotificationPreference({
    tenantId,
    eventType,
    recipients = [],
    channel
}) {
    const distinctRecipients = Array.from(new Map(
        (recipients || [])
            .filter((recipient) => recipient?.user_id)
            .map((recipient) => [recipient.user_id, recipient])
    ).values());

    if (!tenantId || !eventType || !distinctRecipients.length) {
        return [];
    }

    const overrides = await loadPreferenceOverrides({
        tenantId,
        userIds: distinctRecipients.map((recipient) => recipient.user_id),
        eventTypes: [eventType]
    });

    if (!overrides) {
        return distinctRecipients;
    }

    const keyName = channel === "sms" ? "sms_enabled" : "in_app_enabled";

    return distinctRecipients.filter((recipient) => {
        const override = overrides.get(`${recipient.user_id}:${eventType}`);
        if (!override) {
            return true;
        }
        return Boolean(override[keyName]);
    });
}

function mapPreferenceSetting(item, override = null) {
    return {
        event_type: item.event_type,
        label: item.label,
        description: item.description,
        in_app_enabled: override ? Boolean(override.in_app_enabled) : Boolean(item.default_in_app_enabled),
        sms_enabled: override ? Boolean(override.sms_enabled) : Boolean(item.default_sms_enabled),
        toast_enabled: override ? Boolean(override.toast_enabled) : Boolean(item.default_toast_enabled)
    };
}

function getEventDescriptor(eventType, metadata = {}) {
    const catalog = EVENT_CATALOG[eventType] || {};
    const entityIdKey = catalog.entityIdKey || null;

    return {
        title: catalog.title || "Notification",
        severity: catalog.severity || "info",
        actionLabel: catalog.actionLabel || "Open",
        actionRoute: catalog.actionRoute || null,
        entityType: catalog.entityType || null,
        entityId: entityIdKey ? metadata?.[entityIdKey] || null : null
    };
}

async function createInAppNotifications({
    tenantId,
    branchId = null,
    eventType,
    eventKey,
    message,
    metadata = {},
    recipients = []
}) {
    const distinctRecipients = Array.from(new Map(
        (recipients || [])
            .filter((recipient) => recipient?.user_id)
            .map((recipient) => [recipient.user_id, recipient])
    ).values());

    if (!tenantId || !eventType || !eventKey || !message || !distinctRecipients.length) {
        return { delivered: 0, skipped: 0 };
    }

    const allowedRecipients = await filterRecipientsByNotificationPreference({
        tenantId,
        eventType,
        recipients: distinctRecipients,
        channel: "in_app"
    });

    if (!allowedRecipients.length) {
        return { delivered: 0, skipped: distinctRecipients.length };
    }

    let delivered = 0;
    let skipped = 0;

    for (const recipient of allowedRecipients) {
        const descriptor = getEventDescriptor(eventType, metadata);
        const insertPayload = {
            tenant_id: tenantId,
            branch_id: branchId || null,
            recipient_user_id: recipient.user_id,
            recipient_role: recipient.role || null,
            event_type: eventType,
            event_key: eventKey,
            title: descriptor.title,
            message,
            severity: descriptor.severity,
            status: "unread",
            action_label: descriptor.actionLabel,
            action_route: descriptor.actionRoute,
            entity_type: descriptor.entityType,
            entity_id: descriptor.entityId,
            metadata: metadata || {}
        };

        const { error } = await adminSupabase
            .from("notifications")
            .insert(insertPayload);

        if (error) {
            if (String(error.code || "") === "23505") {
                skipped += 1;
                continue;
            }

            if (["PGRST205", "42P01", "42703"].includes(String(error.code || ""))) {
                return { delivered: 0, skipped: distinctRecipients.length };
            }

            throw error;
        }

        delivered += 1;
    }

    return { delivered, skipped };
}

async function listNotificationPreferences(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const allowedItems = getPreferenceCatalogForRole(actor.profile?.role || actor.role || ROLES.MEMBER);
    const allowedEventTypes = allowedItems.map((item) => item.event_type);

    if (!allowedEventTypes.length) {
        return [];
    }

    const overrides = await loadPreferenceOverrides({
        tenantId,
        userIds: [actor.user.id],
        eventTypes: allowedEventTypes
    });

    return allowedItems.map((item) => {
        const override = overrides?.get(`${actor.user.id}:${item.event_type}`) || null;
        return mapPreferenceSetting(item, override);
    });
}

async function updateNotificationPreference(actor, eventType, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const catalogItem = getPreferenceCatalogItem(eventType);
    const allowedItems = getPreferenceCatalogForRole(actor.profile?.role || actor.role || ROLES.MEMBER);

    if (!catalogItem || !allowedItems.some((item) => item.event_type === eventType)) {
        throw new AppError(404, "NOTIFICATION_PREFERENCE_NOT_FOUND", "Notification preference was not found for this role.");
    }

    const existingOverrides = await loadPreferenceOverrides({
        tenantId,
        userIds: [actor.user.id],
        eventTypes: [eventType]
    });
    const existing = existingOverrides?.get(`${actor.user.id}:${eventType}`) || null;

    const updatePayload = {
        tenant_id: tenantId,
        user_id: actor.user.id,
        event_type: eventType,
        in_app_enabled: payload.in_app_enabled ?? existing?.in_app_enabled ?? catalogItem.default_in_app_enabled,
        sms_enabled: payload.sms_enabled ?? existing?.sms_enabled ?? catalogItem.default_sms_enabled,
        toast_enabled: payload.toast_enabled ?? existing?.toast_enabled ?? catalogItem.default_toast_enabled,
        created_by: actor.user.id,
        updated_by: actor.user.id
    };

    const { data, error } = await adminSupabase
        .from("user_notification_preferences")
        .upsert(updatePayload, {
            onConflict: "tenant_id,user_id,event_type"
        })
        .select("user_id, event_type, in_app_enabled, sms_enabled, toast_enabled")
        .single();

    if (error) {
        throw new AppError(500, "NOTIFICATION_PREFERENCE_UPDATE_FAILED", "Unable to update notification preference.", error);
    }

    return mapPreferenceSetting(catalogItem, data || null);
}

async function listNotifications(actor, query = {}) {
    const tenantId = query.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(query.limit || 20)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const status = query.status && LISTABLE_STATUSES.has(query.status) ? query.status : "all";
    const recentOnly = Boolean(query.recent_only);

    let baseQuery = adminSupabase
        .from("notifications")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", actor.user.id)
        .order("created_at", { ascending: false });

    if (status !== "all") {
        baseQuery = baseQuery.eq("status", status);
    }

    if (recentOnly) {
        baseQuery = baseQuery.range(0, Math.min(RECENT_LIMIT, limit) - 1);
    } else {
        baseQuery = baseQuery.range(from, to);
    }

    const unreadQuery = adminSupabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", actor.user.id)
        .eq("status", "unread");

    const [{ data, count, error }, { count: unreadCount, error: unreadError }] = await Promise.all([
        baseQuery,
        unreadQuery
    ]);

    if (error) {
        throw new AppError(500, "NOTIFICATIONS_FETCH_FAILED", "Unable to load notifications.", error);
    }

    if (unreadError) {
        throw new AppError(500, "NOTIFICATIONS_UNREAD_COUNT_FAILED", "Unable to load unread notification count.", unreadError);
    }

    return {
        items: data || [],
        page,
        limit: recentOnly ? Math.min(RECENT_LIMIT, limit) : limit,
        total: Number(count || 0),
        unread_count: Number(unreadCount || 0)
    };
}

async function markNotificationRead(actor, notificationId) {
    const { data: current, error: lookupError } = await adminSupabase
        .from("notifications")
        .select("*")
        .eq("id", notificationId)
        .eq("recipient_user_id", actor.user.id)
        .maybeSingle();

    if (lookupError) {
        throw new AppError(500, "NOTIFICATION_LOOKUP_FAILED", "Unable to load notification.", lookupError);
    }

    if (!current) {
        throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found.");
    }

    assertTenantAccess({ auth: actor }, current.tenant_id);

    if (current.status === "read") {
        return current;
    }

    const { data, error } = await adminSupabase
        .from("notifications")
        .update({
            status: "read",
            read_at: current.read_at || new Date().toISOString(),
            archived_at: null
        })
        .eq("id", notificationId)
        .eq("recipient_user_id", actor.user.id)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "NOTIFICATION_MARK_READ_FAILED", "Unable to mark notification as read.", error);
    }

    return data;
}

async function markAllNotificationsRead(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const patch = {
        status: "read",
        read_at: new Date().toISOString(),
        archived_at: null
    };

    const { data, error } = await adminSupabase
        .from("notifications")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", actor.user.id)
        .eq("status", "unread")
        .select("id");

    if (error) {
        throw new AppError(500, "NOTIFICATIONS_MARK_ALL_READ_FAILED", "Unable to mark notifications as read.", error);
    }

    return { updated: (data || []).length };
}

async function archiveNotification(actor, notificationId) {
    const { data: current, error: lookupError } = await adminSupabase
        .from("notifications")
        .select("*")
        .eq("id", notificationId)
        .eq("recipient_user_id", actor.user.id)
        .maybeSingle();

    if (lookupError) {
        throw new AppError(500, "NOTIFICATION_LOOKUP_FAILED", "Unable to load notification.", lookupError);
    }

    if (!current) {
        throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found.");
    }

    assertTenantAccess({ auth: actor }, current.tenant_id);

    if (current.status === "archived") {
        return current;
    }

    const patch = {
        status: "archived",
        archived_at: current.archived_at || new Date().toISOString(),
        read_at: current.read_at || new Date().toISOString()
    };

    const { data, error } = await adminSupabase
        .from("notifications")
        .update(patch)
        .eq("id", notificationId)
        .eq("recipient_user_id", actor.user.id)
        .select("*")
        .single();

    if (error || !data) {
        throw new AppError(500, "NOTIFICATION_ARCHIVE_FAILED", "Unable to archive notification.", error);
    }

    return data;
}

async function archiveReadNotifications(actor, payload = {}) {
    const tenantId = payload.tenant_id || actor.tenantId;
    assertTenantAccess({ auth: actor }, tenantId);

    const patch = {
        status: "archived",
        archived_at: new Date().toISOString()
    };

    const { data, error } = await adminSupabase
        .from("notifications")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", actor.user.id)
        .eq("status", "read")
        .select("id");

    if (error) {
        throw new AppError(500, "NOTIFICATIONS_ARCHIVE_READ_FAILED", "Unable to archive read notifications.", error);
    }

    return { updated: (data || []).length };
}

module.exports = {
    createInAppNotifications,
    filterRecipientsByNotificationPreference,
    listNotificationPreferences,
    updateNotificationPreference,
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    archiveNotification,
    archiveReadNotifications
};

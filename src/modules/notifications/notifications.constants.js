const { ROLES } = require("../../constants/roles");

const NOTIFICATION_PREFERENCE_CATALOG = [
    {
        event_type: "member_application_submitted",
        label: "New membership application",
        description: "Notify branch managers when a membership application is submitted for branch review.",
        roles: [ROLES.BRANCH_MANAGER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_application_under_review",
        label: "Membership under review",
        description: "Notify applicants when the branch team records a membership review update.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_application_more_info_requested",
        label: "More information requested",
        description: "Notify applicants when the branch asks for clarification or additional membership documents.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_application_approved",
        label: "Membership approved",
        description: "Notify applicants when membership is approved and membership fee payment is required.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_application_rejected",
        label: "Membership not approved",
        description: "Notify applicants when a membership application is rejected by the tenant super admin.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_membership_activated",
        label: "Membership activated",
        description: "Notify members when their membership becomes active after fee collection.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_loan_application_approved",
        label: "Loan approved",
        description: "Notify members when a loan application is approved.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_loan_application_rejected",
        label: "Loan rejected",
        description: "Notify members when a loan application is rejected.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_loan_disbursed",
        label: "Loan disbursed",
        description: "Notify members when an approved loan is successfully disbursed.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "member_payment_posted",
        label: "Payment posted",
        description: "Notify members when a portal payment is posted successfully.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: false
    },
    {
        event_type: "member_payment_failed",
        label: "Payment failed",
        description: "Notify members when a portal payment fails.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "member_payment_expired",
        label: "Payment expired",
        description: "Notify members when a payment request expires before confirmation.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "member_repayment_due_soon",
        label: "Repayment due soon",
        description: "Notify members shortly before a repayment falls due.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: false
    },
    {
        event_type: "member_repayment_overdue",
        label: "Repayment overdue",
        description: "Notify members when a repayment becomes overdue.",
        roles: [ROLES.MEMBER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "approval_request_pending",
        label: "Approval required",
        description: "Notify managers when a high-risk approval request is pending.",
        roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "approval_approved",
        label: "Approval approved",
        description: "Notify makers that an approval request was approved.",
        roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: false
    },
    {
        event_type: "approval_rejected",
        label: "Approval rejected",
        description: "Notify makers that an approval request was rejected.",
        roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "approval_expired",
        label: "Approval expired",
        description: "Notify makers that an approval request expired before execution.",
        roles: [ROLES.SUPER_ADMIN, ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER, ROLES.TELLER, ROLES.AUDITOR],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "loan_application_submitted",
        label: "New loan application",
        description: "Notify loan officers about new loan applications awaiting appraisal.",
        roles: [ROLES.LOAN_OFFICER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: false
    },
    {
        event_type: "loan_application_ready_for_disbursement",
        label: "Ready for disbursement",
        description: "Notify loan officers when an application is ready for disbursement.",
        roles: [ROLES.LOAN_OFFICER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "loan_guarantor_declined",
        label: "Guarantor declined",
        description: "Notify loan officers when any guarantor rejects a guarantee request.",
        roles: [ROLES.LOAN_OFFICER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "loan_default_flag",
        label: "Loan default flag",
        description: "Notify loan officers when a loan is flagged delinquent/default.",
        roles: [ROLES.LOAN_OFFICER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "branch_repayment_overdue",
        label: "Overdue repayment",
        description: "Notify branch managers and loan officers when a loan repayment becomes overdue.",
        roles: [ROLES.BRANCH_MANAGER, ROLES.LOAN_OFFICER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "branch_liquidity_warning",
        label: "Liquidity warning",
        description: "Notify branch managers when lending liquidity is tightening.",
        roles: [ROLES.BRANCH_MANAGER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "branch_liquidity_risk",
        label: "Critical liquidity",
        description: "Notify branch managers when branch lending liquidity is in a critical state.",
        roles: [ROLES.BRANCH_MANAGER],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "teller_cash_mismatch",
        label: "Cash mismatch",
        description: "Notify tellers when close-session cash differs from expected cash.",
        roles: [ROLES.TELLER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "teller_transaction_post_failed",
        label: "Posting failed",
        description: "Notify tellers when a cash transaction fails to post.",
        roles: [ROLES.TELLER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "teller_transaction_blocked",
        label: "Transaction blocked",
        description: "Notify tellers when a policy or control blocks a transaction.",
        roles: [ROLES.TELLER],
        default_in_app_enabled: true,
        default_sms_enabled: true,
        default_toast_enabled: true
    },
    {
        event_type: "audit_case_critical",
        label: "Critical audit case",
        description: "Notify auditors when a critical audit case is opened.",
        roles: [ROLES.AUDITOR],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "treasury_policy_updated",
        label: "Treasury policy updated",
        description: "Notify treasury governance users when treasury guardrails are changed.",
        roles: [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "treasury_order_created",
        label: "Treasury order created",
        description: "Notify treasury governance users when a new treasury order enters review.",
        roles: [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: false
    },
    {
        event_type: "treasury_order_approved",
        label: "Treasury order approved",
        description: "Notify treasury governance users when a treasury order is approved.",
        roles: [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "treasury_order_rejected",
        label: "Treasury order rejected",
        description: "Notify treasury governance users when a treasury order is rejected.",
        roles: [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "treasury_order_executed",
        label: "Treasury order executed",
        description: "Notify treasury governance users when a treasury order is executed and posted.",
        roles: [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    },
    {
        event_type: "treasury_policy_violation",
        label: "Treasury policy violation",
        description: "Notify treasury governance users when an order breaches treasury guardrails or needs escalation.",
        roles: [ROLES.TREASURY_OFFICER, ROLES.BRANCH_MANAGER, ROLES.SUPER_ADMIN],
        default_in_app_enabled: true,
        default_sms_enabled: false,
        default_toast_enabled: true
    }
];

const NOTIFICATION_PREFERENCE_EVENT_TYPES = NOTIFICATION_PREFERENCE_CATALOG.map((item) => item.event_type);

module.exports = {
    NOTIFICATION_PREFERENCE_CATALOG,
    NOTIFICATION_PREFERENCE_EVENT_TYPES
};

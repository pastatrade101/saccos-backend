const SMS_TRIGGER_CATALOG = [
    {
        event_type: "loan_application_submitted",
        label: "Loan app submitted",
        description: "Notify loan officers when a new loan application enters the appraisal queue."
    },
    {
        event_type: "loan_application_rejected",
        label: "Loan app rejected",
        description: "Notify loan officers when an application is rejected and needs rework/member follow-up."
    },
    {
        event_type: "loan_application_ready_for_disbursement",
        label: "Loan ready for disbursement",
        description: "Notify loan officers when approvals are complete and disbursement can proceed."
    },
    {
        event_type: "loan_guarantor_declined",
        label: "Guarantor declined",
        description: "Notify appraising loan officer when any guarantor rejects the guarantee request."
    },
    {
        event_type: "loan_default_flag",
        label: "Loan default flag",
        description: "Notify loan officers when a loan is flagged delinquent/default (DPD breach)."
    },
    {
        event_type: "withdrawal_approval_required",
        label: "Withdrawal approval required",
        description: "Notify teller that their high-value withdrawal request is awaiting checker decision."
    },
    {
        event_type: "approval_approved",
        label: "Approval approved",
        description: "Notify maker that approval request was approved and execution can continue."
    },
    {
        event_type: "approval_rejected",
        label: "Approval rejected",
        description: "Notify maker that approval request was rejected."
    },
    {
        event_type: "approval_expired",
        label: "Approval expired",
        description: "Notify maker when an approval request expires before execution."
    },
    {
        event_type: "teller_cash_mismatch",
        label: "Teller cash mismatch",
        description: "Notify teller when close-session cash differs from expected cash."
    },
    {
        event_type: "teller_transaction_post_failed",
        label: "Teller posting failed",
        description: "Notify teller when withdrawal/disbursement posting fails after action."
    },
    {
        event_type: "teller_transaction_blocked",
        label: "Teller transaction blocked",
        description: "Notify teller when policy/subscription/out-of-hours blocks transaction."
    },
    {
        event_type: "approval_request_pending",
        label: "Approval request pending",
        description: "Notify branch managers that a high-risk approval request requires action."
    },
    {
        event_type: "default_case_opened",
        label: "Default case opened",
        description: "Notify branch managers when a new default case is opened."
    },
    {
        event_type: "default_case_claim_ready",
        label: "Default case claim ready",
        description: "Notify branch managers when a default case reaches claim-ready stage."
    },
    {
        event_type: "guarantor_claim_submitted",
        label: "Guarantor claim submitted",
        description: "Notify branch managers when guarantor claim workflow is submitted."
    }
];

const SMS_TRIGGER_EVENT_TYPES = SMS_TRIGGER_CATALOG.map((item) => item.event_type);

module.exports = {
    SMS_TRIGGER_CATALOG,
    SMS_TRIGGER_EVENT_TYPES
};

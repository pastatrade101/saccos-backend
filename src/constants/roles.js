const ROLES = {
    PLATFORM_ADMIN: "platform_admin",
    PLATFORM_OWNER: "platform_owner",
    SUPER_ADMIN: "super_admin",
    BRANCH_MANAGER: "branch_manager",
    TREASURY_OFFICER: "treasury_officer",
    LOAN_OFFICER: "loan_officer",
    TELLER: "teller",
    AUDITOR: "auditor",
    MEMBER: "member"
};

const STAFF_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.BRANCH_MANAGER,
    ROLES.TREASURY_OFFICER,
    ROLES.LOAN_OFFICER,
    ROLES.TELLER,
    ROLES.AUDITOR
];

module.exports = {
    ROLES,
    STAFF_ROLES
};

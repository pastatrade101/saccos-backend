const PLAN_FEATURES = {
    starter: {
        loans_enabled: false,
        dividends_enabled: false,
        contributions_enabled: false,
        advanced_reports: false,
        maker_checker_enabled: false,
        multi_approval_enabled: false,
        max_branches: 1,
        max_users: 5,
        max_members: 500
    },
    growth: {
        loans_enabled: true,
        dividends_enabled: true,
        contributions_enabled: true,
        advanced_reports: true,
        maker_checker_enabled: true,
        multi_approval_enabled: false,
        max_branches: 5,
        max_users: 25,
        max_members: 5000
    },
    enterprise: {
        loans_enabled: true,
        dividends_enabled: true,
        contributions_enabled: true,
        advanced_reports: true,
        maker_checker_enabled: true,
        multi_approval_enabled: true,
        max_branches: Number.MAX_SAFE_INTEGER,
        max_users: Number.MAX_SAFE_INTEGER,
        max_members: Number.MAX_SAFE_INTEGER
    }
};

const PLAN_LIMITS = {
    starter: {
        branches: PLAN_FEATURES.starter.max_branches,
        staffUsers: PLAN_FEATURES.starter.max_users,
        members: PLAN_FEATURES.starter.max_members,
        exportsPerDay: 10
    },
    growth: {
        branches: PLAN_FEATURES.growth.max_branches,
        staffUsers: PLAN_FEATURES.growth.max_users,
        members: PLAN_FEATURES.growth.max_members,
        exportsPerDay: 100
    },
    enterprise: {
        branches: PLAN_FEATURES.enterprise.max_branches,
        staffUsers: PLAN_FEATURES.enterprise.max_users,
        members: PLAN_FEATURES.enterprise.max_members,
        exportsPerDay: Number.MAX_SAFE_INTEGER
    }
};

module.exports = {
    PLAN_FEATURES,
    PLAN_LIMITS
};

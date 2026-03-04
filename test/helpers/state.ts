export const testState = {
    tenantIds: new Set<string>(),
    userIds: new Set<string>(),
    emails: new Set<string>()
};

export function trackTenant(tenantId?: string | null) {
    if (tenantId) {
        testState.tenantIds.add(tenantId);
    }
}

export function trackUser(userId?: string | null, email?: string | null) {
    if (userId) {
        testState.userIds.add(userId);
    }

    if (email) {
        testState.emails.add(email);
    }
}

export function clearTrackedState() {
    testState.tenantIds.clear();
    testState.userIds.clear();
    testState.emails.clear();
}

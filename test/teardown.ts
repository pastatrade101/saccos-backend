import { cleanupTestData, closePool } from "./helpers/db";
import { deleteAuthUser } from "./helpers/supabaseAdmin";
import { testState, clearTrackedState } from "./helpers/state";

export default async function teardown() {
    const userIds = [...testState.userIds];
    await cleanupTestData();

    for (const userId of userIds) {
        try {
            await deleteAuthUser(userId);
        } catch (error) {
            // Ignore already-deleted users to keep teardown resilient.
        }
    }

    clearTrackedState();
    await closePool();
}

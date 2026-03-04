const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");

async function ensureBranchAssignments({ tenantId, userId, branchIds }) {
    const uniqueBranchIds = [...new Set((branchIds || []).filter(Boolean))];

    if (!uniqueBranchIds.length) {
        return;
    }

    const { data: existingRows, error: existingError } = await adminSupabase
        .from("branch_staff_assignments")
        .select("branch_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .in("branch_id", uniqueBranchIds)
        .is("deleted_at", null);

    if (existingError) {
        throw new AppError(
            500,
            "BRANCH_ASSIGNMENT_LOOKUP_FAILED",
            "Unable to verify branch assignments.",
            existingError
        );
    }

    const existingBranchIds = new Set((existingRows || []).map((row) => row.branch_id));
    const rowsToInsert = uniqueBranchIds
        .filter((branchId) => !existingBranchIds.has(branchId))
        .map((branchId) => ({
            tenant_id: tenantId,
            branch_id: branchId,
            user_id: userId
        }));

    if (!rowsToInsert.length) {
        return;
    }

    const { error: insertError } = await adminSupabase
        .from("branch_staff_assignments")
        .insert(rowsToInsert);

    if (insertError) {
        throw new AppError(
            500,
            "BRANCH_ASSIGNMENT_CREATE_FAILED",
            "Unable to create branch assignments.",
            insertError
        );
    }
}

module.exports = {
    ensureBranchAssignments
};

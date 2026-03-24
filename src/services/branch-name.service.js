const { adminSupabase } = require("../config/supabase");

async function getBranchName(branchId) {
    if (!branchId) {
        return null;
    }

    const { data, error } = await adminSupabase
        .from("branches")
        .select("name")
        .eq("id", branchId)
        .maybeSingle();

    if (error) {
        console.warn("[branch-name] lookup failed", {
            branchId,
            error: error?.message || error
        });
        return null;
    }

    return data?.name || null;
}

module.exports = {
    getBranchName
};

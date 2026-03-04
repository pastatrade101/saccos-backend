const crypto = require("crypto");

const env = require("../config/env");
const { adminSupabase } = require("../config/supabase");
const AppError = require("../utils/app-error");

function getKey() {
    return crypto
        .createHash("sha256")
        .update(env.tempPasswordEncryptionKey)
        .digest();
}

function encryptPassword(password) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        password_ciphertext: encrypted.toString("base64"),
        password_iv: iv.toString("base64"),
        password_tag: tag.toString("base64")
    };
}

function decryptPassword(row) {
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        getKey(),
        Buffer.from(row.password_iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(row.password_tag, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(row.password_ciphertext, "base64")),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}

async function saveCredentialHandoff({ tenantId, userId, memberId = null, email, password, createdBy }) {
    const encrypted = encryptPassword(password);

    const { error: clearError } = await adminSupabase
        .from("credential_handoffs")
        .update({
            cleared_at: new Date().toISOString(),
            cleared_by: createdBy
        })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .is("cleared_at", null);

    if (clearError) {
        throw new AppError(500, "CREDENTIAL_HANDOFF_CLEAR_FAILED", "Unable to rotate temporary credentials.", clearError);
    }

    const { data, error } = await adminSupabase
        .from("credential_handoffs")
        .insert({
            tenant_id: tenantId,
            user_id: userId,
            member_id: memberId,
            email,
            created_by: createdBy,
            ...encrypted
        })
        .select("id, tenant_id, user_id, member_id, email, created_at")
        .single();

    if (error || !data) {
        throw new AppError(500, "CREDENTIAL_HANDOFF_SAVE_FAILED", "Unable to store temporary credentials.", error);
    }

    return data;
}

async function getActiveCredentialByUser({ tenantId, userId }) {
    const { data, error } = await adminSupabase
        .from("credential_handoffs")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .is("cleared_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "CREDENTIAL_HANDOFF_LOOKUP_FAILED", "Unable to load temporary credentials.", error);
    }

    if (!data) {
        return null;
    }

    return {
        id: data.id,
        user_id: data.user_id,
        member_id: data.member_id,
        email: data.email,
        created_at: data.created_at,
        temporary_password: decryptPassword(data)
    };
}

async function clearCredentialByUser({ tenantId, userId, clearedBy }) {
    const { error } = await adminSupabase
        .from("credential_handoffs")
        .update({
            cleared_at: new Date().toISOString(),
            cleared_by: clearedBy
        })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .is("cleared_at", null);

    if (error) {
        throw new AppError(500, "CREDENTIAL_HANDOFF_CLEAR_FAILED", "Unable to clear temporary credentials.", error);
    }
}

module.exports = {
    saveCredentialHandoff,
    getActiveCredentialByUser,
    clearCredentialByUser
};

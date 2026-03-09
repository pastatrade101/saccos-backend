const crypto = require("crypto");

const { adminSupabase } = require("../config/supabase");
const env = require("../config/env");
const AppError = require("../utils/app-error");

function isUniqueConstraintError(error) {
    return String(error?.code || "") === "23505";
}

function isInProgressReservation(record) {
    return !record.completed_at || record.response_status === null;
}

function isStaleInProgressReservation(record) {
    if (!env.idempotencyInProgressTtlMs || !isInProgressReservation(record)) {
        return false;
    }

    const createdAtMs = Date.parse(String(record.created_at || ""));
    if (!Number.isFinite(createdAtMs)) {
        return false;
    }

    return (Date.now() - createdAtMs) >= env.idempotencyInProgressTtlMs;
}

async function releaseStaleInProgressReservation(recordId) {
    const { data, error } = await adminSupabase
        .from("api_idempotency_requests")
        .delete()
        .eq("id", recordId)
        .is("completed_at", null)
        .is("response_status", null)
        .select("id")
        .maybeSingle();

    if (error) {
        throw new AppError(
            500,
            "IDEMPOTENCY_RECOVERY_FAILED",
            "Unable to recover stale idempotency reservation.",
            error
        );
    }

    return Boolean(data?.id);
}

function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    }

    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildRequestHash(req) {
    const payload = req.validated || req.body || {};
    return crypto
        .createHash("sha256")
        .update(stableStringify({
            body: payload,
            params: req.params,
            query: req.query
        }))
        .digest("hex");
}

module.exports = async function idempotency(req, res, next) {
    const idempotencyKey = req.header("Idempotency-Key");

    if (!idempotencyKey) {
        return next();
    }

    if (!req.auth?.user?.id) {
        return next(new AppError(500, "AUTH_CONTEXT_MISSING", "Authentication context is missing for idempotency."));
    }

    const tenantId = req.validated?.tenant_id || req.body?.tenant_id || req.query?.tenant_id || req.auth.tenantId || null;
    const scopeKey = tenantId || "platform";
    const routePath = req.baseUrl + req.path;
    const requestHash = buildRequestHash(req);

    const lookupColumns = {
        scope_key: scopeKey,
        user_id: req.auth.user.id,
        method: req.method,
        route_path: routePath,
        idempotency_key: idempotencyKey
    };

    const { data: existing, error: lookupError } = await adminSupabase
        .from("api_idempotency_requests")
        .select("*")
        .match(lookupColumns)
        .maybeSingle();

    if (lookupError) {
        return next(new AppError(500, "IDEMPOTENCY_LOOKUP_FAILED", "Unable to validate idempotency key.", lookupError));
    }

    if (existing) {
        if (existing.request_hash !== requestHash) {
            return next(new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different payload."));
        }

        if (isInProgressReservation(existing)) {
            if (isStaleInProgressReservation(existing)) {
                try {
                    const released = await releaseStaleInProgressReservation(existing.id);
                    if (!released) {
                        return next(new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "This request is already being processed."));
                    }
                } catch (error) {
                    return next(error);
                }
            } else {
                return next(new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "This request is already being processed."));
            }
        } else {
            return res.status(existing.response_status).json(existing.response_body);
        }
    }

    const { data: created, error: insertError } = await adminSupabase
        .from("api_idempotency_requests")
        .insert({
            tenant_id: tenantId,
            scope_key: scopeKey,
            user_id: req.auth.user.id,
            method: req.method,
            route_path: routePath,
            idempotency_key: idempotencyKey,
            request_hash: requestHash
        })
        .select("*")
        .single();

    if (insertError && isUniqueConstraintError(insertError)) {
        const { data: conflicted, error: conflictLookupError } = await adminSupabase
            .from("api_idempotency_requests")
            .select("*")
            .match(lookupColumns)
            .maybeSingle();

        if (conflictLookupError || !conflicted) {
            return next(new AppError(500, "IDEMPOTENCY_LOOKUP_FAILED", "Unable to validate idempotency key.", conflictLookupError));
        }

        if (conflicted.request_hash !== requestHash) {
            return next(new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different payload."));
        }

        if (isInProgressReservation(conflicted)) {
            if (isStaleInProgressReservation(conflicted)) {
                try {
                    const released = await releaseStaleInProgressReservation(conflicted.id);
                    if (released) {
                        const { data: retriedCreated, error: retriedInsertError } = await adminSupabase
                            .from("api_idempotency_requests")
                            .insert({
                                tenant_id: tenantId,
                                scope_key: scopeKey,
                                user_id: req.auth.user.id,
                                method: req.method,
                                route_path: routePath,
                                idempotency_key: idempotencyKey,
                                request_hash: requestHash
                            })
                            .select("*")
                            .single();

                        if (!retriedInsertError && retriedCreated) {
                            return attachPersistenceHooks(retriedCreated, res, next);
                        }

                        if (retriedInsertError && !isUniqueConstraintError(retriedInsertError)) {
                            return next(new AppError(500, "IDEMPOTENCY_CREATE_FAILED", "Unable to reserve idempotency key.", retriedInsertError));
                        }

                        const { data: retriedConflict, error: retriedConflictLookupError } = await adminSupabase
                            .from("api_idempotency_requests")
                            .select("*")
                            .match(lookupColumns)
                            .maybeSingle();

                        if (retriedConflictLookupError || !retriedConflict) {
                            return next(new AppError(500, "IDEMPOTENCY_LOOKUP_FAILED", "Unable to validate idempotency key.", retriedConflictLookupError));
                        }

                        if (retriedConflict.request_hash !== requestHash) {
                            return next(new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with a different payload."));
                        }

                        if (isInProgressReservation(retriedConflict)) {
                            return next(new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "This request is already being processed."));
                        }

                        return res.status(retriedConflict.response_status).json(retriedConflict.response_body);
                    }
                } catch (error) {
                    return next(error);
                }
            }

            return next(new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "This request is already being processed."));
        }

        if (conflicted.response_status === null) {
            return next(new AppError(409, "IDEMPOTENCY_IN_PROGRESS", "This request is already being processed."));
        }

        return res.status(conflicted.response_status).json(conflicted.response_body);
    }

    if (insertError || !created) {
        return next(new AppError(500, "IDEMPOTENCY_CREATE_FAILED", "Unable to reserve idempotency key.", insertError));
    }

    return attachPersistenceHooks(created, res, next);
};

function attachPersistenceHooks(created, res, next) {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    async function persistResponse(body) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
            await adminSupabase
                .from("api_idempotency_requests")
                .delete()
                .eq("id", created.id);
            return;
        }

        await adminSupabase
            .from("api_idempotency_requests")
            .update({
                response_status: res.statusCode,
                response_body: body,
                completed_at: new Date().toISOString()
            })
            .eq("id", created.id);
    }

    res.json = function patchedJson(body) {
        persistResponse(body).catch(() => undefined);
        return originalJson(body);
    };

    res.send = function patchedSend(body) {
        let normalizedBody = body;

        if (typeof body === "string") {
            try {
                normalizedBody = JSON.parse(body);
            } catch (error) {
                normalizedBody = { raw: body };
            }
        }

        persistResponse(normalizedBody).catch(() => undefined);
        return originalSend(body);
    };

    return next();
}

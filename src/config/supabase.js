const { createClient } = require("@supabase/supabase-js");

const env = require("./env");
const { observeDbQuery } = require("../services/observability.service");
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);

function extractTenantIdFromFilter(rawValue) {
    if (!rawValue) {
        return null;
    }

    return String(rawValue)
        .replace(/^eq\./, "")
        .replace(/^in\.\(/, "")
        .replace(/\)$/, "")
        .split(",")[0]
        .trim() || null;
}

function resolveDbOperation(urlPathname) {
    if (!urlPathname) {
        return "supabase.unknown";
    }

    const rpcPrefix = "/rest/v1/rpc/";
    const tablePrefix = "/rest/v1/";

    if (urlPathname.includes(rpcPrefix)) {
        const name = urlPathname.split(rpcPrefix)[1] || "unknown";
        return `rpc.${name}`;
    }

    if (urlPathname.includes(tablePrefix)) {
        const resource = urlPathname.split(tablePrefix)[1] || "unknown";
        const table = resource.split("/")[0] || "unknown";
        return `table.${table}`;
    }

    return `supabase.${urlPathname}`;
}

function resolveInputUrl(input) {
    return typeof input === "string" ? input : input?.url || "";
}

function resolveMethod(input, init) {
    if (init?.method) {
        return String(init.method).toUpperCase();
    }

    if (typeof input !== "string" && input?.method) {
        return String(input.method).toUpperCase();
    }

    return "GET";
}

function canRetryRequest(method) {
    return RETRYABLE_METHODS.has(method);
}

function isRetryableStatus(statusCode) {
    return RETRYABLE_STATUS_CODES.has(Number(statusCode));
}

function isRetryableNetworkError(error) {
    if (!error) {
        return false;
    }

    const name = String(error.name || "").toLowerCase();
    const message = String(error.message || "").toLowerCase();

    if (name === "aborterror") {
        return false;
    }

    return (
        name === "typeerror"
        || message.includes("fetch failed")
        || message.includes("networkerror")
        || message.includes("network error")
        || message.includes("socket")
        || message.includes("econnreset")
        || message.includes("etimedout")
    );
}

function computeRetryDelayMs(attemptIndex) {
    const maxAttempts = Math.max(1, Number(env.supabaseFetchRetryMaxAttempts || 1));
    const baseMs = Math.max(1, Number(env.supabaseFetchRetryBaseMs || 100));
    const maxMs = Math.max(baseMs, Number(env.supabaseFetchRetryMaxMs || 1000));
    const exponent = Math.max(0, Math.min(attemptIndex - 1, 8));
    const rawDelay = Math.min(maxMs, baseMs * (2 ** exponent));
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(rawDelay * 0.3)));
    const remainingAttempts = Math.max(maxAttempts - attemptIndex, 0);

    return Math.max(1, rawDelay - jitter + Math.min(remainingAttempts * 5, 50));
}

async function sleep(ms) {
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function createInstrumentedFetch(clientName) {
    return async (input, init) => {
        const startedAtNs = process.hrtime.bigint();
        const method = resolveMethod(input, init);
        const inputUrl = resolveInputUrl(input);

        let url;
        try {
            url = new URL(inputUrl);
        } catch {
            url = null;
        }

        const pathname = url?.pathname || "";
        const queryTenant = extractTenantIdFromFilter(url?.searchParams?.get("tenant_id"));
        const queryTenantAlt = extractTenantIdFromFilter(url?.searchParams?.get("p_tenant_id"));

        let bodyTenant = null;
        if (typeof init?.body === "string" && init.body.startsWith("{")) {
            try {
                const parsedBody = JSON.parse(init.body);
                bodyTenant =
                    parsedBody?.tenant_id ||
                    parsedBody?.p_tenant_id ||
                    parsedBody?.tenantId ||
                    null;
            } catch {
                bodyTenant = null;
            }
        }

        let response;
        let statusCode = 0;

        try {
            response = await fetch(input, init);
            statusCode = response.status;
            return response;
        } finally {
            const durationMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
            observeDbQuery({
                operation: `${clientName}.${method}.${resolveDbOperation(pathname)}`,
                statusCode,
                durationMs,
                tenantId: queryTenant || queryTenantAlt || bodyTenant || null
            });
        }
    };
}

function createRetriableSupabaseFetch(clientName) {
    const instrumentedFetch = createInstrumentedFetch(clientName);

    return async (input, init) => {
        const method = resolveMethod(input, init);
        const inputUrl = resolveInputUrl(input);
        const maxAttempts = Math.max(1, Number(env.supabaseFetchRetryMaxAttempts || 1));
        const retryEnabled = canRetryRequest(method) && maxAttempts > 1;

        let attempt = 0;
        let lastNetworkError = null;

        while (attempt < maxAttempts) {
            attempt += 1;

            try {
                const response = await instrumentedFetch(input, init);
                if (!retryEnabled || !isRetryableStatus(response.status) || attempt >= maxAttempts) {
                    return response;
                }

                const delayMs = computeRetryDelayMs(attempt);
                console.warn("[supabase-fetch] transient response, retrying", {
                    client: clientName,
                    method,
                    url: inputUrl,
                    status: response.status,
                    attempt,
                    maxAttempts,
                    delayMs
                });
                await sleep(delayMs);
            } catch (error) {
                lastNetworkError = error;
                if (!retryEnabled || !isRetryableNetworkError(error) || attempt >= maxAttempts) {
                    throw error;
                }

                const delayMs = computeRetryDelayMs(attempt);
                console.warn("[supabase-fetch] network error, retrying", {
                    client: clientName,
                    method,
                    url: inputUrl,
                    attempt,
                    maxAttempts,
                    delayMs,
                    message: String(error?.message || error)
                });
                await sleep(delayMs);
            }
        }

        if (lastNetworkError) {
            throw lastNetworkError;
        }

        return instrumentedFetch(input, init);
    };
}

const clientOptions = {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    global: {
        fetch: createRetriableSupabaseFetch("admin")
    }
};

const adminSupabase = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    clientOptions
);

const publicSupabase = createClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
        ...clientOptions,
        global: {
            fetch: createRetriableSupabaseFetch("public")
        }
    }
);

module.exports = {
    adminSupabase,
    publicSupabase
};

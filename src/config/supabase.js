const { createClient } = require("@supabase/supabase-js");

const env = require("./env");
const { observeDbQuery } = require("../services/observability.service");
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);
const AUTH_SIGNIN_PATH = "/auth/v1/token";

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

function canRetryRequest(method, pathname) {
    if (RETRYABLE_METHODS.has(method)) {
        return true;
    }

    // Password sign-in is safe to retry on transient network failures.
    return method === "POST" && pathname === AUTH_SIGNIN_PATH;
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

    return (
        name === "supabasefetchtimeouterror"
        || name === "aborterror"
        || name === "typeerror"
        || message.includes("timeout")
        || message.includes("fetch failed")
        || message.includes("networkerror")
        || message.includes("network error")
        || message.includes("socket")
        || message.includes("econnreset")
        || message.includes("etimedout")
    );
}

function computeRetryDelayMs(attemptIndex, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts || env.supabaseFetchRetryMaxAttempts || 1));
    const baseMs = Math.max(1, Number(options.baseMs || env.supabaseFetchRetryBaseMs || 100));
    const maxMs = Math.max(baseMs, Number(options.maxMs || env.supabaseFetchRetryMaxMs || 1000));
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

function resolvePathname(inputUrl) {
    try {
        return new URL(inputUrl).pathname || "";
    } catch {
        return "";
    }
}

async function executeFetchWithOptionalTimeout(input, init, timeoutMs = 0) {
    if (!timeoutMs || timeoutMs <= 0) {
        return fetch(input, init);
    }

    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    let clearAbortBridge = null;

    if (upstreamSignal) {
        if (upstreamSignal.aborted) {
            controller.abort();
        } else {
            const relayAbort = () => controller.abort();
            upstreamSignal.addEventListener("abort", relayAbort, { once: true });
            clearAbortBridge = () => upstreamSignal.removeEventListener("abort", relayAbort);
        }
    }

    const timeoutHandle = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        return await fetch(input, {
            ...(init || {}),
            signal: controller.signal
        });
    } catch (error) {
        const isAbortError = String(error?.name || "").toLowerCase() === "aborterror";
        if (!isAbortError) {
            throw error;
        }

        const timeoutError = new Error(`Supabase fetch timeout after ${timeoutMs}ms`);
        timeoutError.name = "SupabaseFetchTimeoutError";
        timeoutError.code = "SUPABASE_FETCH_TIMEOUT";
        throw timeoutError;
    } finally {
        clearTimeout(timeoutHandle);
        clearAbortBridge?.();
    }
}

function createInstrumentedFetch(clientName) {
    return async (input, init, runtimeOptions = {}) => {
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
            response = await executeFetchWithOptionalTimeout(
                input,
                init,
                Number(runtimeOptions.timeoutMs || 0)
            );
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
        const pathname = resolvePathname(inputUrl);
        const isAuthSignin = method === "POST" && pathname === AUTH_SIGNIN_PATH;
        const maxAttempts = isAuthSignin
            ? Math.max(1, Number(env.supabaseAuthRetryMaxAttempts || 1))
            : Math.max(1, Number(env.supabaseFetchRetryMaxAttempts || 1));
        const retryEnabled = canRetryRequest(method, pathname) && maxAttempts > 1;
        const timeoutMs = isAuthSignin
            ? Math.max(0, Number(env.supabaseAuthTimeoutMs || 0))
            : 0;
        const retryTiming = isAuthSignin
            ? {
                maxAttempts,
                baseMs: Math.max(1, Number(env.supabaseAuthRetryBaseMs || 120)),
                maxMs: Math.max(1, Number(env.supabaseAuthRetryMaxMs || 700))
            }
            : {
                maxAttempts,
                baseMs: Math.max(1, Number(env.supabaseFetchRetryBaseMs || 100)),
                maxMs: Math.max(1, Number(env.supabaseFetchRetryMaxMs || 1000))
            };

        let attempt = 0;
        let lastNetworkError = null;

        while (attempt < maxAttempts) {
            attempt += 1;

            try {
                const response = await instrumentedFetch(input, init, { timeoutMs });
                if (!retryEnabled || !isRetryableStatus(response.status) || attempt >= maxAttempts) {
                    return response;
                }

                const delayMs = computeRetryDelayMs(attempt, retryTiming);
                console.warn("[supabase-fetch] transient response, retrying", {
                    client: clientName,
                    method,
                    url: inputUrl,
                    status: response.status,
                    attempt,
                    maxAttempts,
                    delayMs,
                    timeoutMs: timeoutMs || null
                });
                await sleep(delayMs);
            } catch (error) {
                lastNetworkError = error;
                if (!retryEnabled || !isRetryableNetworkError(error) || attempt >= maxAttempts) {
                    throw error;
                }

                const delayMs = computeRetryDelayMs(attempt, retryTiming);
                console.warn("[supabase-fetch] network error, retrying", {
                    client: clientName,
                    method,
                    url: inputUrl,
                    attempt,
                    maxAttempts,
                    delayMs,
                    timeoutMs: timeoutMs || null,
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

const { createClient } = require("@supabase/supabase-js");

const env = require("./env");
const { observeDbQuery } = require("../services/observability.service");

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

function createInstrumentedFetch(clientName) {
    return async (input, init) => {
        const startedAtNs = process.hrtime.bigint();
        const method = String(init?.method || "GET").toUpperCase();
        const inputUrl = typeof input === "string" ? input : input?.url || "";

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

const clientOptions = {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    global: {
        fetch: createInstrumentedFetch("admin")
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
            fetch: createInstrumentedFetch("public")
        }
    }
);

module.exports = {
    adminSupabase,
    publicSupabase
};

function normalizeOrigin(origin) {
    if (!origin) {
        return origin;
    }

    return origin.trim().replace(/\/+$/, "");
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesWildcardOrigin(origin, allowedPattern) {
    const pattern = `^${allowedPattern.split("*").map(escapeRegex).join(".*")}$`;
    const regex = new RegExp(pattern, "i");
    return regex.test(origin);
}

function isOriginAllowed(origin, allowedOrigins) {
    if (!origin) {
        return true;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const normalizedAllowedOrigins = allowedOrigins.map(normalizeOrigin).filter(Boolean);

    if (normalizedAllowedOrigins.length === 0 || normalizedAllowedOrigins.includes("*")) {
        return true;
    }

    return normalizedAllowedOrigins.some((allowedOrigin) => {
        if (allowedOrigin === normalizedOrigin) {
            return true;
        }

        if (allowedOrigin.includes("*")) {
            return matchesWildcardOrigin(normalizedOrigin, allowedOrigin);
        }

        return false;
    });
}

module.exports = {
    normalizeOrigin,
    isOriginAllowed
};

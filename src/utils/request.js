function getEffectiveTenantId(req, options = {}) {
    const { bodyKey = "tenant_id", queryKey = "tenant_id", paramKey = "tenantId" } = options;

    return (
        req.tenantId ||
        req.validated?.body?.[bodyKey] ||
        req.body?.[bodyKey] ||
        req.validated?.query?.[queryKey] ||
        req.query?.[queryKey] ||
        req.params?.[paramKey] ||
        req.auth?.tenantId ||
        null
    );
}

module.exports = {
    getEffectiveTenantId
};

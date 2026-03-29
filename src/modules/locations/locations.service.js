const { adminSupabase } = require("../../config/supabase");
const AppError = require("../../utils/app-error");

const CACHE_TTL_MS = 30 * 60 * 1000;
const locationCache = new Map();

function getCached(key) {
    const entry = locationCache.get(key);
    if (!entry) {
        return null;
    }

    if (entry.expiresAt <= Date.now()) {
        locationCache.delete(key);
        return null;
    }

    return entry.value;
}

function setCached(key, value, ttlMs = CACHE_TTL_MS) {
    locationCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
}

async function getRegions() {
    const cacheKey = "regions";
    const cached = getCached(cacheKey);
    if (cached) {
        return cached;
    }

    const { data, error } = await adminSupabase
        .from("regions")
        .select("id, name")
        .order("name", { ascending: true });

    if (error) {
        throw new AppError(500, "LOCATIONS_REGIONS_LIST_FAILED", "Unable to load regions.", error);
    }

    const rows = data || [];
    setCached(cacheKey, rows);
    return rows;
}

async function getDistricts(regionId) {
    const cacheKey = `districts:${regionId}`;
    const cached = getCached(cacheKey);
    if (cached) {
        return cached;
    }

    const { data, error } = await adminSupabase
        .from("districts")
        .select("id, region_id, name")
        .eq("region_id", regionId)
        .order("name", { ascending: true });

    if (error) {
        throw new AppError(500, "LOCATIONS_DISTRICTS_LIST_FAILED", "Unable to load districts.", error);
    }

    const rows = data || [];
    setCached(cacheKey, rows);
    return rows;
}

async function getWards(districtId) {
    const cacheKey = `wards:${districtId}`;
    const cached = getCached(cacheKey);
    if (cached) {
        return cached;
    }

    const { data, error } = await adminSupabase
        .from("wards")
        .select("id, district_id, name")
        .eq("district_id", districtId)
        .order("name", { ascending: true });

    if (error) {
        throw new AppError(500, "LOCATIONS_WARDS_LIST_FAILED", "Unable to load wards.", error);
    }

    const rows = data || [];
    setCached(cacheKey, rows);
    return rows;
}

async function getVillages({ wardId, page = 1, limit = 100, search }) {
    const resolvedPage = Math.max(1, Number(page || 1));
    const resolvedLimit = Math.min(Math.max(1, Number(limit || 100)), 500);
    const from = (resolvedPage - 1) * resolvedLimit;
    const to = from + resolvedLimit - 1;

    let request = adminSupabase
        .from("villages")
        .select("id, ward_id, name, code", { count: "exact" })
        .eq("ward_id", wardId)
        .order("name", { ascending: true })
        .range(from, to);

    if (search) {
        request = request.ilike("name", `%${search}%`);
    }

    const { data, error, count } = await request;

    if (error) {
        throw new AppError(500, "LOCATIONS_VILLAGES_LIST_FAILED", "Unable to load villages.", error);
    }

    return {
        items: data || [],
        pagination: {
            page: resolvedPage,
            limit: resolvedLimit,
            total: count || 0
        }
    };
}

async function getRegionById(regionId) {
    const { data, error } = await adminSupabase
        .from("regions")
        .select("id, name")
        .eq("id", regionId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOCATION_REGION_LOOKUP_FAILED", "Unable to validate region.", error);
    }

    return data || null;
}

async function getDistrictById(districtId) {
    const { data, error } = await adminSupabase
        .from("districts")
        .select("id, region_id, name")
        .eq("id", districtId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOCATION_DISTRICT_LOOKUP_FAILED", "Unable to validate district.", error);
    }

    return data || null;
}

async function getWardById(wardId) {
    const { data, error } = await adminSupabase
        .from("wards")
        .select("id, district_id, name")
        .eq("id", wardId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOCATION_WARD_LOOKUP_FAILED", "Unable to validate ward.", error);
    }

    return data || null;
}

async function getVillageById(villageId) {
    const { data, error } = await adminSupabase
        .from("villages")
        .select("id, ward_id, name, code")
        .eq("id", villageId)
        .maybeSingle();

    if (error) {
        throw new AppError(500, "LOCATION_VILLAGE_LOOKUP_FAILED", "Unable to validate village.", error);
    }

    return data || null;
}

async function resolveLocationHierarchy({ regionId, districtId, wardId, villageId }) {
    const [region, district, ward, village] = await Promise.all([
        getRegionById(regionId),
        getDistrictById(districtId),
        getWardById(wardId),
        hasValue(villageId) ? getVillageById(villageId) : Promise.resolve(null)
    ]);

    if (!region) {
        throw new AppError(400, "LOCATION_REGION_INVALID", "Selected region does not exist.");
    }

    if (!district) {
        throw new AppError(400, "LOCATION_DISTRICT_INVALID", "Selected district does not exist.");
    }

    if (!ward) {
        throw new AppError(400, "LOCATION_WARD_INVALID", "Selected ward does not exist.");
    }

    if (hasValue(villageId) && !village) {
        throw new AppError(400, "LOCATION_VILLAGE_INVALID", "Selected village or mtaa does not exist.");
    }

    if (district.region_id !== region.id) {
        throw new AppError(400, "LOCATION_REGION_DISTRICT_MISMATCH", "District does not belong to the selected region.");
    }

    if (ward.district_id !== district.id) {
        throw new AppError(400, "LOCATION_DISTRICT_WARD_MISMATCH", "Ward does not belong to the selected district.");
    }

    if (village && village.ward_id !== ward.id) {
        throw new AppError(400, "LOCATION_WARD_VILLAGE_MISMATCH", "Village or mtaa does not belong to the selected ward.");
    }

    return {
        region_id: region.id,
        region_name: region.name,
        district_id: district.id,
        district_name: district.name,
        ward_id: ward.id,
        ward_name: ward.name,
        village_id: village?.id || null,
        village_name: village?.name || null,
        village_code: village?.code || null
    };
}

function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

async function resolveOptionalLocationHierarchy({ regionId, districtId, wardId, villageId }) {
    const ids = [regionId, districtId, wardId, villageId];
    const presentCount = ids.filter(hasValue).length;

    if (presentCount === 0) {
        return null;
    }

    const requiredHierarchyPresent = [regionId, districtId, wardId].filter(hasValue).length;

    if (requiredHierarchyPresent > 0 && requiredHierarchyPresent < 3) {
        throw new AppError(
            400,
            "LOCATION_HIERARCHY_INCOMPLETE",
            "Region, district, and ward must all be selected together."
        );
    }

    if (requiredHierarchyPresent === 0 && hasValue(villageId)) {
        throw new AppError(
            400,
            "LOCATION_HIERARCHY_INCOMPLETE",
            "Village or mtaa cannot be selected without region, district, and ward."
        );
    }

    if (requiredHierarchyPresent === 0) {
        return null;
    }

    return resolveLocationHierarchy({ regionId, districtId, wardId, villageId });
}

module.exports = {
    getRegions,
    getDistricts,
    getWards,
    getVillages,
    resolveLocationHierarchy,
    resolveOptionalLocationHierarchy
};

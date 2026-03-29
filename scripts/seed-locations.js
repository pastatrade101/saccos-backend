require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");

const { adminSupabase } = require("../src/config/supabase");

const DEFAULT_BATCH_SIZE = 500;

function normalizeText(value) {
    return String(value || "").trim();
}

function chunkArray(items, size = DEFAULT_BATCH_SIZE) {
    const chunks = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function upsertRows(table, rows, onConflict) {
    for (const chunk of chunkArray(rows)) {
        const { error } = await adminSupabase
            .from(table)
            .upsert(chunk, { onConflict, ignoreDuplicates: false });

        if (error) {
            throw new Error(`Failed to upsert ${table}: ${error.message}`);
        }
    }
}

async function fetchRowsByNames(table, nameFilterField, names, selectColumns) {
    const rows = [];

    for (const chunk of chunkArray(names)) {
        const { data, error } = await adminSupabase
            .from(table)
            .select(selectColumns)
            .in(nameFilterField, chunk);

        if (error) {
            throw new Error(`Failed to fetch ${table}: ${error.message}`);
        }

        rows.push(...(data || []));
    }

    return rows;
}

async function main() {
    const inputPath = process.argv[2];

    if (!inputPath) {
        throw new Error("Usage: node scripts/seed-locations.js /absolute/path/to/plabrep_areas_complete.json");
    }

    const resolvedPath = path.resolve(inputPath);
    const raw = await fs.readFile(resolvedPath, "utf8");
    const dataset = JSON.parse(raw);

    if (!Array.isArray(dataset) || !dataset.length) {
        throw new Error("Location dataset must be a non-empty JSON array.");
    }

    const normalizedRows = dataset
        .map((item) => ({
            region: normalizeText(item.Region),
            district: normalizeText(item.Council),
            ward: normalizeText(item.Ward),
            village: normalizeText(item.Village_mtaa || item.Name),
            code: normalizeText(item.Code) || null
        }))
        .filter((item) => item.region && item.district && item.ward && item.village);

    const regionNames = Array.from(new Set(normalizedRows.map((row) => row.region))).sort();
    await upsertRows("regions", regionNames.map((name) => ({ name })), "name");
    const regionRows = await fetchRowsByNames("regions", "name", regionNames, "id, name");
    const regionByName = new Map(regionRows.map((row) => [row.name, row.id]));

    const districtMap = new Map();
    normalizedRows.forEach((row) => {
        const regionId = regionByName.get(row.region);
        if (!regionId) {
            return;
        }
        districtMap.set(`${regionId}::${row.district}`, {
            region_id: regionId,
            name: row.district
        });
    });
    await upsertRows("districts", Array.from(districtMap.values()), "region_id,name");
    const districtRows = await adminSupabase
        .from("districts")
        .select("id, region_id, name")
        .in("region_id", Array.from(new Set(Array.from(districtMap.values()).map((row) => row.region_id))));
    if (districtRows.error) {
        throw new Error(`Failed to fetch districts: ${districtRows.error.message}`);
    }
    const districtByKey = new Map((districtRows.data || []).map((row) => [`${row.region_id}::${row.name}`, row.id]));

    const wardMap = new Map();
    normalizedRows.forEach((row) => {
        const regionId = regionByName.get(row.region);
        const districtId = regionId ? districtByKey.get(`${regionId}::${row.district}`) : null;
        if (!districtId) {
            return;
        }
        wardMap.set(`${districtId}::${row.ward}`, {
            district_id: districtId,
            name: row.ward
        });
    });
    await upsertRows("wards", Array.from(wardMap.values()), "district_id,name");
    const wardRows = await adminSupabase
        .from("wards")
        .select("id, district_id, name")
        .in("district_id", Array.from(new Set(Array.from(wardMap.values()).map((row) => row.district_id))));
    if (wardRows.error) {
        throw new Error(`Failed to fetch wards: ${wardRows.error.message}`);
    }
    const wardByKey = new Map((wardRows.data || []).map((row) => [`${row.district_id}::${row.name}`, row.id]));

    const villageMap = new Map();
    normalizedRows.forEach((row) => {
        const regionId = regionByName.get(row.region);
        const districtId = regionId ? districtByKey.get(`${regionId}::${row.district}`) : null;
        const wardId = districtId ? wardByKey.get(`${districtId}::${row.ward}`) : null;
        if (!wardId) {
            return;
        }

        villageMap.set(`${wardId}::${row.village}`, {
            ward_id: wardId,
            name: row.village,
            code: row.code
        });
    });
    await upsertRows("villages", Array.from(villageMap.values()), "ward_id,name");

    console.log("Location seed completed.");
    console.log(`Regions: ${regionNames.length}`);
    console.log(`Districts: ${districtMap.size}`);
    console.log(`Wards: ${wardMap.size}`);
    console.log(`Villages: ${villageMap.size}`);
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("Location seed failed:", error);
        process.exit(1);
    });

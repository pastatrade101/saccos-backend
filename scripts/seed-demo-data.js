require("dotenv").config();

const { adminSupabase } = require("../src/config/supabase");
const dividendsService = require("../src/modules/dividends/dividends.service");

const DEFAULT_PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || "DemoPass123!";
const OWNER_EMAIL =
    process.env.BOOTSTRAP_INTERNAL_OPS_EMAIL ||
    process.env.DEMO_OWNER_EMAIL ||
    "owner.demo@saccos.local";
const OWNER_PASSWORD =
    process.env.BOOTSTRAP_INTERNAL_OPS_PASSWORD ||
    process.env.DEMO_OWNER_PASSWORD ||
    DEFAULT_PASSWORD;
const OWNER_NAME = process.env.BOOTSTRAP_INTERNAL_OPS_FULL_NAME || process.env.DEMO_OWNER_FULL_NAME || "Platform Owner";
const OWNER_PHONE = process.env.BOOTSTRAP_INTERNAL_OPS_PHONE || process.env.DEMO_OWNER_PHONE || "+255754100001";

function atOffset({ yearsAgo = 0, monthsAgo = 0, daysAgo = 0, hour = 9, minute = 0 }) {
    const date = new Date();
    date.setUTCHours(hour, minute, 0, 0);
    if (yearsAgo) {
        date.setUTCFullYear(date.getUTCFullYear() - yearsAgo);
    }
    if (monthsAgo) {
        date.setUTCMonth(date.getUTCMonth() - monthsAgo);
    }
    if (daysAgo) {
        date.setUTCDate(date.getUTCDate() - daysAgo);
    }
    return date;
}

function isoAtOffset(offsets) {
    return atOffset(offsets).toISOString();
}

function fyLabel(startDate, endDate) {
    return `FY${startDate.getUTCFullYear()}/${endDate.getUTCFullYear()}`;
}

function buildDemoSeed() {
    const closedCycleStart = atOffset({ monthsAgo: 8, hour: 0, minute: 0 });
    const closedCycleEnd = atOffset({ daysAgo: 25, hour: 0, minute: 0 });
    const declarationDate = atOffset({ daysAgo: 20, hour: 0, minute: 0 });
    const paymentDate = atOffset({ daysAgo: 12, hour: 0, minute: 0 });
    const draftCycleStart = atOffset({ monthsAgo: 1, hour: 0, minute: 0 });
    const draftCycleEnd = atOffset({ daysAgo: 1, hour: 0, minute: 0 });

    return {
        tenant: {
            name: "Mwanga Community SACCOS",
            registrationNumber: "TZ-SACCOS-DEMO-2026-001",
            plan: "growth",
            status: "active",
            currency: "TZS",
            closedDividendLabel: fyLabel(closedCycleStart, closedCycleEnd),
            draftDividendLabel: `${fyLabel(draftCycleStart, draftCycleEnd)} Planning`,
            closedCycleStart: closedCycleStart.toISOString().slice(0, 10),
            closedCycleEnd: closedCycleEnd.toISOString().slice(0, 10),
            declarationDate: declarationDate.toISOString().slice(0, 10),
            paymentDate: paymentDate.toISOString().slice(0, 10),
            draftCycleStart: draftCycleStart.toISOString().slice(0, 10),
            draftCycleEnd: draftCycleEnd.toISOString().slice(0, 10)
        },
        branches: [
            {
                code: "DAR",
                name: "Dar Central Branch",
                address_line1: "Samora Avenue",
                address_line2: "Golden Jubilee Towers",
                city: "Dar es Salaam",
                state: "Dar es Salaam",
                country: "TZ"
            },
            {
                code: "MWZ",
                name: "Mwanza Lake Branch",
                address_line1: "Kenyatta Road",
                address_line2: "Lake View Plaza",
                city: "Mwanza",
                state: "Mwanza",
                country: "TZ"
            }
        ],
        staff: [
            {
                key: "tenant_admin",
                email: "admin.demo@mwanga.co.tz",
                password: DEFAULT_PASSWORD,
                full_name: "Neema Kessy",
                phone: "+255754100010",
                role: "super_admin",
                branchCodes: ["DAR", "MWZ"]
            },
            {
                key: "branch_manager_dar",
                email: "manager.dar.demo@mwanga.co.tz",
                password: DEFAULT_PASSWORD,
                full_name: "Baraka Nnko",
                phone: "+255754100011",
                role: "branch_manager",
                branchCodes: ["DAR"]
            },
            {
                key: "loan_officer_mwz",
                email: "loans.mwanza.demo@mwanga.co.tz",
                password: DEFAULT_PASSWORD,
                full_name: "Amina Makoye",
                phone: "+255754100012",
                role: "loan_officer",
                branchCodes: ["MWZ"]
            },
            {
                key: "teller_dar",
                email: "teller.dar.demo@mwanga.co.tz",
                password: DEFAULT_PASSWORD,
                full_name: "Salum Mushi",
                phone: "+255754100013",
                role: "teller",
                branchCodes: ["DAR"]
            },
            {
                key: "teller_mwz",
                email: "teller.mwanza.demo@mwanga.co.tz",
                password: DEFAULT_PASSWORD,
                full_name: "Mariam Simbeye",
                phone: "+255754100014",
                role: "teller",
                branchCodes: ["MWZ"]
            },
            {
                key: "auditor",
                email: "auditor.demo@mwanga.co.tz",
                password: DEFAULT_PASSWORD,
                full_name: "John Macha",
                phone: "+255754100015",
                role: "auditor",
                branchCodes: ["DAR", "MWZ"]
            }
        ],
        members: [
            {
                full_name: "Asha Mwakalinga",
                phone: "+255713000101",
                email: "asha.mwakalinga.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240101",
                branchCode: "DAR",
                joinedAt: isoAtOffset({ monthsAgo: 13, daysAgo: 4, hour: 9, minute: 15 }),
                createLogin: true,
                password: DEFAULT_PASSWORD,
                shareContributions: [
                    { amount: 250000, date: isoAtOffset({ monthsAgo: 7, daysAgo: 10, hour: 10, minute: 5 }), reference: "TZ-DEMO-SHR-0001" },
                    { amount: 300000, date: isoAtOffset({ monthsAgo: 4, daysAgo: 18, hour: 11, minute: 0 }), reference: "TZ-DEMO-SHR-0002" },
                    { amount: 350000, date: isoAtOffset({ daysAgo: 19, hour: 9, minute: 25 }), reference: "TZ-DEMO-SHR-0003" }
                ],
                transactions: [
                    { type: "deposit", amount: 1200000, date: isoAtOffset({ monthsAgo: 6, daysAgo: 8, hour: 10, minute: 15 }), reference: "TZ-DEMO-DEP-0001" },
                    { type: "deposit", amount: 750000, date: isoAtOffset({ monthsAgo: 2, daysAgo: 12, hour: 11, minute: 40 }), reference: "TZ-DEMO-DEP-0002" },
                    { type: "deposit", amount: 420000, date: isoAtOffset({ daysAgo: 6, hour: 9, minute: 20 }), reference: "TZ-DEMO-DEP-0003" },
                    { type: "withdraw", amount: 150000, date: isoAtOffset({ daysAgo: 1, hour: 14, minute: 5 }), reference: "TZ-DEMO-WDL-0001" }
                ],
                loan: {
                    principal: 4800000,
                    annual_interest_rate: 18,
                    term_count: 12,
                    repayment_frequency: "monthly",
                    disbursedAt: isoAtOffset({ monthsAgo: 5, daysAgo: 10, hour: 8, minute: 30 }),
                    reference: "TZ-DEMO-LN-0001",
                    repayments: [
                        { amount: 690000, date: isoAtOffset({ monthsAgo: 3, daysAgo: 14, hour: 15, minute: 30 }), reference: "TZ-DEMO-LNR-0001" },
                        { amount: 690000, date: isoAtOffset({ monthsAgo: 1, daysAgo: 10, hour: 10, minute: 0 }), reference: "TZ-DEMO-LNR-0002" }
                    ]
                }
            },
            {
                full_name: "Joseph Nyerere",
                phone: "+255713000102",
                email: "joseph.nyerere.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240102",
                branchCode: "DAR",
                joinedAt: isoAtOffset({ monthsAgo: 12, daysAgo: 18, hour: 9, minute: 30 }),
                createLogin: false,
                shareContributions: [
                    { amount: 200000, date: isoAtOffset({ monthsAgo: 6, daysAgo: 9, hour: 10, minute: 0 }), reference: "TZ-DEMO-SHR-0004" },
                    { amount: 220000, date: isoAtOffset({ monthsAgo: 3, daysAgo: 20, hour: 11, minute: 10 }), reference: "TZ-DEMO-SHR-0005" },
                    { amount: 180000, date: isoAtOffset({ daysAgo: 4, hour: 13, minute: 10 }), reference: "TZ-DEMO-SHR-0006" }
                ],
                transactions: [
                    { type: "deposit", amount: 860000, date: isoAtOffset({ monthsAgo: 5, daysAgo: 7, hour: 12, minute: 0 }), reference: "TZ-DEMO-DEP-0004" },
                    { type: "deposit", amount: 310000, date: isoAtOffset({ daysAgo: 5, hour: 10, minute: 50 }), reference: "TZ-DEMO-DEP-0005" },
                    { type: "deposit", amount: 265000, date: isoAtOffset({ daysAgo: 2, hour: 15, minute: 35 }), reference: "TZ-DEMO-DEP-0006" }
                ]
            },
            {
                full_name: "Neema Mushi",
                phone: "+255713000103",
                email: "neema.mushi.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240103",
                branchCode: "DAR",
                joinedAt: isoAtOffset({ monthsAgo: 11, daysAgo: 26, hour: 8, minute: 10 }),
                createLogin: false,
                shareContributions: [
                    { amount: 180000, date: isoAtOffset({ monthsAgo: 7, daysAgo: 1, hour: 9, minute: 15 }), reference: "TZ-DEMO-SHR-0007" },
                    { amount: 170000, date: isoAtOffset({ monthsAgo: 2, daysAgo: 22, hour: 10, minute: 45 }), reference: "TZ-DEMO-SHR-0008" }
                ],
                transactions: [
                    { type: "deposit", amount: 540000, date: isoAtOffset({ monthsAgo: 4, daysAgo: 16, hour: 11, minute: 35 }), reference: "TZ-DEMO-DEP-0007" },
                    { type: "deposit", amount: 390000, date: isoAtOffset({ daysAgo: 3, hour: 9, minute: 40 }), reference: "TZ-DEMO-DEP-0008" },
                    { type: "withdraw", amount: 120000, date: isoAtOffset({ daysAgo: 0, hour: 16, minute: 20 }), reference: "TZ-DEMO-WDL-0002" }
                ],
                loan: {
                    principal: 3200000,
                    annual_interest_rate: 20,
                    term_count: 10,
                    repayment_frequency: "monthly",
                    disbursedAt: isoAtOffset({ monthsAgo: 4, daysAgo: 18, hour: 9, minute: 0 }),
                    reference: "TZ-DEMO-LN-0002",
                    repayments: [
                        { amount: 430000, date: isoAtOffset({ monthsAgo: 2, daysAgo: 18, hour: 14, minute: 15 }), reference: "TZ-DEMO-LNR-0003" }
                    ]
                }
            },
            {
                full_name: "Salma Juma",
                phone: "+255713000104",
                email: "salma.juma.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240104",
                branchCode: "DAR",
                joinedAt: isoAtOffset({ monthsAgo: 10, daysAgo: 8, hour: 11, minute: 25 }),
                createLogin: false,
                shareContributions: [
                    { amount: 150000, date: isoAtOffset({ monthsAgo: 5, daysAgo: 9, hour: 9, minute: 25 }), reference: "TZ-DEMO-SHR-0009" },
                    { amount: 140000, date: isoAtOffset({ daysAgo: 2, hour: 12, minute: 10 }), reference: "TZ-DEMO-SHR-0010" }
                ],
                transactions: [
                    { type: "deposit", amount: 610000, date: isoAtOffset({ monthsAgo: 3, daysAgo: 7, hour: 10, minute: 25 }), reference: "TZ-DEMO-DEP-0009" },
                    { type: "deposit", amount: 290000, date: isoAtOffset({ daysAgo: 0, hour: 11, minute: 15 }), reference: "TZ-DEMO-DEP-0010" }
                ]
            },
            {
                full_name: "Rehema Mageni",
                phone: "+255713000105",
                email: "rehema.mageni.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240105",
                branchCode: "MWZ",
                joinedAt: isoAtOffset({ monthsAgo: 14, daysAgo: 2, hour: 10, minute: 20 }),
                createLogin: true,
                password: DEFAULT_PASSWORD,
                shareContributions: [
                    { amount: 260000, date: isoAtOffset({ monthsAgo: 7, daysAgo: 5, hour: 10, minute: 30 }), reference: "TZ-DEMO-SHR-0011" },
                    { amount: 280000, date: isoAtOffset({ monthsAgo: 4, daysAgo: 2, hour: 9, minute: 50 }), reference: "TZ-DEMO-SHR-0012" },
                    { amount: 310000, date: isoAtOffset({ daysAgo: 9, hour: 14, minute: 0 }), reference: "TZ-DEMO-SHR-0013" }
                ],
                transactions: [
                    { type: "deposit", amount: 980000, date: isoAtOffset({ monthsAgo: 6, daysAgo: 4, hour: 9, minute: 25 }), reference: "TZ-DEMO-DEP-0011" },
                    { type: "deposit", amount: 660000, date: isoAtOffset({ monthsAgo: 1, daysAgo: 18, hour: 10, minute: 10 }), reference: "TZ-DEMO-DEP-0012" },
                    { type: "deposit", amount: 430000, date: isoAtOffset({ daysAgo: 7, hour: 11, minute: 10 }), reference: "TZ-DEMO-DEP-0013" }
                ],
                loan: {
                    principal: 5400000,
                    annual_interest_rate: 19,
                    term_count: 14,
                    repayment_frequency: "monthly",
                    disbursedAt: isoAtOffset({ monthsAgo: 5, daysAgo: 3, hour: 11, minute: 0 }),
                    reference: "TZ-DEMO-LN-0003",
                    repayments: [
                        { amount: 720000, date: isoAtOffset({ monthsAgo: 3, daysAgo: 3, hour: 16, minute: 10 }), reference: "TZ-DEMO-LNR-0004" },
                        { amount: 720000, date: isoAtOffset({ monthsAgo: 1, daysAgo: 4, hour: 9, minute: 0 }), reference: "TZ-DEMO-LNR-0005" }
                    ]
                }
            },
            {
                full_name: "Baraka Matata",
                phone: "+255713000106",
                email: "baraka.matata.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240106",
                branchCode: "MWZ",
                joinedAt: isoAtOffset({ monthsAgo: 12, daysAgo: 12, hour: 10, minute: 10 }),
                createLogin: false,
                shareContributions: [
                    { amount: 210000, date: isoAtOffset({ monthsAgo: 6, daysAgo: 15, hour: 10, minute: 0 }), reference: "TZ-DEMO-SHR-0014" },
                    { amount: 240000, date: isoAtOffset({ daysAgo: 12, hour: 13, minute: 15 }), reference: "TZ-DEMO-SHR-0015" }
                ],
                transactions: [
                    { type: "deposit", amount: 710000, date: isoAtOffset({ monthsAgo: 3, daysAgo: 12, hour: 9, minute: 0 }), reference: "TZ-DEMO-DEP-0014" },
                    { type: "withdraw", amount: 180000, date: isoAtOffset({ daysAgo: 10, hour: 14, minute: 30 }), reference: "TZ-DEMO-WDL-0003" }
                ]
            },
            {
                full_name: "Happyness Mbise",
                phone: "+255713000107",
                email: "happyness.mbise.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240107",
                branchCode: "MWZ",
                joinedAt: isoAtOffset({ monthsAgo: 9, daysAgo: 10, hour: 8, minute: 45 }),
                createLogin: false,
                shareContributions: [
                    { amount: 190000, date: isoAtOffset({ monthsAgo: 4, daysAgo: 10, hour: 9, minute: 40 }), reference: "TZ-DEMO-SHR-0016" },
                    { amount: 205000, date: isoAtOffset({ daysAgo: 8, hour: 12, minute: 20 }), reference: "TZ-DEMO-SHR-0017" }
                ],
                transactions: [
                    { type: "deposit", amount: 520000, date: isoAtOffset({ monthsAgo: 2, daysAgo: 25, hour: 13, minute: 0 }), reference: "TZ-DEMO-DEP-0015" },
                    { type: "deposit", amount: 310000, date: isoAtOffset({ daysAgo: 8, hour: 10, minute: 40 }), reference: "TZ-DEMO-DEP-0016" }
                ]
            },
            {
                full_name: "Omari Kweka",
                phone: "+255713000108",
                email: "omari.kweka.member@mwanga.co.tz",
                national_id: "TZN-DEMO-240108",
                branchCode: "MWZ",
                joinedAt: isoAtOffset({ monthsAgo: 11, daysAgo: 6, hour: 7, minute: 55 }),
                createLogin: true,
                password: DEFAULT_PASSWORD,
                shareContributions: [
                    { amount: 230000, date: isoAtOffset({ monthsAgo: 7, daysAgo: 8, hour: 10, minute: 25 }), reference: "TZ-DEMO-SHR-0018" },
                    { amount: 260000, date: isoAtOffset({ monthsAgo: 3, daysAgo: 11, hour: 9, minute: 55 }), reference: "TZ-DEMO-SHR-0019" },
                    { amount: 170000, date: isoAtOffset({ daysAgo: 5, hour: 11, minute: 45 }), reference: "TZ-DEMO-SHR-0020" }
                ],
                transactions: [
                    { type: "deposit", amount: 880000, date: isoAtOffset({ monthsAgo: 5, daysAgo: 17, hour: 9, minute: 45 }), reference: "TZ-DEMO-DEP-0017" },
                    { type: "deposit", amount: 470000, date: isoAtOffset({ daysAgo: 11, hour: 15, minute: 35 }), reference: "TZ-DEMO-DEP-0018" },
                    { type: "withdraw", amount: 110000, date: isoAtOffset({ daysAgo: 5, hour: 13, minute: 30 }), reference: "TZ-DEMO-WDL-0004" }
                ],
                loan: {
                    principal: 2700000,
                    annual_interest_rate: 17,
                    term_count: 8,
                    repayment_frequency: "monthly",
                    disbursedAt: isoAtOffset({ monthsAgo: 3, daysAgo: 8, hour: 10, minute: 0 }),
                    reference: "TZ-DEMO-LN-0004",
                    repayments: [
                        { amount: 430000, date: isoAtOffset({ monthsAgo: 1, daysAgo: 7, hour: 15, minute: 0 }), reference: "TZ-DEMO-LNR-0006" }
                    ]
                }
            }
        ]
    };
}

const DEMO = buildDemoSeed();

function logStep(message) {
    console.log(`[seed:demo] ${message}`);
}

function assertResult(result, message) {
    if (!result || result.error) {
        throw new Error(`${message}: ${result?.error?.message || "unknown error"}`);
    }

    return result.data;
}

async function findUserByEmail(email) {
    let page = 1;
    const perPage = 200;

    while (true) {
        const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage });

        if (error) {
            throw error;
        }

        const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

        if (match) {
            return match;
        }

        if (data.users.length < perPage) {
            return null;
        }

        page += 1;
    }
}

async function upsertAuthUser({ email, password, fullName, phone, appMetadata = {}, userMetadata = {} }) {
    const existingUser = await findUserByEmail(email);
    const metadata = {
        full_name: fullName,
        phone,
        ...userMetadata
    };

    if (existingUser) {
        const { data, error } = await adminSupabase.auth.admin.updateUserById(existingUser.id, {
            password,
            email_confirm: true,
            user_metadata: {
                ...(existingUser.user_metadata || {}),
                ...metadata
            },
            app_metadata: {
                ...(existingUser.app_metadata || {}),
                ...appMetadata
            }
        });

        if (error) {
            throw error;
        }

        return data.user;
    }

    const { data, error } = await adminSupabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
        app_metadata: appMetadata
    });

    if (error) {
        throw error;
    }

    return data.user;
}

async function ensureBranchAssignments({ tenantId, userId, branchIds }) {
    const uniqueBranchIds = [...new Set(branchIds.filter(Boolean))];

    if (!uniqueBranchIds.length) {
        return;
    }

    const existingRows = assertResult(
        await adminSupabase
            .from("branch_staff_assignments")
            .select("branch_id")
            .eq("tenant_id", tenantId)
            .eq("user_id", userId)
            .in("branch_id", uniqueBranchIds)
            .is("deleted_at", null),
        "Unable to query branch assignments"
    ) || [];

    const existingBranchIds = new Set(existingRows.map((row) => row.branch_id));
    const rowsToInsert = uniqueBranchIds
        .filter((branchId) => !existingBranchIds.has(branchId))
        .map((branchId) => ({
            tenant_id: tenantId,
            branch_id: branchId,
            user_id: userId
        }));

    if (!rowsToInsert.length) {
        return;
    }

    assertResult(
        await adminSupabase.from("branch_staff_assignments").insert(rowsToInsert),
        "Unable to create branch assignments"
    );
}

async function ensureTenant(ownerUserId) {
    let tenant = assertResult(
        await adminSupabase
            .from("tenants")
            .select("*")
            .eq("registration_number", DEMO.tenant.registrationNumber)
            .is("deleted_at", null)
            .maybeSingle(),
        "Unable to load demo tenant"
    );

    if (!tenant) {
        tenant = assertResult(
            await adminSupabase
                .from("tenants")
                .insert({
                    name: DEMO.tenant.name,
                    registration_number: DEMO.tenant.registrationNumber,
                    status: DEMO.tenant.status
                })
                .select("*")
                .single(),
            "Unable to create demo tenant"
        );
    }

    const subscription = assertResult(
        await adminSupabase
            .from("subscriptions")
            .select("*")
            .eq("tenant_id", tenant.id)
            .order("start_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        "Unable to load tenant subscription"
    );

    const subscriptionPayload = {
        tenant_id: tenant.id,
        plan: DEMO.tenant.plan,
        status: "active",
        start_at: "2025-07-01T00:00:00.000Z",
        expires_at: "2026-12-31T23:59:59.000Z",
        grace_period_until: null,
        limits_override: {}
    };

    if (!subscription) {
        assertResult(
            await adminSupabase.from("subscriptions").insert(subscriptionPayload),
            "Unable to create tenant subscription"
        );
    } else {
        assertResult(
            await adminSupabase
                .from("subscriptions")
                .update(subscriptionPayload)
                .eq("id", subscription.id),
            "Unable to update tenant subscription"
        );
    }

    const { error: defaultsError } = await adminSupabase.rpc("seed_tenant_defaults", {
        p_tenant_id: tenant.id
    });

    if (defaultsError) {
        throw defaultsError;
    }

    assertResult(
        await adminSupabase.from("audit_logs").insert({
            tenant_id: tenant.id,
            user_id: ownerUserId,
            table: "tenants",
            action: "seed_demo_tenant",
            before_data: null,
            after_data: tenant
        }),
        "Unable to write demo tenant audit log"
    );

    return tenant;
}

async function ensureBranch(tenantId, branch) {
    let existing = assertResult(
        await adminSupabase
            .from("branches")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("code", branch.code)
            .is("deleted_at", null)
            .maybeSingle(),
        `Unable to load branch ${branch.code}`
    );

    if (!existing) {
        existing = assertResult(
            await adminSupabase
                .from("branches")
                .insert({
                    tenant_id: tenantId,
                    ...branch
                })
                .select("*")
                .single(),
            `Unable to create branch ${branch.code}`
        );
    }

    return existing;
}

async function ensureUserProfile({ userId, tenantId, fullName, phone, role, branchIds }) {
    assertResult(
        await adminSupabase
            .from("user_profiles")
            .upsert({
                user_id: userId,
                tenant_id: tenantId,
                full_name: fullName,
                phone: phone || null,
                role,
                is_active: true
            }, { onConflict: "user_id" }),
        `Unable to upsert user profile for ${fullName}`
    );

    await ensureBranchAssignments({
        tenantId,
        userId,
        branchIds
    });
}

async function getTenantSettings(tenantId) {
    return assertResult(
        await adminSupabase
            .from("tenant_settings")
            .select("*")
            .eq("tenant_id", tenantId)
            .single(),
        "Unable to load tenant settings"
    );
}

async function getSystemAccountId(tenantId, systemTag) {
    const account = assertResult(
        await adminSupabase
            .from("chart_of_accounts")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("system_tag", systemTag)
            .is("deleted_at", null)
            .maybeSingle(),
        `Unable to load account for ${systemTag}`
    );

    if (!account?.id) {
        throw new Error(`Required system account ${systemTag} is missing.`);
    }

    return account.id;
}

async function ensureMember(tenantId, branch, memberSeed, savingsControlAccountId, shareControlAccountId) {
    let member = assertResult(
        await adminSupabase
            .from("members")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("national_id", memberSeed.national_id)
            .is("deleted_at", null)
            .maybeSingle(),
        `Unable to load member ${memberSeed.full_name}`
    );

    if (!member) {
        member = assertResult(
            await adminSupabase
                .from("members")
                .insert({
                    tenant_id: tenantId,
                    branch_id: branch.id,
                    full_name: memberSeed.full_name,
                    phone: memberSeed.phone,
                    email: memberSeed.email,
                    national_id: memberSeed.national_id,
                    status: "active"
                })
                .select("*")
                .single(),
            `Unable to create member ${memberSeed.full_name}`
        );
    }

    let savingsAccount = assertResult(
        await adminSupabase
            .from("member_accounts")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id)
            .is("deleted_at", null)
            .eq("product_type", "savings")
            .maybeSingle(),
        `Unable to load account for ${memberSeed.full_name}`
    );

    if (!savingsAccount) {
        const accountNumber = `SV-${memberSeed.national_id.slice(-6)}`;
        savingsAccount = assertResult(
            await adminSupabase
                .from("member_accounts")
                .insert({
                    tenant_id: tenantId,
                    member_id: member.id,
                    branch_id: branch.id,
                    account_number: accountNumber,
                    account_name: `${memberSeed.full_name} Savings`,
                    product_type: "savings",
                    status: "active",
                    gl_account_id: savingsControlAccountId
                })
                .select("*")
                .single(),
            `Unable to create member account for ${memberSeed.full_name}`
        );
    }

    let shareAccount = assertResult(
        await adminSupabase
            .from("member_accounts")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id)
            .is("deleted_at", null)
            .eq("product_type", "shares")
            .maybeSingle(),
        `Unable to load share account for ${memberSeed.full_name}`
    );

    if (!shareAccount) {
        const accountNumber = `SH-${memberSeed.national_id.slice(-6)}`;
        shareAccount = assertResult(
            await adminSupabase
                .from("member_accounts")
                .insert({
                    tenant_id: tenantId,
                    member_id: member.id,
                    branch_id: branch.id,
                    account_number: accountNumber,
                    account_name: `${memberSeed.full_name} Share Capital`,
                    product_type: "shares",
                    status: "active",
                    gl_account_id: shareControlAccountId
                })
                .select("*")
                .single(),
            `Unable to create share account for ${memberSeed.full_name}`
        );
    }

    await assertResult(
        await adminSupabase
            .from("members")
            .update({
                branch_id: branch.id,
                full_name: memberSeed.full_name,
                phone: memberSeed.phone,
                email: memberSeed.email,
                status: "active",
                created_at: memberSeed.joinedAt
            })
            .eq("id", member.id),
        `Unable to align member record for ${memberSeed.full_name}`
    );

    await assertResult(
        await adminSupabase
            .from("member_accounts")
            .update({
                branch_id: branch.id,
                account_name: `${memberSeed.full_name} Savings`,
                created_at: memberSeed.joinedAt
            })
            .eq("id", savingsAccount.id),
        `Unable to align member account for ${memberSeed.full_name}`
    );

    await assertResult(
        await adminSupabase
            .from("member_accounts")
            .update({
                branch_id: branch.id,
                account_name: `${memberSeed.full_name} Share Capital`,
                created_at: memberSeed.joinedAt
            })
            .eq("id", shareAccount.id),
        `Unable to align member share account for ${memberSeed.full_name}`
    );

    if (memberSeed.createLogin) {
        const authUser = await upsertAuthUser({
            email: memberSeed.email,
            password: memberSeed.password || DEFAULT_PASSWORD,
            fullName: memberSeed.full_name,
            phone: memberSeed.phone,
            appMetadata: {
                tenant_id: tenantId,
                role: "member",
                member_id: member.id
            }
        });

        await ensureUserProfile({
            userId: authUser.id,
            tenantId,
            fullName: memberSeed.full_name,
            phone: memberSeed.phone,
            role: "member",
            branchIds: [branch.id]
        });

        await assertResult(
            await adminSupabase
                .from("members")
                .update({
                    user_id: authUser.id,
                    email: memberSeed.email
                })
                .eq("id", member.id),
            `Unable to link member login for ${memberSeed.full_name}`
        );
    }

    return {
        member: {
            ...member,
            branch_id: branch.id
        },
        account: savingsAccount,
        savingsAccount,
        shareAccount
    };
}

async function getJournalByReference(tenantId, reference) {
    return assertResult(
        await adminSupabase
            .from("journal_entries")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("reference", reference)
            .maybeSingle(),
        `Unable to check journal reference ${reference}`
    );
}

async function setJournalTimestamp(journalId, occurredAt) {
    const entryDate = occurredAt.slice(0, 10);

    await assertResult(
        await adminSupabase
            .from("journal_entries")
            .update({
                entry_date: entryDate,
                created_at: occurredAt,
                updated_at: occurredAt
            })
            .eq("id", journalId),
        `Unable to align journal ${journalId}`
    );

    await assertResult(
        await adminSupabase
            .from("journal_lines")
            .update({ created_at: occurredAt })
            .eq("journal_id", journalId),
        `Unable to align journal lines for ${journalId}`
    );

    await assertResult(
        await adminSupabase
            .from("member_account_transactions")
            .update({ created_at: occurredAt })
            .eq("journal_id", journalId),
        `Unable to align member transactions for ${journalId}`
    );
}

async function executeCashOperation({ tenantId, accountId, userId, operation, amount, reference, occurredAt }) {
    const existingJournal = await getJournalByReference(tenantId, reference);

    if (existingJournal) {
        await setJournalTimestamp(existingJournal.id, occurredAt);
        return existingJournal.id;
    }

    const rpcName = operation === "deposit" ? "deposit" : "withdraw";
    const { data, error } = await adminSupabase.rpc(rpcName, {
        p_tenant_id: tenantId,
        p_account_id: accountId,
        p_amount: amount,
        p_teller_id: userId,
        p_reference: reference,
        p_description: `Demo ${operation}`
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || `Unable to post ${operation}.`);
    }

    await setJournalTimestamp(data.journal_id, occurredAt);
    return data.journal_id;
}

async function executeShareContribution({ tenantId, accountId, userId, amount, reference, occurredAt }) {
    const existingJournal = await getJournalByReference(tenantId, reference);

    if (existingJournal) {
        await setJournalTimestamp(existingJournal.id, occurredAt);
        return existingJournal.id;
    }

    const { data, error } = await adminSupabase.rpc("share_contribution", {
        p_tenant_id: tenantId,
        p_account_id: accountId,
        p_amount: amount,
        p_teller_id: userId,
        p_reference: reference,
        p_description: "Demo share contribution"
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || "Unable to post share contribution.");
    }

    await setJournalTimestamp(data.journal_id, occurredAt);
    return data.journal_id;
}

async function executeManualJournal({ tenantId, userId, reference, description, occurredAt, lines }) {
    const existingJournal = await getJournalByReference(tenantId, reference);

    if (existingJournal) {
        await setJournalTimestamp(existingJournal.id, occurredAt);
        return existingJournal.id;
    }

    const { data, error } = await adminSupabase.rpc("post_journal_entry", {
        p_tenant_id: tenantId,
        p_reference: reference,
        p_description: description,
        p_entry_date: occurredAt.slice(0, 10),
        p_created_by: userId,
        p_source_type: "adjustment",
        p_lines: lines
    });

    if (error) {
        throw error;
    }

    await setJournalTimestamp(data, occurredAt);
    return data;
}

function addPeriod(baseDate, frequency, installments) {
    const next = new Date(baseDate);

    if (frequency === "daily") {
        next.setUTCDate(next.getUTCDate() + installments);
        return next.toISOString().slice(0, 10);
    }

    if (frequency === "weekly") {
        next.setUTCDate(next.getUTCDate() + (installments * 7));
        return next.toISOString().slice(0, 10);
    }

    next.setUTCMonth(next.getUTCMonth() + installments);
    return next.toISOString().slice(0, 10);
}

async function alignLoanSchedule(loan, disbursedAt) {
    const schedules = assertResult(
        await adminSupabase
            .from("loan_schedules")
            .select("*")
            .eq("loan_id", loan.id)
            .order("installment_number", { ascending: true }),
        `Unable to load schedule for loan ${loan.id}`
    ) || [];

    for (const schedule of schedules) {
        const dueDate = addPeriod(disbursedAt, loan.repayment_frequency, schedule.installment_number);
        await assertResult(
            await adminSupabase
                .from("loan_schedules")
                .update({
                    due_date: dueDate,
                    created_at: disbursedAt
                })
                .eq("id", schedule.id),
            `Unable to align loan schedule ${schedule.id}`
        );
    }
}

async function ensureLoan({ tenantId, member, branch, loanSeed, userId }) {
    let loan = assertResult(
        await adminSupabase
            .from("loans")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("member_id", member.id)
            .eq("principal_amount", loanSeed.principal)
            .eq("term_count", loanSeed.term_count)
            .maybeSingle(),
        `Unable to load loan for ${member.full_name}`
    );

    if (!loan) {
        const { data, error } = await adminSupabase.rpc("loan_disburse", {
            p_tenant_id: tenantId,
            p_member_id: member.id,
            p_branch_id: branch.id,
            p_principal_amount: loanSeed.principal,
            p_annual_interest_rate: loanSeed.annual_interest_rate,
            p_term_count: loanSeed.term_count,
            p_repayment_frequency: loanSeed.repayment_frequency,
            p_disbursed_by: userId,
            p_reference: loanSeed.reference,
            p_description: "Demo loan disbursement"
        });

        if (error) {
            throw error;
        }

        if (!data?.success) {
            throw new Error(data?.message || `Unable to disburse loan for ${member.full_name}.`);
        }

        await setJournalTimestamp(data.journal_id, loanSeed.disbursedAt);

        loan = assertResult(
            await adminSupabase
                .from("loans")
                .select("*")
                .eq("id", data.loan_id)
                .single(),
            `Unable to load seeded loan ${data.loan_id}`
        );
    }

    await assertResult(
        await adminSupabase
            .from("loans")
            .update({
                branch_id: branch.id,
                created_at: loanSeed.disbursedAt,
                disbursed_at: loanSeed.disbursedAt,
                last_interest_accrual_at: loanSeed.disbursedAt.slice(0, 10)
            })
            .eq("id", loan.id),
        `Unable to align loan ${loan.id}`
    );

    await alignLoanSchedule(loan, loanSeed.disbursedAt);
    return loan;
}

async function runInterestAccrualOnce(tenantId, userId) {
    const today = new Date().toISOString().slice(0, 10);
    const existing = assertResult(
        await adminSupabase
            .from("journal_entries")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("source_type", "interest_accrual")
            .eq("entry_date", today)
            .limit(1)
            .maybeSingle(),
        "Unable to inspect interest accrual journal"
    );

    if (existing) {
        return;
    }

    const { data, error } = await adminSupabase.rpc("interest_accrual", {
        p_tenant_id: tenantId,
        p_as_of_date: today,
        p_user_id: userId
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || "Unable to run interest accrual.");
    }
}

async function executeRepayment({ tenantId, loanId, userId, amount, reference, occurredAt }) {
    const existingJournal = await getJournalByReference(tenantId, reference);

    if (existingJournal) {
        await setJournalTimestamp(existingJournal.id, occurredAt);
        return existingJournal.id;
    }

    const { data, error } = await adminSupabase.rpc("loan_repayment", {
        p_tenant_id: tenantId,
        p_loan_id: loanId,
        p_amount: amount,
        p_user_id: userId,
        p_reference: reference,
        p_description: "Demo loan repayment"
    });

    if (error) {
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || `Unable to post repayment ${reference}.`);
    }

    await setJournalTimestamp(data.journal_id, occurredAt);
    return data.journal_id;
}

async function normalizeLoanStatuses(tenantId) {
    const loans = assertResult(
        await adminSupabase
            .from("loans")
            .select("*")
            .eq("tenant_id", tenantId),
        "Unable to load loans for normalization"
    ) || [];

    const today = new Date().toISOString().slice(0, 10);

    for (const loan of loans) {
        const schedules = assertResult(
            await adminSupabase
                .from("loan_schedules")
                .select("*")
                .eq("loan_id", loan.id)
                .order("installment_number", { ascending: true }),
            `Unable to load schedules for loan ${loan.id}`
        ) || [];

        let hasOverdue = false;

        for (const schedule of schedules) {
            const unpaidPrincipal = Number(schedule.principal_due) - Number(schedule.principal_paid);
            const unpaidInterest = Number(schedule.interest_due) - Number(schedule.interest_paid);
            let status = "pending";

            if (unpaidPrincipal <= 0 && unpaidInterest <= 0) {
                status = "paid";
            } else if (Number(schedule.principal_paid) > 0 || Number(schedule.interest_paid) > 0) {
                status = "partial";
            } else if (schedule.due_date < today) {
                status = "overdue";
            }

            if ((status === "partial" || status === "pending") && schedule.due_date < today) {
                status = "overdue";
            }

            if (status === "overdue") {
                hasOverdue = true;
            }

            if (schedule.status !== status) {
                await assertResult(
                    await adminSupabase
                        .from("loan_schedules")
                        .update({ status })
                        .eq("id", schedule.id),
                    `Unable to update loan schedule ${schedule.id}`
                );
            }
        }
    }
}

function buildActor(user, tenantId, role, branchIds, isInternalOps = false) {
    return {
        tenantId,
        role,
        branchIds,
        isInternalOps,
        user: {
            id: user.id,
            email: user.email
        }
    };
}

async function ensureOpeningSurplus({ tenantId, tenantSettings, userId }) {
    await executeManualJournal({
        tenantId,
        userId,
        reference: "TZ-DEMO-OPENING-SURPLUS-2026",
        description: "Demo opening retained earnings for Tanzanian SACCOS showcase",
        occurredAt: isoAtOffset({ monthsAgo: 9, daysAgo: 2, hour: 8, minute: 0 }),
        lines: [
            {
                account_id: tenantSettings.default_cash_account_id,
                debit: 75000000,
                credit: 0
            },
            {
                account_id: tenantSettings.default_retained_earnings_account_id,
                debit: 0,
                credit: 75000000
            }
        ]
    });
}

async function ensureDividendCycles({ tenantId, tenantSettings, staffUsers, owner, branches }) {
    const allBranchIds = Object.values(branches).map((branch) => branch.id);
    const maker = buildActor(
        staffUsers.tenant_admin,
        tenantId,
        "super_admin",
        allBranchIds
    );
    const checker = buildActor(
        owner,
        tenantId,
        "super_admin",
        allBranchIds,
        true
    );
    const dividendsPayableAccountId = await getSystemAccountId(tenantId, "dividends_payable");
    const dividendReserveAccountId = await getSystemAccountId(tenantId, "dividend_reserve");

    const existingClosedCycle = assertResult(
        await adminSupabase
            .from("dividend_cycles")
            .select("id, status")
            .eq("tenant_id", tenantId)
            .eq("period_label", DEMO.tenant.closedDividendLabel)
            .maybeSingle(),
        "Unable to inspect seeded closed dividend cycle"
    );

    if (!existingClosedCycle) {
        const createdClosedCycle = await dividendsService.createCycle(maker, {
            tenant_id: tenantId,
            period_label: DEMO.tenant.closedDividendLabel,
            start_date: DEMO.tenant.closedCycleStart,
            end_date: DEMO.tenant.closedCycleEnd,
            declaration_date: DEMO.tenant.declarationDate,
            record_date: DEMO.tenant.closedCycleEnd,
            payment_date: DEMO.tenant.paymentDate,
            required_checker_count: 1,
            components: [
                {
                    type: "share_dividend",
                    basis_method: "end_balance",
                    distribution_mode: "rate",
                    rate_percent: 8,
                    retained_earnings_account_id: tenantSettings.default_retained_earnings_account_id,
                    dividends_payable_account_id: dividendsPayableAccountId,
                    payout_account_id: null,
                    reserve_account_id: dividendReserveAccountId,
                    eligibility_rules_json: {
                        active_only: true,
                        min_membership_months: 6,
                        minimum_shares: 300000,
                        min_contributions_count: 2,
                        exclude_suspended_exited: true
                    },
                    rounding_rules_json: {
                        rounding_increment: 100,
                        minimum_payout_threshold: 5000,
                        residual_handling: "carry_to_retained_earnings"
                    }
                },
                {
                    type: "savings_interest_bonus",
                    basis_method: "average_daily_balance",
                    distribution_mode: "rate",
                    rate_percent: 3,
                    retained_earnings_account_id: tenantSettings.default_retained_earnings_account_id,
                    dividends_payable_account_id: dividendsPayableAccountId,
                    payout_account_id: null,
                    reserve_account_id: dividendReserveAccountId,
                    eligibility_rules_json: {
                        active_only: true,
                        min_membership_months: 6,
                        max_par_days: 30,
                        require_kyc_completed: true
                    },
                    rounding_rules_json: {
                        rounding_increment: 100,
                        minimum_payout_threshold: 5000,
                        residual_handling: "allocate_pro_rata"
                    }
                }
            ]
        });

        await dividendsService.freezeCycle(maker, createdClosedCycle.cycle.id);
        await dividendsService.allocateCycle(maker, createdClosedCycle.cycle.id);
        await dividendsService.approveCycle(checker, createdClosedCycle.cycle.id, {
            notes: "Demo board approval for Tanzanian SACCOS dividend declaration.",
            signature_hash: "demo-checker-approval-signature"
        });
        await dividendsService.payCycle(maker, createdClosedCycle.cycle.id, {
            payment_method: "reinvest_to_shares",
            reference: "TZ-DEMO-DIV-PAY-2026",
            description: "Demo dividend payment reinvested to member share capital"
        });
        await dividendsService.closeCycle(maker, createdClosedCycle.cycle.id);
    }

    const existingDraftCycle = assertResult(
        await adminSupabase
            .from("dividend_cycles")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("period_label", DEMO.tenant.draftDividendLabel)
            .maybeSingle(),
        "Unable to inspect seeded draft dividend cycle"
    );

    if (!existingDraftCycle) {
        await dividendsService.createCycle(maker, {
            tenant_id: tenantId,
            period_label: DEMO.tenant.draftDividendLabel,
            start_date: DEMO.tenant.draftCycleStart,
            end_date: DEMO.tenant.draftCycleEnd,
            declaration_date: new Date().toISOString().slice(0, 10),
            record_date: DEMO.tenant.draftCycleEnd,
            payment_date: null,
            required_checker_count: 1,
            components: [
                {
                    type: "share_dividend",
                    basis_method: "average_monthly_balance",
                    distribution_mode: "rate",
                    rate_percent: 6,
                    retained_earnings_account_id: tenantSettings.default_retained_earnings_account_id,
                    dividends_payable_account_id: dividendsPayableAccountId,
                    payout_account_id: null,
                    reserve_account_id: dividendReserveAccountId,
                    eligibility_rules_json: {
                        active_only: true,
                        min_membership_months: 3,
                        minimum_shares: 200000
                    },
                    rounding_rules_json: {
                        rounding_increment: 100,
                        minimum_payout_threshold: 5000,
                        residual_handling: "carry_to_retained_earnings"
                    }
                }
            ]
        });
    }
}

async function main() {
    logStep("bootstrapping platform owner");
    const owner = await upsertAuthUser({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        fullName: OWNER_NAME,
        phone: OWNER_PHONE,
        appMetadata: {
            platform_role: "internal_ops"
        }
    });

    logStep("ensuring tenant and subscription");
    const tenant = await ensureTenant(owner.id);
    logStep(`tenant ready: ${tenant.name} (${tenant.id})`);
    const tenantSettings = await getTenantSettings(tenant.id);
    const shareControlAccountId = await getSystemAccountId(tenant.id, "member_share_capital_control");

    const branches = {};
    logStep("ensuring branches");
    for (const branchSeed of DEMO.branches) {
        branches[branchSeed.code] = await ensureBranch(tenant.id, branchSeed);
    }

    logStep("linking platform owner to tenant");
    await ensureUserProfile({
        userId: owner.id,
        tenantId: tenant.id,
        fullName: OWNER_NAME,
        phone: OWNER_PHONE,
        role: "super_admin",
        branchIds: Object.values(branches).map((branch) => branch.id)
    });

    const staffUsers = {};
    logStep("ensuring staff users");
    for (const staff of DEMO.staff) {
        const authUser = await upsertAuthUser({
            email: staff.email,
            password: staff.password,
            fullName: staff.full_name,
            phone: staff.phone,
            appMetadata: {
                tenant_id: tenant.id,
                role: staff.role
            }
        });

        await ensureUserProfile({
            userId: authUser.id,
            tenantId: tenant.id,
            fullName: staff.full_name,
            phone: staff.phone,
            role: staff.role,
            branchIds: staff.branchCodes.map((code) => branches[code].id)
        });

        staffUsers[staff.key] = authUser;
    }

    await ensureOpeningSurplus({
        tenantId: tenant.id,
        tenantSettings,
        userId: owner.id
    });

    const branchCashOperators = {
        DAR: staffUsers.teller_dar || staffUsers.tenant_admin || owner,
        MWZ: staffUsers.teller_mwz || staffUsers.tenant_admin || owner
    };
    const branchLoanOperators = {
        DAR: staffUsers.tenant_admin || owner,
        MWZ: staffUsers.loan_officer_mwz || staffUsers.tenant_admin || owner
    };
    const seededMembers = [];

    logStep("ensuring members, savings activity, and share contributions");
    for (const memberSeed of DEMO.members) {
        const branch = branches[memberSeed.branchCode];
        const memberContext = await ensureMember(
            tenant.id,
            branch,
            memberSeed,
            tenantSettings.default_member_savings_control_account_id,
            shareControlAccountId
        );

        for (const transaction of memberSeed.transactions || []) {
            await executeCashOperation({
                tenantId: tenant.id,
                accountId: memberContext.account.id,
                userId: branchCashOperators[memberSeed.branchCode].id,
                operation: transaction.type,
                amount: transaction.amount,
                reference: transaction.reference,
                occurredAt: transaction.date
            });
        }

        for (const contribution of memberSeed.shareContributions || []) {
            await executeShareContribution({
                tenantId: tenant.id,
                accountId: memberContext.shareAccount.id,
                userId: branchCashOperators[memberSeed.branchCode].id,
                amount: contribution.amount,
                reference: contribution.reference,
                occurredAt: contribution.date
            });
        }

        seededMembers.push({
            ...memberContext,
            branch
        });
    }

    const loanMap = new Map();

    logStep("ensuring loans");
    for (const memberSeed of DEMO.members.filter((member) => member.loan)) {
        const seeded = seededMembers.find((entry) => entry.member.national_id === memberSeed.national_id);
        const loan = await ensureLoan({
            tenantId: tenant.id,
            member: seeded.member,
            branch: seeded.branch,
            loanSeed: memberSeed.loan,
            userId: branchLoanOperators[memberSeed.branchCode].id
        });

        loanMap.set(memberSeed.national_id, loan);
    }

    logStep("running interest accrual");
    await runInterestAccrualOnce(tenant.id, staffUsers.tenant_admin?.id || owner.id);

    logStep("posting loan repayments");
    for (const memberSeed of DEMO.members.filter((member) => member.loan?.repayments?.length)) {
        const loan = loanMap.get(memberSeed.national_id);

        for (const repayment of memberSeed.loan.repayments) {
            await executeRepayment({
                tenantId: tenant.id,
                loanId: loan.id,
                userId: branchCashOperators[memberSeed.branchCode].id,
                amount: repayment.amount,
                reference: repayment.reference,
                occurredAt: repayment.date
            });
        }
    }

    logStep("normalizing loan statuses");
    await normalizeLoanStatuses(tenant.id);

    logStep("ensuring dividend cycles");
    await ensureDividendCycles({
        tenantId: tenant.id,
        tenantSettings,
        staffUsers,
        owner,
        branches
    });

    const branchCounts = Object.fromEntries(
        Object.entries(branches).map(([code, branch]) => [
            code,
            seededMembers.filter((entry) => entry.member.branch_id === branch.id).length
        ])
    );

    const summary = {
        tenant: {
            id: tenant.id,
            name: tenant.name,
            registration_number: tenant.registration_number,
            currency: DEMO.tenant.currency
        },
        logins: {
            platform_owner: {
                email: OWNER_EMAIL,
                password: OWNER_PASSWORD,
                role: "platform_owner + super_admin"
            },
            staff: DEMO.staff.map((staff) => ({
                email: staff.email,
                password: staff.password,
                role: staff.role,
                scope: staff.branchCodes.map((code) => branches[code].name)
            })),
            member_portal: DEMO.members
                .filter((member) => member.createLogin)
                .map((member) => ({
                    email: member.email,
                    password: member.password || DEFAULT_PASSWORD,
                    role: "member",
                    branch: branches[member.branchCode].name
                }))
        },
        counts: {
            branches: Object.keys(branches).length,
            staff: DEMO.staff.length + 1,
            members: DEMO.members.length,
            loans: DEMO.members.filter((member) => member.loan).length,
            dividend_cycles: 2
        },
        checks: [
            {
                login: OWNER_EMAIL,
                expected_role: "Platform Owner / Super Admin",
                expected_scope: "All tenant data, all branches, dividends workspace, reports, team access"
            },
            {
                login: "manager.dar.demo@mwanga.co.tz",
                expected_role: "Branch Manager",
                expected_scope: `Dar Central Branch members and reports only (${branchCounts.DAR} seeded members)`
            },
            {
                login: "loans.mwanza.demo@mwanga.co.tz",
                expected_role: "Loan Officer",
                expected_scope: "Mwanza Lake Branch loan book, arrears, and member loan activity only"
            },
            {
                login: "teller.dar.demo@mwanga.co.tz",
                expected_role: "Teller",
                expected_scope: "Dar Central cash desk with recent 7-day TZS deposits, withdrawals, and share contributions"
            },
            {
                login: "teller.mwanza.demo@mwanga.co.tz",
                expected_role: "Teller",
                expected_scope: "Mwanza Lake cash desk with branch-only savings and share transactions"
            },
            {
                login: "asha.mwakalinga.member@mwanga.co.tz",
                expected_role: "Member",
                expected_scope: "Own savings, share capital, loan balance, and reinvested dividend history only"
            },
            {
                login: "rehema.mageni.member@mwanga.co.tz",
                expected_role: "Member",
                expected_scope: "Own Mwanza member portal with contributions, loans, and dividend credits only"
            }
        ]
    };

    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

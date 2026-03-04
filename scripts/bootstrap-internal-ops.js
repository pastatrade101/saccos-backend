require("dotenv").config();

const { adminSupabase } = require("../src/config/supabase");

const email = process.env.BOOTSTRAP_INTERNAL_OPS_EMAIL;
const password = process.env.BOOTSTRAP_INTERNAL_OPS_PASSWORD;
const fullName = process.env.BOOTSTRAP_INTERNAL_OPS_FULL_NAME || "Platform Internal Ops";
const phone = process.env.BOOTSTRAP_INTERNAL_OPS_PHONE || null;

async function findUserByEmail(targetEmail) {
    let page = 1;
    const perPage = 200;

    while (true) {
        const { data, error } = await adminSupabase.auth.admin.listUsers({
            page,
            perPage
        });

        if (error) {
            throw error;
        }

        const match = data.users.find((user) => user.email?.toLowerCase() === targetEmail.toLowerCase());

        if (match) {
            return match;
        }

        if (data.users.length < perPage) {
            return null;
        }

        page += 1;
    }
}

async function main() {
    if (!email || !password) {
        throw new Error(
            "Set BOOTSTRAP_INTERNAL_OPS_EMAIL and BOOTSTRAP_INTERNAL_OPS_PASSWORD in your environment."
        );
    }

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
        const { data, error } = await adminSupabase.auth.admin.updateUserById(existingUser.id, {
            password,
            email_confirm: true,
            user_metadata: {
                ...(existingUser.user_metadata || {}),
                full_name: fullName,
                phone
            },
            app_metadata: {
                ...(existingUser.app_metadata || {}),
                platform_role: "internal_ops"
            }
        });

        if (error) {
            throw error;
        }

        console.log(
            JSON.stringify(
                {
                    status: "updated",
                    user_id: data.user.id,
                    email: data.user.email,
                    platform_role: data.user.app_metadata?.platform_role
                },
                null,
                2
            )
        );
        return;
    }

    const { data, error } = await adminSupabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            full_name: fullName,
            phone
        },
        app_metadata: {
            platform_role: "internal_ops"
        }
    });

    if (error) {
        throw error;
    }

    console.log(
        JSON.stringify(
            {
                status: "created",
                user_id: data.user.id,
                email: data.user.email,
                platform_role: data.user.app_metadata?.platform_role
            },
            null,
            2
        )
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

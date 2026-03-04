import { createClient } from "@supabase/supabase-js";

import { trackUser } from "./state";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY as string;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required for tests.");
}

const clientOptions = {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
};

export const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions);
export const publicClient = createClient(supabaseUrl, supabaseAnonKey, clientOptions);

export type CreatedAuthUser = {
    id: string;
    email: string;
    password: string;
};

function randomPassword() {
    return `T3st!${Math.random().toString(36).slice(2, 10)}A#`;
}

export async function createAuthUser(params: {
    email: string;
    password?: string;
    userMetadata?: Record<string, unknown>;
    appMetadata?: Record<string, unknown>;
}): Promise<CreatedAuthUser> {
    const password = params.password || randomPassword();
    const { data, error } = await adminClient.auth.admin.createUser({
        email: params.email,
        password,
        email_confirm: true,
        user_metadata: params.userMetadata || {},
        app_metadata: params.appMetadata || {}
    });

    if (error || !data.user) {
        throw error || new Error("Unable to create auth user.");
    }

    trackUser(data.user.id, data.user.email || params.email);

    return {
        id: data.user.id,
        email: data.user.email || params.email,
        password
    };
}

export async function deleteAuthUser(userId: string): Promise<void> {
    await adminClient.auth.admin.deleteUser(userId);
}

export async function signInForToken(email: string, password: string): Promise<string> {
    const { data, error } = await publicClient.auth.signInWithPassword({
        email,
        password
    });

    if (error || !data.session?.access_token) {
        throw error || new Error("Unable to sign in test user.");
    }

    return data.session.access_token;
}

export async function getAuthUserById(userId: string) {
    const { data, error } = await adminClient.auth.admin.getUserById(userId);
    if (error || !data.user) {
        throw error || new Error("Unable to load auth user.");
    }

    return data.user;
}

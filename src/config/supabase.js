const { createClient } = require("@supabase/supabase-js");

const env = require("./env");

const clientOptions = {
    auth: {
        autoRefreshToken: false,
        persistSession: false
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
    clientOptions
);

module.exports = {
    adminSupabase,
    publicSupabase
};

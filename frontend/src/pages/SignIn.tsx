import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { FormField } from "../components/FormField";
import { useToast } from "../components/Toast";
import { useUI } from "../ui/UIProvider";
import pageStyles from "./Pages.module.css";

const schema = z.object({
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters.")
});

type SignInValues = z.infer<typeof schema>;

export function SignInPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { pushToast } = useToast();
    const { signIn, session } = useAuth();
    const { theme, toggleTheme } = useUI();
    const [submitting, setSubmitting] = useState(false);

    const form = useForm<SignInValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            email: "",
            password: ""
        }
    });

    if (session) {
        return <Navigate to="/" replace />;
    }

    const onSubmit = form.handleSubmit(async (values) => {
        setSubmitting(true);

        try {
            await signIn(values.email, values.password);
            pushToast({
                type: "success",
                title: "Signed in",
                message: "You are now signed in."
            });
            navigate("/", { replace: true });
        } catch (error) {
            pushToast({
                type: "error",
                title: "Sign-in failed",
                message: error instanceof Error ? error.message : "Unable to sign in."
            });
        } finally {
            setSubmitting(false);
        }
    });

    return (
        <div className={pageStyles.authShell}>
            <div className={pageStyles.authCard}>
                <div className="toolbar" style={{ marginBottom: "1rem" }}>
                    <button className="secondary-button" type="button" onClick={toggleTheme}>
                        {theme === "dark" ? "Light mode" : "Dark mode"}
                    </button>
                </div>
                <h1 className={pageStyles.authTitle}>Sign in to SACCOS Control</h1>
                <p className={pageStyles.authCopy}>
                    Use an internal operations account first, then complete tenant setup inside the app.
                </p>

                <form className={pageStyles.form} onSubmit={onSubmit}>
                    <FormField label="Email" error={form.formState.errors.email?.message}>
                        <input type="email" {...form.register("email")} placeholder="ops@example.com" />
                    </FormField>
                    <FormField label="Password" error={form.formState.errors.password?.message}>
                        <input type="password" {...form.register("password")} placeholder="Enter your password" />
                    </FormField>
                    <button className="primary-button" disabled={submitting} type="submit">
                        {submitting ? "Signing in..." : "Sign In"}
                    </button>
                </form>
            </div>
        </div>
    );
}

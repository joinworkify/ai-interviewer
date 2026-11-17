"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Loader2 } from "lucide-react";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { DEFAULT_NEXT, safeNext } from "@/lib/auth/safe-next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: "Google sign-in was cancelled. You can try again or use your email.",
  oauth_failed: "Google sign-in could not be completed. Please try again or use your email.",
};

export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get("expired") === "1";
  const next = safeNext(params.get("next"));
  const oauthError = OAUTH_ERRORS[params.get("error") ?? ""];

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    const { data, error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase says "Invalid login credentials"; show the wireframe wording.
      setError(
        error.message === "Invalid login credentials"
          ? "Error: wrong email or password"
          : `Error: ${error.message}`,
      );
      setIsLoading(false);
      return;
    }
    // Admins land on their dashboard unless the login was for a specific page.
    const isAdmin = data.user?.app_metadata?.role === "admin";
    router.push(isAdmin && next === DEFAULT_NEXT ? "/admin" : next);
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Log in</CardTitle>
        </CardHeader>
        <CardContent>
          {expired && (
            <p role="alert" className="mb-4 rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
              Your session expired. Please log in again.
            </p>
          )}
          {oauthError && (
            <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {oauthError}
            </p>
          )}
          <div className="mb-5 space-y-4">
            <SocialAuthButtons next={next} />
            <div className="flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Or continue with email</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/auth/forgot-password"
                  className="ml-auto text-sm text-primary underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="animate-spin" />}
              Log in
            </Button>
            {error && (
              <p role="alert" className="text-center text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <p className="mt-5 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link
              href={next === DEFAULT_NEXT ? "/auth/sign-up" : `/auth/sign-up?next=${encodeURIComponent(next)}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

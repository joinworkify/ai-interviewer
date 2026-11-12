"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, login } from "@/lib/candidate/api";

export default function CandidateLoginPage() {
  const router = useRouter();
  const expired = useSearchParams().get("expired") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/candidate/roles");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-sm rounded-lg border p-6">
      <h1 className="mb-6 text-center text-2xl font-semibold">Log in</h1>
      {expired && (
        <p role="alert" className="mb-4 rounded-md bg-muted p-3 text-sm">
          Your session expired. Please log in again.
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Log in
        </Button>
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

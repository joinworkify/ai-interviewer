import type { Metadata } from "next";
import Link from "next/link";

import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="theme-datasea flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 [color-scheme:light]">
      <Link href="/" aria-label="DataSea home" className="flex items-center gap-2 font-semibold tracking-tight">
        <LogoMark size={40} />
        DataSea
      </Link>
      <Card className="w-full max-w-md text-center shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">404 — Page not found</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-5">
          <p className="text-sm text-muted-foreground">
            The page you are looking for does not exist or is no longer available.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/candidate/roles">View open roles</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

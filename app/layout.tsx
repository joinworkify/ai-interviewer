
import type { Metadata } from "next";
import { Geist, Newsreader, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: "DataSea Interviews", template: "%s | DataSea" },
  description: "AI-led interviews for DataSea candidates.",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-editorial-heading",
  display: "swap",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-editorial-body",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${newsreader.variable} ${sourceSerif.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </ThemeProvider>

        <Analytics />
      </body>
    </html>
  );
}


import type { Metadata } from "next";
import { Geist, Newsreader, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://talent.joindatasea.com"),
  title: "Open roles",
  description: "AI-led interviews for DataSea candidates.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Datasea Interview",
    images: [
      {
        url: "/images/1.jpg",
        width: 1200,
        height: 600,
        alt: "Human Judgment for AI Teams - DataSea",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/images/1.jpg"],
  },
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

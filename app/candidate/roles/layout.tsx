
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://talent.joindatasea.com"),
  title: {
    default: "DataSea Talent | Open Roles",
    template: "%s | DataSea Talent",
  },
  description:
    "AI-led interviews for DataSea candidates. Discover opportunities and take the next step in your career.",
  openGraph: {
    title: "DataSea Talent | Open Roles",
    description:
      "AI-led interviews for DataSea candidates. Discover opportunities and take the next step in your career.",
    url: "https://talent.joindatasea.com/",
    siteName: "DataSea Talent",
    images: [
      {
        url: "/images/1.PNG",
        width: 1200,
        height: 630,
        alt: "DataSea Talent - AI-led interviews and career opportunities",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DataSea Talent | Open Roles",
    description:
      "AI-led interviews for DataSea candidates. Discover opportunities and take the next step in your career.",
    images: ["/images/1.PNG"],
  },
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

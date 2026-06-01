import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OCR Extract - AI Document Data Extraction",
  description:
    "OCR Extract is an AI-powered document data extraction tool. Extract structured data from PDF, Word, Excel, and images. Export to Excel/CSV/JSON.",
  keywords: [
    "OCR",
    "document extraction",
    "AI document parser",
    "PDF data extraction",
    "extract data from PDF",
    "document to Excel",
    "OCR alternative",
    "batch document processing",
  ],
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7V5a2 2 0 0 1 2-2h2'/><path d='M17 3h2a2 2 0 0 1 2 2v2'/><path d='M21 17v2a2 2 0 0 1-2 2h-2'/><path d='M7 21H5a2 2 0 0 1-2-2v-2'/><circle cx='12' cy='12' r='3'/><path d='M12 9v1'/><path d='M12 14v1'/></svg>",
  },
  openGraph: {
    title: "OCR Extract - AI Document Data Extraction",
    description:
      "Extract structured data from any document using AI. Supports PDF, Word, Excel, images. Export to Excel/CSV/JSON.",
    type: "website",
    locale: "zh_CN",
    alternateLocale: "en_US",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

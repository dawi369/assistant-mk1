/**
 * Root Next.js layout for the workbench shell.
 *
 * This file owns global font/theme providers and document metadata. Product
 * runtime behavior belongs in `app/assistant.tsx` and the API routes, keeping
 * layout concerns separate from agent orchestration.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";

import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Assistant-MK1",
  description: "Reusable agent workbench for production-shaped assistant runtimes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthKitProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}

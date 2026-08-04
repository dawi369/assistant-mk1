/**
 * Root Next.js layout for the workbench shell.
 *
 * This file owns global font/theme providers and document metadata. Product
 * runtime behavior belongs in `app/assistant.tsx` and the API routes, keeping
 * layout concerns separate from agent orchestration.
 */
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";

import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Assistant · mk1",
    template: "%s · Assistant mk1",
  },
  description: "A focused workbench for trusted agents, durable workflows, and inspected action.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
        <AuthKitProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}

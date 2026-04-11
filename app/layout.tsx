import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RelyyCast",
  description: "RelyyCast control plane for desktop-powered public streams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full bg-background antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}

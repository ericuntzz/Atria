"use client";

import { Sidebar } from "./sidebar";

interface AppLayoutProps {
  userEmail: string;
  children: React.ReactNode;
  /** Optional bottom nav element rendered on mobile */
  mobileNav?: React.ReactNode;
}

export function AppLayout({ userEmail, children, mobileNav }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Skip to content link — visible only on keyboard focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* Desktop sidebar — hidden on mobile */}
      <header className="hidden lg:flex h-full" role="banner">
        <Sidebar userEmail={userEmail} />
      </header>

      <main id="main-content" className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      {mobileNav}
    </div>
  );
}

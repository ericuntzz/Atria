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
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden lg:flex h-full">
        <Sidebar userEmail={userEmail} />
      </div>

      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      {mobileNav}
    </div>
  );
}

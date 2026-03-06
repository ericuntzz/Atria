"use client";

import { Sidebar } from "./sidebar";

interface AppLayoutProps {
  userEmail: string;
  children: React.ReactNode;
}

export function AppLayout({ userEmail, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar userEmail={userEmail} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

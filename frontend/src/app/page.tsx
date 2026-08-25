"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { getCurrentUser, logout } from "@/lib/api";

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (cancelled) {
          return;
        }
        if (user) {
          setIsAuthenticated(true);
        } else {
          window.location.href = "/login";
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach the server. Please try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    await logout();
    window.location.href = "/login";
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm font-medium text-[var(--gray-text)]">{error}</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <KanbanBoard onSignOut={handleSignOut} />;
}

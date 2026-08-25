"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { getCurrentUser, logout } from "@/lib/api";

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((user) => {
      if (cancelled) {
        return;
      }
      if (user) {
        setIsAuthenticated(true);
      } else {
        window.location.href = "/login";
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

  if (!isAuthenticated) {
    return null;
  }

  return <KanbanBoard onSignOut={handleSignOut} />;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUpIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BlogPos = { top: number; right: number };

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Blog variant ──────────────────────────────────────────────────────────────
// Tracks the author-bio card (`article footer.not-prose`) and renders the
// button in its top-right corner via computed fixed coordinates.
function BlogBackToTop() {
  const [pos, setPos] = useState<BlogPos | null>(null);
  const cardRef = useRef<Element | null>(null);

  useEffect(() => {
    const update = () => {
      const card = cardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const inView = rect.top < window.innerHeight - 40 && rect.bottom > 0;
      setPos(
        inView
          ? { top: rect.top + 14, right: window.innerWidth - rect.right + 14 }
          : null,
      );
    };

    const init = () => {
      cardRef.current = document.querySelector(
        "article footer.not-prose .rounded-xl",
      );
      if (!cardRef.current) return;
      update();
      window.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update, { passive: true });
    };

    // Give React a tick to finish rendering the article
    const t = setTimeout(init, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      style={
        pos
          ? { position: "fixed", top: pos.top, right: pos.right, zIndex: 50 }
          : { position: "fixed", top: -200, right: -200, zIndex: 50 }
      }
      className={cn(
        "transition-all duration-300 ease-out",
        pos
          ? "pointer-events-auto scale-100 opacity-100"
          : "pointer-events-none scale-95 opacity-0",
      )}
    >
      <Button
        onClick={scrollToTop}
        variant="outline"
        size="xs"
        className="flex items-center gap-1 rounded-full border-border/50 bg-background/95 shadow-sm backdrop-blur-sm hover:bg-background"
        aria-label="Back to top"
      >
        <ArrowUpIcon className="size-3" weight="bold" />
        Back to Top
      </Button>
    </div>
  );
}

// ── Docs variant ──────────────────────────────────────────────────────────────
// Simple scroll-based trigger; floats at the bottom-right away from content.
function DocsBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY;
      const remaining =
        document.documentElement.scrollHeight - window.innerHeight - scrolled;
      setVisible(scrolled > 200 && remaining < 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={cn(
        "fixed bottom-8 right-4 z-50 transition-all duration-300 ease-out lg:right-1/4",
        visible
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-4 scale-95 opacity-0",
      )}
    >
      <Button
        onClick={scrollToTop}
        variant="outline"
        size="sm"
        className="flex items-center gap-1.5 rounded-full border-border/60 bg-background/90 shadow-lg backdrop-blur-sm hover:bg-background"
        aria-label="Back to top"
      >
        <ArrowUpIcon className="size-3.5" weight="bold" />
        Back to Top
      </Button>
    </div>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
export function BackToTop() {
  const pathname = usePathname();
  if (pathname?.startsWith("/blog/") && pathname !== "/blog")
    return <BlogBackToTop />;
  if (pathname?.startsWith("/docs/") && pathname !== "/docs")
    return <DocsBackToTop />;
  return null;
}

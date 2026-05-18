"use client";

import * as React from "react";
import { addTransitionType, startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { InputGroup, InputGroupAddon } from "./ui/input-group";
import { cn } from "@/lib/utils";
import type { DocsSearchSection } from "@/lib/docs-search";

// NOTE: This component intentionally does NOT depend on `cmdk`. Some
// corporate web filters block the standalone cmdk vendor chunk with a 403
// based on content heuristics, regardless of filename. We reimplement just
// enough of the cmdk-style command palette (filtering, arrow-key nav,
// Enter to select, Esc to close, Cmd/Ctrl+K to toggle) using shadcn
// primitives so the docs search keeps working on locked-down networks.

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

function scoreDocsItem(value: string, search: string) {
  const haystack = value.toLowerCase();
  const needle = search.toLowerCase().trim();

  if (!needle) {
    return 1;
  }

  if (haystack.includes(needle)) {
    return haystack.startsWith(needle) ? 1 : 0.75;
  }

  const tokens = needle.split(/\s+/).filter(Boolean);

  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) {
    return 0.5;
  }

  return 0;
}

type FlatItem = {
  href: string;
  title: string;
  description: string;
  keywords: string;
  heading: string;
  score: number;
};

export function DocsSearch({ sections }: { sections: DocsSearchSection[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    setOpen((currentOpen) => !currentOpen);
  });

  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    setActiveIndex(0);
  }

  const filtered = React.useMemo(() => {
    const groups: { heading: string; items: FlatItem[] }[] = [];

    for (const section of sections) {
      const items: FlatItem[] = [];

      for (const item of section.items) {
        const value = `${item.title} ${item.keywords}`;
        const score = scoreDocsItem(value, query);

        if (score > 0) {
          items.push({
            href: item.href,
            title: item.title,
            description: item.description,
            keywords: item.keywords,
            heading: section.heading,
            score,
          });
        }
      }

      if (items.length > 0) {
        items.sort((a, b) => b.score - a.score);
        groups.push({ heading: section.heading, items });
      }
    }

    return groups;
  }, [sections, query]);

  const flat = React.useMemo(
    () => filtered.flatMap((g) => g.items),
    [filtered]
  );

  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function handleSelect(href: string) {
    setOpen(false);
    startTransition(() => {
      addTransitionType("nav-forward");
      router.push(href);
    });
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) =>
        flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, flat.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[activeIndex];
      if (item) handleSelect(item.href);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 w-full justify-between rounded-xl border-border bg-background/80 px-4 text-[11px] tracking-[0.22em] text-muted-foreground hover:bg-muted/60 sm:text-xs"
        onClick={() => handleOpenChange(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MagnifyingGlassIcon className="size-4" />
          <span className="truncate">Search documentation</span>
        </span>
        <span className="hidden items-center gap-1 text-[10px] text-muted-foreground/90 sm:inline-flex">
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono tracking-normal text-foreground/80 uppercase">
            Cmd
          </span>
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono tracking-normal text-foreground/80 uppercase">
            K
          </span>
        </span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search docs</DialogTitle>
          <DialogDescription>
            Jump between documentation pages.
          </DialogDescription>
        </DialogHeader>
        <DialogContent
          className="top-1/3 max-w-2xl translate-y-0 overflow-hidden rounded-2xl border border-border bg-background/95 p-0 shadow-2xl"
          showCloseButton={false}
        >
          <div className="flex size-full flex-col overflow-hidden bg-popover text-popover-foreground">
            <div data-slot="command-input-wrapper" className="p-1">
              <InputGroup className="border-transparent border-b-input bg-transparent px-3">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search docs, topics, and routes..."
                  aria-label="Search documentation"
                  aria-autocomplete="list"
                  aria-controls="docs-search-list"
                  aria-activedescendant={
                    flat[activeIndex]
                      ? `docs-search-item-${activeIndex}`
                      : undefined
                  }
                  className="w-full bg-transparent px-2 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                />
                <InputGroupAddon>
                  <MagnifyingGlassIcon className="size-3.5 shrink-0 opacity-50" />
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div
              id="docs-search-list"
              ref={listRef}
              role="listbox"
              className="no-scrollbar max-h-104 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none"
            >
              {flat.length === 0 ? (
                <div className="py-6 text-center text-sm">
                  No documentation page matched your search.
                </div>
              ) : (
                (() => {
                  let runningIndex = 0;
                  return filtered.map((group) => (
                    <div
                      key={group.heading}
                      className="overflow-hidden p-1.5 text-foreground"
                    >
                      <div className="px-3 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        {group.heading}
                      </div>
                      {group.items.map((item) => {
                        const index = runningIndex++;
                        const active = pathname === item.href;
                        const isSelected = index === activeIndex;

                        return (
                          <div
                            key={item.href}
                            id={`docs-search-item-${index}`}
                            data-index={index}
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleSelect(item.href)}
                            onMouseEnter={() => setActiveIndex(index)}
                            className={cn(
                              "relative flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm outline-hidden select-none",
                              isSelected && "bg-muted/80 text-foreground"
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">
                                {item.title}
                              </div>
                              <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {item.description}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "ml-auto text-xs tracking-widest text-muted-foreground",
                                isSelected && "text-foreground"
                              )}
                            >
                              {active ? "Current" : "Open"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { docsNav } from "./docs-nav";
import { NavLink } from "./nav-link";
import { cn } from "../lib/utils";

export function DocsSidebar() {
  return (
    <nav className="space-y-8 text-sm lg:pe-4">
      {docsNav.map((section) => (
        <div key={section.title} className="space-y-3">
          <h4 className="px-3 text-[11px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
            {section.title}
          </h4>
          <ul className="space-y-1.5 border-s border-border/70 ps-3">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  exact
                  transitionTypes={["nav-forward"]}
                  className={({ isActive }) =>
                    cn(
                      "relative block rounded-e-lg border-s-2 px-3 py-2 leading-6 transition-[color,background-color,border-color] duration-200",
                      isActive
                        ? "border-primary bg-muted/80 font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                    )
                  }
                >
                  {item.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

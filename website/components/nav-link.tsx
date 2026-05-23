"use client";

import type * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useTransition } from "react";
import type { Route } from "next";
import { useClientPathname } from "@/hooks/use-client-pathname";

type RenderProps = { isActive: boolean; isPending: boolean };

type Props<T extends string = string> = {
  href: Route<T> | URL;
  className: string | ((props: RenderProps) => string);
  children: React.ReactNode | ((props: RenderProps) => React.ReactNode);
  exact?: boolean;
  fallback?: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">;

function checkActive(
  pathname: string | null,
  href: string,
  exact: boolean
): boolean {
  if (pathname === null) return false;
  if (exact || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolve<T>(
  value: T | ((props: RenderProps) => T),
  props: RenderProps
): T {
  return typeof value === "function"
    ? (value as (props: RenderProps) => T)(props)
    : value;
}

function isModifiedEvent(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.button !== 0
  );
}

function isExternalLink(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.currentTarget.origin !== window.location.origin;
}

// `<Link>` with active-state detection. `className` and `children` can be
// render props that receive `{ isActive, isPending }`. The outer Suspense
// satisfies cache-components's missing-Suspense-with-CSR-bailout for
// `usePathname` on dynamic-param routes.
export function NavLink<T extends string>({
  href,
  className,
  children,
  exact = false,
  fallback,
  ...rest
}: Props<T>) {
  const inactive: RenderProps = { isActive: false, isPending: false };
  return (
    <Suspense
      fallback={
        fallback ?? (
          <Link
            href={href as Route}
            className={resolve(className, inactive)}
            {...rest}
          >
            {resolve(children, inactive)}
          </Link>
        )
      }
    >
      <NavLinkInner href={href} className={className} exact={exact} {...rest}>
        {children}
      </NavLinkInner>
    </Suspense>
  );
}

function NavLinkInner<T extends string>({
  href,
  className,
  children,
  exact = false,
  onClick,
  target,
  ...rest
}: Props<T>) {
  // `useClientPathname` returns null on the server / first client render so
  // the prerendered HTML matches across rewrites (e.g. `/` → `/noprefetch/`).
  const pathname = useClientPathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isActive = checkActive(pathname, href.toString(), exact);
  const props: RenderProps = { isActive, isPending };

  return (
    <Link
      href={href as Route}
      aria-current={isActive ? "page" : undefined}
      className={resolve(className, props)}
      onClick={(e) => {
        onClick?.(e);

        if (
          e.defaultPrevented ||
          isModifiedEvent(e) ||
          isExternalLink(e) ||
          target === "_blank"
        ) {
          return;
        }

        e.preventDefault();
        startTransition(() => {
          router.push(href.toString() as Route);
        });
      }}
      target={target}
      {...rest}
    >
      {resolve(children, props)}
    </Link>
  );
}

export function NavLinkSkeleton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span aria-hidden className={`text-gray opacity-50 ${className ?? ""}`}>
      {children}
    </span>
  );
}

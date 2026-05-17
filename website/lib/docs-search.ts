import { cache } from "react";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { docsNav } from "@/components/docs-nav";

export type DocsSearchItem = {
  title: string;
  href: string;
  description: string;
  keywords: string;
};

export type DocsSearchSection = {
  heading: string;
  items: DocsSearchItem[];
};

type DiscoveredDoc = {
  title: string;
  href: string;
  description: string;
  keywords: string[];
};

const docsDir = path.join(process.cwd(), "app", "docs");

async function walkDocsPages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => walkDocsPages(path.join(dir, entry.name))),
  );

  const pageFile = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [path.join(dir, "page.tsx")]
    : [];

  return [...pageFile, ...nestedFiles.flat()];
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getRouteFromFile(filePath: string) {
  const relativeDir = path.relative(docsDir, path.dirname(filePath));

  if (!relativeDir || relativeDir === ".") {
    return "/docs";
  }

  return `/docs/${relativeDir.split(path.sep).join("/")}`;
}

function extractMetadata(source: string, filePath: string): DiscoveredDoc {
  const title = source.match(/title:\s*"([^"]+)"/)?.[1] ?? "Untitled";
  const description =
    source.match(/description:\s*(?:\n\s*)?"([\s\S]*?)",\s*path:/)?.[1] ??
    "Documentation page";
  const href = source.match(/path:\s*"([^"]+)"/)?.[1] ?? getRouteFromFile(filePath);
  const keywordsBlock = source.match(/keywords:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const keywords = [...keywordsBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  return {
    title: normalizeText(title),
    href,
    description: normalizeText(description),
    keywords,
  };
}

function getSectionForRoute(href: string, navSectionLookup: Map<string, string>) {
  if (navSectionLookup.has(href)) {
    return navSectionLookup.get(href) ?? "More docs";
  }

  let bestMatch = "";
  let matchedSection = "More docs";

  for (const [navHref, section] of navSectionLookup.entries()) {
    if (href.startsWith(`${navHref}/`) && navHref.length > bestMatch.length) {
      bestMatch = navHref;
      matchedSection = section;
    }
  }

  return matchedSection;
}

export const getDocsSearchSections = cache(async (): Promise<DocsSearchSection[]> => {
  const pageFiles = await walkDocsPages(docsDir);
  const discoveredDocs = await Promise.all(
    pageFiles.map(async (filePath) => extractMetadata(await readFile(filePath, "utf8"), filePath)),
  );

  const navSections = docsNav.map((section) => ({
    heading: section.title,
    items: section.items.map((item, index) => ({ ...item, order: index })),
  }));
  const navOrder = new Map(navSections.flatMap((section) => section.items.map((item) => [item.href, item.order])));
  const navTitles = new Map(docsNav.flatMap((section) => section.items.map((item) => [item.href, item.title])));
  const navSectionLookup = new Map(docsNav.flatMap((section) => section.items.map((item) => [item.href, section.title])));

  const grouped = new Map<string, DocsSearchItem[]>();

  for (const doc of discoveredDocs) {
    const heading = getSectionForRoute(doc.href, navSectionLookup);
    const navTitle = navTitles.get(doc.href);
    const sectionItems = grouped.get(heading) ?? [];

    sectionItems.push({
      title: doc.title,
      href: doc.href,
      description: doc.description,
      keywords: [
        heading,
        doc.title,
        navTitle,
        doc.href.replaceAll("/", " "),
        doc.description,
        ...doc.keywords,
      ]
        .filter(Boolean)
        .join(" "),
    });

    grouped.set(heading, sectionItems);
  }

  const orderedSections = docsNav.map((section) => section.title);
  const extraSections = [...grouped.keys()].filter((heading) => !orderedSections.includes(heading)).sort();

  return [...orderedSections, ...extraSections]
    .map((heading) => {
      const items = grouped.get(heading);

      if (!items?.length) {
        return null;
      }

      const sortedItems = items.sort((left, right) => {
        const leftOrder = navOrder.get(left.href) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = navOrder.get(right.href) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return left.title.localeCompare(right.title);
      });

      return { heading, items: sortedItems };
    })
    .filter((section): section is DocsSearchSection => section !== null);
});
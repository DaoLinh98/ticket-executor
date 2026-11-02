"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingMeta } from "@/lib/workflow/meta";
import { IconTile } from "./parts";

const textOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : "";

// A heading an agent wrote becomes a labelled row with the icon its keyword maps to (`headingMeta`).
function Heading({ level, children }: { level: 1 | 2 | 3; children: ReactNode }) {
  const m = headingMeta(textOf(children));
  const Tag = `h${level + 2}` as "h3" | "h4" | "h5";
  return (
    <Tag className="te-wf-md-h" data-level={level}>
      <IconTile d={m.icon} tone={m.tone} size={level === 3 ? 20 : 22} iconSize={level === 3 ? 12 : 13} />
      <span>{children}</span>
    </Tag>
  );
}

const COMPONENTS: Components = {
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  table: ({ children }) => (
    <div className="te-scroll te-table-scroll" style={{ overflowX: "auto" }}>
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

/** An agent's markdown output (plan, summary, reply), rendered with icons on its headings. Raw HTML is not rendered. */
export default function OutputMarkdown({ text }: { text: string }) {
  return (
    <div className="te-rich te-wf-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

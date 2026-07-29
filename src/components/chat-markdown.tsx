import type { ReactNode } from "react";

// Lightweight, dependency-free markdown renderer for chat bubbles. Supports the
// small subset the assistant actually emits: bold, inline code, bullet/ordered
// lists, links, headings, and soft line breaks. Rendered as React nodes (never
// raw HTML) so untrusted model output can't inject markup.
//
// Note: underscores are intentionally NOT treated as emphasis so filenames like
// `illustrious_all_rated_v1` survive intact — matching GitHub's intra-word rule.

interface InlineRule {
  type: "code" | "bold" | "link" | "italic";
  re: RegExp;
}

const INLINE_RULES: InlineRule[] = [
  { type: "code", re: /`([^`]+)`/ },
  { type: "bold", re: /\*\*([\s\S]+?)\*\*/ },
  { type: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { type: "italic", re: /\*([^*\n]+)\*/ },
];

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];

  let earliest:
    | { rule: InlineRule; match: RegExpExecArray; index: number }
    | null = null;

  for (const rule of INLINE_RULES) {
    const match = rule.re.exec(text);
    if (match && (earliest === null || match.index < earliest.index)) {
      earliest = { rule, match, index: match.index };
    }
  }

  if (!earliest) return [text];

  const { rule, match, index } = earliest;
  const key = `${keyPrefix}-${index}`;
  const nodes: ReactNode[] = [];

  const before = text.slice(0, index);
  if (before) nodes.push(before);

  if (rule.type === "code") {
    nodes.push(
      <code
        key={key}
        className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
      >
        {match[1]}
      </code>
    );
  } else if (rule.type === "bold") {
    nodes.push(
      <strong key={key} className="font-semibold">
        {parseInline(match[1], key)}
      </strong>
    );
  } else if (rule.type === "link") {
    nodes.push(
      <a
        key={key}
        href={match[2]}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        {parseInline(match[1], key)}
      </a>
    );
  } else {
    nodes.push(<em key={key}>{parseInline(match[1], key)}</em>);
  }

  nodes.push(...parseInline(text.slice(index + match[0].length), `${key}-a`));
  return nodes;
}

const isBullet = (line: string) => /^\s*[-*+]\s+/.test(line);
const isOrdered = (line: string) => /^\s*\d+\.\s+/.test(line);
const isHeading = (line: string) => /^#{1,4}\s+/.test(line);

function parseBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const className =
        level <= 1
          ? "text-base font-semibold"
          : level === 2
            ? "text-sm font-semibold"
            : "font-semibold";
      blocks.push(
        <p key={`h-${key}`} className={className}>
          {parseInline(heading[2], `h${key}`)}
        </p>
      );
      key++;
      i++;
      continue;
    }

    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s+/, "");
        items.push(
          <li key={`li-${key}-${items.length}`}>
            {parseInline(text, `li${key}-${items.length}`)}
          </li>
        );
        i++;
      }
      blocks.push(
        <ul key={`ul-${key}`} className="list-disc space-y-0.5 pl-4">
          {items}
        </ul>
      );
      key++;
      continue;
    }

    if (isOrdered(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(
          <li key={`oli-${key}-${items.length}`}>
            {parseInline(text, `oli${key}-${items.length}`)}
          </li>
        );
        i++;
      }
      blocks.push(
        <ol key={`ol-${key}`} className="list-decimal space-y-0.5 pl-4">
          {items}
        </ol>
      );
      key++;
      continue;
    }

    // Paragraph: consecutive lines until a blank line or a block starter.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isBullet(lines[i]) &&
      !isOrdered(lines[i]) &&
      !isHeading(lines[i])
    ) {
      paragraph.push(lines[i]);
      i++;
    }

    const nodes: ReactNode[] = [];
    paragraph.forEach((paragraphLine, index) => {
      if (index > 0) nodes.push(<br key={`br-${key}-${index}`} />);
      nodes.push(...parseInline(paragraphLine, `p${key}-${index}`));
    });
    blocks.push(
      <p key={`p-${key}`} className="leading-5">
        {nodes}
      </p>
    );
    key++;
  }

  return blocks;
}

export function ChatMarkdown({ content }: { content: string }) {
  return <div className="space-y-2 break-words">{parseBlocks(content)}</div>;
}

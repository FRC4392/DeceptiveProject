import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeDrawingUrl } from "../../../convex/lib/assembly";
import { cn } from "@/lib/utils";

/**
 * An issue body or comment, as GitHub wrote it.
 *
 * These arrive as markdown and used to be shown as plain text, so a comment
 * full of backticks and bullet dashes read like source. Two things matter here
 * beyond rendering it:
 *
 * - **Nothing escapes the card.** A pasted stack trace, a 300-character URL or
 *   a base64 blob has no soft break in it, so the text itself is allowed to
 *   break anywhere, while code blocks and tables scroll sideways instead —
 *   breaking a command mid-token would make it unreadable *and* uncopyable.
 * - **Raw HTML is never rendered.** react-markdown ignores it unless
 *   `rehype-raw` is added, which is why no sanitizer is needed here. Don't add
 *   one without the other: this text comes from whoever opened the issue.
 */
export function MarkdownBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 space-y-3 break-words text-sm [overflow-wrap:anywhere]",
        // Block code sits inside <pre>, which brings its own box — so the
        // inline-code chip styling below has to stand down in there.
        "[&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre>code]:text-inherit",
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 text-sm font-semibold">{children}</h4>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 text-sm font-semibold">{children}</h4>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="max-w-full overflow-x-auto rounded bg-muted p-3 font-mono text-xs leading-relaxed">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b px-2 py-1 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b px-2 py-1 align-top">{children}</td>
          ),
          hr: () => <hr className="border-border" />,
          img: ({ src, alt }) => (
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt ?? ""}
              className="max-w-full rounded"
            />
          ),
          // Only http(s) reaches an href, the same rule a sub-assembly's
          // drawing link goes through.
          a: ({ href, children }) =>
            href && isSafeDrawingUrl(href) ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

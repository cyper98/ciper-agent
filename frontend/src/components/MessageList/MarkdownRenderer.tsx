import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownRendererProps {
  content: string;
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const lang = className?.replace('language-', '') ?? '';
  const text = extractText(children);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <div className="md-code-block">
      <div className="md-code-block__header">
        <span className="md-code-block__lang">{lang || 'plaintext'}</span>
        <button className="md-code-block__copy" onClick={copy} title="Copy code">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="md-code-block__pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node) && node.props) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export function MarkdownRenderer({ content }: MarkdownRendererProps): JSX.Element {
  return (
    <div className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            // Block code — className is set by rehype-highlight (e.g. "language-ts")
            if (className) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            // Inline code
            return (
              <code className="md-inline-code" {...props}>
                {children}
              </code>
            );
          },
          // Suppress the default <pre> wrapper — CodeBlock renders its own
          pre({ children }) {
            // If children is already a CodeBlock, render directly
            return <>{children}</>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

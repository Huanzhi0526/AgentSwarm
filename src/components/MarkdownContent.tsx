import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, FileText, AtSign } from 'lucide-react';

export interface MentionableSlot {
  slotId: string;
  displayName: string;
}

interface MarkdownContentProps {
  content: string;
  variant?: 'agent' | 'human';
  knownSlots?: MentionableSlot[];
  onOpenFilePath?: (relPath: string) => void;
  onClickMention?: (targetSlotId: string) => void;
}

const LIKELY_FILE_RE =
  /^(?:[a-zA-Z0-9_\u4e00-\u9fa5.-]+[\\/])*[a-zA-Z0-9_\u4e00-\u9fa5.-]+\.(?:md|mdx|tsx?|jsx?|mjs|cjs|json|html?|css|scss|py|go|rs|java|c|cpp|h|cs|sh|ps1|cmd|bat|ya?ml|toml|sql|csv|txt|svg|png|jpe?g|gif|webp|pdf)$/i;

function injectMentionLinks(raw: string, validSet: Set<string>): string {
  if (!raw || validSet.size === 0) return raw;
  // Split out fenced code blocks so we never alter code inside ```...```
  const parts = raw.split(/(`{3,}[\s\S]*?`{3,})/g);
  return parts
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment;
      // Unwrap `@slot` or **@slot** first
      let s = segment
        .replace(/`@( [a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+)`/g, (_, id) => `@${String(id).trim()}`)
        .replace(/\*\*@([a-zA-Z0-9_-]+)\*\*/g, '@$1');

      // Avoid matching inside existing markdown links [...](...)
      s = s.replace(/(^|[^a-zA-Z0-9_/.[\]-])@([a-zA-Z0-9_-]+)/g, (full, prefix: string, id: string) => {
        const lower = id.toLowerCase();
        if (!validSet.has(lower)) return full;
        return `${prefix}[@${id}](#mention:${lower})`;
      });
      return s;
    })
    .join('');
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  variant = 'agent',
  knownSlots,
  onOpenFilePath,
  onClickMention,
}) => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const slotMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of knownSlots ?? []) {
      m.set(s.slotId.toLowerCase(), s.displayName);
    }
    if (!m.has('human')) m.set('human', '我');
    return m;
  }, [knownSlots]);

  const preparedMarkdown = useMemo(() => {
    const validSet = new Set<string>(slotMap.keys());
    return injectMentionLinks(content, validSet);
  }, [content, slotMap]);

  const handleCopy = (raw: string) => {
    navigator.clipboard.writeText(raw);
    setCopiedCode(raw);
    setTimeout(() => setCopiedCode(null), 1600);
  };

  if (variant === 'human') {
    return (
      <div className="text-[14.5px] sm:text-[15px] leading-[1.68] text-white break-words [&>p+p]:mt-2 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:my-1.5 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:my-1.5 [&_strong]:font-bold [&_code]:rounded [&_code]:bg-white/18 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const cleanHref = (href || '').trim();
              if (cleanHref.startsWith('#mention:')) {
                const targetSlot = cleanHref.slice('#mention:'.length).toLowerCase();
                const targetName = slotMap.get(targetSlot);
                return (
                  <button
                    type="button"
                    onClick={() => onClickMention?.(targetSlot)}
                    title={`点击查看与 ${targetName || `@${targetSlot}`} 的往来对话记录`}
                    className="inline-flex items-center gap-1 rounded-md bg-white/22 hover:bg-white/32 px-1.5 py-0.5 text-[13px] font-semibold text-white transition cursor-pointer mx-0.5"
                  >
                    <span>{children}</span>
                    {targetName && <span className="opacity-90 font-normal">({targetName})</span>}
                  </button>
                );
              }
              return (
                <a href={cleanHref} target="_blank" rel="noreferrer" className="underline">
                  {children}
                </a>
              );
            },
          }}
        >
          {preparedMarkdown}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="text-[14.5px] leading-[1.72] text-[#2C2E35] break-words space-y-2.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-[16.5px] font-bold text-[#1F2024] pt-1 pb-0.5">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[15.5px] font-bold text-[#1F2024] pt-1 pb-0.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[14.5px] font-bold text-[#232429] pt-0.5">{children}</h3>
          ),
          p: ({ children }) => <p className="leading-[1.72] text-[#2C2E35]">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#1B1C20]">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1 text-[#2C2E35] marker:text-[#9A9DA8]">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1 text-[#2C2E35] marker:text-[var(--ac-bar)] marker:font-semibold">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-[1.68]">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="rounded-r-xl border-l-3 border-[#B8ADD9] bg-[#F8F7FC] px-3.5 py-2 text-[13.5px] text-[#555866]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-[#ECECF2] my-3" />,
          a: ({ href, children }) => {
            const cleanHref = (href || '').trim();
            if (cleanHref.startsWith('#mention:')) {
              const targetSlot = cleanHref.slice('#mention:'.length).toLowerCase();
              const targetName = slotMap.get(targetSlot);
              return (
                <button
                  type="button"
                  onClick={() => onClickMention?.(targetSlot)}
                  title={`点击查看发起者与 ${targetName || `@${targetSlot}`} 的往来对话记录`}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--ac-border)] bg-[var(--ac-soft)] px-1.5 py-0.5 text-[13px] font-semibold text-[var(--ac-text)] hover:border-[#BBAEE0] hover:bg-[#EAE3F8] transition cursor-pointer align-baseline mx-0.5"
                >
                  <AtSign className="h-3 w-3 text-[var(--ac-primary)] flex-shrink-0" />
                  <span>{String(children).replace(/^@/, '')}</span>
                  {targetName && (
                    <span className="text-[11.5px] font-medium text-[#796CA2]">· {targetName}</span>
                  )}
                </button>
              );
            }

            const isExternal = /^https?:\/\//i.test(cleanHref);
            if (!isExternal && onOpenFilePath && cleanHref && !cleanHref.startsWith('#')) {
              const rel = cleanHref.replace(/^file:\/\/\/?/i, '').replace(/#L\d+.*$/i, '');
              return (
                <button
                  type="button"
                  onClick={() => onOpenFilePath(rel)}
                  className="inline-flex items-center gap-1 rounded-md bg-[var(--ac-soft)] px-1.5 py-0.5 text-[13px] font-medium text-[var(--ac-text)] hover:bg-[#E7E1F5] transition cursor-pointer"
                >
                  <FileText className="h-3 w-3 flex-shrink-0" />
                  <span>{children}</span>
                </button>
              );
            }
            return (
              <a
                href={cleanHref}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--ac-deep)] underline decoration-[var(--ac-border-strong)] underline-offset-2 hover:text-[#524382]"
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-xl border border-[#EAEAEF] my-2">
              <table className="w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[#F7F7FA] text-[#4B4D57] border-b border-[#EAEAEF]">
              {children}
            </thead>
          ),
          th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => (
            <td className="px-3 py-2 border-t border-[#F1F1F5] text-[#3C3E47]">{children}</td>
          ),
          code: ({ className, children }) => {
            const rawText = String(children ?? '').replace(/\n$/, '');
            const langMatch = /language-([a-zA-Z0-9_-]+)/.exec(className || '');
            const isBlock = Boolean(langMatch) || rawText.includes('\n');

            if (isBlock) {
              return (
                <div className="my-2 overflow-hidden rounded-2xl border border-[#E6E6EE] bg-[#F9F9FC]">
                  <div className="flex items-center justify-between border-b border-[#ECECF2] bg-[#F2F2F7] px-3.5 py-1.5 text-[11.5px] text-[#7A7D89]">
                    <span className="font-mono">{langMatch?.[1] || 'code'}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(rawText)}
                      className="inline-flex items-center gap-1 text-[#666975] hover:text-[#1F2024] cursor-pointer"
                    >
                      {copiedCode === rawText ? (
                        <>
                          <Check className="h-3 w-3 text-[#529471]" /> 已复制
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> 复制
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto p-3.5 font-mono text-[12.5px] leading-[1.6] text-[#282A32]">
                    <code>{rawText}</code>
                  </pre>
                </div>
              );
            }

            const cleanedCandidate = rawText.trim().replace(/^[./\\]+/, '');
            if (onOpenFilePath && LIKELY_FILE_RE.test(cleanedCandidate)) {
              return (
                <button
                  type="button"
                  onClick={() => onOpenFilePath(cleanedCandidate)}
                  title="点击直接预览此文件"
                  className="inline-flex items-center gap-1 rounded-md border border-[#E2DDF0] bg-[var(--ac-tint)] px-1.5 py-0.5 font-mono text-[12.5px] font-medium text-[var(--ac-text)] hover:bg-[#EAE4F7] transition cursor-pointer align-baseline"
                >
                  <FileText className="h-3 w-3 flex-shrink-0 text-[var(--ac-primary)]" />
                  <span>{rawText}</span>
                </button>
              );
            }

            return (
              <code className="rounded-md bg-[#F2F2F7] px-1.5 py-0.5 font-mono text-[12.5px] text-[#454752]">
                {rawText}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {preparedMarkdown}
      </ReactMarkdown>
    </div>
  );
};

import React, { useEffect, useMemo } from 'react';
import { ArrowLeftRight, ArrowRight, CornerDownRight, FileText, X } from 'lucide-react';
import type { AgentSlot, BoardPost, ModelOption } from '../types';
import { formatEffortLabel, formatModelLabel, formatRelativeTime } from '../utils/format';
import { EngineIcon, UserAvatarIcon } from './BrandIcon';
import { SelectMenu } from './SelectMenu';
import { MarkdownContent, type MentionableSlot } from './MarkdownContent';

interface PairwiseDialogueModalProps {
  pair: { slotA: string; slotB: string } | null;
  agents: AgentSlot[];
  posts: BoardPost[];
  allModels: ModelOption[];
  onChangePair: (next: { slotA: string; slotB: string }) => void;
  onJumpToPost: (postId: string) => void;
  onPreviewFile: (relPath: string) => void;
  onClose: () => void;
}

function postTargetsSlot(post: BoardPost, targetSlotLower: string): boolean {
  if (post.mentions.some((m) => m.toLowerCase() === targetSlotLower)) return true;
  if (post.meta.replyToSlotId?.toLowerCase() === targetSlotLower) return true;
  const escaped = targetSlotLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_-])`, 'i');
  return re.test(post.content);
}

export const PairwiseDialogueModal: React.FC<PairwiseDialogueModalProps> = ({
  pair,
  agents,
  posts,
  allModels,
  onChangePair,
  onJumpToPost,
  onPreviewFile,
  onClose,
}) => {
  const participantOptions = useMemo(() => {
    const opts = [{ value: 'human', label: '我 (用户)' }];
    for (const a of agents) {
      opts.push({ value: a.slotId, label: `${a.displayName} (@${a.slotId})` });
    }
    return opts;
  }, [agents]);

  const knownSlots: MentionableSlot[] = useMemo(
    () => [
      { slotId: 'human', displayName: '我' },
      ...agents.map((a) => ({ slotId: a.slotId, displayName: a.displayName })),
    ],
    [agents]
  );

  const matchedPosts = useMemo(() => {
    if (!pair) return [];
    const a = pair.slotA.toLowerCase();
    const b = pair.slotB.toLowerCase();
    const nonSys = posts.filter((p) => p.authorType !== 'system');

    if (a === b) {
      return nonSys.filter(
        (p) => p.authorSlotId.toLowerCase() === a || postTargetsSlot(p, a)
      );
    }

    return nonSys.filter((p, idx) => {
      const author = p.authorSlotId.toLowerCase();
      // 1. Direct A -> B or B -> A
      if (author === a && postTargetsSlot(p, b)) return true;
      if (author === b && postTargetsSlot(p, a)) return true;

      // 2. Immediate turn reply (e.g. A @mentioned B in step idx-1, and B immediately responded at step idx)
      if (idx > 0) {
        const prev = nonSys[idx - 1];
        const prevAuthor = prev.authorSlotId.toLowerCase();
        if (author === b && prevAuthor === a && postTargetsSlot(prev, b)) return true;
        if (author === a && prevAuthor === b && postTargetsSlot(prev, a)) return true;
      }
      return false;
    });
  }, [pair, posts]);

  useEffect(() => {
    if (!pair) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [pair, onClose]);

  if (!pair) return null;

  const resolveParticipant = (slotId: string) => {
    if (slotId.toLowerCase() === 'human') {
      return { name: '我', role: '指令发起', isHuman: true, engine: undefined };
    }
    const found = agents.find((x) => x.slotId.toLowerCase() === slotId.toLowerCase());
    return {
      name: found?.displayName || `@${slotId}`,
      role: found?.roleTitle || slotId,
      isHuman: false,
      engine: found?.engine,
    };
  };

  const infoA = resolveParticipant(pair.slotA);
  const infoB = resolveParticipant(pair.slotB);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px] p-3 sm:p-6">
      <div className="flex w-full max-w-3xl max-h-[86vh] flex-col rounded-3xl bg-white shadow-2xl border border-[#EAEAEF] overflow-hidden">
        {/* Header with Pairwise Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-[#F1F1F5] bg-white">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-2">
              {infoA.isHuman ? (
                <UserAvatarIcon size={26} />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ac-soft)] border border-[#EAEAEF]">
                  <EngineIcon engine={infoA.engine} size={16} />
                </span>
              )}
              <div className="w-[144px]">
                <SelectMenu
                  value={pair.slotA}
                  options={participantOptions}
                  onChange={(val) => onChangePair({ slotA: val, slotB: pair.slotB })}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => onChangePair({ slotA: pair.slotB, slotB: pair.slotA })}
              title="对调双方视角"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ac-soft)] text-[var(--ac-primary)] hover:bg-[#E7E1F5] transition cursor-pointer"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>

            <div className="flex items-center gap-2">
              {infoB.isHuman ? (
                <UserAvatarIcon size={26} />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ac-soft)] border border-[#EAEAEF]">
                  <EngineIcon engine={infoB.engine} size={16} />
                </span>
              )}
              <div className="w-[144px]">
                <SelectMenu
                  value={pair.slotB}
                  options={participantOptions}
                  onChange={(val) => onChangePair({ slotA: pair.slotA, slotB: val })}
                />
              </div>
            </div>

            <span className="rounded-full bg-[var(--ac-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--ac-deep)]">
              {matchedPosts.length} 条往来
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭双人对话记录"
            className="rounded-full p-1.5 text-[#8A8D98] hover:bg-[#F3F2F7] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Pairwise Dialogue Stream */}
        <div className="flex-1 overflow-y-auto bg-[#F7F7FA] p-4 sm:p-6 space-y-4 min-h-[260px]">
          {matchedPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-1.5">
              <div className="text-[14.5px] font-semibold text-[#3C3E47]">
                {infoA.name} 与 {infoB.name} 暂无直接 @ 往来记录
              </div>
              <div className="text-[12.5px] text-[#8A8D98]">
                可在上方下拉框切换查看其他成员之间的协作对话
              </div>
            </div>
          ) : (
            matchedPosts.map((post) => {
              const fromA = post.authorSlotId.toLowerCase() === pair.slotA.toLowerCase();
              const sender = fromA ? infoA : infoB;
              const receiver = fromA ? infoB : infoA;
              const slotObj = agents.find((x) => x.slotId === post.authorSlotId);
              const modelLabel = formatModelLabel(
                post.meta.modelId || slotObj?.modelId,
                allModels
              );
              const effortLabel = formatEffortLabel(
                post.meta.reasoningEffort || slotObj?.reasoningEffort
              );

              return (
                <div
                  key={post.id}
                  className="rounded-2xl border border-[#EAEAEF] bg-white p-4 sm:p-5 shadow-[0_2px_8px_rgba(20,20,35,0.025)]"
                >
                  {/* Direction Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[#F2F2F6]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {sender.isHuman ? (
                        <UserAvatarIcon size={24} />
                      ) : (
                        <EngineIcon engine={post.authorEngine || sender.engine} size={18} />
                      )}
                      <span className="text-[13.5px] font-bold text-[#1F2024]">{sender.name}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#9A9DA8]" />
                      <span className="rounded-md bg-[var(--ac-soft)] px-2 py-0.5 text-[12px] font-semibold text-[var(--ac-hover)]">
                        {receiver.name}
                      </span>
                      {!sender.isHuman && modelLabel && (
                        <span className="rounded-md bg-[#F2F2F7] px-2 py-0.5 text-[11.5px] text-[#666975]">
                          {modelLabel} · {effortLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 text-[12px] text-[#8E919C]">
                      <span>{formatRelativeTime(post.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onJumpToPost(post.id);
                        }}
                        className="inline-flex items-center gap-1 text-[var(--ac-deep)] font-medium hover:underline cursor-pointer"
                      >
                        <CornerDownRight className="h-3 w-3" /> 定位原消息
                      </button>
                    </div>
                  </div>

                  {post.title && (
                    <div className="mb-1.5 text-[14.5px] font-bold text-[#1F2024]">
                      {post.title}
                    </div>
                  )}

                  <MarkdownContent
                    content={post.content}
                    variant="agent"
                    knownSlots={knownSlots}
                    onOpenFilePath={(rel) => {
                      onClose();
                      onPreviewFile(rel);
                    }}
                    onClickMention={(targetSlot) => {
                      if (targetSlot !== post.authorSlotId.toLowerCase()) {
                        onChangePair({ slotA: post.authorSlotId, slotB: targetSlot });
                      }
                    }}
                  />

                  {post.meta.filesChanged && post.meta.filesChanged.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-[#F2F2F6] flex flex-wrap items-center gap-2">
                      {post.meta.filesChanged.map((f) => (
                        <button
                          type="button"
                          key={f}
                          onClick={() => {
                            onClose();
                            onPreviewFile(f);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#E4E1F0] bg-[#FAFAFD] px-2.5 py-1 text-[12px] font-medium text-[#4B4D57] hover:border-[#BDB3DF] hover:text-[var(--ac-text)] cursor-pointer"
                        >
                          <FileText className="h-3.5 w-3.5 text-[var(--ac-primary)]" />
                          <span className="font-mono">{f}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

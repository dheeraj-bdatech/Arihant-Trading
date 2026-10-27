'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Globe2, Link2, MessageSquare, Send } from 'lucide-react';
import {
  LEAD_CUSTOMER_CHAT_ROLES,
  LEAD_MESSAGE_MAX_LENGTH,
  type LeadChatLinkDto,
  type LeadMessageAudience,
  type LeadMessageDto,
} from '@arihant/shared';
import { Badge, Button, InfoCallout, Spinner, Textarea, formatDateTimeIN } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { roleLabel } from '@/lib/role-label';
import { getSocket } from '@/lib/socket';

/**
 * The lead's conversation (Conversation tab of the lead detail): oldest message first, newest at the bottom.
 * Team-only messages stay internal; with a customer chat link switched on, the lead owner, managers and admins can
 * also write to the customer, whose replies arrive here live. Messages are append-only — no edit or delete.
 */
export const LeadConversation: React.FC<{ leadId: string; onPosted?: () => void }> = ({ leadId, onPosted }) => {
  const { user } = useAuth();
  const canChatCustomer = Boolean(user && LEAD_CUSTOMER_CHAT_ROLES.includes(user.role));
  const [messages, setMessages] = useState<LeadMessageDto[]>([]);
  const [link, setLink] = useState<LeadChatLinkDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<LeadMessageAudience>('team');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [newLinkUrl, setNewLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<'rotate' | 'revoke' | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const [msgs, chatLink] = await Promise.all([
          api.get<LeadMessageDto[]>(`/leads/${leadId}/messages`),
          api.get<LeadChatLinkDto>(`/leads/${leadId}/chat-link`),
        ]);
        setMessages(msgs);
        setLink(chatLink);
      } catch (err: any) {
        if (!quiet) setLoadError(err?.message || 'Could not load the conversation.');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [leadId],
  );

  useEffect(() => {
    setMessages([]);
    setLink(null);
    setText('');
    setAudience('team');
    setSendError(null);
    setNewLinkUrl(null);
    setConfirming(null);
    load();
  }, [load]);

  // A message on this lead from anyone (a teammate, or the customer over the link) re-reads the thread
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMessage = (p: { lead_id?: string }) => {
      if (p?.lead_id === leadId) load(true);
    };
    socket.on('lead:message', onMessage);
    return () => {
      socket.off('lead:message', onMessage);
    };
  }, [leadId, load]);

  // Keep the newest message in view
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Writing to the customer needs a live link
  useEffect(() => {
    if (!link?.active) setAudience('team');
  }, [link?.active]);

  const trimmed = text.trim();
  const tooLong = text.length > LEAD_MESSAGE_MAX_LENGTH;
  const toCustomer = audience === 'customer';

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trimmed || tooLong || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await api.post<LeadMessageDto>(`/leads/${leadId}/messages`, { body: trimmed, audience });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setText('');
      onPosted?.();
    } catch (err: any) {
      setSendError(err?.message || 'Could not send the message. Try again.');
    } finally {
      setSending(false);
    }
  };

  const makeLink = async () => {
    setLinkBusy(true);
    setLinkError(null);
    try {
      const made = await api.post<LeadChatLinkDto>(`/leads/${leadId}/chat-link`);
      setLink(made);
      setNewLinkUrl(made.url_path ? `${window.location.origin}${made.url_path}` : null);
      setCopied(false);
      setConfirming(null);
    } catch (err: any) {
      setLinkError(err?.message || 'Could not create the chat link.');
    } finally {
      setLinkBusy(false);
    }
  };

  const turnOff = async () => {
    setLinkBusy(true);
    setLinkError(null);
    try {
      setLink(await api.delete<LeadChatLinkDto>(`/leads/${leadId}/chat-link`));
      setNewLinkUrl(null);
      setConfirming(null);
    } catch (err: any) {
      setLinkError(err?.message || 'Could not turn the chat link off.');
    } finally {
      setLinkBusy(false);
    }
  };

  const copyLink = async () => {
    if (!newLinkUrl) return;
    try {
      await navigator.clipboard.writeText(newLinkUrl);
      setCopied(true);
    } catch {
      setLinkError('Copy failed. Select the link and copy it by hand.');
    }
  };

  return (
    <div className="flex flex-1 flex-col animate-in fade-in duration-150">
      <div className="flex flex-1 flex-col space-y-3 rounded-xl border border-[#DCD8CE] bg-white p-3 sm:p-4">
        <div className="flex items-center gap-2 border-b border-[#ECE9E2] pb-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-[#0F5E63]" />
          <span className="text-xs font-bold uppercase tracking-wider text-[#14213D]">Conversation</span>
          {messages.length > 0 && (
            <span className="ml-auto font-mono text-[10px] text-[#4A5568]">
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </span>
          )}
        </div>

        {/* Customer chat link: status for everyone, controls for those who may write to the customer */}
        {!loading && !loadError && link && (
          <div className="space-y-2 rounded-lg border border-[#ECE9E2] bg-[#FBFAF7] p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-[#0F5E63]" />
              {link.active ? (
                <span className="min-w-0 flex-1 text-[#14213D]">
                  <strong>Customer chat is on.</strong>{' '}
                  <span className="text-[#4A5568]">
                    Link made {link.created_at ? formatDateTimeIN(link.created_at) : ''}
                    {link.created_by_name ? ` by ${link.created_by_name}` : ''}.
                  </span>
                </span>
              ) : (
                <span className="min-w-0 flex-1 text-[#4A5568]">
                  No customer chat link. {canChatCustomer ? 'Create one to chat with the customer live.' : 'The lead owner can create one.'}
                </span>
              )}
              {canChatCustomer && confirming === null && (
                <div className="flex shrink-0 gap-1.5">
                  {link.active ? (
                    <>
                      <Button size="xs" variant="secondary" onClick={() => setConfirming('rotate')} disabled={linkBusy}>
                        New link
                      </Button>
                      <Button size="xs" variant="ghost" className="text-[#881337]" onClick={() => setConfirming('revoke')} disabled={linkBusy}>
                        Turn off
                      </Button>
                    </>
                  ) : (
                    <Button size="xs" variant="primary" leftIcon={<Link2 className="h-3 w-3" />} onClick={makeLink} isLoading={linkBusy}>
                      Create chat link
                    </Button>
                  )}
                </div>
              )}
            </div>

            {confirming && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[#ECE9E2] pt-2">
                <span className="min-w-0 flex-1 text-[#7C2D12]">
                  {confirming === 'rotate'
                    ? 'The link the customer has now will stop working. Make a new one?'
                    : 'The customer will no longer be able to open the chat. Their messages stay here.'}
                </span>
                <Button size="xs" variant={confirming === 'revoke' ? 'danger' : 'primary'} onClick={confirming === 'rotate' ? makeLink : turnOff} isLoading={linkBusy}>
                  {confirming === 'rotate' ? 'Make new link' : 'Turn off'}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(null)} disabled={linkBusy}>
                  Cancel
                </Button>
              </div>
            )}

            {newLinkUrl && (
              <div className="space-y-1.5 border-t border-[#ECE9E2] pt-2">
                <div className="flex gap-1.5">
                  <input
                    readOnly
                    aria-label="Customer chat link"
                    value={newLinkUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-[#C9C4B8] bg-white px-2.5 font-mono text-[11px] text-[#14213D] focus:border-[#0F5E63] focus:outline-none sm:h-8"
                  />
                  <Button size="sm" variant="secondary" leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={copyLink} className="h-10 shrink-0 sm:h-8">
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-[11px] text-[#4A5568]">
                  Send this link to the customer by WhatsApp or email. For security it is shown only now; if it is lost, make a new link.
                </p>
              </div>
            )}

            {linkError && (
              <p role="alert" className="font-medium text-[#881337]">
                {linkError}
              </p>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Spinner size="md" />
          </div>
        ) : loadError ? (
          <InfoCallout variant="danger" title="Could not load the conversation">
            <span className="block">{loadError}</span>
            <Button size="xs" variant="secondary" className="mt-2" onClick={() => load()}>
              Try again
            </Button>
          </InfoCallout>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[#DCD8CE] bg-[#FBFAF7] p-4 text-center text-xs text-[#4A5568]">
            No messages yet. Start the conversation: share an update, ask a question, or note the next step.
          </div>
        ) : (
          <div ref={threadRef} role="log" aria-label="Conversation messages" className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {messages.map((m) => {
              const mine = Boolean(user?.id && m.author_id === user.id);
              const tone = m.from_customer
                ? 'border-[#E9C9B4] bg-[#FBEBDD]'
                : mine
                ? 'border-[#D0E5E3] bg-[#E3EFEE]'
                : 'border-[#ECE9E2] bg-[#FBFAF7]';
              return (
                <div key={m.id} className={`space-y-1 rounded-lg border p-2.5 text-xs ${tone}`}>
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {m.from_customer ? (
                        <>
                          <Globe2 className="h-3 w-3 text-[#9A3412]" />
                          <span className="font-bold text-[#14213D]">{m.customer_name || 'Customer'}</span>
                          <Badge variant="warning" size="sm" className="text-[10px]">
                            Customer
                          </Badge>
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-[#14213D]">{mine ? 'You' : m.author_name || 'Former team member'}</span>
                          {m.author_role && (
                            <Badge variant="outline" size="sm" className="text-[10px]">
                              {roleLabel(m.author_role)}
                            </Badge>
                          )}
                          {m.audience === 'customer' && (
                            <Badge variant="info" size="sm" className="text-[10px]">
                              Sent to customer
                            </Badge>
                          )}
                        </>
                      )}
                    </span>
                    <time dateTime={m.created_at} className="font-mono text-[10px] text-[#4A5568]">
                      {formatDateTimeIN(m.created_at)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[#14213D]">{m.body}</p>
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={send} className="space-y-2 border-t border-[#ECE9E2] pt-3">
          {canChatCustomer && link?.active && (
            <div role="radiogroup" aria-label="Who sees this message" className="inline-flex rounded-lg border border-[#C9C4B8] bg-white p-0.5 text-xs">
              {(
                [
                  ['team', 'Team only'],
                  ['customer', 'To customer'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={audience === key}
                  onClick={() => setAudience(key)}
                  className={`min-h-[36px] rounded-md px-3 font-semibold transition-colors sm:min-h-[28px] ${
                    audience === key ? (key === 'customer' ? 'bg-[#9A3412] text-white' : 'bg-[#0F5E63] text-white') : 'text-[#4A5568] hover:text-[#14213D]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <Textarea
            aria-label="New message"
            rows={2}
            placeholder={toCustomer ? 'Write to the customer. They will see this on their chat link…' : 'Write a message to the team on this lead…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
            error={tooLong ? `Message must be at most ${LEAD_MESSAGE_MAX_LENGTH} characters.` : sendError || undefined}
            disabled={loading || Boolean(loadError)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={`font-mono text-[10px] ${tooLong ? 'text-[#881337]' : 'text-[#6B7280]'}`}>
              {text.length}/{LEAD_MESSAGE_MAX_LENGTH} · Ctrl+Enter to send
            </span>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              leftIcon={<Send className="h-3.5 w-3.5" />}
              isLoading={sending}
              disabled={!trimmed || tooLong || loading || Boolean(loadError)}
              className={`h-10 shrink-0 sm:h-8 ${toCustomer ? 'bg-[#9A3412] hover:bg-[#7C2D12]' : ''}`}
            >
              {toCustomer ? 'Send to customer' : 'Send'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

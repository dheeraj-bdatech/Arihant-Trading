'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Send } from 'lucide-react';
import { LEAD_MESSAGE_MAX_LENGTH, type LeadChatMessageDto, type LeadChatViewDto } from '@arihant/shared';
import { api, ApiError } from '@/lib/api';
import { Button, Card, InfoCallout, Textarea } from '@/components/ui';
import { Spinner } from '@/components/ui/Spinner';
import { fmtDateTime } from '../service-request/shared';

/** How often an open, visible chat checks for the team's replies. */
const POLL_MS = 8000;

function LeadChat() {
  const token = useSearchParams().get('token') || '';
  const [view, setView] = useState<LeadChatViewDto | null>(null);
  const [gone, setGone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) {
      setGone(true);
      return;
    }
    try {
      setView(await api.get<LeadChatViewDto>('/public/lead-chat', { token }));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
      else setLoadError(err instanceof ApiError && err.status === 429 ? err.message : 'Connection lost. Retrying…');
    }
  }, [token]);

  // Load, then check for replies while the page is visible (stops once the link is found turned off)
  useEffect(() => {
    if (gone) return;
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, gone]);

  const count = view?.messages.length ?? 0;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const trimmed = text.trim();
  const tooLong = text.length > LEAD_MESSAGE_MAX_LENGTH;

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!trimmed || tooLong || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await api.post<LeadChatMessageDto>('/public/lead-chat/messages', { token, body: trimmed });
      setView((prev) =>
        prev && !prev.messages.some((m) => m.id === message.id) ? { ...prev, messages: [...prev.messages, message] } : prev,
      );
      setText('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
      else setSendError(err instanceof ApiError ? err.message : 'Could not send. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  if (gone) {
    return (
      <InfoCallout variant="warning" title="This chat link is not active">
        Ask your Arihant contact for a new chat link.
      </InfoCallout>
    );
  }

  if (!view) {
    return (
      <div className="flex justify-center py-16">
        {loadError ? <InfoCallout variant="danger" title="Could not open the chat">{loadError}</InfoCallout> : <Spinner size="lg" />}
      </div>
    );
  }

  return (
    <Card padding="none" className="overflow-hidden border-[#DCD8CE]">
      <div className="space-y-1 border-b border-[#ECE9E2] bg-[#FBFAF7] px-4 py-3">
        <h1 className="font-serif text-lg font-bold text-[#14213D]">Chat with Arihant Trading</h1>
        <p className="text-xs text-[#4A5568]">
          {view.product_name ? `${view.product_name} for ` : ''}
          <strong className="text-[#14213D]">{view.organisation_name}</strong>
          {view.owner_name ? ` · Your contact: ${view.owner_name}` : ''}
        </p>
      </div>

      {loadError && (
        <p role="status" className="border-b border-[#ECE9E2] bg-[#FFF8EB] px-4 py-2 text-xs text-[#7C2D12]">
          {loadError}
        </p>
      )}

      <div ref={threadRef} role="log" aria-label="Chat messages" aria-live="polite" className="h-[min(60vh,480px)] space-y-2 overflow-y-auto px-4 py-4">
        {view.messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-[#4A5568]">
            No messages yet. Write your question below and the Arihant team will reply here.
          </p>
        ) : (
          view.messages.map((m) => (
            <div key={m.id} className={`flex ${m.from_customer ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] space-y-1 rounded-xl border px-3 py-2 text-sm ${
                  m.from_customer ? 'border-[#D0E5E3] bg-[#E3EFEE]' : 'border-[#DCD8CE] bg-white'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                  <span className="font-semibold text-[#14213D]">{m.from_customer ? 'You' : m.sender_name}</span>
                  <time dateTime={m.created_at} className="font-mono text-[#4A5568]">
                    {fmtDateTime(m.created_at)}
                  </time>
                </div>
                <p className="whitespace-pre-wrap break-words text-[#14213D]">{m.body}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={send} className="space-y-2 border-t border-[#ECE9E2] bg-[#FBFAF7] px-4 py-3">
        <Textarea
          aria-label="Your message"
          rows={2}
          placeholder={view.customer_name ? `Write your message, ${view.customer_name}…` : 'Write your message…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
          error={tooLong ? `Message must be at most ${LEAD_MESSAGE_MAX_LENGTH} characters.` : sendError || undefined}
          className="text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[11px] ${tooLong ? 'text-[#881337]' : 'text-[#6B7280]'}`}>
            {text.length}/{LEAD_MESSAGE_MAX_LENGTH}
          </span>
          <Button type="submit" leftIcon={<Send className="h-4 w-4" />} isLoading={sending} disabled={!trimmed || tooLong} className="h-11 sm:h-10">
            Send
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function LeadChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      }
    >
      <LeadChat />
    </Suspense>
  );
}

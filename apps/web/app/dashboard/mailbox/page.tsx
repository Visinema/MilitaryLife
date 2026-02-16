'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MailboxMessage } from '@mls/shared/game-types';
import { api, ApiError } from '@/lib/api-client';

type MailboxPayload = {
  items: MailboxMessage[];
  summary: {
    unreadCount: number;
    latest: MailboxMessage | null;
  };
  snapshot: {
    world?: {
      currentDay?: number;
    };
  } | null;
};

function formatMailboxDay(day: number): string {
  return `Day ${day}`;
}

export default function MailboxPage() {
  const [loading, setLoading] = useState(true);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MailboxPayload | null>(null);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const loadMailbox = useCallback(async (unreadOnly: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.v5Mailbox({ unreadOnly, limit: 120 });
      setData(response);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Gagal memuat mailbox.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMailbox(showUnreadOnly);
  }, [loadMailbox, showUnreadOnly]);

  const markRead = async (messageId: string) => {
    setBusyMessageId(messageId);
    setError(null);
    try {
      await api.v5MailboxRead(messageId);
      await loadMailbox(showUnreadOnly);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Gagal mark-as-read.');
      }
    } finally {
      setBusyMessageId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="cyber-panel p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Mailbox Command</p>
        <h1 className="text-lg font-semibold text-text">Surat Masuk Komando</h1>
        <p className="text-xs text-muted">Surat promosi, demosi, mutasi, sanksi, court, dan undangan council tersimpan persisten.</p>
      </div>

      <div className="cyber-panel p-3 text-xs space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-accent/70 bg-accent/10 px-2 py-1 text-text">
            Unread: {data?.summary.unreadCount ?? 0}
          </span>
          <span className="rounded border border-border/70 bg-bg/70 px-2 py-1 text-muted">
            World Day: {data?.snapshot?.world?.currentDay ?? '-'}
          </span>
          <button
            onClick={() => setShowUnreadOnly((prev) => !prev)}
            className="rounded border border-border bg-bg px-2 py-1 text-text hover:border-accent"
          >
            {showUnreadOnly ? 'Tampilkan Semua' : 'Hanya Unread'}
          </button>
        </div>
        {data?.summary.latest ? (
          <p className="text-muted">
            Surat terbaru: <span className="text-text">{data.summary.latest.subject}</span> ({formatMailboxDay(data.summary.latest.createdDay)})
          </p>
        ) : (
          <p className="text-muted">Belum ada surat.</p>
        )}
      </div>

      <div className="cyber-panel p-3 text-xs">
        {loading ? <p className="text-muted">Loading mailbox...</p> : null}
        {error ? <p className="text-danger">{error}</p> : null}
        {!loading && !error && (data?.items.length ?? 0) === 0 ? (
          <p className="text-muted">Mailbox kosong.</p>
        ) : null}
        <div className="space-y-2">
          {data?.items.map((item) => {
            const unread = !item.readAt;
            return (
              <article
                key={item.messageId}
                className={`rounded border p-2 ${unread ? 'border-accent/60 bg-accent/10' : 'border-border/60 bg-bg/70'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-text">{item.subject}</p>
                  <span className="text-[11px] text-muted">{formatMailboxDay(item.createdDay)}</span>
                </div>
                <p className="mt-1 text-muted">{item.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted">{item.category}</span>
                  <span className="rounded border border-border/70 px-2 py-0.5 text-[11px] text-muted">{unread ? 'UNREAD' : `READ ${item.readDay ?? '-'}`}</span>
                  {unread ? (
                    <button
                      onClick={() => void markRead(item.messageId)}
                      disabled={busyMessageId === item.messageId}
                      className="rounded border border-accent bg-accent/20 px-2 py-0.5 text-[11px] text-text disabled:opacity-60"
                    >
                      {busyMessageId === item.messageId ? 'Reading...' : 'Mark as Read'}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

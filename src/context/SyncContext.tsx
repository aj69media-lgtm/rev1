import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import {
  enqueueOfflineMutation,
  getQueuedMutations,
  loadOfflineSnapshot,
  removeQueuedMutation,
  saveOfflineSnapshot,
} from '../lib/offlineDb';
import { useAuth } from './AuthContext';

export interface OnlineUser {
  id: number;
  full_name: string;
  role_name: string;
}

export interface SyncNotification {
  id: number;
  user_id: number;
  project_id: number | null;
  type: string;
  title: string;
  body: string;
  link_section: string;
  is_read: number;
  created_at: string;
}

interface SyncContextValue {
  isOnline: boolean;
  wsConnected: boolean;
  syncVersion: number;
  pendingCount: number;
  isSyncing: boolean;
  onlineUsers: OnlineUser[];
  notifications: SyncNotification[];
  lastEventLabel: string | null;
  flushOfflineQueue: () => Promise<void>;
  mutateWithOfflineQueue: <T = any>(params: {
    method: string;
    url: string;
    body: Record<string, unknown>;
    label: string;
  }) => Promise<{ queued: boolean; data?: T }>;
  fetchWithCache: <T = any>(cacheKey: string, url: string) => Promise<{ data: T; fromCache: boolean; cachedAt?: string }>;
  markNotificationRead: (id: number) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [wsConnected, setWsConnected] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [notifications, setNotifications] = useState<SyncNotification[]>([]);
  const [lastEventLabel, setLastEventLabel] = useState<string | null>(null);

  const lastEventIdRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshQueueCount = useCallback(async () => {
    const items = await getQueuedMutations();
    setPendingCount(items.length);
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest<{ notifications: SyncNotification[] }>('/api/notifications');
      setNotifications(res.notifications || []);
    } catch {
      // Offline
    }
  }, [token]);

  const flushOfflineQueue = useCallback(async () => {
    if (!token || !navigator.onLine) return;
    const queued = await getQueuedMutations();
    if (queued.length === 0) {
      setPendingCount(0);
      return;
    }

    setIsSyncing(true);
    try {
      for (const item of queued) {
        try {
          await apiRequest(item.url, {
            method: item.method,
            body: { ...item.body, clientIdempotencyKey: item.clientIdempotencyKey },
          });
          if (item.id !== undefined) {
            await removeQueuedMutation(item.id);
          }
        } catch (err: any) {
          // Stop flushing if network dropped again; skip permanent 4xx validation errors after logging
          if (!navigator.onLine || err?.name === 'TypeError') break;
          if (err?.status >= 400 && err?.status < 500 && item.id !== undefined) {
            await removeQueuedMutation(item.id);
          }
        }
      }
      setSyncVersion((v) => v + 1);
      setLastEventLabel('Offline records synchronized');
    } finally {
      await refreshQueueCount();
      setIsSyncing(false);
    }
  }, [token, refreshQueueCount]);

  useEffect(() => {
    refreshQueueCount();
  }, [refreshQueueCount]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      flushOfflineQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setWsConnected(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushOfflineQueue]);

  // WebSocket + Polling Fallback
  useEffect(() => {
    if (!token || !user) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      setNotifications([]);
      return;
    }

    refreshNotifications();
    flushOfflineQueue();

    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connectWs = () => {
      if (stopped || !navigator.onLine) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
          pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000);
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'connected') {
              if (typeof msg.latestEventId === 'number') {
                lastEventIdRef.current = msg.latestEventId;
              }
              if (Array.isArray(msg.onlineUsers)) {
                setOnlineUsers(msg.onlineUsers);
              }
            } else if (msg.type === 'presence:update') {
              setOnlineUsers(msg.onlineUsers || []);
            } else if (msg.type === 'sync:event') {
              if (typeof msg.id === 'number') {
                lastEventIdRef.current = Math.max(lastEventIdRef.current, msg.id);
              }
              setSyncVersion((v) => v + 1);
              setLastEventLabel(`${msg.module}: ${msg.eventType.replace(':', ' ')}`);
            } else if (msg.type === 'notification:new' && msg.notification) {
              setNotifications((prev) => {
                if (prev.some((n) => n.id === msg.notification.id)) return prev;
                return [msg.notification, ...prev];
              });
            }
          } catch {
            // Ignore malformed WS payloads
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (pingTimer) clearInterval(pingTimer);
          if (!stopped) {
            reconnectTimer = setTimeout(connectWs, 4000);
          }
        };
      } catch {
        setWsConnected(false);
      }
    };

    connectWs();

    // cPanel-compatible REST polling fallback when WS is disconnected or offline recovery happens
    pollTimer = setInterval(async () => {
      if (!navigator.onLine || wsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const res = await apiRequest<{ events: any[] }>(`/api/sync/events?since=${lastEventIdRef.current}`);
        if (res.events && res.events.length > 0) {
          lastEventIdRef.current = Math.max(...res.events.map((e) => e.id));
          setSyncVersion((v) => v + 1);
          refreshNotifications();
        }
      } catch {
        // Ignore polling errors while offline
      }
    }, 15000);

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, user, refreshNotifications, flushOfflineQueue]);

  const mutateWithOfflineQueue = useCallback(
    async <T = any,>({
      method,
      url,
      body,
      label,
    }: {
      method: string;
      url: string;
      body: Record<string, unknown>;
      label: string;
    }): Promise<{ queued: boolean; data?: T }> => {
      const idempKey = `cbms-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (!navigator.onLine) {
        await enqueueOfflineMutation({ method, url, body, label, clientIdempotencyKey: idempKey });
        await refreshQueueCount();
        return { queued: true };
      }

      try {
        const data = await apiRequest<T>(url, {
          method,
          body: { ...body, clientIdempotencyKey: idempKey },
        });
        setSyncVersion((v) => v + 1);
        return { queued: false, data };
      } catch (err: any) {
        // Only queue on network failures, not 4xx validation/permission rejections
        if (!navigator.onLine || err?.name === 'TypeError') {
          await enqueueOfflineMutation({ method, url, body, label, clientIdempotencyKey: idempKey });
          await refreshQueueCount();
          return { queued: true };
        }
        throw err;
      }
    },
    [refreshQueueCount]
  );

  const fetchWithCache = useCallback(
    async <T = any,>(cacheKey: string, url: string): Promise<{ data: T; fromCache: boolean; cachedAt?: string }> => {
      if (navigator.onLine) {
        try {
          const data = await apiRequest<T>(url);
          await saveOfflineSnapshot(cacheKey, data);
          return { data, fromCache: false };
        } catch (err: any) {
          if (err?.status && err.status >= 400 && err.status < 500) {
            throw err;
          }
        }
      }
      const cached = await loadOfflineSnapshot<T>(cacheKey);
      if (cached) {
        return { data: cached.data, fromCache: true, cachedAt: cached.updatedAt };
      }
      throw new Error('Offline and no cached snapshot available for this view.');
    },
    []
  );

  const markNotificationRead = useCallback(async (id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch {
      // Ignore offline error
    }
  }, []);

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        wsConnected,
        syncVersion,
        pendingCount,
        isSyncing,
        onlineUsers,
        notifications,
        lastEventLabel,
        flushOfflineQueue,
        mutateWithOfflineQueue,
        fetchWithCache,
        markNotificationRead,
        refreshNotifications,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
};

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}

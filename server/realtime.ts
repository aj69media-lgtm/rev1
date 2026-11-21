import type http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { type AuthUser, canAccessProject, resolveSessionUser } from './auth.ts';
import { db } from './db.ts';

interface ConnectedClient {
  ws: WebSocket;
  user: AuthUser;
}

const clients = new Set<ConnectedClient>();

export function initWebSocketServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const token = url.searchParams.get('token') || '';
    const resolved = resolveSessionUser(token);
    if (!resolved) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const client: ConnectedClient = { ws, user: resolved.user };
    clients.add(client);

    const latestEvent = db
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM sync_events')
      .get() as { max_id: number };

    ws.send(
      JSON.stringify({
        type: 'connected',
        userId: resolved.user.id,
        role: resolved.user.role_slug,
        latestEventId: latestEvent.max_id,
        onlineUsers: getOnlineUserSummary(),
      })
    );

    broadcastPresence();

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      broadcastPresence();
    });
  });
}

function getOnlineUserSummary(): Array<{ id: number; full_name: string; role_name: string }> {
  const seen = new Map<number, { id: number; full_name: string; role_name: string }>();
  for (const c of clients) {
    if (!c.user.is_client_role && !seen.has(c.user.id)) {
      seen.set(c.user.id, {
        id: c.user.id,
        full_name: c.user.full_name,
        role_name: c.user.role_name,
      });
    }
  }
  return Array.from(seen.values());
}

function broadcastPresence(): void {
  const summary = getOnlineUserSummary();
  const payload = JSON.stringify({ type: 'presence:update', onlineUsers: summary });
  for (const c of clients) {
    if (!c.user.is_client_role && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload);
    }
  }
}

export function emitSyncEvent(params: {
  eventType: string;
  module: string;
  projectId?: number | null;
  clientVisible?: boolean;
  payload: Record<string, unknown>;
}): number {
  const clientOnly = params.clientVisible ? 1 : 0;
  const info = db
    .prepare(
      'INSERT INTO sync_events (event_type, module, project_id, client_only, payload_json) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      params.eventType,
      params.module,
      params.projectId ?? null,
      clientOnly,
      JSON.stringify(params.payload)
    );

  const eventId = Number(info.lastInsertRowid);
  const message = JSON.stringify({
    type: 'sync:event',
    id: eventId,
    eventType: params.eventType,
    module: params.module,
    projectId: params.projectId ?? null,
    payload: params.payload,
    createdAt: new Date().toISOString(),
  });

  for (const c of clients) {
    if (c.ws.readyState !== WebSocket.OPEN) continue;
    if (c.user.is_client_role && !params.clientVisible) continue;
    if (params.projectId && !canAccessProject(c.user, params.projectId)) continue;
    c.ws.send(message);
  }

  return eventId;
}

export function createNotification(params: {
  userId: number;
  projectId?: number | null;
  type: string;
  title: string;
  body: string;
  linkSection?: string;
}): void {
  const info = db
    .prepare(
      'INSERT INTO notifications (user_id, project_id, type, title, body, link_section) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(
      params.userId,
      params.projectId ?? null,
      params.type,
      params.title,
      params.body,
      params.linkSection || 'overview'
    );

  const notifPayload = JSON.stringify({
    type: 'notification:new',
    notification: {
      id: Number(info.lastInsertRowid),
      user_id: params.userId,
      project_id: params.projectId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      link_section: params.linkSection || 'overview',
      is_read: 0,
      created_at: new Date().toISOString(),
    },
  });

  for (const c of clients) {
    if (c.user.id === params.userId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(notifPayload);
    }
  }
}

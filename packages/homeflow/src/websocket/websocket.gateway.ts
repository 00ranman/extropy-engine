/**
 * @module websocket/websocket.gateway
 * HomeFlow WebSocket Gateway
 *
 * Provides real-time bidirectional communication for:
 * - Device state changes (IoT sensors, smart switches)
 * - Chore completion events with live XP updates
 * - Household entropy score broadcasts
 * - Shopping list and inventory sync
 * - Health metric streaming
 */

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventBusService, HomeFlowEvent } from '../services/event-bus.service';

export type WsEventType =
  | 'device:state'
  | 'device:alert'
  | 'chore:completed'
  | 'chore:assigned'
  | 'xp:awarded'
  | 'entropy:update'
  | 'inventory:low_stock'
  | 'shopping:updated'
  | 'health:metric'
  | 'household:event'
  | 'system:ping';

export interface WsMessage {
  type: WsEventType;
  payload: unknown;
  timestamp: string;
  householdId?: string;
}

interface ConnectedClient {
  ws: WebSocket;
  householdId: string;
  userId: string;
  connectedAt: string;
}

/**
 * HomeFlow WebSocket Gateway
 * Attaches to an existing HTTP server and upgrades connections.
 */
export class HomeFlowWebSocketGateway {
  private wss: WebSocketServer;
  private clients: Map<string, ConnectedClient> = new Map();
  private eventBus: EventBusService;

  constructor(server: HttpServer, eventBus: EventBusService) {
    this.eventBus = eventBus;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.init();
  }

  private init(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const params = new URLSearchParams(req.url?.split('?')[1] ?? '');
      const householdId = params.get('householdId') ?? 'unknown';
      const userId = params.get('userId') ?? 'anonymous';
      const clientId = `${householdId}:${userId}`;

      this.clients.set(clientId, {
        ws,
        householdId,
        userId,
        connectedAt: new Date().toISOString(),
      });

      this.send(ws, { type: 'system:ping', payload: { status: 'connected', clientId }, timestamp: new Date().toISOString() });

      ws.on('message', (data) => this.handleMessage(clientId, data.toString()));
      ws.on('close', () => this.clients.delete(clientId));
      ws.on('error', (err) => console.error(`[WS] Client ${clientId} error:`, err));
    });

    // Bridge extropy-engine EventBus events to WebSocket clients
    this.eventBus.on('device:state_changed', (event: HomeFlowEvent) => {
      this.broadcastToHousehold(event.householdId, { type: 'device:state', payload: event.data, timestamp: event.timestamp });
    });
    this.eventBus.on('chore:completed', (event: HomeFlowEvent) => {
      this.broadcastToHousehold(event.householdId, { type: 'chore:completed', payload: event.data, timestamp: event.timestamp });
    });
    this.eventBus.on('xp:awarded', (event: HomeFlowEvent) => {
      this.broadcastToHousehold(event.householdId, { type: 'xp:awarded', payload: event.data, timestamp: event.timestamp });
    });
    this.eventBus.on('entropy:recalculated', (event: HomeFlowEvent) => {
      this.broadcastToHousehold(event.householdId, { type: 'entropy:update', payload: event.data, timestamp: event.timestamp });
    });
    this.eventBus.on('inventory:low_stock', (event: HomeFlowEvent) => {
      this.broadcastToHousehold(event.householdId, { type: 'inventory:low_stock', payload: event.data, timestamp: event.timestamp });
    });
  }

  private handleMessage(clientId: string, raw: string): void {
    try {
      const msg: WsMessage = JSON.parse(raw);
      if (msg.type === 'system:ping') {
        const client = this.clients.get(clientId);
        if (client) this.send(client.ws, { type: 'system:ping', payload: { pong: true }, timestamp: new Date().toISOString() });
      }
    } catch {
      console.warn(`[WS] Malformed message from ${clientId}`);
    }
  }

  private send(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** Broadcast to all connected clients belonging to a household */
  broadcastToHousehold(householdId: string, msg: Omit<WsMessage, 'householdId'>): void {
    for (const [, client] of this.clients) {
      if (client.householdId === householdId) {
        this.send(client.ws, { ...msg, householdId });
      }
    }
  }

  /** Broadcast to ALL connected clients (system-wide announcements) */
  broadcastGlobal(msg: Omit<WsMessage, 'householdId'>): void {
    for (const [, client] of this.clients) {
      this.send(client.ws, { ...msg });
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}

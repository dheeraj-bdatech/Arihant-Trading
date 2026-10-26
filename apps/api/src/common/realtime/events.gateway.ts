import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../database/database.module.js';
import type { Database, UserRole } from '@arihant/shared';
import { verifyAccessToken } from '../auth/verify-token.js';

/** Same allow-list as the HTTP API (CORS_ORIGINS, comma separated); read per handshake so .env is respected. */
const allowedOrigin = (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
  const allowed = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim());
  // Non-browser clients send no Origin; they still need a valid token to connect.
  cb(null, !origin || allowed.includes(origin));
};

@WebSocketGateway({
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authHeader =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization;

      if (!authHeader) {
        this.logger.warn(`Client ${client.id} disconnected: No auth token provided`);
        client.disconnect();
        return;
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : authHeader;

      // Same verification as the HTTP guard (HS256 and Supabase ES256).
      const payload: any = await verifyAccessToken(token, this.configService);
      const userId = payload.sub || payload.id;

      if (!userId) {
        client.disconnect();
        return;
      }

      const user = await this.db
        .selectFrom('users')
        .select(['id', 'role', 'region_id', 'is_active'])
        .where('id', '=', userId)
        .executeTakeFirst();

      if (!user || !user.is_active) {
        client.disconnect();
        return;
      }

      // Join individual user room, role room, and region room
      client.join(`user:${user.id}`);
      client.join(`role:${user.role}`);
      if (user.region_id) {
        client.join(`region:${user.region_id}`);
      }

      this.logger.log(`Client connected: ${client.id} (user: ${user.id}, role: ${user.role})`);
    } catch (err: any) {
      this.logger.warn(`Auth failed for client ${client.id}: ${err.message}`);
      client.disconnect();
    }
  }

  /** A deactivated account loses its live connection at once (its HTTP calls already fail in the guard). */
  @OnEvent('user.deactivated')
  disconnectUser(payload: { userId: string }) {
    if (this.server && payload?.userId) {
      this.server.in(`user:${payload.userId}`).disconnectSockets(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  sendToUser(userId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, data);
    }
  }

  sendToRole(role: UserRole, event: string, data: any) {
    if (this.server) {
      this.server.to(`role:${role}`).emit(event, data);
    }
  }

  sendToRegion(regionId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`region:${regionId}`).emit(event, data);
    }
  }

  broadcast(event: string, data: any) {
    if (this.server) {
      this.server.emit(event, data);
    }
  }
}

/**
 * The contract between crate and an installable plugin.
 *
 * This file mirrors crate's own interfaces (src/lib/plugin.ts and web/src/plugins/types.ts in
 * the crate repo). It exists because an installed plugin is built HERE, against these types,
 * and runs THERE, against the real objects — there is no compiler at the boundary, so this
 * file is the boundary. If crate changes its contract, this file changes with it, and every
 * plugin rebuilds; that discipline is the price of install-without-rebuild.
 */

import type { ComponentType } from 'react';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ---- server half ---------------------------------------------------------

export interface PluginCaller {
  /** Row id, or null for the API-key caller, which is not a user. */
  id: number | null;
  user: string;
  name: string;
  isAdmin: boolean;
  viaToken: boolean;
}

/** IPv4-pinned HTTP helpers from crate's lib/http — the estate has no IPv6 egress. */
export interface PluginHttp {
  getText(url: string, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<string>;
  getJson<T>(url: string, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<T | null>;
  getBytes(url: string, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<Buffer | null>;
}

export interface PluginContext {
  db: Database.Database;
  /** Track existence and ownership checks. Matches crate's UserLibrary surface a plugin may use. */
  userlib: {
    byId(id: number): { trackId: number; title: string; artistName: string; albumTitle: string } | null;
  };
  log: FastifyBaseLogger;
  /** The session guard: has already replied 401 when it returns null. */
  need: (req: FastifyRequest, reply: FastifyReply) => PluginCaller | null;
  events: { on(event: string, fn: (event: string, e: { title: string; message: string }) => void): void };
  http: PluginHttp;
}

/** What a plugin's server/index.ts default-exports. */
export interface CratePlugin {
  id: string;
  migrate?(db: Database.Database): void;
  routes?(app: FastifyInstance, ctx: PluginContext): void;
}

// ---- client half ----------------------------------------------------------

export type Say = (k: 'good' | 'bad', t: string) => void;

export interface PanelProps {
  trackId: number;
  title: string;
  artistName: string;
  onClose: () => void;
  say: Say;
}

/** What a plugin's client/index.tsx default-exports. */
export interface UiPlugin {
  id: string;
  playbar?: { title: string; icon: ComponentType; Panel: ComponentType<PanelProps> };
  profile?: { label: string; hint: string; Pane: ComponentType<{ say: Say }> };
}

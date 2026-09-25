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
  /** Resolves null on a non-2xx, and carries the content type — crate's real shape. */
  getBytes(
    url: string,
    opts?: { timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<{ body: Buffer; contentType: string } | null>;
}

export interface PluginContext {
  db: Database.Database;
  /** Track existence and ownership checks. Matches crate's UserLibrary surface a plugin may use. */
  userlib: {
    byId(id: number): { trackId: number; title: string; artistName: string; albumTitle: string } | null;
    /**
     * Create a playlist for a user. A `rules` JSON string (core's lib/dynamicpl.ts shape)
     * makes it DYNAMIC — it deals fresh tracks from the recipe on every open. This is how
     * the DJ's "save mood as playlist" works.
     */
    createPlaylist(userId: number, name: string, rules?: string | null): number;
    setPlaylistDescription(playlistId: number, description: string): void;
  };
  log: FastifyBaseLogger;
  /** The session guard: has already replied 401 when it returns null. */
  need: (req: FastifyRequest, reply: FastifyReply) => PluginCaller | null;
  events: { on(event: string, fn: (event: string, e: { title: string; message: string }) => void): void };
  /**
   * Song characteristics, read-only, plus the distance maths over them (crate's
   * lib/similarity.ts). A plugin gets the primitive rather than the tables: it may ask how close
   * things are, and may not write scores.
   *
   * `enabled()` is the feature switch. False means no track has a profile worth asking about, and
   * a caller should fall back to whatever it did before rather than treating an empty vector as
   * a statement about the music.
   */
  characteristics: {
    enabled(): boolean;
    /** Active characteristic keys, so a caller can build a target profile in the right space. */
    keys(): string[];
    /** One track's merged AI+manual vector, or null when it has never been analysed. */
    vectorOf(trackId: number): Map<string, number> | null;
    /** How close every analysed track is to a target profile. Absent id = cannot say. */
    scoreAgainst(profile: Record<string, number>): Map<number, number>;
    compareToProfile(
      trackId: number,
      profile: Record<string, number>,
    ): {
      similarity: number | null;
      overlap: number;
      reason?: string;
      closest: { characteristic: string; name: string; a: number; b: number; delta: number; weight: number }[];
      differences: { characteristic: string; name: string; a: number; b: number; delta: number; weight: number }[];
    };
  };
  http: PluginHttp;
  /**
   * Put a file into the library for someone — crate's dedupe, move, index, override, own
   * sequence (its lib/ingest.ts). The file is MOVED. Requires crate >= external-sources.
   */
  library: {
    ingest(
      input: { file: string; artist: string; title: string; album?: string; trackNo?: number },
      userId: number,
    ): Promise<{ trackId: number; adopted: boolean; artist: string; title: string; album: string }>;
  };
  /** A writable directory that belongs to this plugin alone, under /data. */
  dataDir: string;
  /** This plugin's own settings, as declared in CratePlugin.settings. Read-only. */
  settings: { get(key: string): string | number | boolean | undefined };
}

/** One song an external source can offer. `key` is the source's own id for it. */
export interface ExternalHit {
  key: string;
  title: string;
  artist: string;
  album?: string;
  durationS?: number;
  coverUrl?: string;
  score?: number;
}

/** Where a song's audio is right now. crate proxies it; the plugin never touches HTTP. */
export interface ExternalStream {
  url: string;
  mime: string;
  headers?: Record<string, string>;
  sizeBytes?: number;
  /** Epoch seconds after which the URL stops working. */
  expiresAt?: number;
}

export interface ExternalAcquired {
  file: string;
  artist: string;
  title: string;
  album?: string;
  trackNo?: number;
}

/**
 * Songs from outside the library. The plugin answers four questions; crate does everything a
 * person or client can see — ids (x-<id>-<key>), auth, Range, transcoding, when to fall back,
 * when a listen counts, the import, the caps. Mirrors crate's src/lib/plugin.ts.
 */
export interface ExternalSource {
  /** [a-z0-9]+ — the <source> in x-<source>-<key>. Changing it orphans every id. */
  id: string;
  label: string;
  search(q: string, limit: number): Promise<ExternalHit[]>;
  describe(key: string): Promise<ExternalHit | null>;
  resolveStream(key: string): Promise<ExternalStream>;
  acquire(key: string, hit: ExternalHit): Promise<ExternalAcquired>;
}

export interface PluginSettingDef {
  key: string;
  label: string;
  type: 'boolean' | 'string' | 'number' | 'secret';
  default?: string | number | boolean;
  hint?: string;
}

/** What a plugin's server/index.ts default-exports. */
export interface CratePlugin {
  id: string;
  migrate?(db: Database.Database): void;
  routes?(app: FastifyInstance, ctx: PluginContext): void;
  /** Offer songs from outside the library. Requires crate >= external-sources. */
  source?(ctx: PluginContext): ExternalSource;
  /** Settings the admin can change on this plugin's page. */
  settings?: PluginSettingDef[];
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
  /**
   * Always mounted while somebody is signed in, rendering nothing visible: the plugin's
   * running half. Lives inside PlayerProvider (usePlayer works) and unmounts when the plugin
   * is switched off. Requires crate >= the Service-slot build (2026-08-07).
   */
  Service?: ComponentType;
}

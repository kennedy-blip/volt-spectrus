import { Injectable } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { GridAudit, SmartMeterRead, SyncQueueEntry, Vampire } from '../models';

interface VoltSpectraDB extends DBSchema {
  vampires: { key: string; value: Vampire; indexes: { byAddedAt: string } };
  audits: { key: string; value: GridAudit; indexes: { byCreatedAt: string } };
  meterReads: { key: string; value: SmartMeterRead; indexes: { byCreatedAt: string } };
  syncQueue: { key: string; value: SyncQueueEntry; indexes: { byStatus: string } };
  meta: { key: string; value: { key: string; value: string } };
}

export const DB_NAME = 'voltspectra';
export const DB_VERSION = 1;

/**
 * Offline-first IndexedDB persistence.  Every GraphQL mutation and every
 * hardware sensor log lands here first; the sync queue replays to the cloud
 * when connectivity returns.  This is what makes the APK basement-ready.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private db: IDBPDatabase<VoltSpectraDB> | null = null;

  private async conn(): Promise<IDBPDatabase<VoltSpectraDB>> {
    if (this.db) return this.db;
    this.db = await openDB<VoltSpectraDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('vampires')) {
          database.createObjectStore('vampires', { keyPath: 'id' }).createIndex('byAddedAt', 'addedAt');
        }
        if (!database.objectStoreNames.contains('audits')) {
          database.createObjectStore('audits', { keyPath: 'id' }).createIndex('byCreatedAt', 'createdAt');
        }
        if (!database.objectStoreNames.contains('meterReads')) {
          database.createObjectStore('meterReads', { keyPath: 'id' }).createIndex('byCreatedAt', 'createdAt');
        }
        if (!database.objectStoreNames.contains('syncQueue')) {
          database.createObjectStore('syncQueue', { keyPath: 'id' }).createIndex('byStatus', 'status');
        }
        if (!database.objectStoreNames.contains('meta')) {
          database.createObjectStore('meta', { keyPath: 'key' });
        }
      },
    });
    return this.db;
  }

  async ready(): Promise<boolean> {
    try {
      await this.conn();
      return true;
    } catch (err) {
      console.warn('[IndexedDb] unavailable', err);
      return false;
    }
  }

  /* ------------------------------------------------------------- vampires */

  async allVampires(): Promise<Vampire[]> {
    const db = await this.conn();
    return db.getAllFromIndex('vampires', 'byAddedAt');
  }
  async putVampire(v: Vampire): Promise<void> {
    const db = await this.conn();
    await db.put('vampires', v);
  }
  async removeVampire(id: string): Promise<void> {
    const db = await this.conn();
    await db.delete('vampires', id);
  }

  /* --------------------------------------------------------------- audits */

  async allAudits(): Promise<GridAudit[]> {
    const db = await this.conn();
    return db.getAllFromIndex('audits', 'byCreatedAt');
  }
  async putAudit(a: GridAudit): Promise<void> {
    const db = await this.conn();
    await db.put('audits', a);
  }

  /* ----------------------------------------------------------- meter reads */

  async allMeterReads(): Promise<SmartMeterRead[]> {
    const db = await this.conn();
    return db.getAllFromIndex('meterReads', 'byCreatedAt');
  }
  async putMeterRead(r: SmartMeterRead): Promise<void> {
    const db = await this.conn();
    await db.put('meterReads', r);
  }

  /* ------------------------------------------------------------ sync queue */

  async allSync(): Promise<SyncQueueEntry[]> {
    const db = await this.conn();
    return db.getAll('syncQueue');
  }
  async putSync(entry: SyncQueueEntry): Promise<void> {
    const db = await this.conn();
    await db.put('syncQueue', entry);
  }
  async updateSync(entry: SyncQueueEntry): Promise<void> {
    const db = await this.conn();
    await db.put('syncQueue', entry);
  }
  async clearSync(): Promise<void> {
    const db = await this.conn();
    await db.clear('syncQueue');
  }

  /* ------------------------------------------------------------------ meta */

  async getMeta(key: string): Promise<string | null> {
    const db = await this.conn();
    const row = await db.get('meta', key);
    return row?.value ?? null;
  }
  async setMeta(key: string, value: string): Promise<void> {
    const db = await this.conn();
    await db.put('meta', { key, value });
  }

  /** Raw JSON telemetry export for the Grid Systems Director tier. */
  async exportAll(): Promise<Record<string, unknown>> {
    const [vampires, audits, meterReads, syncQueue] = await Promise.all([
      this.allVampires(),
      this.allAudits(),
      this.allMeterReads(),
      this.allSync(),
    ]);
    return { exportedAt: new Date().toISOString(), vampires, audits, meterReads, syncQueue };
  }
}

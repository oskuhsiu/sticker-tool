export interface VideoMasterStore {
  readonly kind: 'memory' | 'indexeddb';
  readonly projectId: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  bytesUsed(): Promise<number>;
}

class MemoryVideoMasterStore implements VideoMasterStore {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, Uint8Array>();

  constructor(readonly projectId: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(key, bytes.slice());
  }

  async get(key: string): Promise<Uint8Array> {
    const bytes = this.entries.get(key);
    if (!bytes) throw new Error(`Video master store 缺少 ${key}`);
    return bytes.slice();
  }

  async has(key: string): Promise<boolean> {
    return this.entries.has(key);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async bytesUsed(): Promise<number> {
    let total = 0;
    for (const bytes of this.entries.values()) total += bytes.length;
    return total;
  }
}

const DATABASE_NAME = 'sticker-tool-video-master-v2';
const OBJECT_STORE = 'chunks';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

class IndexedDbVideoMasterStore implements VideoMasterStore {
  readonly kind = 'indexeddb' as const;
  private readonly keys = new Set<string>();

  constructor(readonly projectId: string) {}

  private scoped(key: string): string {
    return `${this.projectId}/${key}`;
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(OBJECT_STORE, mode);
      const result = await requestResult(run(transaction.objectStore(OBJECT_STORE)));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      });
      return result;
    } finally {
      database.close();
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(bytes.slice().buffer, this.scoped(key)));
    this.keys.add(key);
  }

  async get(key: string): Promise<Uint8Array> {
    const value = await this.transaction('readonly', (store) => store.get(this.scoped(key)));
    if (!(value instanceof ArrayBuffer)) throw new Error(`Video master store 缺少 ${key}`);
    return new Uint8Array(value);
  }

  async has(key: string): Promise<boolean> {
    const count = await this.transaction('readonly', (store) => store.count(this.scoped(key)));
    return count > 0;
  }

  async delete(key: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(this.scoped(key)));
    this.keys.delete(key);
  }

  async clear(): Promise<void> {
    await Promise.all([...this.keys].map((key) => this.delete(key)));
  }

  async bytesUsed(): Promise<number> {
    let total = 0;
    for (const key of this.keys) total += (await this.get(key)).length;
    return total;
  }
}

export interface VideoStorePreflight {
  estimatedBytes: number;
  availableBytes: number | null;
  backend: 'memory' | 'indexeddb';
}

export async function preflightVideoMasterStore(estimatedBytes: number): Promise<VideoStorePreflight> {
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) {
    throw new RangeError('estimatedBytes must be a non-negative safe integer');
  }
  const backend = estimatedBytes > 32 * 1024 * 1024 && typeof indexedDB !== 'undefined' ? 'indexeddb' : 'memory';
  const storageEstimate = backend === 'indexeddb' ? await navigator.storage?.estimate?.() : undefined;
  const availableBytes = storageEstimate?.quota !== undefined
    ? Math.max(0, storageEstimate.quota - (storageEstimate.usage ?? 0))
    : null;
  if (availableBytes !== null && estimatedBytes * 1.15 > availableBytes) {
    throw new Error(
      `預估 Project 需 ${(estimatedBytes / 1024 / 1024).toFixed(0)} MiB，瀏覽器儲存只剩約 ` +
      `${(availableBytes / 1024 / 1024).toFixed(0)} MiB`,
    );
  }
  return {
    estimatedBytes,
    availableBytes,
    backend,
  };
}

export async function createVideoMasterStore(args: {
  projectId?: string;
  estimatedBytes?: number;
  forceMemory?: boolean;
} = {}): Promise<VideoMasterStore> {
  const projectId = args.projectId ?? crypto.randomUUID();
  if (args.forceMemory || typeof indexedDB === 'undefined') return new MemoryVideoMasterStore(projectId);
  const preflight = await preflightVideoMasterStore(args.estimatedBytes ?? 0);
  return preflight.backend === 'indexeddb'
    ? new IndexedDbVideoMasterStore(projectId)
    : new MemoryVideoMasterStore(projectId);
}

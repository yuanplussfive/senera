/** Structured-clone storage preserves File objects without base64 copies or origin-dependent preview URLs. */
export class MessageDraftRepository {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("senera-message-drafts", 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        const invalidate = () => {
          if (this.database === opening) this.database = undefined;
        };
        database.onclose = invalidate;
        database.onversionchange = () => {
          database.close();
          invalidate();
        };
        resolve(database);
      };
      request.onerror = () => {
        reject(request.error);
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error("Close older Senera tabs to update message draft storage."));
      };
    });
    this.database = opening;
    // Failed opens remain explicit, while the next action may open a new connection.
    void opening.catch(() => {
      if (this.database === opening) this.database = undefined;
    });
    return opening;
  }

  async read<T>(key: string): Promise<T | undefined> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").get(key);
      transaction.oncomplete = () => resolve(request.result as T | undefined);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async write<T>(key: string, value: T | undefined): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      if (value === undefined) store.delete(key);
      else store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /** One read/write transaction also serializes competing documents at this origin. */
  async update<T>(key: string, change: (previous: T | undefined) => T | undefined): Promise<T | undefined> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      const request = store.get(key);
      let result: T | undefined;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          result = change(request.result as T | undefined);
          if (result === undefined) store.delete(key);
          else store.put(result, key);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export const messageDraftRepository = new MessageDraftRepository();

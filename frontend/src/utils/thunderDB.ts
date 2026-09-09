import { invoke } from './tauriBridge';

interface PendingSave {
  data: any;
  timer: any;
  resolvers: Array<() => void>;
  rejecters: Array<(err: any) => void>;
}

const pendingSaves = new Map<string, PendingSave>();

export const saveToThunderDB = async (key: string, data: any, immediate: boolean = false): Promise<void> => {
  if (immediate) {
    const existing = pendingSaves.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      pendingSaves.delete(key);
      existing.resolvers.forEach((r) => r());
    }

    const jsonStr = JSON.stringify(data, null, 2);
    try {
      await invoke('save_thunderdb_file_command', {
        filename: `${key}.json`,
        content: jsonStr,
      });
    } catch (err) {
      console.error(`[ThunderDB] Failed to save ${key}.json to disk:`, err);
    }
    return;
  }

  return new Promise<void>((resolve, reject) => {
    let entry = pendingSaves.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      entry.data = data;
      entry.resolvers.push(resolve);
      entry.rejecters.push(reject);
    } else {
      entry = {
        data,
        timer: null,
        resolvers: [resolve],
        rejecters: [reject],
      };
      pendingSaves.set(key, entry);
    }

    entry.timer = setTimeout(async () => {
      const activeEntry = pendingSaves.get(key);
      if (!activeEntry) return;
      pendingSaves.delete(key);

      const jsonStr = JSON.stringify(activeEntry.data, null, 2);
      try {
        await invoke('save_thunderdb_file_command', {
          filename: `${key}.json`,
          content: jsonStr,
        });
        activeEntry.resolvers.forEach((r) => r());
      } catch (err) {
        console.error(`[ThunderDB] Failed to save ${key}.json to disk:`, err);
        activeEntry.rejecters.forEach((rej) => rej(err));
      }
    }, 150);
  });
};

export const loadFromThunderDB = async <T>(key: string, defaultValue: T): Promise<T> => {
  // Read json file from ~/.thunderdm
  try {
    const content = await invoke<string | null>('read_thunderdb_file_command', {
      filename: `${key}.json`,
    });
    if (content && typeof content === 'string' && content.trim()) {
      return JSON.parse(content) as T;
    }
  } catch (err) {
    console.warn(`[ThunderDB] Could not read ${key}.json from disk:`, err);
  }

  return defaultValue;
};


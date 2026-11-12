// Where past events are kept on a phone: a SQLite-backed key-value store. The
// app's working state lives in AsyncStorage, which Android caps at a few
// megabytes in total, too little for a growing history.
import Storage from 'expo-sqlite/kv-store';

export const historyStorage = {
  getItem: (key: string): Promise<string | null> => Storage.getItem(key),
  setItem: (key: string, value: string): Promise<void> => Storage.setItem(key, value),
  removeItem: async (key: string): Promise<void> => {
    await Storage.removeItem(key);
  },
};

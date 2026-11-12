// In a browser, SQLite needs WebAssembly and special server headers, so past
// events go in the browser's own storage instead.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const historyStorage = {
  getItem: (key: string): Promise<string | null> => AsyncStorage.getItem(key),
  setItem: (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value),
  removeItem: (key: string): Promise<void> => AsyncStorage.removeItem(key),
};

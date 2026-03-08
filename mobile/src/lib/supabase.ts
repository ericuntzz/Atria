// URL polyfill loaded via supabase-polyfill.native.ts
import "./supabase-polyfill";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

// Web uses localStorage, native uses expo-secure-store
const createStorageAdapter = () => {
  if (Platform.OS === "web") {
    return {
      getItem: (key: string) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key: string, value: string) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          // ignore
        }
      },
      removeItem: (key: string) => {
        try {
          localStorage.removeItem(key);
        } catch {
          // ignore
        }
      },
    };
  }

  // Native: use expo-secure-store with chunking to bypass the
  // iOS Keychain 2048-byte value limit. Supabase sessions can
  // exceed this when JWTs contain custom claims or user metadata.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require("expo-secure-store");
  const CHUNK_SIZE = 1800; // Leave margin below the 2048-byte limit

  return {
    getItem: async (key: string): Promise<string | null> => {
      const header = await SecureStore.getItemAsync(key);
      if (header === null) return null;
      // If no chunk marker, it's a single-chunk value
      if (!header.startsWith("__chunked__:")) return header;

      const count = parseInt(header.split(":")[1], 10);
      const chunks: string[] = [];
      for (let i = 0; i < count; i++) {
        const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
        if (chunk === null) return null; // Corrupted — treat as missing
        chunks.push(chunk);
      }
      return chunks.join("");
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }
      // Split into chunks
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      // Write header first, then chunks
      await SecureStore.setItemAsync(key, `__chunked__:${chunks.length}`);
      for (let i = 0; i < chunks.length; i++) {
        await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunks[i]);
      }
    },
    removeItem: async (key: string): Promise<void> => {
      const header = await SecureStore.getItemAsync(key);
      if (header?.startsWith("__chunked__:")) {
        const count = parseInt(header.split(":")[1], 10);
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(`${key}_chunk_${i}`);
        }
      }
      await SecureStore.deleteItemAsync(key);
    },
  };
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL env var");
if (!supabaseAnonKey)
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_ANON_KEY env var");

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: createStorageAdapter(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// src/nostr.d.ts
import { Event } from 'nostr-tools';

// Define the structure of the NIP-07 provider object
interface Nip07Provider {
  getPublicKey(): Promise<string>;
  signEvent(event: { created_at: number; kind: number; tags: string[][]; content: string }): Promise<Event>;
  // Optional: Add other NIP-07 methods if needed (getRelays, nip04.encrypt/decrypt)
  // getRelays?(): Promise<{ [url: string]: { read: boolean; write: boolean } }>;
  // nip04?: {
  //   encrypt(pubkey: string, plaintext: string): Promise<string>;
  //   decrypt(pubkey: string, ciphertext: string): Promise<string>;
  // };
}

// Augment the global Window interface
declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}

// Export an empty object to make this file a module
export {};
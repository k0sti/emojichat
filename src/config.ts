// Relay configurations for EmojiChat

// Relays to publish notes to (and fetch history/live updates from)
export const publishRelays: string[] = [
    'wss://relay.nexel.space'
];

// Relays to fetch profile (Kind 0) events from
export const profileRelays: string[] = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
    'wss://purplepag.es' // Known for profile data
]; 
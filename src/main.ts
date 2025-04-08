import { RelayPool } from 'applesauce-relay';
import { NostrEvent, Filter } from 'nostr-tools'; // Types from nostr-tools

console.log('Nostr Client Script Loaded (using Applesauce RelayPool)');

const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null;
const statusDiv = document.getElementById('status');
const notesListDiv = document.getElementById('notes-list');

const relays = ['wss://relay.damus.io', 'wss://relay.primal.net']; // Example relays

// 1. Initialize RelayPool
const pool = new RelayPool();

let subscription: any | null = null; // Use 'any' to bypass RxJS type conflict

async function connectAndFetch() {
    if (!statusDiv || !notesListDiv || !connectBtn) {
        console.error('Required HTML elements not found');
        return;
    }

    statusDiv.textContent = 'Status: Connecting & Fetching...';
    connectBtn.disabled = true;
    notesListDiv.innerHTML = ''; // Clear previous notes

    // Unsubscribe from previous subscription if it exists
    if (subscription) {
        console.log('Unsubscribing from previous request.');
        subscription.unsubscribe();
        subscription = null;
    }

    try {
        // 2. Get a RelayGroup for the desired relays
        // Note: RelayPool doesn't require explicit connection beforehand.
        // Connections are managed internally when requests are made.
        const group = pool.group(relays);
        console.log(`RelayGroup created for: ${relays.join(', ')}`);

        // 3. Define the filter for the request
        const filters: Filter[] = [{
            kinds: [1],
            limit: 20, // Fetch latest 20 notes
        }];
        console.log('Requesting filters:', JSON.stringify(filters));

        // 4. Make the request and subscribe
        subscription = group.req(filters).pipe(
            // Optional filtering/mapping if needed
            // filter(response => typeof response !== 'string'), // Example: only pass events
        ).subscribe({
            next(response) {
                if (response === "EOSE") {
                    console.log('Received EOSE');
                    // You might receive EOSE from multiple relays in the group.
                    // Consider how to handle this - maybe update status only once.
                    if (statusDiv) statusDiv.textContent = 'Status: Feed Loaded (EOSE received)';
                    if (connectBtn) connectBtn.disabled = false; // Re-enable button after EOSE
                } else {
                    // It's an event
                    const event = response as NostrEvent;
                     // Basic validation
                    if (!event || typeof event.content !== 'string' || typeof event.pubkey !== 'string' || typeof event.created_at !== 'number') {
                        console.warn('Received invalid event structure:', event);
                        return;
                    }
                    console.log('Received event:', event.id, event.pubkey.substring(0,8));
                    const noteElement = document.createElement('div');
                    noteElement.classList.add('note');
                    noteElement.innerHTML = `
                        <p>${event.content}</p>
                        <small>By: ${event.pubkey.substring(0, 8)}... at ${new Date(event.created_at * 1000).toLocaleString()}</small>
                    `;
                    // Prepend new notes to the top
                    if (notesListDiv) notesListDiv.insertBefore(noteElement, notesListDiv.firstChild);
                }
            },
            error(err) {
                console.error('Subscription error:', err);
                if (statusDiv) statusDiv.textContent = `Status: Error - ${err.message || 'Subscription failed'}`;
                if (connectBtn) connectBtn.disabled = false;
            },
            complete() {
                // This might be called if the underlying observable completes,
                // which could happen if all relays disconnect or the subscription is closed manually.
                console.log('Subscription stream completed.');
                 if (statusDiv && statusDiv.textContent?.includes('Fetching')) {
                    statusDiv.textContent = 'Status: Stream completed (check console for details)';
                 }
                if (connectBtn) connectBtn.disabled = false;
            }
        });

         // Optional: Timeout to re-enable button if EOSE doesn't fire quickly
         setTimeout(() => {
            if (connectBtn?.disabled) {
                 console.log('Timeout reached, enabling button.');
                 if (statusDiv) statusDiv.textContent = 'Status: Feed Loaded (Timeout)';
                 connectBtn.disabled = false;
                 // Don't necessarily unsubscribe here, as events might still arrive
            }
        }, 20000); // 20 second timeout


    } catch (error) {
        console.error('Error setting up RelayGroup or subscription:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (statusDiv) statusDiv.textContent = `Status: Setup Error - ${errorMessage}`;
        if (connectBtn) connectBtn.disabled = false;
    }
}

if (connectBtn) {
    connectBtn.addEventListener('click', connectAndFetch);
} else {
    console.error('Connect button not found');
}
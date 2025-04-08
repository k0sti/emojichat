import { RelayPool } from 'applesauce-relay';
import { EventStore, QueryStore } from 'applesauce-core'; // Removed Queries import object
import { TimelineQuery } from 'applesauce-core/queries/simple'; // Import TimelineQuery instead
import { NostrEvent, Filter, Event, EventTemplate } from 'nostr-tools'; // Added EventTemplate
import { tap } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs'; // Import firstValueFrom
import { ExtensionSigner } from 'applesauce-signers'; // Import ExtensionSigner

console.log('EmojiChat Client Script Loaded');

// NIP-07 related variables
let userPubkey: string | null = null;
let nip07Signer: ExtensionSigner | null = null; // Use ExtensionSigner type

const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null;
const statusDiv = document.getElementById('status');
const notesListDiv = document.getElementById('notes-list');
const composeAreaDiv = document.getElementById('compose-area');
const composeInputDiv = document.getElementById('compose-input');
const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
const emojiPanelDiv = document.getElementById('emoji-panel');

const relays = ['wss://relay.damus.io', 'wss://relay.primal.net']; // Example relays

// 1. Initialize RelayPool
const pool = new RelayPool();
const eventStore = new EventStore();
const queryStore = new QueryStore(eventStore); // Link QueryStore to EventStore

let notesSubscription: any | null = null;
// Initialize the relay group immediately after the pool
const relayGroup = pool.group(relays);
console.log(`RelayGroup initialized immediately for: ${relays.join(', ')}`);
let replyContext: { eventId: string; pubkey: string } | null = null; // To store reply target
// Removed duplicate declaration

// Function to handle NIP-07 connection
async function connectNip07() {
    if (!statusDiv || !connectBtn) {
        console.error('Required HTML elements not found for NIP-07 connect');
        return;
    }
    // ExtensionSigner constructor will handle checking for window.nostr internally

    statusDiv.textContent = 'Status: Requesting NIP-07 connection...';
    connectBtn.disabled = true;

    try {
        nip07Signer = new ExtensionSigner(); // Instantiate the signer
        // getPublicKey now handles the check and potential errors
        userPubkey = await nip07Signer.getPublicKey();
        console.log('Connected with pubkey:', userPubkey);
        statusDiv.textContent = `Status: Connected as ${userPubkey.substring(0, 8)}...`;
        connectBtn.textContent = 'Fetch Notes'; // Change button text
        // Remove old listener, add new one for fetching
        connectBtn.removeEventListener('click', connectNip07);
        connectBtn.addEventListener('click', fetchNotes);
        connectBtn.disabled = false;
        // Show compose area after connecting
        if (composeAreaDiv) {
            composeAreaDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('NIP-07 connection error:', error);
        statusDiv.textContent = `Status: NIP-07 Error - ${error instanceof Error ? error.message : 'Failed'}`;
        connectBtn.disabled = false;
        nip07Signer = null;
        userPubkey = null;
    }
}

// Renamed original function to focus on fetching
async function fetchNotes() {
    if (!statusDiv || !notesListDiv || !connectBtn) {
        console.error('Required HTML elements not found');
        return;
    }

    statusDiv.textContent = 'Status: Connecting & Fetching...';
    connectBtn.disabled = true;
    notesListDiv.innerHTML = ''; // Clear previous notes

    // Unsubscribe from previous notes subscription if it exists
    if (notesSubscription) {
        console.log('Unsubscribing from previous notes request.');
        notesSubscription.unsubscribe();
        notesSubscription = null;
    }

    try {
        // 2. Get a RelayGroup for the desired relays
        // Note: RelayPool doesn't require explicit connection beforehand.
        // Connections are managed internally when requests are made.
        // Relay group is already initialized globally
        console.log(`Using pre-initialized RelayGroup for: ${relays.join(', ')}`);

        // 3. Define the filter for the request
        const filters: Filter[] = [{
            kinds: [1],
            limit: 20, // Fetch latest 20 notes
        }];
        console.log('Requesting filters:', JSON.stringify(filters));

        // 4. Make the request and subscribe
        notesSubscription = relayGroup.req(filters).pipe(
            // Tap into the stream BEFORE the final subscription
            tap(response => {
                // Add events to the EventStore, ignore EOSE here
                if (typeof response !== 'string' && response?.kind !== undefined) {
                     // Basic validation before adding
                    if (response.content !== undefined && response.pubkey !== undefined && response.created_at !== undefined) {
                        console.log('Adding event to EventStore:', response.id);
                        eventStore.add(response as NostrEvent); // Corrected method name
                    } else {
                         console.warn('Received invalid event structure, not adding to store:', response);
                    }
                }
            })
        ).subscribe({ // Keep subscribe for EOSE, errors, completion
            next(response) {
                if (response === "EOSE") {
                    console.log('Received EOSE');
                    // You might receive EOSE from multiple relays in the group.
                    // Consider how to handle this - maybe update status only once.
                    if (statusDiv) statusDiv.textContent = 'Status: Feed Loaded (EOSE received)';
                    if (connectBtn) connectBtn.disabled = false; // Re-enable button after EOSE
                } else {
                    // Event processing is now handled in the 'tap' operator above.
                    // We only log receipt here for debugging if needed.
                    const event = response as NostrEvent;
                    console.log('Network received event:', event.id);
                    // DOM manipulation removed from here. It will be driven by QueryStore later.
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

// Initial setup: Attach NIP-07 connection handler first
if (connectBtn) {
    connectBtn.addEventListener('click', connectNip07);
} else {
    console.error('Connect button not found');
}

// --- Step 4: Fetching & Displaying Notes using QueryStore ---

// Define a function to check if a string contains only emojis and whitespace
// Basic check: Looks for characters outside common emoji ranges + whitespace. Needs refinement for comprehensive coverage.
// Source for regex idea: https://stackoverflow.com/questions/37621031/check-if-string-contains-only-emojis
const containsOnlyEmoji = (text: string): boolean => {
    if (!text) return false;
    // Remove variation selectors and ZWJ
    const stripped = text.replace(/[\uFE00-\uFE0F\u200D]/g, '');
    // Match common emoji ranges, pictographs, transport, regional indicators, and basic whitespace
    const emojiRegex = /^[\s\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+$/u;
    return emojiRegex.test(stripped);
};

// Create a query for kind:1 notes from the QueryStore
// Using SimpleQuery for basic event kind filtering
const notesQuery = queryStore.createQuery(TimelineQuery, [{ kinds: [1] }]); // Use TimelineQuery

// Subscribe to the query to update the UI
// TimelineQuery returns NostrEvent[]
notesQuery.subscribe((notes: NostrEvent[] | undefined) => { // Type includes undefined
    // Handle the undefined case
    if (notes === undefined) {
        console.log("TimelineQuery emitted undefined (potentially initial state or no matching events)");
        // Optionally clear the list or show a message if needed
        // if (notesListDiv) notesListDiv.innerHTML = 'No notes found yet.';
        return;
    }
    // Proceed if notes is an array
    if (!notesListDiv) return;
    console.log(`QueryStore updated with ${notes.length} kind:1 notes.`);

    // Clear the current list before rendering filtered notes
    notesListDiv.innerHTML = '';

    // Filter for emoji-only notes and sort by creation time (newest first)
    // Note: TimelineQuery should already return sorted events, but sorting again doesn't hurt
    const emojiNotes = notes
        .filter(event => containsOnlyEmoji(event.content))
        .sort((a, b) => b.created_at - a.created_at);

    console.log(`Rendering ${emojiNotes.length} emoji-only notes.`);

    // Render the filtered notes
    emojiNotes.forEach(event => {
        const noteElement = document.createElement('div');
        noteElement.classList.add('note');
        // Basic rendering - includes reply button now
        noteElement.innerHTML = `
            <p style="font-size: 1.5em;">${event.content}</p> <!-- Larger font for emojis -->
            <small>By: ${event.pubkey.substring(0, 8)}... at ${new Date(event.created_at * 1000).toLocaleString()}</small>
            <button class="reply-btn" data-event-id="${event.id}" data-pubkey="${event.pubkey}" title="Reply to this note">↩️ Reply</button>
        `;
        notesListDiv.appendChild(noteElement); // Append to keep order (or use insertBefore if needed)
    });
});

// Note: The actual fetching is triggered by fetchNotes() which calls group.req()
// The events flow: group.req() -> tap() -> eventStore.add() -> queryStore notifies -> notesQuery.subscribe() updates UI

// --- Step 5: Posting New Notes ---

// Function to handle sending a note
async function sendNote() {
    if (!composeInputDiv || !sendBtn || !nip07Signer || !userPubkey) {
        console.error("Cannot send note: Missing input, button, signer, or pubkey.");
        return;
    }

    const content = composeInputDiv.textContent?.trim() || '';
    if (!content) {
        alert("Cannot send empty note!");
        return;
    }
    // Basic check: Ensure it's likely only emojis before sending
    if (!containsOnlyEmoji(content)) {
         alert("Please send only emojis!");
         return;
    }


    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    console.log(`Attempting to send: ${content}`);

    try {
        // 1. Create Event Template
        const template: EventTemplate = {
            kind: 1,
            content: content,
            // Add reply tags if replyContext exists
            tags: replyContext
                ? [
                    ["e", replyContext.eventId, ""], // Simple 'e' tag
                    ["p", replyContext.pubkey, ""],   // Simple 'p' tag
                  ]
                : [], // Empty tags for a new note
            // Removed duplicate tags definition
            created_at: Math.floor(Date.now() / 1000),
        };

        // 2. Sign event using ExtensionSigner
        console.log("Signing event template:", template);
        const signedEvent = await nip07Signer.signEvent(template);
        console.log("Signed event:", signedEvent);

        // 3. Publish using applesauce-relay
        // relayGroup is now guaranteed to be initialized
        console.log("Publishing event via RelayGroup...");
        // The event() method returns an Observable. We need to subscribe to trigger it.
        // We'll use firstValueFrom to convert the Observable to a Promise that resolves
        // with the first emission (the PublishResponse).
        const publishResponse = await firstValueFrom(relayGroup.event(signedEvent));
        console.log("Publish response:", publishResponse);

        if (!publishResponse.ok) {
            throw new Error(`Failed to publish: ${publishResponse.message || 'Unknown relay error'}`);
        }

        console.log(`Published event ${signedEvent.id}`, replyContext ? `in reply to ${replyContext.eventId}` : '');
        composeInputDiv.textContent = ''; // Clear input on success
        replyContext = null; // Clear reply context after successful send
        // TODO: Update UI to remove reply indication if any was added

    } catch (error) {
        console.error("Error sending note:", error);
        alert(`Error sending note: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '➡️ Send';
    }
}

// Add event listener for the send button
if (sendBtn) {
    sendBtn.addEventListener('click', sendNote);
} else {
    console.error("Send button not found");
}

// Add event listener for the emoji panel (using event delegation)
if (emojiPanelDiv && composeInputDiv) {
    emojiPanelDiv.addEventListener('click', (e) => {
        const target = e.target as HTMLElement; // Cast target once
        // Check if target exists, is a SPAN, and has textContent
        if (target && target.tagName === 'SPAN' && target.textContent) {
            // Ensure composeInputDiv.textContent is treated as a string (even if initially null)
            composeInputDiv.textContent = (composeInputDiv.textContent || '') + target.textContent;
            // Optional: Focus input after adding emoji
            // composeInputDiv.focus();
        }
    });
} else {
    console.error("Emoji panel or compose input not found");
}

// --- Step 6: Replying to Notes ---

// Add event listener for reply buttons (using event delegation on notes list)
if (notesListDiv && composeInputDiv) {
    notesListDiv.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('reply-btn')) {
            const eventId = target.getAttribute('data-event-id');
            const pubkey = target.getAttribute('data-pubkey');

            if (eventId && pubkey) {
                replyContext = { eventId, pubkey };
                console.log('Set reply context:', replyContext);
                // Optional: Update UI to indicate a reply is being composed
                composeInputDiv.focus(); // Focus input for reply
                // You could add a visual indicator near the compose box
                alert(`Replying to note ${eventId.substring(0, 6)}... by ${pubkey.substring(0, 6)}...`); // Simple alert for now
            }
        }
    });
} else {
     console.error("Notes list or compose input not found for reply listener");
}
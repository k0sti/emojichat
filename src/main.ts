import { RelayPool, SubscriptionResponse, PublishResponse, completeOnEose } from 'applesauce-relay'; // Import needed types + completeOnEose
import { EventStore, QueryStore } from 'applesauce-core';
import { TimelineQuery } from 'applesauce-core/queries/simple';
import { getNip10References } from 'applesauce-core/helpers/threading'; // Import NIP-10 helper
import { NostrEvent, Filter, Event, EventTemplate } from 'nostr-tools';
import { tap } from 'rxjs/operators';
import { merge, of, catchError, retry, delay, timer } from 'rxjs'; // Import timer for retry delay
import { firstValueFrom } from 'rxjs'; // Import firstValueFrom
import { ExtensionSigner } from 'applesauce-signers'; // Import ExtensionSigner

console.log('EmojiChat Client Script Loaded');

// NIP-07 related variables
let userPubkey: string | null = null;
let nip07Signer: ExtensionSigner | null = null; // Use ExtensionSigner type

// Declare variables for DOM elements, but assign them inside DOMContentLoaded
let connectBtn: HTMLButtonElement | null = null;
let statusDiv: HTMLElement | null = null;
let notesListDiv: HTMLElement | null = null;
let composeAreaDiv: HTMLElement | null = null;
let composeInputDiv: HTMLElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let emojiPanelDiv: HTMLElement | null = null;
let userProfilePicContainer: HTMLElement | null = null; // For status bar profile pic
let mainContentDiv: HTMLElement | null = null; // Default parent for compose area
let cancelReplyContainer: HTMLElement | null = null; // Container for cancel button
const relays = ['wss://relay.nexel.space']; // Example relays

// 1. Initialize RelayPool
const pool = new RelayPool();
const eventStore = new EventStore();
const queryStore = new QueryStore(eventStore); // Link QueryStore to EventStore

let historySubscription: any | null = null; // For initial history
let liveSubscription: any | null = null; // For live updates
// Initialize the relay group immediately after the pool
const relayGroup = pool.group(relays);
console.log(`RelayGroup initialized immediately for: ${relays.join(', ')}`);
let replyContext: { eventId: string; pubkey: string } | null = null; // To store reply target
// Removed duplicate declaration
const requestedProfilePubkeys = new Set<string>(); // Track requested profile pubkeys
let profileSubscription: any | null = null; // To manage the profile request subscription

// Define ProfileData interface
interface ProfileData {
    picture?: string;
    name?: string;
    created_at?: number; // Add timestamp to compare events
}

// Profile Cache
const profileCache = new Map<string, ProfileData>();

// Function to handle NIP-07 connection
// --- DOM Ready Execution ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');

    // Assign DOM elements now that they exist
    connectBtn = document.getElementById('connectBtn') as HTMLButtonElement | null;
    statusDiv = document.getElementById('status');
    notesListDiv = document.getElementById('notes-list');
    composeAreaDiv = document.getElementById('compose-area');
    composeInputDiv = document.getElementById('compose-input');
    sendBtn = document.getElementById('sendBtn') as HTMLButtonElement | null;
    emojiPanelDiv = document.getElementById('emoji-panel');
    userProfilePicContainer = document.getElementById('user-profile-pic-container'); // Assign status bar container
    cancelReplyContainer = document.getElementById('cancel-reply-container'); // Assign cancel container
    mainContentDiv = document.querySelector('.main-content'); // Assign default parent for compose area

    // --- Status Bar Profile Pic Update ---
    function updateUserStatusBarProfilePic(pubkey: string) {
        if (userProfilePicContainer) {
            // console.log(`Updating status bar profile pic for ${pubkey.substring(0,6)}`);
            // Reuse existing helper, assuming styles are okay or handled by CSS
            const profileHtml = getProfileHtml(pubkey);
            userProfilePicContainer.innerHTML = profileHtml;
        } else {
            console.error("User profile pic container not found in status bar.");
        }
    }

    // --- NIP-07 Connection ---
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
        // connectBtn.textContent = 'Fetch Notes'; // No longer needed
        // Remove old listener, no need to add fetchNotes listener here
        connectBtn.removeEventListener('click', connectNip07);
        // connectBtn.addEventListener('click', fetchNotes); // Removed
        connectBtn.style.display = 'none'; // Hide the button after connection
        // connectBtn.disabled = false; // Button is hidden, disabled state irrelevant

        // Fetch notes immediately after successful connection
        fetchNotes(); // Fetch notes (which also triggers profile requests for authors)

        // Update status bar with initial (likely Robohash) profile pic
        updateUserStatusBarProfilePic(userPubkey);

        // Specifically request logged-in user's profile if not already requested by fetchNotes logic
        if (!requestedProfilePubkeys.has(userPubkey)) {
            console.log(`Requesting logged-in user's profile (${userPubkey.substring(0,6)}) specifically`);
            requestedProfilePubkeys.add(userPubkey); // Mark as requested
            const userProfileFilter: Filter[] = [{ kinds: [0], authors: [userPubkey], limit: 1 }];

            // Use a fire-and-forget request; relies on the main tap operator to process the result
             relayGroup.req(userProfileFilter).pipe(
                 // @ts-ignore - Suppressing RxJS version conflict error
                 tap((response: any) => { // Use 'any' as workaround for RxJS type conflict
                    // Add events to the EventStore AND update cache
                    if (typeof response !== 'string' && response?.kind === 0) { // Process only Kind 0 here
                         // Basic validation before adding
                        if (response.content !== undefined && response.pubkey !== undefined && response.created_at !== undefined) {
                            const event = response as NostrEvent;
                            eventStore.add(event); // Add to store regardless of cache comparison

                            // Update profile cache - only update if newer than cached
                            try {
                                const existingCachedProfile = profileCache.get(event.pubkey);
                                const cachedTimestamp = existingCachedProfile?.created_at ?? 0; // Get timestamp from cache

                                // Only parse and update cache if the incoming event is newer
                                if (event.created_at >= cachedTimestamp) { // Use >= to handle first event
                                     const profileContent: ProfileData = JSON.parse(event.content);
                                     // console.log(`Updating profile cache for ${event.pubkey.substring(0,6)} with event ${event.id} (ts: ${event.created_at})`);
                                     profileCache.set(event.pubkey, {
                                         picture: profileContent.picture,
                                         name: profileContent.name,
                                         created_at: event.created_at // Store timestamp in cache
                                     });
                                     // If this profile update is for the logged-in user, update the status bar pic
                                     if (event.pubkey === userPubkey) {
                                         updateUserStatusBarProfilePic(userPubkey);
                                     }
                                }
                            } catch (e) {
                                 console.warn(`Failed to parse profile content for event ${event.id}:`, e);
                            }
                        } else {
                             console.warn('Received invalid profile event structure, not adding to store:', response);
                        }
                    } // Ignore non-Kind 0 events from this request
                })
             ).subscribe({ // Minimal subscriber just to trigger the request
                 error: (err: any) => console.error("Error fetching logged-in user profile:", err)
             });
        }
        // Show compose area after connecting by appending it to main content
        if (mainContentDiv && composeAreaDiv) {
            composeAreaDiv.style.display = 'flex'; // Use flex to align items
            mainContentDiv.appendChild(composeAreaDiv);
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

    // Unsubscribe from previous subscriptions if they exist
    if (historySubscription) {
        console.log('Unsubscribing from previous history request.');
        historySubscription.unsubscribe();
        historySubscription = null;
    }
    if (liveSubscription) {
        console.log('Unsubscribing from previous live request.');
        liveSubscription.unsubscribe();
        liveSubscription = null;
    }

    try {
        // 2. Get a RelayGroup for the desired relays
        // Note: RelayPool doesn't require explicit connection beforehand.
        // Connections are managed internally when requests are made.
        // Relay group is already initialized globally
        console.log(`Using pre-initialized RelayGroup for: ${relays.join(', ')}`);

        // 3. Define filters for history and live updates
        const historyLimit = 20;
        const historyFilter: Filter[] = [{
            kinds: [1],
            limit: historyLimit,
        }];
        const liveFilter: Filter[] = [{
            kinds: [1],
            // No limit, no since - just live kind 1
        }];

        // console.log('Requesting history filter:', JSON.stringify(historyFilter)); // Removed debug log
        // console.log('Requesting live filter:', JSON.stringify(liveFilter)); // Removed debug log

        // Shared tap operator for adding events to the store
        const storeEventTap = tap((response: any) => { // Use 'any' as workaround
            // Check if it's a valid NostrEvent object before adding
            if (typeof response === 'object' && response?.id && response.kind !== undefined && response.pubkey && response.created_at !== undefined && response.content !== undefined) {
                // console.log(`[storeEventTap] Adding event: ${response.id}`); // Removed debug log
                eventStore.add(response as NostrEvent);
            } else if (typeof response !== 'string' && response !== 'EOSE') {
                 // Log if it's not a string, not EOSE, and not a valid event structure
                 console.warn('Received invalid event structure, not adding to store:', response);
            }
        });

        // 4a. Make the history request using RelayGroup (completes on EOSE)
        historySubscription = relayGroup.req(historyFilter).pipe(
            // @ts-ignore - Suppressing RxJS version conflict error
            storeEventTap,
            completeOnEose()
        ).subscribe({
            next: (response) => {
                console.log('History received event:', (response as NostrEvent).id);
            },
            error: (err: any) => {
                console.error('History subscription error:', err);
                if (statusDiv) statusDiv.textContent = `Status: History Error - ${err.message || 'Subscription failed'}`;
            },
            complete: () => {
                console.log('History subscription completed after EOSE.');
                if (statusDiv) statusDiv.textContent = 'Status: History Loaded, Listening for Live...';
            }
        });

        // 4b. Manually create and merge live subscriptions for each relay
        const liveRelayStreams = relayGroup.relays.map(relay =>
            relay.req(liveFilter).pipe(
                // @ts-ignore - Suppressing RxJS version conflict error
                storeEventTap, // Add events to store
                // Removed catchError, using retry instead
                retry({ // Add retry logic
                    delay: (error: any, retryCount: number) => { // Add types
                        console.warn(`Live subscription error for ${relay.url} (retry ${retryCount}):`, error);
                        console.log(`Retrying connection to ${relay.url} in 5 seconds...`);
                        return timer(5000); // Use timer for delay
                    }
                })
            )
        );
// @ts-ignore - Suppressing RxJS version conflict error for merge
liveSubscription = merge(...liveRelayStreams).subscribe({
        // Removed duplicate line
             next: (response: any) => {
                 // We only care about events here, EOSE is not relevant for the merged stream
                 if (typeof response !== 'string') {
                     console.log('Live received event:', (response as NostrEvent).id);
                     // Update status only once after history is done
                     if (statusDiv && statusDiv.textContent?.includes('Listening')) {
                         statusDiv.textContent = 'Status: Live Feed Active';
                     }
                 }
                 // Individual relay EOSEs are ignored by this subscriber
             },
             error: (err: any) => {
                 // This error handler might not be reached if individual streams handle errors
                 console.error('Merged live subscription error (unexpected):', err);
                 if (statusDiv) statusDiv.textContent = `Status: Live Feed Error - ${err.message || 'Subscription failed'}`;
             },
             complete: () => {
                 // This should not complete unless all relays disconnect AND handle errors with of()
                 console.log('Merged live subscription stream completed (unexpected?).');
                 if (statusDiv) statusDiv.textContent = 'Status: Live Feed Disconnected';
             }
         });

        // Removed separate live subscription block
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
        console.error('Connect button not found after DOMContentLoaded');
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

// Helper function to get profile HTML using cache
function getProfileHtml(pubkey: string): string {
    const profileData = profileCache.get(pubkey);
    let pictureUrl: string | undefined = profileData?.picture;

    // console.log(`Cache check for ${pubkey.substring(0,6)}:`, profileData); // Debug log

    const fallbackUrl = `https://robohash.org/${pubkey}`;
    // Ensure pictureUrl is a non-empty string before using it
    const finalUrl = (pictureUrl && pictureUrl.trim() !== '') ? pictureUrl.trim() : fallbackUrl;

    // Use the same class as the original placeholder for styling consistency
    // Added inline styles matching original div and object-fit: cover
    return `<img src="${finalUrl}" alt="Profile for ${pubkey.substring(0, 6)}" class="profile-pic" style="width: 30px; height: 30px; border-radius: 50%; margin-right: 10px; object-fit: cover;">`;
}


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
    // *** ADDED LOGGING ***
    // console.log('Raw notes received by notesQuery.subscribe:', JSON.stringify(notes.map(n => ({id: n.id, content: n.content, created_at: n.created_at})), null, 2)); // Removed debug log

    if (!notesListDiv) return; // Keep this check

    // --- Fetch Profile Data Logic ---
    const currentPubkeys = new Set(notes.map(note => note.pubkey));
    const newPubkeysToFetch = [...currentPubkeys].filter(pk => !requestedProfilePubkeys.has(pk));

    if (newPubkeysToFetch.length > 0) {
        console.log(`Requesting Kind 0 profiles for ${newPubkeysToFetch.length} new pubkeys:`, newPubkeysToFetch.map(pk => pk.substring(0,6)));
        newPubkeysToFetch.forEach(pk => requestedProfilePubkeys.add(pk)); // Add immediately to prevent re-requesting

        const profileFilter: Filter[] = [{
            kinds: [0],
            authors: newPubkeysToFetch,
        }];

        // Unsubscribe from previous profile request if any
        // Note: This simple unsub/resub might cause UI flicker if profiles arrive slowly.
        // A more robust solution might manage subscriptions per pubkey or use a different query pattern.
        if (profileSubscription) {
             console.log('Unsubscribing from previous profile request.');
             profileSubscription.unsubscribe();
             profileSubscription = null;
        }


        // Make the request for profiles, pipe through tap operator to update cache and store
        profileSubscription = relayGroup.req(profileFilter).pipe(
             // @ts-ignore - Suppressing RxJS version conflict error
             tap((response: any) => { // Use 'any' as workaround for RxJS type conflict
                // Add events to the EventStore AND update cache
                if (typeof response !== 'string' && response?.kind === 0) { // Process only Kind 0 here
                     // Basic validation before adding
                    if (response.content !== undefined && response.pubkey !== undefined && response.created_at !== undefined) {
                        const event = response as NostrEvent;
                        eventStore.add(event); // Add to store regardless of cache comparison

                        // Update profile cache - only update if newer than cached
                        try {
                            const existingCachedProfile = profileCache.get(event.pubkey);
                            const cachedTimestamp = existingCachedProfile?.created_at ?? 0; // Get timestamp from cache

                            // Only parse and update cache if the incoming event is newer
                            if (event.created_at >= cachedTimestamp) { // Use >= to handle first event
                                 const profileContent: ProfileData = JSON.parse(event.content);
                                 // console.log(`Updating profile cache for ${event.pubkey.substring(0,6)} with event ${event.id} (ts: ${event.created_at})`);
                                 profileCache.set(event.pubkey, {
                                     picture: profileContent.picture,
                                     name: profileContent.name,
                                     created_at: event.created_at // Store timestamp in cache
                                 });
                                 // If this profile update is for the logged-in user, update the status bar pic
                                 if (event.pubkey === userPubkey) {
                                     updateUserStatusBarProfilePic(userPubkey);
                                 }
                                 // UI refresh for notes list happens when notesQuery emits.
                        } else {
                                 // console.log(`Ignoring older profile event ${event.id} for ${event.pubkey.substring(0,6)}`);
                            }

                        } catch (e) {
                             console.warn(`Failed to parse profile content for event ${event.id}:`, e);
                        }

                    } else {
                         console.warn('Received invalid profile event structure, not adding to store:', response);
                    }
                } // Ignore non-Kind 0 events from this request
            })
        ).subscribe({
            next: (response: any) => { // Use any
                if (response === "EOSE") {
                    console.log(`Profile request EOSE received for authors: ${newPubkeysToFetch.map(pk => pk.substring(0,6))}`);
                }
                // Event processing happens in tap
            },
            error: (err: any) => { // Use any
                console.error('Profile subscription error:', err);
            },
            complete: () => {
                console.log('Profile subscription stream completed.');
            }
        });
    }
    // --- End Fetch Profile Data Logic ---

    // console.log(`QueryStore updated with ${notes.length} kind:1 notes.`); // Removed debug log

    // Clear the current list before rendering filtered notes
    notesListDiv.innerHTML = '';

    // Filter for emoji-only notes and sort by creation time (newest first)
    // Note: TimelineQuery should already return sorted events, but sorting again doesn't hurt
    const emojiNotes = notes
        .filter(event => containsOnlyEmoji(event.content))
        .sort((a, b) => b.created_at - a.created_at);

    // console.log(`Rendering ${emojiNotes.length} emoji-only notes.`); // Removed debug log

    // *** ADDED NULL CHECK *** (Keep this one)
    if (!notesListDiv) {
        console.error("notesListDiv is null inside notesQuery subscription, cannot render notes.");
        return;
    }

    // --- Threading Logic ---
    const notesById = new Map<string, NostrEvent>();
    const repliesByParentId = new Map<string, string[]>();
    const replyIds = new Set<string>();

    emojiNotes.forEach(note => {
        notesById.set(note.id, note);
        const refs = getNip10References(note);
        // Use the direct reply ("e" tag) as parent, ignore "a" tags for simplicity
        const parentId = refs.reply?.e?.id;

        if (parentId) {
            replyIds.add(note.id);
            if (!repliesByParentId.has(parentId)) {
                repliesByParentId.set(parentId, []);
            }
            repliesByParentId.get(parentId)!.push(note.id);
        }
    });

    // Identify top-level notes (not replies to other notes in this set)
    const topLevelNotes = emojiNotes
        .filter(note => !replyIds.has(note.id))
        .sort((a, b) => b.created_at - a.created_at); // Sort newest first

    // Recursive rendering function
    const renderNoteAndReplies = (noteId: string, level: number) => {
        const note = notesById.get(noteId);
        if (!note || !notesListDiv) return; // Check notesListDiv again just in case

        const noteElement = document.createElement('div');
        noteElement.classList.add('message');
        noteElement.style.marginLeft = `${level * 30}px`; // Apply indentation

        const profileHtml = getProfileHtml(note.pubkey);
        noteElement.innerHTML = `
            ${profileHtml}
            <div class="message-content">${note.content}</div>
            <div class="message-actions">
                 <button class="reply-btn" data-event-id="${note.id}" data-pubkey="${note.pubkey}">↩️</button> <!-- Title already removed -->
            </div>
        `;
        notesListDiv.appendChild(noteElement);

        // Render replies
        const childIds = repliesByParentId.get(noteId);
        if (childIds) {
            // Sort replies chronologically within the thread
            const sortedChildIds = childIds.sort((aId, bId) => {
                const aNote = notesById.get(aId);
                const bNote = notesById.get(bId);
                return (aNote?.created_at ?? 0) - (bNote?.created_at ?? 0);
            });
            sortedChildIds.forEach(replyId => renderNoteAndReplies(replyId, level + 1));
        }
    };

    // Clear the list and render threads starting from top-level notes
    // notesListDiv.innerHTML = ''; // Already cleared earlier
    topLevelNotes.forEach(note => renderNoteAndReplies(note.id, 0));
});

// Note: The actual fetching is triggered by fetchNotes() which calls group.req()
// The events flow: group.req() -> tap() -> eventStore.add() -> queryStore notifies -> notesQuery.subscribe() updates UI

// --- Step 5: Posting New Notes ---

// Function to handle sending a note
    // --- Posting New Notes ---
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
    sendBtn.textContent = ''; // Clear icon before showing spinner
    sendBtn.classList.add('sending'); // Add spinner class
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
        // console.log("Signing event template:", template); // Removed debug log
        const signedEvent = await nip07Signer.signEvent(template);
        // console.log("Signed event:", signedEvent); // Removed debug log

        // 3. Publish using applesauce-relay
        // relayGroup is now guaranteed to be initialized
        console.log("Publishing event via RelayGroup...");
        // The event() method returns an Observable. We need to subscribe to trigger it.
        // We'll use firstValueFrom to convert the Observable to a Promise that resolves
        // with the first emission (the PublishResponse).
        // Use 'any' workaround for firstValueFrom type conflict
        const publishResponse = await firstValueFrom(relayGroup.event(signedEvent) as any) as PublishResponse;
        // console.log("Publish response:", publishResponse); // Removed debug log

        // Check publishResponse properties
        if (!publishResponse.ok) {
            throw new Error(`Failed to publish: ${publishResponse.message || 'Unknown relay error'}`);
        }

        console.log(`Published event ${signedEvent.id}`, replyContext ? `in reply to ${replyContext.eventId}` : '');
        composeInputDiv.textContent = ''; // Clear input on success
        // Move compose area back to default position
        // Move compose area back to default position and reset UI
        if (mainContentDiv && composeAreaDiv) {
            mainContentDiv.appendChild(composeAreaDiv);
        }
        updateComposeUI(false); // Reset button icon and hide cancel button
        replyContext = null; // Clear reply context after successful send
        // TODO: Update UI to remove reply indication if any was added

    } catch (error) {
        console.error("Error sending note:", error);
        alert(`Error sending note: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending'); // Remove spinner class
        // Icon is restored by updateComposeUI called in sendNote success path
    }
    }

    // Add event listener for the send button
    if (sendBtn) {
        sendBtn.addEventListener('click', sendNote);
    } else {
        console.error("Send button not found after DOMContentLoaded");
    }

    // Add event listener for the emoji panel (using event delegation)
    if (emojiPanelDiv && composeInputDiv) {
        emojiPanelDiv.addEventListener('click', (e) => {
            const target = e.target as HTMLElement; // Cast target once
            // Check if target exists, is a SPAN, and has textContent
            if (target && target.tagName === 'SPAN' && target.textContent) {
                // Ensure composeInputDiv.textContent is treated as a string (even if initially null)
                // Need to check composeInputDiv again inside the listener as it might be null initially
                const currentComposeInput = document.getElementById('compose-input');
                if (currentComposeInput) {
                    currentComposeInput.textContent = (currentComposeInput.textContent || '') + target.textContent;
                    // Optional: Focus input after adding emoji
                    // currentComposeInput.focus();
                }
            }
        });
    } else {
        console.error("Emoji panel or compose input not found after DOMContentLoaded");
    }

// --- UI Update Function ---
function updateComposeUI(isReplying: boolean) {
    if (!sendBtn || !cancelReplyContainer) return;

    if (isReplying) {
        sendBtn.textContent = '↩️'; // Reply icon
        sendBtn.title = 'Send Reply';

        // Create and add cancel button if it doesn't exist
        if (!cancelReplyContainer.querySelector('.cancel-reply-btn')) {
            const cancelButton = document.createElement('button');
            cancelButton.textContent = '❌';
            cancelButton.title = 'Cancel Reply';
            cancelButton.classList.add('cancel-reply-btn');
            cancelButton.addEventListener('click', () => {
                replyContext = null; // Clear reply context
                updateComposeUI(false); // Reset UI
                // Move compose area back to default
                if (mainContentDiv && composeAreaDiv) {
                    mainContentDiv.appendChild(composeAreaDiv);
                }
                if (composeInputDiv) composeInputDiv.textContent = ''; // Clear input
            });
            cancelReplyContainer.appendChild(cancelButton);
        }
        cancelReplyContainer.style.display = 'inline'; // Show container
    } else {
        sendBtn.textContent = '➡️'; // Default send icon
        sendBtn.title = 'Send';
        // Remove cancel button and hide container
        cancelReplyContainer.innerHTML = ''; // Clear container
        cancelReplyContainer.style.display = 'none'; // Hide container
    }
}


// --- Step 6: Replying to Notes ---

// Add event listener for reply buttons (using event delegation on notes list)
    // --- Replying to Notes ---
    if (notesListDiv && composeInputDiv && composeAreaDiv) { // Ensure composeAreaDiv exists
        notesListDiv.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('reply-btn')) {
                const eventId = target.getAttribute('data-event-id');
                const pubkey = target.getAttribute('data-pubkey');
                const messageElement = target.closest('.message'); // Find the parent message div

                if (eventId && pubkey && messageElement && composeAreaDiv) {
                    replyContext = { eventId, pubkey };

                    // Move compose area below the message being replied to
                    messageElement.insertAdjacentElement('afterend', composeAreaDiv);
                    updateComposeUI(true); // Update button icon and show cancel button

                    // Focus input
                     const currentComposeInput = document.getElementById('compose-input');
                     if (currentComposeInput) {
                        currentComposeInput.focus();
                     }
                }
            }
        });
    } else {
         console.error("Required elements (notesListDiv, composeInputDiv, composeAreaDiv) not found for reply listener setup.");
    }

}); // End of DOMContentLoaded listener
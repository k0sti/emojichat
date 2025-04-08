# EmojiChat Implementation Plan (Applesauce Only)

This plan outlines the steps to implement the EmojiChat Nostr client using only Applesauce library components (`applesauce-core` and `applesauce-relay`).

## 1. Setup & Dependencies

*   Confirm necessary dependencies are installed: `applesauce-core`, `applesauce-relay`, `nostr-tools`, `rxjs`. (Verified via `package.json`).

## 2. Refactor `src/main.ts` Core Logic

*   Keep the `applesauce-relay` (`RelayPool`) initialization from the existing `src/main.ts`.
*   **Initialize `applesauce-core`:**
    *   Create a single `EventStore` instance.
    *   Create a `QueryStore` instance linked to the `EventStore`.
*   **Connect `applesauce-relay` Subscription to `EventStore`:**
    *   When fetching notes using `RelayPool.group(relays).req(filters)`, take the resulting RxJS observable.
    *   Pipe the `NostrEvent` objects emitted by this observable into `eventStore.addEvent()`.
    *   Handle EOSE messages within the subscription logic (e.g., for status updates).

## 3. Authentication (NIP-07 Integration)

*   Add UI elements (e.g., a "Connect" button) to `index.html`.
*   Implement logic in `src/main.ts` to:
    *   Detect a NIP-07 browser extension (e.g., `window.nostr`).
    *   On button click, request the user's public key (`getPublicKey()`) and signing capabilities (`signEvent()`).
    *   Store the retrieved `pubkey` and the NIP-07 signer object (`window.nostr`).
    *   Update the UI to show connected status (e.g., display pubkey or profile pic placeholder).

## 4. Fetching & Displaying Notes

*   Define Nostr filters using `nostr-tools` syntax (e.g., `[{ kinds: [1], limit: 50 }]`).
*   Use `RelayPool.group(relays).req(filters)` to create the subscription for fetching notes.
*   (Events will automatically flow into the `EventStore` via the pipeline set up in Step 2).
*   Create an `applesauce` query using `QueryStore.createQuery()` to observe `kind:1` events from the store.
*   Subscribe to this query in the UI rendering logic within `src/main.ts`.
*   **Render Notes (UI Logic):**
    *   Inside the query subscription, filter the received `NostrEvent` objects: check if `event.content` contains *only* emojis (using a suitable regex or character check).
    *   For valid emoji notes, update the DOM (e.g., the `#notes-list` div in `index.html`). Include:
        *   User profile picture placeholder.
        *   The emoji content.
        *   A 'Reply' button storing the note's ID and author pubkey (e.g., in data attributes).

## 5. Posting New Notes

*   Implement UI logic for the emoji panel and compose input area in `index.html` and `src/main.ts`.
*   On 'Send' button click:
    *   Retrieve selected emojis from the input area.
    *   Use `nostr-tools` (`finalizeEvent`) to construct a `kind:1` event object, passing the emojis as content and using the stored NIP-07 signer.
    *   **Publish using `applesauce-relay`:** Use the appropriate method from `RelayPool` or `RelayGroup` to publish the finalized event (e.g., `group.publish(signedEvent)` - *exact method needs confirmation during implementation*).

## 6. Replying to Notes

*   Add event listeners to 'Reply' buttons. When clicked, store the target event's ID and author pubkey. Update UI to indicate reply context.
*   On 'Send' (in reply context):
    *   Retrieve selected emojis.
    *   Use `nostr-tools` (`finalizeEvent`) to construct the `kind:1` reply event, adding appropriate `e` (event ID) and `p` (pubkey) tags. Sign using NIP-07.
    *   **Publish reply using `applesauce-relay`**.

## 7. UI Structure Alignment

*   Modify `index.html` to include necessary elements:
    *   Container for the notes feed (`#notes-list`).
    *   Compose area with input and send button.
    *   Emoji selection panel.
    *   Connect button (`#connectBtn`).
    *   Status display area (`#status`).
    *   Ensure IDs match those used in `src/main.ts`. Draw inspiration from `design/page.html` for layout.

## Architecture Diagram

```mermaid
graph LR
    subgraph UI Layer (index.html + main.ts DOM manipulation)
        ConnectButton --> NIP07Interface[NIP-07 Interface]
        FeedView -- subscribes --> QueryStore
        ComposeView --> SignerInterface
        ComposeView --> PublishInterface
    end

    subgraph Application Logic (main.ts - Applesauce Core + Relay + RxJS)
        NIP07Interface -- interacts --> NIP07Extension[NIP-07 Browser Ext]
        QueryStore -- reads --> EventStore
        EventStore -- receives events from pipe --> RelaySubscription[RelayGroup.req() Observable]
        SignerInterface -- uses --> NIP07Interface
        PublishInterface -- uses --> ApplesauceRelay[applesauce-relay API]
    end

    subgraph Networking Layer (applesauce-relay)
        RelaySubscription -- created by --> ApplesauceRelay
        ApplesauceRelay -- connects/subscribes/publishes --> Relays
    end

    subgraph External
        Relays
        NIP07Extension
    end

    QueryStore -- creates queries for --> FeedView
    SignerInterface -- gets signature from --> NIP07Interface
    PublishInterface -- sends event via --> ApplesauceRelay
    RelaySubscription -- pipes events to --> EventStore
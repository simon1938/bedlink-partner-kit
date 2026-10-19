import { randomUUID } from "node:crypto";
import { bedlink } from "./client";
import { store as defaultStore, type BedlinkStore } from "./store";

// Planned feature "messages": one thread per reservation, the same in BedLink
// and on your side. What you post appears in the host's BedLink inbox; what
// the host (or a BedLink automatic message) writes reaches you through the
// message.created webhook, and syncThread() as a catch-up.
// Never re-post a message whose source is "bedlink": that would loop.

export function createMessages(store: BedlinkStore = defaultStore) {
  return {
    /** sender "guest": the traveller writes on your site. "host": the host answers from your tool. */
    async send(reservationId: string, sender: "guest" | "host", body: string, externalId: string = `msg_${randomUUID()}`) {
      const message = await bedlink.sendMessage(reservationId, { externalId, sender, body: body.slice(0, 5000) });
      await store.upsertMessage(message);
      return message;
    },

    async syncThread(reservationId: string) {
      let cursor: string | null = null;
      do {
        const page = await bedlink.listMessages(reservationId, cursor);
        for (const m of page.messages) await store.upsertMessage(m);
        cursor = page.hasMore ? page.nextCursor : null;
      } while (cursor);
    },
  };
}

export const messages = createMessages();

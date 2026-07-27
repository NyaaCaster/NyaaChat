import type { Message } from "../types";

/**
 * Index of the last extracted-batch boundary, or -1 when the session has none.
 * Scans backwards: the newest marker is the effective boundary, so multiple
 * batches collapse to a single cut point without needing them to be ordered.
 */
export function findBoundaryIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].memoryBatchSeq !== undefined) return i;
  }
  return -1;
}

/** Messages that should actually be sent as history. */
export function messagesAfterBoundary(messages: Message[]): Message[] {
  const idx = findBoundaryIndex(messages);
  return idx < 0 ? messages : messages.slice(idx + 1);
}

/** All batch sequence numbers present in this session, ascending. */
export function extractedBatchSeqs(messages: Message[]): number[] {
  return messages
    .map((m) => m.memoryBatchSeq)
    .filter((s): s is number => s !== undefined)
    .sort((a, b) => a - b);
}

/** Next batch sequence number for this session (1-based). */
export function nextBatchSeq(messages: Message[]): number {
  const seqs = extractedBatchSeqs(messages);
  return seqs.length === 0 ? 1 : seqs[seqs.length - 1] + 1;
}

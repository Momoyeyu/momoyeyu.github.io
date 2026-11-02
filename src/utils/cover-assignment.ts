import { createHash } from "node:crypto";

const rank = (seed: string) => createHash("sha256").update(seed).digest("hex");

/** Deal shuffled decks without replacement, so usage differs by at most one. */
export function allocateCovers(postIds: string[], covers: string[]): Map<string, string> {
    const result = new Map<string, string>();
    if (!covers.length) return result;
    for (let start = 0, round = 0; start < postIds.length; start += covers.length, round++) {
        const deck = [...covers].sort((a, b) => rank(`${round}:${a}`).localeCompare(rank(`${round}:${b}`)));
        for (let i = 0; i < deck.length && start + i < postIds.length; i++) result.set(postIds[start + i], deck[i]);
    }
    return result;
}

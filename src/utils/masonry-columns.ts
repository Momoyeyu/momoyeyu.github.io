/** Balance two columns without changing order within either column. */
export function balanceColumns(heights: number[]): number[][] {
    if (heights.length < 2) return [heights.map((_, i) => i), []];
    if (heights.length > 16) {
        const columns: number[][] = [[], []], totals = [0, 0];
        heights.forEach((height, i) => { const side = totals[0] <= totals[1] ? 0 : 1; columns[side].push(i); totals[side] += height; });
        return columns;
    }
    const total = heights.reduce((sum, height) => sum + height, 0);
    let bestMask = 1, bestDifference = Infinity;
    for (let mask = 1; mask < (1 << heights.length) - 1; mask += 2) {
        const left = heights.reduce((sum, height, i) => sum + ((mask & (1 << i)) ? height : 0), 0);
        const difference = Math.abs(total - 2 * left);
        if (difference < bestDifference) { bestDifference = difference; bestMask = mask; }
    }
    return [heights.flatMap((_, i) => bestMask & (1 << i) ? [i] : []), heights.flatMap((_, i) => bestMask & (1 << i) ? [] : [i])];
}

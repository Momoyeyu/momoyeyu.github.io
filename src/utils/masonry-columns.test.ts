import { expect, it } from "vitest";
import { balanceColumns } from "./masonry-columns";
it("balances mixed cover heights, retaining each item exactly once and in column order", () => {
    const heights = [800, 700, 600, 500, 400];
    const columns = balanceColumns(heights);
    expect(columns.map(column => column.reduce((sum, i) => sum + heights[i], 0))).toEqual([1500, 1500]);
    expect(columns.flat().sort((a,b)=>a-b)).toEqual([0,1,2,3,4]);
    expect(columns[0][0]).toBe(0);
    for (const column of columns) expect(column).toEqual([...column].sort((a,b)=>a-b));
    expect(balanceColumns([])).toEqual([[], []]);
    expect(balanceColumns([1])).toEqual([[0], []]);
});

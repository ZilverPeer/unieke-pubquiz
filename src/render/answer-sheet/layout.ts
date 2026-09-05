/** Shared page geometry for the Answer sheet: an A4 page tiled into a 2x4 grid. */

/** A4 page size in points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

/** Small outer margin so cut lines never sit flush against the paper edge. */
export const PAGE_MARGIN = 10;

export const GRID_ROWS = 4;
export const GRID_COLUMNS = 2;

export const ROW_HEIGHT = (PAGE_HEIGHT - PAGE_MARGIN * 2) / GRID_ROWS;
export const CELL_WIDTH = (PAGE_WIDTH - PAGE_MARGIN * 2) / GRID_COLUMNS;

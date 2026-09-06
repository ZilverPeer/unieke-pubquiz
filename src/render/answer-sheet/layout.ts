/**
 * Shared page geometry for the Answer sheet: a landscape A4 page tiled into
 * a 2-column x 4-row grid — six Text Round cells (two per row, three rows)
 * plus one Music Round row spanning both columns.
 *
 * Landscape (width and height of portrait A4 swapped) makes each column
 * wide (~411pt) so the Round heading and the "Teamnaam" field fit on one
 * line even with a long Category name, while each row is shorter
 * (~144pt) than in the old portrait grid. That's still enough room for a
 * Text Round's 10 answer rows stacked in a single column at a small font,
 * and for the Music Round's two columns of five two-line (Artist/Title)
 * entries, because the Music Round row spans the full page width, so
 * neither section needs more vertical space per row than before.
 */

/** A4 page size in points, landscape (width and height swapped from portrait). */
export const PAGE_WIDTH = 841.89;
export const PAGE_HEIGHT = 595.28;

/** Small outer margin so cut lines never sit flush against the paper edge. */
export const PAGE_MARGIN = 10;

export const GRID_ROWS = 4;
export const GRID_COLUMNS = 2;

export const ROW_HEIGHT = (PAGE_HEIGHT - PAGE_MARGIN * 2) / GRID_ROWS;
export const CELL_WIDTH = (PAGE_WIDTH - PAGE_MARGIN * 2) / GRID_COLUMNS;

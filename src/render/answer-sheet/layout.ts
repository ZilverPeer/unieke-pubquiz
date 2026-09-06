/**
 * Shared page geometry for the Answer sheet: a landscape A4 page tiled into
 * a 4-column x 2-row grid (~205pt wide x ~288pt tall cells) — six Text
 * Round cells (four in row 1, two in row 2) plus one Music Round cell in
 * row 2 spanning the remaining two columns (~411pt wide).
 *
 * A 2-column x 4-row grid (the first landscape attempt) was rejected: it
 * gave Text Round cells ~411pt of width — far more than the single answer
 * column needs — and only ~144pt of height for ten stacked answer rows, an
 * unusable ~11pt row pitch. Rotating to 4 columns x 2 rows trades that
 * unused width for height: ~288pt is enough for a legible ~25pt pitch
 * across ten rows (or across the Music Round's two-line entries), and
 * ~205pt is still wide enough for the Round heading and the "Teamnaam"
 * field to usually share one line (see TextRoundSection's header layout
 * for the fallback when a long Category name doesn't fit).
 */

/** A4 page size in points, landscape (width and height swapped from portrait). */
export const PAGE_WIDTH = 841.89;
export const PAGE_HEIGHT = 595.28;

/** Small outer margin so cut lines never sit flush against the paper edge. */
export const PAGE_MARGIN = 10;

export const GRID_ROWS = 2;
export const GRID_COLUMNS = 4;

export const ROW_HEIGHT = (PAGE_HEIGHT - PAGE_MARGIN * 2) / GRID_ROWS;
export const CELL_WIDTH = (PAGE_WIDTH - PAGE_MARGIN * 2) / GRID_COLUMNS;

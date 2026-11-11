import { along, area, boxOf, distanceTo, insideOf, length, pathPieces, subpathsOf } from "./geometry.js";
/** Stroke-drawing recipes have nothing to draw on a filled shape, so solid shapes pop in instead. */
export const SOLID_FALLBACK = { draw: "pop", drawBack: "pop", drawOut: "pop", redraw: "pop" };
/** The solid drawing of an icon: its designed `solid` list, or the one `autoSolid` derives from the outline. */
export const solidNodes = (data) => data.solid ?? autoSolid(data.nodes, data.text ? "text" : data.key.startsWith("brand-") ? "wordmark" : undefined);
/**
 * SVG closes an open run when filling it, so some open runs fill like closed ones: a bell whose ends meet, a half sun
 * (an upright or level half arc becomes a half disc), a user's shoulders, and a van body whose open side is bridged by other strokes (its wheels).
 * Arches left open (a letter A, a U-turn arrow) and longer arcs (a spinner, which would become a pie slice) stay lines.
 */
function encloses({ points, closed, curved, bent }, others) {
    const enclosed = area(points);
    if (closed)
        return enclosed > 0.5;
    if (enclosed < 8)
        return false;
    const [x0, y0] = points[0];
    const [x1, y1] = points[points.length - 1];
    const gap = Math.hypot(x1 - x0, y1 - y0);
    if (gap <= 2)
        return true;
    if (curved)
        return Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) < 0.5 && enclosed >= 0.3 * gap * gap && enclosed <= 0.5 * gap * gap;
    // Shoulders standing on the bottom edge (a user's body) are open only along the edge.
    if (bent && Math.abs(y1 - y0) < 0.5 && y0 >= 20.5 && gap >= 8) {
        const height = y0 - Math.min(...points.map(([, y]) => y));
        if (height > 3 && height < 0.8 * gap)
            return true;
    }
    if (gap > 0.45 * length(points))
        return false;
    let bridged = 0;
    for (let k = 1; k < 10; k++) {
        const p = [x1 + ((x0 - x1) * k) / 10, y1 + ((y0 - y1) * k) / 10];
        if (others.some((o) => distanceTo(p, o) <= 1.6))
            bridged++;
    }
    return bridged >= 7;
}
const inside = (a, b) => a.x0 >= b.x0 - 0.01 && a.y0 >= b.y0 - 0.01 && a.x1 <= b.x1 + 0.01 && a.y1 <= b.y1 + 0.01;
const boxArea = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
/**
 * Without a designed solid drawing: shapes that enclose an area are filled, a filled shape lying inside a larger one
 * (a keyhole, a badge star) is cut out of it, and everything else is a line.
 * Each run of a path is its own shape, so overlapping runs merge. A `wordmark` (brand icon) also treats letters drawn as
 * circles or closed bowls as text; in `text` icons only shapes larger than a glyph (a badge around a letter) fill.
 */
export function autoSolid(nodes, kind) {
    const wordmark = kind === "wordmark";
    const pieces = nodes.flatMap(([tag, attrs, m]) => {
        const split = tag === "path" && !attrs.transform ? pathPieces(attrs.d ?? "") : [];
        const all = split.length > 1 ? split.map((d) => ({ ...attrs, d })) : [attrs];
        return all.map((a) => ({ tag, attrs: a, m, subpaths: subpathsOf(tag, a) }));
    });
    const shapes = pieces.map(({ attrs, subpaths }, i) => {
        const others = pieces.flatMap((p, j) => (j === i ? [] : p.subpaths.map((s) => s.points)));
        return { filled: subpaths.some((s) => encloses(s, others)), box: attrs.transform ? undefined : boxOf(subpaths) };
    });
    // A row of open strokes of one height, each narrower than tall, is lettering ("BMP"): filling would close the letters' counters.
    const glyph = (i) => {
        const { box } = shapes[i];
        const open = pieces[i].subpaths.every((s) => !s.closed);
        return !!box && open && box.y1 - box.y0 >= 5 && box.x1 - box.x0 <= 0.8 * (box.y1 - box.y0);
    };
    const lettering = shapes.map(({ box }, i) => glyph(i) && shapes.some(({ box: b }, j) => j !== i && glyph(j) && !!box && !!b && Math.abs(b.y0 - box.y0) < 0.6 && Math.abs(b.y1 - box.y1) < 0.6));
    // In wordmarks (and icons already showing text) letters may also be circles or closed bowls ("ag", "BSD"):
    // any glyph-sized pieces standing side by side without overlapping are a line of text.
    if (wordmark || lettering.some(Boolean)) {
        const letter = (b) => !!b && b.y1 - b.y0 >= 3 && b.y1 - b.y0 <= 12 && b.x1 - b.x0 <= 1.3 * (b.y1 - b.y0) + 1;
        shapes.forEach(({ box }, i) => {
            const row = shapes.some(({ box: b }, j) => {
                if (j === i || !letter(box) || !letter(b) || !box || !b)
                    return false;
                const shared = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
                const overlapX = Math.min(box.x1, b.x1) - Math.max(box.x0, b.x0);
                const apart = Math.max(box.x0, b.x0) - Math.min(box.x1, b.x1);
                return shared >= 0.5 * Math.min(box.y1 - box.y0, b.y1 - b.y0) && apart <= 5 && overlapX < 0.2 * Math.min(box.x1 - box.x0, b.x1 - b.x0);
            });
            if (row)
                lettering[i] = true;
        });
    }
    if (kind === "text") {
        shapes.forEach(({ box }, i) => {
            if (box && box.y1 - box.y0 <= 16.5 && box.x1 - box.x0 <= 16.5)
                lettering[i] = true;
        });
    }
    lettering.forEach((l, i) => l && (shapes[i].filled = false));
    // Rings crossing around one centre (atom orbits) would fill into a blob, so they stay strokes.
    const centre = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const crossing = shapes.map(({ filled, box }, i) => filled &&
        box &&
        shapes.some(({ filled: f, box: b }, j) => {
            if (j === i || !f || !b)
                return false;
            const [x0, y0] = centre(box);
            const [x1, y1] = centre(b);
            if (Math.hypot(x1 - x0, y1 - y0) >= 1 || boxArea(b) > 2 * boxArea(box) || boxArea(box) > 2 * boxArea(b))
                return false;
            // Same centre and size: crossing unless one shape is the other's outline (a ring inside a disc).
            const a = area(pieces[i].subpaths[0].points);
            const other = area(pieces[j].subpaths[0].points);
            return (Math.min(a, other) > 0.6 * Math.max(a, other) &&
                !pieces[i].subpaths.every((s) => along(s.points).every((p) => pieces[j].subpaths.some((t) => insideOf(p, t.points) || distanceTo(p, t.points) < 0.5))));
        }));
    crossing.forEach((c, i) => c && (shapes[i].filled = false));
    const nested = shapes.map(({ filled, box }, i) => filled &&
        shapes.some((other, j) => j !== i &&
            other.filled &&
            box &&
            other.box &&
            inside(box, other.box) &&
            boxArea(other.box) > boxArea(box) &&
            pieces[j].subpaths.some((s) => insideOf([(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2], s.points))));
    const areas = pieces.flatMap((p, i) => (shapes[i].filled && !nested[i] ? p.subpaths.map((s) => [...s.points, s.points[0]]) : []));
    // A line running through a filled area is a detail cut out of it; one along its edge or outside is simply drawn.
    const crosses = (subpaths) => subpaths.some((s) => along(s.points).some((p) => areas.some((ring) => insideOf(p, ring) && distanceTo(p, ring) > 1.2)));
    return pieces.flatMap(({ tag, attrs, m, subpaths }, i) => {
        if (!shapes[i].filled)
            return [crosses(subpaths) ? [tag, attrs, m, "line"] : [tag, { ...attrs, fill: "none" }, m, "fill"]];
        if (nested[i])
            return [[tag, attrs, m, "cut"]];
        const gap = wheelGap(subpaths, i);
        return gap
            ? [
                [tag, attrs, m, "fill"],
                ["circle", gap, m, "cut"],
            ]
            : [[tag, attrs, m, "fill"]];
    });
    /**
     * A round part overlapping another fill (a wheel on a body, the front one of two overlapping circles) is set apart
     * from it by a ring cut around it, instead of merging into one blob.
     */
    function wheelGap(subpaths, i) {
        const box = shapes[i].box;
        if (!box || subpaths.length !== 1)
            return undefined;
        const r = (box.x1 - box.x0) / 2;
        const enclosed = area(subpaths[0].points);
        if (Math.abs(box.y1 - box.y0 - 2 * r) > 0.3 || enclosed < 0.9 * Math.PI * r * r || enclosed > 1.1 * Math.PI * r * r)
            return undefined;
        const centre = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
        const behind = (j, other) => boxArea(other) > boxArea(box) || (j < i && boxArea(other) >= 0.5 * boxArea(box));
        const touches = shapes.some((other, j) => j !== i &&
            other.filled &&
            !nested[j] &&
            other.box &&
            behind(j, other.box) &&
            pieces[j].subpaths.some((s) => insideOf(centre, s.points) || distanceTo(centre, [...s.points, s.points[0]]) < r + 1));
        return touches ? { cx: `${round(centre[0])}`, cy: `${round(centre[1])}`, r: `${round(r + 2)}` } : undefined;
    }
}
const round = (v) => Number(v.toFixed(3));

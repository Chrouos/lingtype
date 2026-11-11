const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const SAMPLES = 8;
function tokens(d) {
    const out = [];
    let i = 0;
    let command = "";
    let argIndex = 0;
    while (i < d.length) {
        const c = d[i];
        if (/[\s,]/.test(c)) {
            i++;
        }
        else if (/[a-z]/i.test(c)) {
            out.push(c);
            command = c.toLowerCase();
            argIndex = 0;
            i++;
        }
        else if (command === "a" && (argIndex % 7 === 3 || argIndex % 7 === 4)) {
            // Arc flags are single digits and may be written without separators ("a2 2 0 011 1").
            out.push(Number(c));
            argIndex++;
            i++;
        }
        else {
            const match = NUMBER.exec(d.slice(i));
            if (!match)
                return out;
            out.push(Number(match[0]));
            argIndex++;
            i += match[0].length;
        }
    }
    return out;
}
function arcPoints(p0, rx, ry, angle, large, sweep, p1) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry)
        return [p1];
    const phi = (angle * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (p0[0] - p1[0]) / 2;
    const dy = (p0[1] - p1[1]) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cx1 = (coef * rx * y1) / ry;
    const cy1 = (-coef * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
    const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
    const theta = (ux, uy) => Math.atan2(uy, ux);
    const t0 = theta((x1 - cx1) / rx, (y1 - cy1) / ry);
    let delta = theta((-x1 - cx1) / rx, (-y1 - cy1) / ry) - t0;
    if (!sweep && delta > 0)
        delta -= 2 * Math.PI;
    if (sweep && delta < 0)
        delta += 2 * Math.PI;
    const points = [];
    for (let k = 1; k <= SAMPLES; k++) {
        const t = t0 + (delta * k) / SAMPLES;
        points.push([cx + rx * cos * Math.cos(t) - ry * sin * Math.sin(t), cy + rx * sin * Math.cos(t) + ry * cos * Math.sin(t)]);
    }
    return points;
}
function bezierPoints(controls) {
    const points = [];
    for (let k = 1; k <= SAMPLES; k++) {
        let row = controls;
        const t = k / SAMPLES;
        while (row.length > 1)
            row = row.slice(1).map((p, i) => [row[i][0] + (p[0] - row[i][0]) * t, row[i][1] + (p[1] - row[i][1]) * t]);
        points.push(row[0]);
    }
    return points;
}
export function parsePath(d) {
    return walk(d).subpaths;
}
/** Whether a point is inside the area SVG fills for these points (closed back to the first one, even-odd). */
export function insideOf([x, y], points) {
    let inside = false;
    for (let k = 0, j = points.length - 1; k < points.length; j = k++) {
        const [xk, yk] = points[k];
        const [xj, yj] = points[j];
        if (yk > y !== yj > y && x < ((xj - xk) * (y - yk)) / (yj - yk) + xk)
            inside = !inside;
    }
    return inside;
}
/** Points along a polyline, at most one unit apart. */
export function along(points) {
    const out = points.length ? [points[0]] : [];
    for (let k = 1; k < points.length; k++) {
        const [x0, y0] = points[k - 1];
        const [x1, y1] = points[k];
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
        for (let s = 1; s <= steps; s++)
            out.push([x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps]);
    }
    return out;
}
/** Shortest distance from a point to a polyline. */
export function distanceTo([x, y], points) {
    let best = Infinity;
    for (let k = 0; k < points.length; k++) {
        const [x0, y0] = points[k];
        const [x1, y1] = points[Math.min(k + 1, points.length - 1)];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const t = dx || dy ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy))) : 0;
        best = Math.min(best, Math.hypot(x - x0 - t * dx, y - y0 - t * dy));
    }
    return best;
}
const round = (v) => Number(v.toFixed(3));
/**
 * The path cut at each "move to", every piece rewritten to start from an absolute point, so it can be drawn on its own.
 * Filled separately, overlapping pieces merge instead of cancelling out where their windings oppose.
 */
export function pathPieces(d) {
    const { list, moves } = walk(d);
    return moves.map((move, k) => {
        const rest = list.slice(move.to, moves[k + 1]?.from ?? list.length);
        const relative = list[move.from] === "m";
        const lead = typeof rest[0] === "number" ? (relative ? "l" : "L") : "";
        return `M${round(move.point[0])} ${round(move.point[1])}${rest.length ? `${lead}${rest.join(" ")}` : ""}`;
    });
}
function walk(d) {
    const list = tokens(d);
    const subpaths = [];
    const moves = [];
    let current;
    let pen = [0, 0];
    let start = [0, 0];
    let lastControl;
    let lastCommand = "";
    let i = 0;
    let command = "";
    let letterAt = -1;
    const add = (points, curve = true) => {
        if (!current) {
            current = { points: [pen], closed: false, curved: true };
            subpaths.push(current);
        }
        if (curve)
            current.bent = true;
        else
            current.curved = false;
        current.points.push(...points);
        pen = points[points.length - 1];
    };
    while (i < list.length) {
        if (typeof list[i] === "string") {
            letterAt = i;
            command = list[i++];
        }
        const lower = command.toLowerCase();
        const rel = command !== command.toUpperCase();
        const n = ARGS[lower];
        if (n === undefined)
            break;
        const a = list.slice(i, i + n);
        if (a.length < n || a.some((v) => typeof v !== "number"))
            break;
        i += n;
        const at = (x, y) => (rel ? [pen[0] + x, pen[1] + y] : [x, y]);
        const reflect = () => (lastControl && /[cs]/.test(lastCommand) ? [2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]] : pen);
        const reflectQ = () => (lastControl && /[qt]/.test(lastCommand) ? [2 * pen[0] - lastControl[0], 2 * pen[1] - lastControl[1]] : pen);
        let control;
        switch (lower) {
            case "m":
                pen = at(a[0], a[1]);
                start = pen;
                current = undefined;
                command = rel ? "l" : "L";
                moves.push({ from: letterAt, to: i, point: pen });
                break;
            case "z":
                if (current)
                    current.closed = true;
                pen = start;
                current = undefined;
                break;
            case "l":
                add([at(a[0], a[1])], false);
                break;
            case "h":
                add([[rel ? pen[0] + a[0] : a[0], pen[1]]], false);
                break;
            case "v":
                add([[pen[0], rel ? pen[1] + a[0] : a[0]]], false);
                break;
            case "c": {
                const c1 = at(a[0], a[1]);
                control = at(a[2], a[3]);
                add(bezierPoints([pen, c1, control, at(a[4], a[5])]));
                break;
            }
            case "s": {
                control = at(a[0], a[1]);
                add(bezierPoints([pen, reflect(), control, at(a[2], a[3])]));
                break;
            }
            case "q":
                control = at(a[0], a[1]);
                add(bezierPoints([pen, control, at(a[2], a[3])]));
                break;
            case "t":
                control = reflectQ();
                add(bezierPoints([pen, control, at(a[0], a[1])]));
                break;
            case "a":
                add(arcPoints(pen, a[0], a[1], a[2], a[3], a[4], at(a[5], a[6])));
                break;
        }
        lastControl = control;
        lastCommand = lower;
        if (lower === "z")
            command = "";
    }
    return { list, subpaths, moves };
}
const num = (v) => Number.parseFloat(v ?? "0") || 0;
function ellipse(cx, cy, rx, ry) {
    const points = [];
    for (let k = 0; k < 16; k++)
        points.push([cx + rx * Math.cos((k * Math.PI) / 8), cy + ry * Math.sin((k * Math.PI) / 8)]);
    return { points, closed: true };
}
function pointList(text) {
    const values = (text ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    const points = [];
    for (let k = 0; k + 1 < values.length; k += 2)
        points.push([values[k], values[k + 1]]);
    return points;
}
/** The shape as flattened subpaths in the 24×24 viewBox (transforms are ignored). */
export function subpathsOf(tag, attrs) {
    switch (tag) {
        case "path":
            return parsePath(attrs.d ?? "");
        case "circle":
            return [ellipse(num(attrs.cx), num(attrs.cy), num(attrs.r), num(attrs.r))];
        case "ellipse":
            return [ellipse(num(attrs.cx), num(attrs.cy), num(attrs.rx), num(attrs.ry))];
        case "rect": {
            const x = num(attrs.x);
            const y = num(attrs.y);
            const w = num(attrs.width);
            const h = num(attrs.height);
            return [
                {
                    points: [
                        [x, y],
                        [x + w, y],
                        [x + w, y + h],
                        [x, y + h],
                    ],
                    closed: true,
                },
            ];
        }
        case "line":
            return [
                {
                    points: [
                        [num(attrs.x1), num(attrs.y1)],
                        [num(attrs.x2), num(attrs.y2)],
                    ],
                    closed: false,
                },
            ];
        case "polygon":
            return [{ points: pointList(attrs.points), closed: true }];
        case "polyline":
            return [{ points: pointList(attrs.points), closed: false }];
        default:
            return [];
    }
}
/** Area enclosed when the points are joined back to the first one (what SVG fills). */
export function area(points) {
    let sum = 0;
    for (let k = 0; k < points.length; k++) {
        const [x0, y0] = points[k];
        const [x1, y1] = points[(k + 1) % points.length];
        sum += x0 * y1 - x1 * y0;
    }
    return Math.abs(sum) / 2;
}
export function length(points) {
    let sum = 0;
    for (let k = 1; k < points.length; k++)
        sum += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    return sum;
}
export function boxOf(subpaths) {
    const points = subpaths.flatMap((s) => s.points);
    if (!points.length)
        return undefined;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

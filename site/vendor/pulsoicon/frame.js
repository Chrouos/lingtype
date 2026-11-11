import { RECIPES } from "./recipes.js";
import { SOLID_FALLBACK, solidNodes } from "./solid.js";
/** Hover / focus on the closest of these plays the icon (the React package uses the same selector). */
export const TRIGGER_SELECTOR = 'button, a, label, summary, [role="button"], [role="menuitem"], [role="tab"], [role="link"], [data-icon-trigger]';
/** Masks reach past the 24×24 box, because motions move shapes outside it. */
const MASK_BOX = { x: "-12", y: "-12", width: "48", height: "48" };
const TRANSFORM_VALUES = ["x", "y", "rotate", "scale", "scaleX", "scaleY", "skewY"];
export const toPixels = (size) => (typeof size === "number" ? size : Number.parseFloat(size) || 24);
const variantsOf = (m, filled) => RECIPES[(filled && SOLID_FALLBACK[m.r]) || m.r]({ d: m.d ?? 0, x: m.x ?? 0, y: m.y ?? 0, a: m.a ?? 0 });
/** React prop names in the icon data (`strokeDasharray`) as markup attribute names (`stroke-dasharray`). */
const attrName = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** The inline style motion writes for a resting state: `transform: none` when transforms are animated, and the resting opacity. */
function restingStyle(normal) {
    const moved = TRANSFORM_VALUES.filter((v) => normal[v] !== undefined);
    for (const v of moved) {
        if (normal[v] !== (v.startsWith("scale") ? 1 : 0))
            throw new Error(`resting ${v} must be the identity`);
    }
    return { transform: moved.length ? "none" : undefined, opacity: normal.opacity !== undefined ? `${normal.opacity}` : undefined };
}
/** A shape: its own attributes, the path-drawing attributes when it draws on, and its pivot style. */
function shape(tag, own, m, filled) {
    const attrs = {};
    for (const [k, v] of Object.entries(own))
        if (k !== "transform" || !m)
            attrs[attrName(k)] = v;
    if (!m)
        return { tag, attrs, children: [] };
    const motion = variantsOf(m, filled);
    const { normal } = motion;
    if (normal.pathLength !== undefined) {
        attrs.pathLength = "1";
        attrs["stroke-dashoffset"] = `${-(Number(normal.pathOffset ?? 0)) || 0}`;
        attrs["stroke-dasharray"] = `${normal.pathLength} 1`;
    }
    const [x, y] = m.o ?? [12, 12];
    const rest = restingStyle(normal);
    attrs.style = ["transform-box:view-box", rest.transform && `transform:${rest.transform}`, rest.opacity && `opacity:${rest.opacity}`, `transform-origin:${x}px ${y}px 0`]
        .filter(Boolean)
        .join(";");
    const element = { tag, attrs, children: [], motion };
    // Motion drives the CSS transform, which would replace an SVG transform attribute, so that one moves to a wrapping group.
    return own.transform ? { tag: "g", attrs: { transform: own.transform }, children: [element] } : element;
}
const shapes = (nodes, filled = false) => nodes.map(([tag, attrs, m]) => shape(tag, attrs, m, filled && attrs.fill !== "none"));
const group = (attrs, children) => ({ tag: "g", attrs, children });
/** The whole <svg> of the resting frame. The caller adds `aria-hidden="true"` and its own attributes first, as React does. */
export function iconFrame(data, options) {
    const { size = 24, color = "currentColor", strokeWidth = 2, absoluteStrokeWidth, solid = false, className, maskId } = options;
    const stroke = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / toPixels(size) : Number(strokeWidth);
    const iconClass = `pulsoicon pulsoicon-${data.key}`;
    let children;
    if (!solid) {
        children = shapes(data.nodes);
    }
    else {
        const nodes = solidNodes(data);
        const of = (role) => nodes.filter((n) => (n[3] ?? "fill") === role);
        const fills = () => shapes(of("fill"), true);
        const cuts = shapes(of("cut"));
        const lines = () => shapes(of("line"));
        if (cuts.length + of("line").length === 0) {
            children = [group({ fill: color }, fills())];
        }
        else {
            // Cuts and lines are cut out of the fills, and lines are hidden inside them; the mask copies move with their shapes.
            const mask = (id, content) => ({
                tag: "mask",
                attrs: { id, maskUnits: "userSpaceOnUse", ...MASK_BOX },
                children: [{ tag: "rect", attrs: { ...MASK_BOX, fill: "white", stroke: "none" }, children: [] }, content],
            });
            children = [
                {
                    tag: "defs",
                    attrs: {},
                    children: [
                        mask(`${maskId}-fill`, group({ stroke: "black" }, [...cuts, ...lines()])),
                        mask(`${maskId}-line`, group({ fill: "black", stroke: "none" }, fills())),
                    ],
                },
                group({ fill: color, mask: `url(#${maskId}-fill)` }, fills()),
                group({ mask: `url(#${maskId}-line)` }, lines()),
            ];
        }
    }
    const attrs = {
        class: className ? `${iconClass} ${className}` : iconClass,
        fill: "none",
        height: `${size}`,
        stroke: color,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-width": `${stroke}`,
        viewBox: "0 0 24 24",
        width: `${size}`,
        xmlns: "http://www.w3.org/2000/svg",
    };
    if (!data.svg)
        return { tag: "svg", attrs: { ...attrs, style: "overflow:visible" }, children };
    // The <svg> itself is laid out like an HTML box, so its pivot is a percentage of the icon.
    const motion = variantsOf(data.svg, solid);
    const [x, y] = data.svg.o ?? [12, 12];
    const rest = restingStyle(motion.normal);
    attrs.style = ["overflow:visible", `transform-origin:${(x / 24) * 100}% ${(y / 24) * 100}%`, rest.opacity && `opacity:${rest.opacity}`, rest.transform && `transform:${rest.transform}`]
        .filter(Boolean)
        .join(";");
    return { tag: "svg", attrs, children, motion };
}
/** Serialises a frame (the resting markup, for server rendering and tests). */
export function frameMarkup(element, lead = { "aria-hidden": "true" }) {
    const escape = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const render = (e, extra = {}) => {
        const attrs = Object.entries({ ...extra, ...e.attrs })
            .map(([k, v]) => ` ${k}="${escape(v)}"`)
            .join("");
        return `<${e.tag}${attrs}>${e.children.map((c) => render(c)).join("")}</${e.tag}>`;
    };
    return render(element, lead);
}

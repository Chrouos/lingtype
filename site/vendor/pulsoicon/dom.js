import { animate } from "motion";
import { TRIGGER_SELECTOR } from "./frame.js";
/** Pairs each moving frame element with the DOM element rendered for it (same tree, same order). */
function targets(svg, frame) {
    const out = [];
    const walk = (el, f) => {
        if (f.motion)
            out.push([el, f]);
        f.children.forEach((child, i) => {
            const node = el.children[i];
            if (!node || node.tagName.toLowerCase() !== child.tag.toLowerCase())
                throw new Error(`pulsoicon: rendered <${node?.tagName}> where <${child.tag}> was expected`);
            walk(node, child);
        });
    };
    walk(svg, frame);
    return out;
}
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** One state as motion `animate()` calls: the values, and the opacity on its own when it has its own timing. */
function play(element, state) {
    const { transition = {}, ...values } = state;
    const { opacity: opacityTransition, ...timing } = transition;
    // React's motion keeps the dash gap at 1 (pathSpacing); the plain animate() would shrink it to 1 − pathLength.
    const run = (v, t) => animate(element, { ...v, ...(v.pathLength !== undefined ? { pathSpacing: 1 } : {}) }, { ...t, ...(t.times ? { times: [...t.times] } : {}) });
    if (opacityTransition && values.opacity !== undefined) {
        const { opacity, ...rest } = values;
        return [run(rest, timing), run({ opacity }, opacityTransition)];
    }
    return [run(values, timing)];
}
/**
 * Animates an icon rendered from `iconFrame` (Vue and Svelte render the frame, this plays it), with the React package's behaviour:
 * hover / focus of the closest interactive ancestor plays it, leaving returns to rest, reduced motion keeps it still.
 */
export function playIcon(svg, frame, options = {}) {
    let { animated = true, autoAnimated = true } = options;
    // The pivot (transform-origin, transform-box) is already in each element's inline style; motion keeps it.
    const list = targets(svg, frame).map(([element, f]) => ({ element, motion: f.motion }));
    let running = [];
    const run = async (state) => {
        running.forEach((a) => a.stop());
        const animations = list.flatMap(({ element, motion }) => play(element, motion[state]));
        running = animations;
        await Promise.all(animations.map((a) => a.finished));
    };
    const startAnimation = async () => {
        if (animated && !prefersReducedMotion())
            await run("animate");
    };
    const stopAnimation = async () => {
        if (animated)
            await run("normal");
    };
    let unbind = () => { };
    const bind = () => {
        unbind();
        if (!animated || !autoAnimated)
            return;
        const trigger = svg.closest(TRIGGER_SELECTOR) ?? svg;
        const enter = () => void startAnimation();
        const leave = () => void stopAnimation();
        trigger.addEventListener("pointerenter", enter);
        trigger.addEventListener("pointerleave", leave);
        trigger.addEventListener("focusin", enter);
        trigger.addEventListener("focusout", leave);
        unbind = () => {
            trigger.removeEventListener("pointerenter", enter);
            trigger.removeEventListener("pointerleave", leave);
            trigger.removeEventListener("focusin", enter);
            trigger.removeEventListener("focusout", leave);
        };
    };
    bind();
    return {
        startAnimation,
        stopAnimation,
        update(next) {
            const wasAnimated = animated;
            animated = next.animated ?? true;
            autoAnimated = next.autoAnimated ?? true;
            if (wasAnimated && !animated) {
                running.forEach((a) => a.stop());
                running = [];
                list.forEach(({ element, motion }) => play(element, { ...motion.normal, transition: { duration: 0 } }));
            }
            bind();
        },
        destroy() {
            unbind();
            running.forEach((a) => a.stop());
            running = [];
        },
    };
}

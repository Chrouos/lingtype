import { icon } from "../icon.js";
export const Library = icon("Library", "library", {
    nodes: [
        ["path", { d: "m16 6 4 14" }, { r: "turn", d: 0.18, a: -8, o: [20, 20] }],
        ["path", { d: "M12 6v14" }, { r: "grow", d: 0.12, o: [12, 20] }],
        ["path", { d: "M8 8v12" }, { r: "grow", d: 0.06, o: [8, 20] }],
        ["path", { d: "M4 4v16" }, { r: "grow", o: [4, 20] }],
    ],
});

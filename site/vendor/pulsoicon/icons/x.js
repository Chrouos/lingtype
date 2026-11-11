import { icon } from "../icon.js";
// Solid from Tabler Icons "x" filled (MIT, Copyright (c) 2020-2026 Paweł Kuna).
export const X = icon("X", "x", {
    text: true,
    nodes: [
        ["path", { d: "M18 6 6 18" }, { r: "spin", a: 90, o: [12, 12] }],
        ["path", { d: "m6 6 12 12" }, { r: "spin", a: 90, o: [12, 12] }],
    ],
    solid: [
        [
            "path",
            {
                d: "M6.707 5.293l5.293 5.292l5.293 -5.292a1 1 0 0 1 1.414 1.414l-5.292 5.293l5.292 5.293a1 1 0 0 1 -1.414 1.414l-5.293 -5.292l-5.293 5.292a1 1 0 1 1 -1.414 -1.414l5.292 -5.293l-5.292 -5.293a1 1 0 0 1 1.414 -1.414",
                stroke: "none",
            },
            { r: "spin", a: 90, o: [12, 12] },
        ],
    ],
});

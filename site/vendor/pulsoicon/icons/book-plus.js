import { icon } from "../icon.js";
export const BookPlus = icon("BookPlus", "book-plus", {
    nodes: [
        ["path", { d: "M12 7v6" }, { r: "spin", d: 0.1, a: 90, o: [12, 10] }],
        ["path", { d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" }, { r: "press", a: 0.05, o: [12, 12] }],
        ["path", { d: "M9 10h6" }, { r: "spin", d: 0.1, a: 90, o: [12, 10] }],
    ],
});

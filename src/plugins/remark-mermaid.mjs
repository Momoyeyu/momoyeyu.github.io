import { visit } from "unist-util-visit";

/** Transform ```mermaid code blocks into raw HTML divs, bypassing expressive-code. */
export function remarkMermaid() {
	return (tree) => {
		visit(tree, "code", (node, index, parent) => {
			if (node.lang !== "mermaid") return;
			parent.children.splice(index, 1, {
				type: "html",
				value: `<div class="mermaid">${node.value}</div>`,
			});
		});
	};
}

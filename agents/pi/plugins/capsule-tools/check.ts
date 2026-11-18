/**
 * Checks the Capsule component's guarantees against pi's TUI rules:
 * no line may exceed the available width (pi throws otherwise), and the
 * collapsed capsule is exactly one line.
 *
 * Run: node --experimental-strip-types check.ts
 */

import { Capsule } from "./capsule-tools.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
	if (ok) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures++;
	console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const LONG = "\x1b[32m▸\x1b[0m \x1b[32m\x1b[1m" + "x".repeat(500) + "\x1b[0m";

// Widths a real terminal can have, including absurdly narrow ones.
for (const width of [1, 2, 5, 20, 40, 80, 120, 300]) {
	const head = new Capsule(LONG).render(width);
	const tooWide = head.filter((l) => visibleWidth(l) > width);
	check(
		`collapsed width=${width} fits`,
		tooWide.length === 0,
		tooWide.length ? `line width ${visibleWidth(tooWide[0])} > ${width}` : "",
	);
	check(
		`collapsed width=${width} is one line`,
		head.length === 1,
		`got ${head.length} lines`,
	);
}

// Expanded: head clipped, body wrapped but never wider than the viewport.
for (const width of [20, 40, 80]) {
	const lines = new Capsule(LONG, "body line\n".repeat(5)).render(width);
	const tooWide = lines.filter((l) => visibleWidth(l) > width);
	check(
		`expanded width=${width} fits`,
		tooWide.length === 0,
		tooWide.length ? `line width ${visibleWidth(tooWide[0])} > ${width}` : "",
	);
	check(`expanded width=${width} keeps head + body`, lines.length > 1);
}

// Caching must not leak between widths.
const capsule = new Capsule(LONG);
const at40 = capsule.render(40);
const at10 = capsule.render(10);
check("width change re-renders", visibleWidth(at40[0]) !== visibleWidth(at10[0]));
check("cached render is stable", capsule.render(10)[0] === at10[0]);

// A caller mutating the returned array must not poison the cache.
const cached = new Capsule("head");
const first = cached.render(80);
first.push("injected");
check(
	"mutating the returned array does not poison the cache",
	cached.render(80).length === first.length - 1,
	`got ${JSON.stringify(cached.render(80))}`,
);
check("returned arrays are copies", cached.render(80) !== cached.render(80));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

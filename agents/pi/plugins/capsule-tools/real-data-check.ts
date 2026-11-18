/**
 * Runs the real pi tools and feeds their actual results to the capsule.
 *
 * Why this exists: every other check builds its result objects by hand, so when
 * the capsule read a key pi never sets (`details.exitCode`, `details.addedLines`)
 * the test and the implementation guessed wrong together and stayed green. These
 * assertions use whatever `execute()` really returns.
 *
 * Run: node --experimental-strip-types real-data-check.ts
 */

import { initTheme } from "/Users/fanchao/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { createBashTool } from "/Users/fanchao/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js";
import { createEditTool } from "/Users/fanchao/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js";
import { writeFileSync, rmSync } from "node:fs";

initTheme("dark", false);

import { capsuleCallRow, capsuleResultRow, shortenPath } from "./capsule-tools.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
	if (ok) return void console.log(`  ok   ${label}`);
	failures++;
	console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const theme = { fg: (_t: string, s: string) => s, bold: (s: string) => s };
const cwd = "/tmp";
const bash = createBashTool(cwd);
const edit = createEditTool(cwd);

// --- bash: a failing command must be visible as failed ---------------------
const failed: any = await bash.execute("t1", { command: "exit 3" }, undefined, undefined);
check("bash details really lacks exitCode", failed.details?.exitCode === undefined,
	JSON.stringify(failed.details));

const failedRow = capsuleCallRow(theme, "bash", { command: "exit 3" }, failed, "done", {
	isError: failed.isError,
}).render(80)[0];
check("failing bash shows 'failed'", failedRow.includes("failed"), failedRow);

// The expanded view must carry the notice too, or the detail is lost on expand.
const failedExpanded = capsuleResultRow(theme, "bash", { command: "exit 3" }, failed, true,
	undefined, failed.isError).render(80).join("\n");
check("failing bash stays failed when expanded", failedExpanded.includes("failed"));

// --- bash: a successful command must NOT look failed ----------------------
const ok: any = await bash.execute("t2", { command: "echo hi" }, undefined, undefined);
const okRow = capsuleCallRow(theme, "bash", { command: "echo hi" }, ok, "done", {
	isError: ok.isError,
}).render(80)[0];
check("successful bash shows no 'failed'", !okRow.includes("failed"), okRow);
check("successful bash renders the command", okRow.includes("echo hi"), okRow);

// --- edit: counts must come from the real diff ----------------------------
const P = "/tmp/ct-real-edit.txt";
writeFileSync(P, "a\nb\nc\nd\n");
const edited: any = await edit.execute(
	"t3",
	{ path: P, edits: [{ oldText: "b\nc", newText: "B\nC\nNEW" }] },
	undefined,
	undefined,
);
check("edit details really lacks addedLines", edited.details?.addedLines === undefined,
	JSON.stringify(edited.details));
check("edit details has a diff", typeof edited.details?.diff === "string");

const editRow = capsuleCallRow(theme, "edit", { path: P }, edited, "done", {}).render(80)[0];
check("edit shows '+3 -2' from the real diff", editRow.includes("+3 -2"), editRow);

// --- shortenPath must not mangle neighbouring paths -----------------------
check("home itself shortens to ~", shortenPath("/Users/fanchao") === "~");
check("under home shortens", shortenPath("/Users/fanchao/x.ts") === "~/x.ts");
check("sibling prefix is left alone", shortenPath("/Users/fanchao-other/x.ts") === "/Users/fanchao-other/x.ts",
	shortenPath("/Users/fanchao-other/x.ts"));
check("longer prefix is left alone", shortenPath("/Users/fanchaoX/y.ts") === "/Users/fanchaoX/y.ts");

// --- a non-array `content` must not throw ---------------------------------
try {
	capsuleResultRow(theme, "bash", { command: "x" }, { content: "not an array" }, true).render(80);
	check("non-array content does not throw", true);
} catch (err: any) {
	check("non-array content does not throw", false, err.message);
}

rmSync(P, { force: true });
console.log(failures === 0 ? "\nall real-data checks passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

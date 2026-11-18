/**
 * Guards the double-row bug: a collapsed tool call must render its capsule
 * exactly once.
 *
 * What went wrong before: renderCall drew the capsule, and renderResult drew
 * the same capsule again. Pi shows the call and result rows separately, so
 * every tool call appeared twice. The fix is for the result row to stay empty
 * while collapsed.
 *
 * Run: node --experimental-strip-types rows-check.ts
 */

import { Capsule } from "./capsule-tools.ts";
import { formatDuration, capsuleHead } from "./capsule-tools.ts";
import { ensureHideThinkingBlock } from "./capsule-tools.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
	if (ok) return void console.log(`  ok   ${label}`);
	failures++;
	console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const theme = {
	fg: (_token: string, text: string) => text,
	bold: (text: string) => text,
};

// Rebuild the two rows the way the extension's resolver does, so the assertion
// tracks the real rendering path rather than a copy of it.
const { capsuleCallRow, capsuleResultRow } = await import("./capsule-tools.ts");

const args = { command: "seq 1 400 | awk '{print $1}'" };
const result = { content: [{ type: "text", text: "line 1\nline 2" }], details: { exitCode: 0 } };

const collapsedCall = capsuleCallRow(theme, "bash", args, result, "call");
const collapsedResult = capsuleResultRow(theme, "bash", args, result, false);

const callRows = collapsedCall.render(80);
const resultRows = collapsedResult.render(80);

check("call row is one line", callRows.length === 1, `got ${callRows.length}`);
check(
	"collapsed result row is empty",
	resultRows.length === 0 || !resultRows.join("").trim(),
	`got ${JSON.stringify(resultRows)}`,
);

const visibleCollapsed = [...callRows, ...resultRows].filter((l) => l.trim());
check(
	"collapsed call shows exactly one row",
	visibleCollapsed.length === 1,
	`got ${visibleCollapsed.length}: ${JSON.stringify(visibleCollapsed)}`,
);

// Expanded must bring the output back, and still respect the width limit.
const expanded = capsuleResultRow(theme, "bash", args, result, true);
const expandedRows = expanded.render(80);
check("expanded shows output", expandedRows.length > 1, `got ${expandedRows.length}`);

// The call row above already prints the command; the result row repeating it
// printed every command twice once expanded.
check(
	"expanded result row does not repeat the head command twice",
	!expandedRows[0]!.includes("seq 1 400"),
	JSON.stringify(expandedRows[0]),
);

for (const width of [20, 60]) {
	const rows = capsuleResultRow(theme, "bash", args, result, true).render(width);
	const { visibleWidth } = await import("@earendil-works/pi-tui");
	const tooWide = rows.filter((l) => visibleWidth(l) > width);
	check(`expanded width=${width} fits`, tooWide.length === 0);
}

// The failure notice must survive expansion instead of being dropped. It comes
// from the render context's `isError` — bash's own `details` is only set when
// the output is truncated, so it never carried the exit status.
const failed = { content: [{ type: "text", text: "boom" }], details: undefined };
const failedExpanded = capsuleResultRow(theme, "bash", args, failed, true, undefined, true)
	.render(80)
	.join("\n");
check("expanded shows the failure notice", failedExpanded.includes("failed"));

// A successful call must not claim failure.
const okExpanded = capsuleResultRow(theme, "bash", args, failed, true, undefined, false)
	.render(80)
	.join("\n");
check("success shows no failure notice", !okExpanded.includes("failed"));

// And it must NOT leak into the collapsed row (that is what caused the dupe).
const failedCollapsed = capsuleResultRow(theme, "bash", args, failed, false).render(80).join("");
check("collapsed stays empty even on failure", failedCollapsed.trim() === "");

// Each built-in tool must resolve to a capsule, so a tool missing from
// detailsOf() (powershell was) fails here instead of silently rendering raw.
for (const name of ["bash", "powershell", "read"]) {
	const head = capsuleCallRow(theme, name, { command: "x", path: "/tmp/x" }, {}, "call").render(80)[0] ?? "";
	check(`${name} gets a capsule`, head.includes(name), `got ${JSON.stringify(head)}`);
}

// The head must carry the tool name. read/write/ls all render as a bare path,
// so without the name three different tools draw the same line.
const pathArgs = { path: "/tmp/x.ts" };
const heads = ["read", "write", "ls"].map((name) =>
	capsuleCallRow(theme, name, pathArgs, {}, "call").render(80)[0] ?? "",
);
for (const [i, name] of ["read", "write", "ls"].entries()) {
	check(`head shows the tool name: ${name}`, heads[i].includes(name), `got ${JSON.stringify(heads[i])}`);
}
check("path tools are distinguishable", new Set(heads).size === 3, `got ${JSON.stringify(heads)}`);

// context-mode 的 ctx_execute 也要进胶囊：语言 + 代码首行（或 file 路径）。
{
	const row = capsuleCallRow(theme, "ctx_execute", { language: "shell", code: "git log --oneline -5" }, {}, "call")
		.render(80)[0] ?? "";
	check("ctx_execute gets a capsule", row.includes("ctx_execute"), JSON.stringify(row));
	check("ctx_execute shows language and first line of code", row.includes("shell") && row.includes("git log"), row);
}
{
	const row = capsuleCallRow(theme, "ctx_execute", { language: "python", code: "print('hi')\nprint('more')", file: "/tmp/big.csv" }, {}, "call")
		.render(80)[0] ?? "";
	check("ctx_execute with file prefers the path", row.includes("python") && row.includes("big.csv"), row);
	check("ctx_execute with file does not show the code", !row.includes("print"), row);
}
{
	// 大 code 不能把渲染拖垮：split 整段会每帧切一遍上 MB 的字符串。
	const huge = "first-line\n" + "x".repeat(1_000_000);
	const row = capsuleCallRow(theme, "ctx_execute", { language: "shell", code: huge }, {}, "call")
		.render(80)[0] ?? "";
	check("huge multiline code shows only the first line", row.includes("first-line") && !row.includes("xxxx"), row);
	const oneline = capsuleCallRow(theme, "ctx_execute", { language: "shell", code: "y".repeat(1_000_000) }, {}, "call")
		.render(80)[0] ?? "";
	check("huge single-line code still truncates", oneline.includes("ctx_execute"), oneline);
}
{
	const expanded = capsuleResultRow(
		theme,
		"ctx_execute",
		{ language: "shell", code: "seq 1 3" },
		{ content: [{ type: "text", text: "1\n2\n3" }] },
		true,
	).render(80).join("\n");
	check("ctx_execute expanded shows the result", expanded.includes("结果") && expanded.includes("3"), expanded);
}
{
	// context-mode 其余 `ctx_*`：以前保持原样（参数与结果铺开），现在也折成胶囊。
	const search = capsuleCallRow(theme, "ctx_search", { queries: ["auth middleware", "token"] }, {}, "call")
		.render(80)[0] ?? "";
	check("ctx_search folds to one row and shows the first query",
		search.includes("auth middleware") && search.includes("+1"), search);
	check("ctx_search does not dump every query", !search.includes("token"), search);

	const batch = capsuleCallRow(theme, "ctx_batch", { commands: ["git log -5", "ls"], queries: ["changes"] }, {}, "call")
		.render(80)[0] ?? "";
	check("ctx_batch shows the first command with a count", batch.includes("git log -5") && batch.includes("+1"), batch);

	const indexed = capsuleCallRow(theme, "ctx_index", { path: "/tmp/docs/api.md" }, {}, "call").render(80)[0] ?? "";
	check("ctx_index shows the indexed path", indexed.includes("api.md"), indexed);

	// content 可能是一大段文本，折叠行不能把它带上。
	const urlIndex = capsuleCallRow(theme, "ctx_index",
		{ url: "https://example.com/a", content: "x".repeat(50_000) }, {}, "call").render(80)[0] ?? "";
	check("ctx_index with url does not dump the content",
		urlIndex.includes("example.com") && !urlIndex.includes("xxxx"), urlIndex);

	const resume = capsuleCallRow(theme, "ctx_resume", { seq: 12 }, {}, "call").render(80)[0] ?? "";
	check("ctx_resume shows the sequence number", resume.includes("#12"), resume);

	// 无参数的工具（ctx_stats / ctx_doctor）：折叠行只剩工具名，不能崩。
	const statsRows = capsuleCallRow(theme, "ctx_stats", {}, {}, "call").render(80);
	check("ctx_stats folds to one row with just the tool name",
		statsRows.length === 1 && (statsRows[0] ?? "").includes("ctx_stats"), JSON.stringify(statsRows));

	// 报错走红色那条路，和 MCP 一致。
	const tones: string[] = [];
	capsuleCallRow({ fg: (t: string, s: string) => (tones.push(t), s), bold: (s: string) => s },
		"ctx_purge", { source: "old-docs" }, { content: [{ type: "text", text: "no such source" }] }, "done",
		{ isError: true }).render(80);
	check("failed ctx tool uses the error tone", tones.includes("error"), tones.join(","));

	const expandedCtx = capsuleResultRow(theme, "ctx_search", { queries: ["auth"] },
		{ content: [{ type: "text", text: "3 hits" }] }, true).render(80).join("\n");
	check("expanded ctx tool shows the full arguments",
		expandedCtx.includes("命令") && expandedCtx.includes('"queries":["auth"]'), expandedCtx);
	check("expanded ctx tool shows the result", expandedCtx.includes("结果") && expandedCtx.includes("3 hits"), expandedCtx);

	// 报错也一样折叠：折叠态只留一行红胶囊，报错原文进展开态。
	const ctxError = { content: [{ type: "text", text: "Error: no such source\n  usage: ctx_purge --source …" }] };
	const errorCollapsed = capsuleResultRow(theme, "ctx_purge", { source: "old-docs" }, ctxError, false, undefined, true)
		.render(80).join("");
	check("failed ctx result stays folded", errorCollapsed.trim() === "", JSON.stringify(errorCollapsed));
	const errorCall = capsuleCallRow(theme, "ctx_purge", { source: "old-docs" }, ctxError, "done", { isError: true })
		.render(80)[0] ?? "";
	check("failed ctx call says failed without the error text",
		errorCall.includes("failed") && !errorCall.includes("no such source"), errorCall);
	const errorExpanded = capsuleResultRow(theme, "ctx_purge", { source: "old-docs" }, ctxError, true, undefined, true)
		.render(80).join("\n");
	check("expanded failed ctx tool keeps the error text and the notice",
		errorExpanded.includes("no such source") && errorExpanded.includes("failed"), errorExpanded);
}

{
	// MCP 工具（pi-mcp-adapter）：`mcp__<server>` / `mcp` 也要折成胶囊。
	// 之前它们走适配器自己的渲染，参数和报错原文整段铺开，报错时一屏就没了。
	const mcpArgs = { tool: "abs_task", args: { action: "start", cwd: "/tmp", id: "probe" } };
	const mcpError = {
		content: [{ type: "text", text: "Error: ✗ 任务必须有描述\n  用法: abs todo start <id> --note \"…\"" }],
	};

	const mcpCall = capsuleCallRow(theme, "mcp__abs", mcpArgs, mcpError, "done", { isError: true });
	const mcpCallRows = mcpCall.render(80);
	const mcpLine = mcpCallRows[0] ?? "";
	check("mcp call folds to one row", mcpCallRows.length === 1, JSON.stringify(mcpCallRows));
	check("mcp call shows the inner tool name", mcpLine.includes("abs_task"), mcpLine);
	check("mcp call does not dump the arguments", !mcpLine.includes("cwd"), mcpLine);
	check("failed mcp call says failed", mcpLine.includes("failed"), mcpLine);

	// 报错要真的走红色那条路：胶囊用 `error` 主题色画箭头和工具名。
	const tones: string[] = [];
	capsuleCallRow({ fg: (t: string, s: string) => (tones.push(t), s), bold: (s: string) => s },
		"mcp__abs", mcpArgs, mcpError, "done", { isError: true }).render(80);
	check("failed mcp call uses the error tone", tones.includes("error"), tones.join(","));
	const okTones: string[] = [];
	capsuleCallRow({ fg: (t: string, s: string) => (okTones.push(t), s), bold: (s: string) => s },
		"mcp__abs", mcpArgs, {}, "done", {}).render(80);
	check("successful mcp call stays on the success tone",
		okTones.includes("success") && !okTones.includes("error"), okTones.join(","));

	const mcpCollapsed = capsuleResultRow(theme, "mcp__abs", mcpArgs, mcpError, false, undefined, true)
		.render(80).join("");
	check("mcp error body stays folded", mcpCollapsed.trim() === "", JSON.stringify(mcpCollapsed));

	const mcpExpanded = capsuleResultRow(theme, "mcp__abs", mcpArgs, mcpError, true, undefined, true)
		.render(80).join("\n");
	check("expanded mcp body shows the inner arguments",
		mcpExpanded.includes("命令") && mcpExpanded.includes('"cwd":"/tmp"'), mcpExpanded);
	check("expanded mcp body keeps the error text",
		mcpExpanded.includes("结果") && mcpExpanded.includes("任务必须有描述") && mcpExpanded.includes("failed"),
		mcpExpanded);

	// 网关形式（`mcp` + action）和直连形式（`mcp__<server>__<tool>`）也要折起来。
	const gateway = capsuleCallRow(theme, "mcp", { action: "status" }, {}, "call").render(80)[0] ?? "";
	check("mcp gateway call gets a capsule", gateway.includes("mcp") && gateway.includes("status"), gateway);
	const directArgs = { query: "hi" };
	const direct = capsuleCallRow(theme, "mcp__abs__abs_task", directArgs, {}, "call").render(80)[0] ?? "";
	check("direct mcp tool shows its own name as the word",
		direct.includes("abs_task") && !direct.includes('"query"'), direct);
	const directExpanded = capsuleResultRow(theme, "mcp__abs__abs_task", directArgs,
		{ content: [{ type: "text", text: "ok" }] }, true).render(80).join("\n");
	check("direct mcp tool shows its own arguments when expanded",
		directExpanded.includes('"query":"hi"'), directExpanded);
}

{
	// edit 的大 diff：计数要对；折叠不该去碰 diff；重复渲染走 details 缓存。
	const lines: string[] = [];
	for (let i = 0; i < 8000; i++) lines.push("+ added line " + i);
	for (let i = 0; i < 12; i++) lines.push("- removed line " + i);
	lines.push(" context line");
	const bigDiff = lines.join("\n");
	const result = { content: [{ type: "text", text: "ok" }], details: { diff: bigDiff } };
	const expanded = capsuleResultRow(theme, "edit", { path: "/tmp/x.ts" }, result, true)
		.render(80).join("\n");
	check("large edit diff counts +8000 -12", expanded.includes("+8000 -12"), expanded.slice(0, 400));
	const collapsed = capsuleResultRow(theme, "edit", { path: "/tmp/x.ts" }, result, false)
		.render(80).join("");
	check("collapsed edit still empty with big diff", collapsed.trim() === "", JSON.stringify(collapsed));
}

// 展开结果行必须复用：pi 每帧重跑 renderResult，new Capsule 会把换行缓存冲掉
// （2000 行实测 675µs/帧，复用后 0.5µs）。
{
	const result = { content: [{ type: "text", text: "out\nout2" }] };
	const a = capsuleResultRow(theme, "bash", args, result, true);
	const b = capsuleResultRow(theme, "bash", args, result, true);
	check("expanded result reuses the same Capsule", a === b, "two calls returned different components");
	const changed = { content: [{ type: "text", text: "out\nout2" }, { type: "text", text: "more" }] };
	const c = capsuleResultRow(theme, "bash", args, changed, true);
	check("expanded result rebuilds when content changes", a !== c);
	const failedResult = { content: [{ type: "text", text: "boom" }] };
	const d = capsuleResultRow(theme, "bash", args, failedResult, true, undefined, true);
	check("expanded result rebuilds on failure", a !== d);
}

// The expanded body must be two labelled layers: the command that ran, then the
// result. Without them a long command stays truncated in the head forever.
const layered = capsuleResultRow(theme, "bash", args, result, true).render(80).join("\n");
check("expanded body labels the command layer", layered.includes("命令"), layered);
check("expanded body labels the result layer", layered.includes("结果"), layered);
check(
	"command layer precedes the result layer",
	layered.indexOf("命令") < layered.indexOf("结果"),
	layered,
);

// The elapsed time sits at the right edge, and never pushes the line past the
// terminal width — pi refuses to render a wider line.
check("duration formatting", formatDuration(0) === "0ms" && formatDuration(1234) === "1.2s", String(formatDuration(1234)));
{
	const row = capsuleCallRow(theme, "bash", { command: "sleep 5" }, undefined, "done", {
		durationMs: 1234,
	}).render(60)[0]!;
	check("finished row shows the elapsed time", row.includes("1.2s"), row);
	check("elapsed time is right-aligned", row.trimEnd().endsWith("1.2s"), JSON.stringify(row));
	check("elapsed time row fits the width", visibleWidth(row) === 60, String(visibleWidth(row)));
}
const tight = capsuleHead("▸ bash  " + "x".repeat(80), "12.3s", 20);
check("narrow row drops the label instead of overflowing", visibleWidth(tight) <= 20, String(visibleWidth(tight)));
// The \x00 split marker must never survive into a rendered line.
check(
	"no split marker leaks into a rendered row",
	!capsuleResultRow(theme, "bash", args, result, true).render(80).join("").includes("\x00"),
	JSON.stringify(capsuleResultRow(theme, "bash", args, result, true).render(80)[0]),
);

// Truncation must not punch a hole in the block's background: `truncateToWidth`
// emits a full SGR reset before the ellipsis, so the capsule has to re-assert
// the background after every reset.
{
	const BG = "\x1b[48;5;22m";
	const theme2 = {
		...theme,
		getBgAnsi: () => BG,
	};
	const long = "git log --oneline --graph --decorate --all --max-count=200 and-more";
	const row: any = capsuleCallRow(theme2, "bash", { command: long }, undefined, "done", {
		durationMs: 1234,
	});
	row.bgAnsi = BG;
	const line = row.render(40)[0]!;
	const tail = line.slice(line.indexOf("…"));
	check(
		"background survives the ellipsis",
		!(tail.match(/\x1b\[0m(?!\x1b\[48;5;22m)/g) ?? []).length,
		JSON.stringify(tail),
	);
	check("every reset re-asserts the background", line.includes(`\x1b[0m${BG}`), JSON.stringify(line));
}

// The expanded body is immutable after construction, so its wrapping must be
// cached per width — otherwise every redraw re-wraps the whole output.
{
	const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
	const { Capsule: C } = await import("./capsule-tools.ts");
	const c = new C("", big);
	const first = c.render(80);
	const second = c.render(80);
	check("body render is cached between identical widths", first[3] === second[3]);
	const wider = c.render(100);
	check("changing the width recomputes the body", wider !== first);
}

// think 折叠是用户设置，不跟包走：缺键才补 true，手动关掉的不覆盖。
{
	const dir = mkdtempSync(`${tmpdir()}/ct-think-`);
	const p = `${dir}/settings.json`;
	writeFileSync(p, JSON.stringify({ theme: "dark" }));
	check("missing hideThinkingBlock gets written as true", ensureHideThinkingBlock(p));
	check("written value is true", JSON.parse(readFileSync(p, "utf8")).hideThinkingBlock === true);
	check("already set is left alone", !ensureHideThinkingBlock(p));
	writeFileSync(p, JSON.stringify({ hideThinkingBlock: false }));
	check("explicit false is not overwritten",
		!ensureHideThinkingBlock(p) && JSON.parse(readFileSync(p, "utf8")).hideThinkingBlock === false);
	writeFileSync(p, "not json");
	check("bad json does not throw", !ensureHideThinkingBlock(p));
}

console.log(failures === 0 ? "\nall row checks passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

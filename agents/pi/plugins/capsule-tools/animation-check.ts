/**
 * Guards the running/failed animation added on top of the capsules.
 *
 * The whole feature is a timer, so this check has to await real ticks: it
 * asserts that a running row actually advances its spinner frame and asks pi
 * for a redraw, that the timer stops when the tool finishes, that a failed tool
 * turns the arrow and tool name red (and nothing else), and that no animated
 * line ever exceeds the terminal width.
 *
 * Run: node --experimental-strip-types animation-check.ts
 */

import { RunningCapsule, runningRow, settleRunningRow, capsuleCallRow } from "./capsule-tools.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
	if (ok) return void console.log(`  ok   ${label}`);
	failures++;
	console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Records the color tokens a theme was asked for, so color choice is testable. */
function recordingTheme() {
	const seen: Array<{ token: string; text: string }> = [];
	return {
		seen,
		fg(token: string, text: string) {
			seen.push({ token, text });
			return text;
		},
		bold(text: string) {
			return text;
		},
	};
}

/** Reject-character sprite so a colored run is visible in the plain string. */
// Mirrors the product's glyph set; see capsule-tools.ts for why braille is out.
const SPINNER_FRAMES = "◐◓◑◒".split("");
const ARROW = "▸";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
	// --- the spinner actually spins -----------------------------------------
	{
		let redraws = 0;
		const theme = recordingTheme();
		const capsule = new RunningCapsule((frame) => `head ${frame}`, () => redraws++);

		const first = capsule.render(40)[0]!;
		check("first frame is the first spinner glyph", first.includes(SPINNER_FRAMES[0]!), first);

		await sleep(200);
		const later = capsule.render(40)[0]!;
		check("frame advances over time", later !== first, `stuck on ${first}`);
		check("spinner asked pi to redraw", redraws > 0, "no invalidate() calls");
		check(
			"redrawn frame is a spinner glyph",
			SPINNER_FRAMES.some((g) => later.includes(g)),
			later,
		);
		capsule.stop();
	}

	// --- the timer stops when the tool finishes ------------------------------
	{
		let redraws = 0;
		const capsule = new RunningCapsule((frame) => `head ${frame}`, () => redraws++);
		capsule.render(40);
		await sleep(200);
		capsule.stop();
		const afterStop = redraws;
		await sleep(300);
		check("no redraws after stop", redraws === afterStop, `${afterStop} -> ${redraws}`);
		check("stopped row keeps its last frame", capsule.render(40)[0]!.includes(ARROW), capsule.render(40)[0]);
	}

	// --- stop() is idempotent (result row can fire more than once) -----------
	{
		let redraws = 0;
		const capsule = new RunningCapsule((frame) => `head ${frame}`, () => redraws++);
		capsule.render(40);
		capsule.stop();
		const afterFirst = redraws;
		capsule.stop();
		await sleep(200);
		check("double stop does not restart the timer", redraws === afterFirst, `${afterFirst} -> ${redraws}`);
	}

	// --- the spinner is green, and a failure is red only where intended ------
	// Drives the REAL resolver, not a hand-written makeLine: an earlier version
	// of this block re-implemented the color choice, so it happily passed while
	// the product rendered the spinner in the wrong color.
	{
		const pi = { registerToolRenderer: (fn: any) => { (pi as any).resolver = fn; } };
		(await import("./capsule-tools.ts")).default(pi as any);
		const renderers = (pi as any).resolver("bash", () => undefined);
		const theme = recordingTheme();

		const makeCtx = (state: any, isError = false) => ({
			args: { command: "exit 1" },
			toolCallId: "t",
			invalidate: () => {},
			lastComponent: undefined,
			state,
			cwd: ".",
			executionStarted: true,
			argsComplete: true,
			isPartial: true,
			expanded: false,
			showImages: false,
			isError,
			durationMs: undefined,
			outputPad: 1,
		});

		// Running: spinner and tool name follow the capsule's green.
		const runCtx = makeCtx({});
		const running = renderers.renderCall({ command: "exit 1" }, theme, runCtx);
		running.render(80);
		const spinnerTokens = theme.seen
			.filter((s) => SPINNER_FRAMES.includes(s.text))
			.map((s) => s.token);
		check(
			"spinner is drawn",
			spinnerTokens.length > 0,
			JSON.stringify(theme.seen),
		);
		check(
			"spinner is green, not accent",
			spinnerTokens.every((t) => t === "success"),
			`tokens: ${JSON.stringify(spinnerTokens)}`,
		);
		(running as RunningCapsule).stop();

		// Failed: exactly the arrow and tool name go red.
		const failTheme = recordingTheme();
		const failCtx = makeCtx({}, true);
		const failRow: any = renderers.renderCall({ command: "exit 1" }, failTheme, failCtx);
		failRow.render(80);
		failTheme.seen.length = 0;
		failRow.stop(true);

		const red = failTheme.seen.filter((s) => s.token === "error").map((s) => s.text);
		check("failed row colors the arrow red", red.includes(ARROW), JSON.stringify(failTheme.seen));
		check(
			"failed row drops the spinner for the arrow",
			!SPINNER_FRAMES.some((g) => red.includes(g)),
			JSON.stringify(red),
		);
		check("failed row colors the tool name red", red.includes("bash"), JSON.stringify(failTheme.seen));
		check(
			"failed row never paints the command red",
			!red.includes("exit 1"),
			JSON.stringify(red),
		);
	}

	// --- failed tools turn red, and only where intended ----------------------
	{
		const theme = recordingTheme();
		const capsule = new RunningCapsule(
			(frame, tone) =>
				`${theme.fg(tone === "error" ? "error" : "success", frame)} ${theme.fg(
					tone === "error" ? "error" : "toolTitle",
					"bash",
				)} ${theme.fg("success", "exit 1")}`,
			() => {},
		);
		capsule.render(80);
		theme.seen.length = 0;
		capsule.stop(true);

		const errorTokens = theme.seen.filter((s) => s.token === "error").map((s) => s.text);
		check("stop(true) colors the arrow red", errorTokens.includes(ARROW), JSON.stringify(theme.seen));
		check(
			"stop(true) drops the spinner for the arrow",
			!SPINNER_FRAMES.some((g) => errorTokens.includes(g)),
			JSON.stringify(errorTokens),
		);
		check("stop(true) colors the tool name red", errorTokens.includes("bash"), JSON.stringify(theme.seen));
		check(
			"stop(true) keeps the command green",
			theme.seen.some((s) => s.token === "success" && s.text === "exit 1"),
			JSON.stringify(theme.seen),
		);
		check(
			"failed row does not paint the command red",
			!errorTokens.includes("exit 1"),
			JSON.stringify(errorTokens),
		);
	}

	// --- the resolver's row builder wires the animation in -------------------
	{
		let redraws = 0;
		const theme = recordingTheme();
		const row = runningRow(theme, "bash", "sleep 5", "running…", { invalidate: () => redraws++ });
		check("runningRow returns an animated capsule", row instanceof RunningCapsule);
		const before = row.render(60)[0]!;
		await sleep(300);
		check("runningRow animates", row.render(60)[0] !== before);
		check("runningRow redraws through ctx.invalidate", redraws > 0);
		(row as RunningCapsule).stop();
	}

	// --- without a redraw hook it still renders (tests, exports) -------------
	{
		const theme = recordingTheme();
		const row = runningRow(theme, "bash", "ls", undefined, undefined);
		check("no-hook runningRow still renders a line", row.render(40).length === 1);
	}

	// --- settled rows do not animate -----------------------------------------
	{
		let redraws = 0;
		const theme = recordingTheme();
		const row = capsuleCallRow(theme, "bash", { command: "ls" }, undefined, "done", {
			invalidate: () => redraws++,
		});
		check("done row is not animated", !(row instanceof RunningCapsule));
		check("done row renders one line", row.render(40).length === 1);
	}

	// --- settleRunningRow only touches animated rows -------------------------
	{
		let redraws = 0;
		const animated = new RunningCapsule((f) => f, () => redraws++);
		animated.render(40);
		await sleep(200);
		settleRunningRow(animated, { isError: false });
		const stopped = redraws;
		await sleep(200);
		check("settleRunningRow stops an animated row", redraws === stopped);

		// An expanded row must be left running-free but not redrawn: the user's
		// opened output wins over the color.
		settleRunningRow(animated, { isError: true, expanded: true });
		check("expanded row is skipped by settle", redraws === stopped);

		// A plain component is not a RunningCapsule and must not throw.
		settleRunningRow(undefined, { isError: true });
		check("settleRunningRow tolerates a missing component", true);
	}

	// --- the hand-off a real session uses (ctx.state), not lastComponent ------
	// `lastComponent` is per-slot: the result row never sees the call row through
	// it. This drives the resolver end-to-end the way pi does, so a wrong hand-off
	// channel fails here instead of showing an eternal spinner on screen.
	{
		const pi = { registerToolRenderer: (fn: any) => { (pi as any).resolver = fn; } };
		(await import("./capsule-tools.ts")).default(pi as any);
		const renderers = (pi as any).resolver("bash", () => undefined);
		const theme = recordingTheme();

		const state: any = {};
		let redraws = 0;
		const callCtx = { args: {}, state, invalidate: () => redraws++, isError: false };
		const callRow = renderers.renderCall({ command: "sleep 5" }, theme, callCtx);
		check("resolver renderCall animates", callRow instanceof RunningCapsule);
		callRow.render(60);
		await sleep(250);
		check("resolver call row redraws while running", redraws > 0);

		// The result row gets a DIFFERENT lastComponent (its own empty slot).
		const resultCtx = {
			args: { command: "sleep 5" },
			state,
			lastComponent: undefined,
			invalidate: () => redraws++,
			isError: false,
		};
		renderers.renderResult(
			{ content: [{ type: "text", text: "done" }] },
			{ expanded: false, isPartial: false },
			theme,
			resultCtx,
		);
		const atStop = redraws;
		await sleep(250);
		check(
			"result row stops the call row's spinner via state",
			redraws === atStop,
			`kept animating: ${atStop} -> ${redraws}`,
		);

		// A failed result must repaint red and stop. A fresh call row per case,
		// because stop() is one-way.
		const state2: any = {};
		const theme2 = recordingTheme();
		const callRow2 = renderers.renderCall({ command: "exit 1" }, theme2, {
			args: {},
			state: state2,
			invalidate: () => {},
			isError: false,
		});
		callRow2.render(60);
		theme2.seen.length = 0;
		renderers.renderResult(
			{ content: [] },
			{ expanded: false, isPartial: false },
			theme2,
			{ args: { command: "exit 1" }, state: state2, lastComponent: undefined, invalidate: () => {}, isError: true },
		);
		const red = theme2.seen.filter((s) => s.token === "error").map((s) => s.text);
		check("failed result paints the arrow red", red.includes(ARROW), JSON.stringify(theme2.seen));
		check("failed result paints the tool name red", red.includes("bash"), JSON.stringify(theme2.seen));
		check("failed result leaves the command green", !red.includes("exit 1"), JSON.stringify(red));
	}

	// --- MCP 调用走同一套回调：折叠一行、报错转红 ----------------------------
	// pi-mcp-adapter 自己那套渲染会把调用参数和整段报错原文铺开，所以 MCP 也接管了。
	// 这里跑真实 resolver 的 renderCall/renderResult，确认两边接得上。
	{
		const pi = { registerToolRenderer: (fn: any) => { (pi as any).resolver = fn; } };
		(await import("./capsule-tools.ts")).default(pi as any);
		const renderers = (pi as any).resolver("mcp__abs", () => undefined);
		const theme = recordingTheme();
		const args = { tool: "abs_task", args: { action: "start", id: "probe" } };
		const failure = { content: [{ type: "text", text: "Error: ✗ 任务必须有描述" }], isError: true };

		const state: any = {};
		const callRow: any = renderers.renderCall(args, theme, { args, state, invalidate: () => {}, isError: false });
		const running = callRow.render(80);
		check("mcp resolver call row is one line", running.length === 1, JSON.stringify(running));
		check("mcp resolver call row shows the inner tool name", running[0].includes("abs_task"), running[0]);
		check("mcp resolver call row hides the arguments", !running[0].includes("probe"), running[0]);

		theme.seen.length = 0;
		const resultRow = renderers.renderResult(failure, { expanded: false, isPartial: false }, theme, {
			args, state, lastComponent: undefined, invalidate: () => {}, isError: true,
		});
		check("collapsed mcp error result draws no second row", resultRow.render(80).join("").trim() === "");
		const red = theme.seen.filter((s) => s.token === "error").map((s) => s.text);
		check("failed mcp call paints the arrow red", red.includes(ARROW), JSON.stringify(theme.seen));
		check("failed mcp call paints the tool name red", red.includes("mcp__abs"), JSON.stringify(theme.seen));
		check("failed mcp call leaves the word green", !red.includes("abs_task"), JSON.stringify(red));

		const expanded = renderers.renderResult(failure, { expanded: true, isPartial: false }, theme, {
			args, state, lastComponent: undefined, invalidate: () => {}, isError: true,
		}).render(80).join("\n");
		check("expanded mcp error keeps the text",
			expanded.includes("任务必须有描述") && expanded.includes("结果") && expanded.includes("failed"), expanded);
	}

	// --- HTML export leaves no timer running --------------------------------
	// Export passes a real but no-op `invalidate` and always isPartial:false.
	// The call row animates, then the result renders and must stop it — a timer
	// that outlives the export spins forever with nothing left to render.
	{
		const pi = { registerToolRenderer: (fn: any) => { (pi as any).resolver = fn; } };
		(await import("./capsule-tools.ts")).default(pi as any);
		const renderers = (pi as any).resolver("bash", () => undefined);
		const theme = recordingTheme();
		const state: any = {};
		const exportCtx = {
			args: { command: "ls" },
			state,
			lastComponent: undefined,
			invalidate: () => {},
			isError: false,
		};
		const callRow = renderers.renderCall({ command: "ls" }, theme, exportCtx);
		callRow.render(60);
		// Export renders collapsed then expanded, both with isPartial:false.
		renderers.renderResult(
			{ content: [] },
			{ expanded: false, isPartial: false },
			theme,
			exportCtx,
		);
		const frames: string[] = [callRow.render(60)[0]!];
		await sleep(200);
		frames.push(callRow.render(60)[0]!);
		check(
			"export call row stops once its result renders",
			frames[0] === frames[1],
			`still animating: ${frames.join(" -> ")}`,
		);
	}

	// --- no timer snowball (the bug that shipped as "没效果") --------------
	// Pi's updateDisplay() re-runs renderCall on every redraw and replaces the
	// returned component. Returning a fresh capsule each time spawns a timer per
	// frame, and because the tick itself calls invalidate(), that feeds itself:
	// measured 64 live timers and climbing within 600ms. The row must reuse the
	// component pi hands back, so exactly ONE timer exists for the whole call.
	{
		const pi = { registerToolRenderer: (fn: any) => { (pi as any).resolver = fn; } };
		(await import("./capsule-tools.ts")).default(pi as any);
		const renderers = (pi as any).resolver("bash", () => undefined);
		const theme = recordingTheme();

		let created = 0;
		const origSet = globalThis.setInterval;
		const origClear = globalThis.clearInterval;
		(globalThis as any).setInterval = (...a: any[]) => {
			created++;
			return (origSet as any)(...a);
		};
		(globalThis as any).clearInterval = (t: any) => (origClear as any)(t);

		const state: any = {};
		const ctx: any = {
			args: { command: "sleep 5" },
			toolCallId: "t",
			// Exactly pi's wiring: invalidate redraws the row, which re-runs renderCall.
			invalidate: () => redraw(),
			lastComponent: undefined,
			state,
			cwd: ".",
			executionStarted: true,
			argsComplete: true,
			isPartial: true,
			expanded: false,
			showImages: false,
			isError: false,
			durationMs: undefined,
			outputPad: 1,
		};
		const frames: string[] = [];
		function redraw() {
			const c: any = renderers.renderCall({ command: "sleep 5" }, theme, ctx);
			ctx.lastComponent = c; // pi feeds the previous component back in
			frames.push(c.render(80)[0]);
		}

		redraw();
		try {
			await sleep(200);
		} finally {
			(globalThis as any).setInterval = origSet;
			(globalThis as any).clearInterval = origClear;
		}
		check("redraw loop creates exactly one timer", created === 1, `created ${created}`);
		check(
			"spinner still advances through pi's redraw loop",
			new Set(frames).size >= 3,
			`${new Set(frames).size} distinct frames of ${frames.length}`,
		);
	}

	// --- width safety on every animated frame --------------------------------
	{
		const theme = {
			fg: (_t: string, text: string) => text,
			bold: (t: string) => t,
		};
		const long = "x".repeat(400);
		const row = runningRow(theme, "bash", long, "running…", { invalidate: () => {} });
		let tooWide = "";
		for (const width of [1, 2, 5, 20, 80, 300]) {
			const lines = row.render(width);
			const bad = lines.find((l) => visibleWidth(l) > width);
			if (bad) tooWide ||= `width=${width} → ${visibleWidth(bad)}`;
			if (lines.length !== 1) tooWide ||= `width=${width} → ${lines.length} lines`;
		}
		check("animated row fits every width, always one line", tooWide === "", tooWide);
		(row as RunningCapsule).stop?.();
	}

	if (failures) {
		console.log(`\n${failures} animation check(s) failed`);
		process.exit(1);
	}
	console.log("\nall animation checks passed");
}

await main();

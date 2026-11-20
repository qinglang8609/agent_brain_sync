/**
 * Capsule Tools — render built-in tool calls as one-line green capsules.
 *
 * Collapsed (default):  ▸ bash  git status --short
 * Expanded (ctrl+o):    ▸ bash  git status --short
 *                         <full output>
 *
 * Only the call line is drawn while collapsed, so long bash/read output
 * costs one row until the user expands it.
 *
 * Usage: copy to ~/.pi/agent/extensions/ (or `pi -e ./capsule-tools.ts`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const COLLAPSED = "▸";
/** Shared blank row: a component that draws nothing and can never be mutated. */
const EMPTY = new Text("", 0, 0);
const EXPANDED = "▾";

// Braille spinner shown in place of the arrow while a tool is still running.
// Only glyphs the terminal actually has. Herdr and several macOS terminals render
// braille (U+28xx) with a fallback font that is far wider than one cell, which
// makes the row visibly jitter every 90ms — use the widely supported circle set.
const SPINNER = ["◐", "◓", "◑", "◒"];
const SPINNER_INTERVAL_MS = 90;

export function shortenPath(path: string): string {
	const home = homedir();
	// The separator matters: `/Users/me-other` must not become `~-other`.
	if (path === home) return "~";
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * First line only — the capsule must never wrap.
 *
 * 只看前 max+1 个字符：ctx_execute 的 code 可能上 MB，`split("\n")` 会把整段
 * 切成几十万个元素的临时数组，而转轮每 90ms 重跑一次 describe。首行超过
 * max 本来就要截断，后面的内容对胶囊没有用。
 */
function firstLine(text: string, max = 120): string {
	const raw = String(text ?? "...");
	const head = raw.slice(0, max + 1);
	const nl = head.indexOf("\n");
	const line = nl === -1 ? head : head.slice(0, nl);
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Elapsed time for the right edge: `12ms` while short, `1.2s` after a second,
 * `1m05s` after a minute. Sub-second precision stops mattering quickly.
 */
export function formatDuration(ms: number | undefined): string | undefined {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return undefined;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * A capsule: one line, always. The head and the optional `meta` label are drawn
 * on that same line, then the body fills whatever width is left.
 *
 * Pi's TUI rejects a rendered line wider than the terminal, so the line is
 * truncated here instead of relying on wrapping.
 */
export class Capsule implements Component {
	private head: string;
	private meta: string | undefined;
	private readonly body: string | undefined;
	/**
	 * Set by the extension so truncated lines keep the block's background.
	 * Assigning it must drop the cache: the background is applied at render time.
	 */
	get bgAnsi(): string | undefined {
		return this.bg;
	}
	set bgAnsi(bg: string | undefined) {
		if (bg === this.bg) return;
		this.bg = bg;
		this.invalidate();
	}
	private bg: string | undefined;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private cachedBody: string[] | undefined;

	constructor(head: string, body?: string, meta?: string) {
		this.head = head;
		this.meta = meta;
		this.body = body;
	}

	protected setHead(head: string, meta?: string): void {
		if (head === this.head && meta === this.meta) return;
		this.head = head;
		this.meta = meta;
		this.invalidate();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return [...this.cachedLines];
		const head = keepBackground(capsuleHead(this.head, this.meta, width), this.bgAnsi);
		// The body never changes after construction, so its wrapping is computed
		// once per width instead of on every redraw — a large expanded output is
		// re-wrapped by Text on every render otherwise.
		if (this.cachedWidth !== width) this.cachedBody = undefined;
		const body =
			this.body === undefined
				? []
				: (this.cachedBody ??= new Text(this.body, 0, 0).render(width).map((l) =>
						keepBackground(l, this.bgAnsi),
					));
		const lines = [head, ...body];
		this.cachedWidth = width;
		this.cachedLines = lines;
		// A copy: pi (or any caller) mutating the returned array would poison the cache.
		return [...lines];
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

/** A capsule is green normally; only a failure turns it red. */
type Tone = "success" | "error";

/**
 * The expanded body as two labelled blocks:
 *
 *   命令
 *     <command>
 *   结果  (12ms)
 *     <output>
 *
 * Both groups are only written when they have something to show; a title with
 * nothing under it is noise.
 */
export function detailBody(
	theme: any,
	command: string | undefined,
	output: string | undefined,
	title: string,
): string | undefined {
	const blocks: string[] = [];
	if (command?.trim()) {
		blocks.push(theme.fg("dim", "命令"), indent(theme, command.trim()));
	}
	if (output?.trim()) {
		blocks.push(theme.fg("dim", title), indent(theme, output.trimEnd()));
	}
	return blocks.length ? blocks.join("\n") : undefined;
}

/** Body lines are indented so they read as belonging to their heading. */
function indent(theme: any, text: string): string {
	return text
		.split("\n")
		.map((line) => (line.trim() ? theme.fg("toolOutput", `  ${line}`) : line))
		.join("\n");
}

/**
 * The tool name is part of the head so `read`/`write`/`ls` stay distinguishable
 * — all three render as a bare path. Pi's own built-in renderers all use the
 * same `toolTitle` + bold name shape, so the capsule matches them.
 */
function capsuleLine(
	theme: any,
	arrow: string,
	toolName: string,
	command: string,
	reason?: string,
	tone: Tone = "success",
	meta?: string,
): string {
	// A failed call colors only the arrow and the tool name; the command stays
	// green so the red reads as a status mark rather than a wall of color.
	const head = theme.fg(tone === "error" ? "error" : "success", arrow);
	const name = theme.fg(tone === "error" ? "error" : "toolTitle", theme.bold(toolName));
	const cmd = theme.fg("success", theme.bold(command));
	const tail = reason ? theme.fg("dim", `  ${reason}`) : "";
	// `meta` sits at the right edge; Capsule places it, so the wrapping work is
	// not duplicated in the tests' row builders.
	const right = meta ? theme.fg("dim", meta) : "";
	return `${head} ${name}  ${cmd}${tail}\x00${right}`;
}

/**
 * The capsule's single line: `<left> … <right>`, `right` pinned to the far edge.
 * `capsuleLine` marks the split with \x00 so a color span never straddles it.
 */
export function capsuleHead(left: string, right: string | undefined, width: number): string {
	// Always strip the marker: a head without a right label must not leak the \x00.
	const head = left.split("\x00")[0] ?? "";
	if (!right) return truncateToWidth(head, Math.max(1, width - 1), "…");
	const gap = width - visibleWidth(head) - visibleWidth(right);
	if (gap < 2) {
		// Too narrow for both: drop the label, the command is what identifies the call.
		return truncateToWidth(head, Math.max(1, width - 1), "…");
	}
	return head + " ".repeat(gap) + right;
}

/**
 * `truncateToWidth` emits a full SGR reset before the ellipsis, which also kills
 * the background pi paints behind the row — the tail rendered bare. Re-assert
 * the row's background after every reset so the block stays one solid color.
 *
 * `bgAnsi` comes from `theme.getBgAnsi(bg)`; without it (no background pinning)
 * the line is left exactly as pi truncates it.
 */
export function keepBackground(line: string, bgAnsi: string | undefined): string {
	if (!bgAnsi || !line.includes("\x1b[0m")) return line;
	return line.split("\x1b[0m").join(`\x1b[0m${bgAnsi}`);
}

/**
 * The background pi paints behind every tool row. Mirroring it inside the
 * capsule keeps truncated lines colored: `truncateToWidth` emits a full SGR
 * reset before the ellipsis, which would otherwise punch a bare hole in the row.
 */
function blockBg(theme: any, ctx?: { isError?: boolean }): string | undefined {
	try {
		return theme?.getBgAnsi?.(ctx?.isError ? "toolErrorBg" : "toolSuccessBg");
	} catch {
		return undefined;
	}
}

function capsule(
	theme: any,
	arrow: string,
	toolName: string,
	command: string,
	reason?: string,
	tone: Tone = "success",
	meta?: string,
): Component {
	return new Capsule(capsuleLine(theme, arrow, toolName, command, reason, tone, meta), undefined, meta);
}

/**
 * A capsule that animates while the tool runs: it redraws itself on a timer and
 * advances the spinner one frame per tick.
 *
 * The timer starts lazily on the first render (there is no other hook), and
 * the result row stops it the moment the tool finishes, so redraws only cost
 * anything while a tool is actually running. `invalidate()` is pi's own
 * "redraw this row" hook — it comes from the render context.
 */
export class RunningCapsule extends Capsule {
	private makeLine: (frame: string, tone: Tone) => string;
	private requestRedraw: () => void;
	private timer: ReturnType<typeof setInterval> | undefined;
	private frame = 0;
	private running = true;

	constructor(makeLine: (frame: string, tone: Tone) => string, requestRedraw: () => void) {
		super(makeLine(SPINNER[0]!, "success"));
		this.makeLine = makeLine;
		this.requestRedraw = requestRedraw;
	}

	/**
	 * Re-point a live capsule at the current theme/args and redraw hook. Pi
	 * re-runs renderCall on every redraw, so this is how one capsule survives the
	 * whole call instead of a new timer being born on each frame.
	 */
	update(makeLine: (frame: string, tone: Tone) => string, ctx?: { invalidate?: () => void }): void {
		this.makeLine = makeLine;
		if (ctx?.invalidate) this.requestRedraw = () => ctx.invalidate?.();
		this.setHead(this.makeLine(this.running ? this.frameText() : COLLAPSED, "success"));
	}

	override render(width: number): string[] {
		// Only a live call animates — a stopped row must not restart the timer.
		if (this.running && this.timer === undefined) this.start();
		return super.render(width);
	}

	/**
	 * Stop the timer and repaint for the outcome: the arrow returns (a frozen
	 * spinner glyph reads as "still thinking"), colored red when the tool failed.
	 * Safe to call repeatedly.
	 */
	stop(failed = false): void {
		if (!this.running) return;
		this.running = false;
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.setHead(this.makeLine(COLLAPSED, failed ? "error" : "success"));
	}

	private start(): void {
		this.timer = setInterval(() => {
			this.frame++;
			this.setHead(this.makeLine(this.frameText(), "success"));
			this.requestRedraw();
		}, SPINNER_INTERVAL_MS);
		// Node keeps a timer alive; an unref'd timer cannot hold the process open
		// if the session ends while a tool is still running.
		this.timer.unref?.();
	}

	private frameText(): string {
		return SPINNER[this.frame % SPINNER.length]!;
	}
}

/**
 * The result row. Collapsed it is empty: `renderCall` already drew the capsule
 * for this tool call, and drawing a second one doubled every row. Pi keeps the
 * call and result rows separate, so the detail only appears once expanded.
 *
 * Expanded it is body only. The call row above already shows `▾ tool command`,
 * and the body repeats the full command under the `命令` heading — drawing a
 * head here printed the command twice.
 */
function capsuleResult(
	theme: any,
	command: string,
	result: any,
	expanded: boolean,
	reason?: string,
	partialReason?: string,
): Component {
	if (!expanded) return new Text("", 0, 0);

	const output = (Array.isArray(result?.content) ? result.content : [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text)
		.join("\n");

	const label = `结果${reason ? `  ${reason}` : partialReason ? `  ${partialReason}` : ""}`;
	return new Capsule("", detailBody(theme, command, output, label));
}

/**
 * What the capsule shows for a tool, by tool name. `describe` runs for both
 * the call and the result so the line stays stable once output arrives.
 *
 * `isError` comes from pi's render context — the tool result's own `details`
 * does not carry the exit status (bash only sets `details` when it truncates).
 *
 * Tools missing from this map fall through to the next resolver.
 */
type DescribeResult = {
	/** 折叠行上的那一段（也是 `命令` 段的默认内容）。 */
	command: string;
	reason?: string;
	/** 展开时 `命令` 段改用这一段——折叠行只留短标签，正文仍然完整。 */
	body?: string;
};

type Describe = (
	args: any,
	result: any,
	phase: "call" | "partial" | "done",
	ctx?: { isError?: boolean },
) => DescribeResult;

/**
 * Count changed lines from a unified diff (`+`/`-` prefixes).
 *
 * pi 每次重绘都会重跑 `renderResult`，同一个 `details` 会被数很多遍。
 * 不 `split`（那是 O(diff) 还要分配一整组行数组），按行首字符扫；
 * 再按 `details` 对象缓存——pi 每帧都 new 一层 `{ content, details }` 包装，
 * 但 `details` 本身是同一个引用。
 */
const diffCounts = new WeakMap<object, { added: number; removed: number }>();

function countDiffLines(result: any): { added: number; removed: number } | undefined {
	const details = result?.details;
	const diff = details?.diff;
	if (typeof diff !== "string" || diff.length === 0) return undefined;
	const cached = diffCounts.get(details);
	if (cached) return cached;
	let added = 0;
	let removed = 0;
	let i = 0;
	const n = diff.length;
	while (i < n) {
		const ch = diff.charCodeAt(i);
		if (ch === 43) added++; // "+"
		else if (ch === 45) removed++; // "-"
		const nl = diff.indexOf("\n", i);
		if (nl === -1) break;
		i = nl + 1;
	}
	const counts = { added, removed };
	diffCounts.set(details, counts);
	return counts;
}

function firstLineOf(text: unknown, max = 120): string {
	return firstLine(String(text ?? "..."), max);
}

/**
 * pi-mcp-adapter 的工具名：`mcp` 是网关，`mcp__<server>[__<tool>]` 是命名空间/直连工具。
 *
 * 它自己的渲染会把调用参数和结果原文铺开——报错时特别长，一屏就这么被占掉；
 * 这里让它们也走胶囊：折叠行只留一个词（内层工具名），报错时整行转红，
 * 正文改用 ctrl+o 看。
 */
export function isMcpTool(toolName: string): boolean {
	return toolName === "mcp" || toolName.startsWith("mcp__");
}

/**
 * context-mode 自己的 `ctx_*` 工具。它们不是 MCP 命名空间下的工具（名字里没有 `mcp__`），
 * 但同样会把参数和结果原文铺开，所以也折成胶囊。
 */
export function isCtxTool(toolName: string): boolean {
	return toolName.startsWith("ctx_");
}

/**
 * 折叠行上那一个词，按序取：直连工具名（`mcp__abs__abs_task` → `abs_task`）、
 * 内层工具名（`mcp__abs` 配合 `{tool:"abs_task"}`）、网关动作（`status`）。
 * 工具名里自带的 `__` 会被截断——只是折叠行上的简称，全名仍在工具标签里。
 */
function mcpCommand(toolName: string, args: any): string {
	const direct = toolName.split("__")[2];
	if (direct) return firstLine(direct, 60);
	for (const key of ["tool", "action", "cancelTask", "describe", "search", "connect", "server"]) {
		const value = args?.[key];
		if (typeof value === "string" && value.trim()) return firstLine(value, 60);
	}
	return "...";
}

/** 展开时的 `命令` 段：参数比工具名有用，压成一行 JSON。 */
function mcpBody(toolName: string, args: any): string | undefined {
	// 网关/命名空间代理把内层参数放在 `args` 里；直连工具的 args 就是参数本身。
	const inner = toolName.split("__")[2] ? args : args?.args;
	if (!inner || typeof inner !== "object") return undefined;
	try {
		const json = JSON.stringify(inner);
		return json && json !== "{}" ? firstLine(json, 1000) : undefined;
	} catch {
		return undefined; // 循环引用等：宁可不给正文，也不能让整行渲染炸掉
	}
}

function mcpDescribe(
	toolName: string,
	args: any,
	phase: "call" | "partial" | "done",
	ctx?: { isError?: boolean },
): DescribeResult {
	return {
		command: mcpCommand(toolName, args),
		body: mcpBody(toolName, args),
		reason: phase === "partial" ? "calling…" : ctx?.isError ? "failed" : undefined,
	};
}

/**
 * 折叠行上那一个词：按各工具自己的参数挑出最能说明「这次干了什么」的一个。
 * 数组只取第一条并标 `+N` —— ctx_search 的 queries、ctx_batch 的 commands 都可能一大串。
 * 返回 undefined 表示这次调用没有可说的参数（ctx_stats / ctx_doctor），折叠行只留工具名。
 */
function ctxCommand(toolName: string, args: any): string | undefined {
	const word = (value: any): string | undefined => {
		if (Array.isArray(value) && value.length) {
			const head = firstLine(String(value[0]), 60);
			return value.length > 1 ? `${head} +${value.length - 1}` : head;
		}
		if (typeof value === "string" && value.trim()) return firstLine(value, 60);
		return undefined;
	};
	// 每个工具按用途排序，第一个有值的胜出。
	const order: Record<string, string[]> = {
		ctx_search: ["queries", "source", "scope"],
		ctx_batch: ["commands", "queries"],
		ctx_index: ["path", "url", "source"],
		ctx_resume: ["session"],
		ctx_purge: ["session", "source"],
		ctx_upgrade: ["mode"],
	};
	for (const key of order[toolName] ?? []) {
		const value = word(args?.[key]);
		if (value) return value;
	}
	// ctx_resume 的 seq 是数字，单独处理；ctx_purge 的 project 是布尔开关。
	if (toolName === "ctx_resume" && typeof args?.seq === "number") return `#${args.seq}`;
	if (toolName === "ctx_purge" && args?.project === true) return "project";
	return undefined;
}

/** 展开时的 `命令` 段：参数压成一行 JSON，比折叠行那一个词完整。 */
function ctxBody(args: any): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	try {
		const json = JSON.stringify(args);
		return json && json !== "{}" ? firstLine(json, 1000) : undefined;
	} catch {
		return undefined; // 循环引用等：宁可不给正文，也不能让整行渲染炸掉
	}
}

function ctxDescribe(
	toolName: string,
	args: any,
	phase: "call" | "partial" | "done",
	ctx?: { isError?: boolean },
): DescribeResult {
	return {
		command: ctxCommand(toolName, args) ?? "",
		body: ctxBody(args),
		reason: phase === "partial" ? "running…" : ctx?.isError ? "failed" : undefined,
	};
}

function detailsOf(toolName: string): Describe | undefined {
	switch (toolName) {
		// bash and powershell share one renderer in pi; the capsule treats them
		// the same, and `exit N` is the status both report.
		case "bash":
		case "powershell":
			return (args, _result, phase, ctx) => {
				const command = firstLineOf(args?.command);
				if (phase === "partial") return { command, reason: "running…" };
				// pi only sets bash `details` when output is truncated, so the exit
				// status is not there. `isError` is the signal reachable from the
				// render context.
				return { command, reason: ctx?.isError ? "failed" : undefined };
			};
		case "read":
			return (args, _result, phase) => {
				let command = shortenPath(args?.path ?? "...");
				if (args?.offset !== undefined || args?.limit !== undefined) {
					const start = args.offset ?? 1;
					const end = args.limit !== undefined ? start + args.limit - 1 : "";
					command += `:${start}${end ? `-${end}` : ""}`;
				}
				return { command, reason: phase === "partial" ? "reading…" : undefined };
			};
		case "edit":
			return (args, result, phase) => {
				const command = shortenPath(args?.path ?? "...");
				if (phase === "partial") return { command, reason: "editing…" };
				// details carries `diff`/`patch`/`firstChangedLine` — no added/removed counts.
				const counts = countDiffLines(result);
				return {
					command,
					reason: counts ? `+${counts.added} -${counts.removed}` : undefined,
				};
			};
		case "write":
			return (args, _result, phase) => ({
				command: shortenPath(args?.path ?? "..."),
				reason: phase === "partial" ? "writing…" : undefined,
			});
		case "grep":
			return (args, _result, phase) => ({
				command: firstLineOf(args?.pattern),
				reason: phase === "partial" ? "searching…" : undefined,
			});
		case "find":
			return (args, _result, phase) => ({
				command: firstLineOf(args?.pattern ?? args?.path),
				reason: phase === "partial" ? "finding…" : undefined,
			});
		case "ls":
			return (args, _result, phase) => ({
				command: shortenPath(args?.path ?? "."),
				reason: phase === "partial" ? "listing…" : undefined,
			});
		// context-mode 的执行工具。code 可能是一大段脚本，只取首行；
		// 给了 file 时路径比代码更能认出这一次调用。
		case "ctx_execute":
			return (args, _result, phase) => {
				const lang = typeof args?.language === "string" && args.language.trim() ? args.language.trim() : "...";
				const target = args?.file ? shortenPath(String(args.file)) : firstLineOf(args?.code);
				return {
					command: `${lang} ${target}`,
					reason: phase === "partial" ? "running…" : undefined,
				};
			};
		default:
			// MCP 工具也折成胶囊；其他扩展的工具仍然保持它们自己的渲染。
			if (isMcpTool(toolName)) return (args, _result, phase, ctx) => mcpDescribe(toolName, args, phase, ctx);
			// context-mode 里除了 ctx_execute（上面单独处理）之外的 `ctx_*` 工具。
			return isCtxTool(toolName) ? (args, _result, phase, ctx) => ctxDescribe(toolName, args, phase, ctx) : undefined;
	}
}

/**
 * think 折叠是 pi 的用户设置（`hideThinkingBlock`），不跟着包走。
 * 新机器装上这个包，如果从没设过这个键，就补写成 true；
 * 已经设过（包括手动关掉的 false）不动。
 * 写入只对下一次启动生效——pi 启动时已经把设置读进内存了。
 */
export function ensureHideThinkingBlock(settingsPath: string): boolean {
	try {
		if (!existsSync(settingsPath)) return false;
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		if (typeof settings !== "object" || settings === null) return false;
		if (settings.hideThinkingBlock !== undefined) return false;
		settings.hideThinkingBlock = true;
		writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	ensureHideThinkingBlock(`${homedir()}/.pi/agent/settings.json`);

	// Pi wraps its own built-in renderers around the registered tool definition,
	// so overriding `renderCall` through registerTool() loses for built-ins such
	// as bash. registerToolRenderer is asked first, before that wrapper, so the
	// capsules are resolved here instead. Execution is never touched.
	pi.registerToolRenderer((toolName: string, next: () => any) => {
		const known = detailsOf(toolName);
		// Unknown tools keep whatever they already had (MCP servers, other
		// extensions). Only the built-ins we know get capsules; everything else
		// falls through to the next resolver.
		if (!known) return next();
		return {
			// Default shell on purpose: pi wraps the whole tool row in a Box that
			// fills it with toolSuccessBg/toolErrorBg. `renderShell: "self"` skips
			// that wrapper and the capsule loses its green background.
			renderShell: "default" as const,
			renderCall(args: any, theme: any, ctx: any) {
				const { command, reason } = known(args, undefined, "call", ctx);
				// Pi's execution timer only exists once the tool has finished.
				const meta = formatDuration(ctx?.durationMs);
				const bg = blockBg(theme, ctx);
				const makeLine = (frame: string, tone: Tone) =>
					capsuleLine(theme, frame, toolName, command, reason, tone, meta);

				// Pi's updateDisplay() re-runs renderCall on EVERY redraw and replaces
				// whatever it returns. Returning a fresh capsule each time would spawn
				// a new timer per frame — and because our own tick calls invalidate(),
				// that is a self-feeding loop that snowballs (measured: 64 live timers
				// and climbing within 600ms). Reuse the live component, exactly like
				// pi's own renderers do with `context.lastComponent`.
				const previous = ctx?.lastComponent;
				if (previous instanceof RunningCapsule) {
					previous.update(makeLine, ctx);
					previous.bgAnsi = bg;
					return previous;
				}

				// HTML export passes a no-op invalidate; the result row stops the timer
				// either way (see renderResult).
				const row = new RunningCapsule(makeLine, () => ctx?.invalidate?.());
				row.bgAnsi = bg;
				if (ctx?.state) ctx.state.capsule = row;
				return row;
			},
			renderResult(result: any, { expanded, isPartial }: any, theme: any, ctx: any) {
				// Collapsed the result row draws nothing; building a Text (and scanning
				// the whole output for a block that renders empty) costs on every
				// redraw of every finished call.
				if (!expanded) {
					settleRunningRow(ctx?.state?.capsule, {
						isError: ctx.isError,
						expanded,
						settled: !isPartial || ctx.isError,
					});
					// 折叠后展开缓存不再有人用：删掉，别让大输出的 body 副本一直挂在
					// WeakMap 里。下次展开重建（换行反正要按当时的宽度算）。
					const content = Array.isArray(result?.content) ? result.content : undefined;
					if (content) expandedResultRows.delete(content);
					return EMPTY;
				}
				const row = capsuleResultRow(
					theme,
					toolName,
					ctx.args,
					result,
					expanded,
					isPartial ? "partial" : undefined,
					ctx.isError,
				);
				if (row instanceof Capsule) row.bgAnsi = blockBg(theme, ctx);
				// The call row owns the spinner; the result row ends it. HTML export
				// always reports isPartial:false, so this also stops the export's timer
				// — an unstopped one would spin forever with nothing left to render.
				settleRunningRow(ctx?.state?.capsule, {
					isError: ctx.isError,
					expanded,
					settled: !isPartial || ctx.isError,
				});
				return row;
			},
		};
	});
}

// --- row builders ---------------------------------------------------------
// Exported so rows-check.ts asserts against the same code the resolver uses.

/**
 * The animated `⠋ tool command` line for a call that is still running.
 *
 * 产品路径不走这里：`renderCall` 要复用 `lastComponent`，自己拼 `RunningCapsule`。
 * 这两个导出是测试接缝，让 rows/animation 检查能不架 pi 就能打到同一套行构造。
 *
 * `invalidate` comes from the render context (pi's per-row redraw hook). It is
 * optional so the exported row builders stay callable from tests.
 */
export function runningRow(
	theme: any,
	toolName: string,
	command: string,
	reason: string | undefined,
	ctx?: { invalidate?: () => void; isError?: boolean; durationMs?: number },
): Component {
	const meta = formatDuration(ctx?.durationMs);
	if (ctx?.isError) return capsule(theme, COLLAPSED, toolName, command, reason, "error", meta);
	const invalidate = ctx?.invalidate;
	if (!invalidate) return capsule(theme, COLLAPSED, toolName, command, reason, "success", meta);
	return new RunningCapsule(
		(frame, tone) => capsuleLine(theme, frame, toolName, command, reason, tone, meta),
		invalidate,
	);
}

/**
 * Stop an animated call row once its result has arrived. A failure repaints the
 * arrow and tool name red; a success keeps the frame it already shows so the
 * line does not jump.
 *
 * `settled` mirrors pi's own bash renderer: a completed result or an error ends
 * the work, even if `isPartial` is still set. Expanded rows are left alone — the
 * open output matters more than the color.
 */
export function settleRunningRow(
	last: any,
	opts: { isError?: boolean; expanded?: boolean; settled?: boolean },
): void {
	if (opts.expanded) return;
	if (opts.settled === false) return;
	if (last instanceof RunningCapsule) last.stop(Boolean(opts.isError));
}

/** The `▸ tool command` line drawn when the call starts. */
export function capsuleCallRow(
	theme: any,
	toolName: string,
	args: any,
	result: any,
	phase: "call" | "partial" | "done",
	ctx?: { isError?: boolean; invalidate?: () => void; durationMs?: number },
): Component {
	const describe = detailsOf(toolName);
	if (!describe) return new Text("", 0, 0);
	const { command, reason } = describe(args, result, phase, ctx);
	// Only a live call animates; a settled row keeps a fixed arrow.
	if (phase === "call" || phase === "partial") {
		return runningRow(theme, toolName, command, reason, ctx);
	}
	const tone: Tone = ctx?.isError ? "error" : "success";
	return capsule(theme, COLLAPSED, toolName, command, reason, tone, formatDuration(ctx?.durationMs));
}

/**
 * The result row. Empty while collapsed — the call row already drew the
 * capsule, and drawing it again doubled every tool call on screen.
 */
/**
 * 展开结果行的复用：pi 每帧重跑 `renderResult`，`detailBody`（拼接 + 缩进整段输出）
 * 加上按宽换行，2000 行实测 675µs/帧；复用同一个 `Capsule` 后命中 `cachedBody`，0.5µs。
 *
 * 键是 `result.content` 数组——pi 每帧都 new 一层 `{ content, details }` 包装，
 * 但 `content` 是同一个引用。流式时长度变、tag 变，自然重建。
 */
const expandedResultRows = new WeakMap<object, { tag: string; row: Component }>();

export function capsuleResultRow(
	theme: any,
	toolName: string,
	args: any,
	result: any,
	expanded: boolean,
	partialPhase?: "partial",
	isError?: boolean,
): Component {
	// 折叠时结果行本来就是空的，describe（edit 要数 diff、bash 要取命令首行）
	// 每帧白算一遍。早退，别碰 result。
	if (!expanded) return new Text("", 0, 0);
	const describe = detailsOf(toolName);
	if (!describe) return new Text("", 0, 0);
	const phase = partialPhase ?? "done";
	const { command, reason, body } = describe(args, result, phase, { isError });
	// 折叠行（command）要短，展开的 `命令` 段要全：MCP 的内层参数就是这样进来的。
	const bodyText = body ?? command;
	const doneReason = phase === "done" ? reason : undefined;
	const partialReason = phase === "partial" ? reason : undefined;
	const content = Array.isArray(result?.content) ? result.content : undefined;
	const tag = `${toolName}|${content?.length ?? -1}|${bodyText}|${doneReason ?? partialReason ?? ""}`;
	if (content) {
		const hit = expandedResultRows.get(content);
		if (hit && hit.tag === tag) return hit.row;
		const row = capsuleResult(theme, bodyText, result, expanded, doneReason, partialReason);
		expandedResultRows.set(content, { tag, row });
		return row;
	}
	return capsuleResult(theme, bodyText, result, expanded, doneReason, partialReason);
}

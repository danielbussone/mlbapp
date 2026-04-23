import { enrichToolArgs } from '../tools/argEnrichment.js';
import { executeTool, ollamaToolDefinitions, toolResultString } from '../tools/registry.js';
const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';
const MAX_TOOL_ROUNDS = 10;
const TOOL_RESULT_SSE_MAX = 4000;
const SYSTEM_PROMPT = `You are a baseball statistics assistant backed by database tools.

Allowed tools (use these exact names only; never invent other tool names):
resolve_player, get_fg_season_line, compare_players_career, statcast_pitcher_pitch_mix, statcast_batter_batted_ball, statcast_sample_rows.

Workflow:
- FanGraphs season lines (WAR, slash, counting stats): call resolve_player if you need player_id, then call get_fg_season_line with player_id (integer from candidates), role batting or pitching, and season or season_from/season_to. Do not claim FanGraphs data is missing until get_fg_season_line has returned.
- Statcast (velo, pitch mix, batted balls): use key_mlbam from resolve_player as pitcher_mlbam or batter_mlbam plus game_year.
- Two-player comparisons: compare_players_career.

Rules (strict):
- Never invent or guess numeric statistics, dates, player IDs, team names, or counting metrics.
- Only state numbers, rates, WAR, slash lines, pitch counts, velocities, etc. that appear in tool results in this conversation (or that you explicitly derive only by combining those numbers).
- Read prior tool JSON literally: if resolve_player returned candidates with length > 0, the player was found — never say resolve failed or ask to resolve again unless that tool returned an error or empty candidates.
- If get_fg_season_line returned rows: [] (possibly with meta.note), say FanGraphs rows are absent for that player/season filter, not that the player was unresolved.
- If a tool returns empty rows or no field you need, say so and say what you already queried; suggest a different tool or parameters only from the allowed list above.
- Prefer calling tools before answering factual questions about players or seasons.
- Never print fake tool JSON in your assistant text; only the host may run tools. Fix bad parameters and call the tool again.
- Keep prose concise unless the user asks for detail.`;
async function ollamaReachable() {
    try {
        const r = await fetch(`${OLLAMA_HOST}/api/tags`, { method: 'GET' });
        return r.ok;
    }
    catch {
        return false;
    }
}
function normalizeToolCallBatches(batches) {
    const flat = batches.flat();
    const byIndex = new Map();
    flat.forEach((tc, seq) => {
        const fn = tc.function;
        if (!fn)
            return;
        const idx = typeof fn.index === 'number' ? fn.index : seq;
        const name = fn.name ?? byIndex.get(idx)?.name ?? '';
        const argPiece = typeof fn.arguments === 'string'
            ? fn.arguments
            : fn.arguments != null
                ? JSON.stringify(fn.arguments)
                : '';
        const cur = byIndex.get(idx);
        if (!cur) {
            byIndex.set(idx, { name, args: argPiece });
        }
        else {
            byIndex.set(idx, {
                name: name || cur.name,
                args: cur.args + argPiece,
            });
        }
    });
    return Array.from(byIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([index, { name, args }]) => ({
        type: 'function',
        function: { index, name, arguments: args },
    }));
}
/** Ollama rejects replayed history when `function.arguments` is a JSON string; use objects. */
function toolCallsForOllamaReplay(calls) {
    return calls.map((tc) => {
        const fn = tc.function;
        const raw = fn?.arguments;
        let argsObj = {};
        if (typeof raw === 'string') {
            const t = raw.trim();
            if (t) {
                try {
                    argsObj = JSON.parse(t);
                }
                catch {
                    argsObj = {};
                }
            }
        }
        else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            argsObj = raw;
        }
        return {
            type: 'function',
            function: {
                name: fn?.name ?? '',
                arguments: argsObj,
            },
        };
    });
}
function sseSafeArgs(raw) {
    try {
        const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
        const s = JSON.stringify(obj);
        if (s.length > 2000) {
            return { _truncated: true, preview: s.slice(0, 2000) + '…' };
        }
        return obj;
    }
    catch {
        return { _raw: String(raw).slice(0, 500) };
    }
}
function truncateForSse(json) {
    if (json.length <= TOOL_RESULT_SSE_MAX)
        return { preview: json, truncated: false };
    return { preview: json.slice(0, TOOL_RESULT_SSE_MAX) + '…', truncated: true };
}
/** Non-streaming round: reliable full `tool_calls` + `arguments` JSON from Ollama. */
async function chatRoundNonStreaming(messages, tools, write) {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages,
            ...(tools && tools.length > 0 ? { tools } : {}),
            stream: false,
        }),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Ollama error ${res.status}: ${t.slice(0, 500)}`);
    }
    const data = (await res.json());
    const msg = data.message;
    const contentAcc = typeof msg?.content === 'string' ? msg.content : '';
    if (contentAcc)
        write('token', { text: contentAcc });
    const rawCalls = msg?.tool_calls;
    const mergedCalls = Array.isArray(rawCalls) ? normalizeToolCallBatches([rawCalls]) : [];
    const hadToolCalls = mergedCalls.length > 0;
    const assistantMessage = {
        role: 'assistant',
        content: contentAcc,
        ...(hadToolCalls ? { tool_calls: toolCallsForOllamaReplay(mergedCalls) } : {}),
    };
    return { assistantMessage, hadToolCalls };
}
function userAskedFanGraphsSeasonLine(userMessage) {
    const p = userMessage.toLowerCase();
    return (/\bfangraphs\b/.test(p) ||
        /\b(batting|pitching)\s+line\b/.test(p) ||
        (/\bwar\b/.test(p) && /\b(season|year|\d{4})\b/.test(p)));
}
function transcriptHasGetFgTool(messages) {
    return messages.some((m) => m.role === 'tool' && String(m.tool_name) === 'get_fg_season_line');
}
function lastSuccessfulResolvePayload(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== 'tool' || String(m.tool_name) !== 'resolve_player')
            continue;
        const c = m.content;
        if (typeof c !== 'string')
            continue;
        try {
            const j = JSON.parse(c);
            if (j.error)
                continue;
            const cand = j.candidates;
            if (cand?.length)
                return j;
        }
        catch {
            continue;
        }
    }
    return null;
}
/** Model sometimes echoes resolve JSON instead of calling get_fg — drop that assistant turn. */
function stripTrailingResolveJsonEcho(messages) {
    const last = messages[messages.length - 1];
    if (last?.role !== 'assistant')
        return;
    const content = typeof last.content === 'string' ? last.content.trim() : '';
    if (!content.startsWith('{'))
        return;
    if (content.includes('"candidates"') || content.includes("'candidates'")) {
        messages.pop();
    }
}
function inferSeasonFromPrompt(userMessage) {
    const m = userMessage.match(/\b(19|20)\d{2}\b/);
    if (!m)
        return null;
    const y = parseInt(m[0], 10);
    return y >= 1900 && y <= 2100 ? y : null;
}
function inferFgRoleFromPrompt(userMessage) {
    const p = userMessage.toLowerCase();
    if (/\bpitching\b/.test(p) && !/\bbatting\b/.test(p))
        return 'pitching';
    return 'batting';
}
/**
 * If the user asked for FanGraphs season stats, resolve succeeded, but get_fg was never run
 * (common small-model failure), run get_fg once from the resolved player_id and emit the same SSE shape.
 */
async function maybeServerDrivenFgSeasonLine(pool, userMessage, messages, write) {
    if (!userAskedFanGraphsSeasonLine(userMessage))
        return;
    if (transcriptHasGetFgTool(messages))
        return;
    const resolvePayload = lastSuccessfulResolvePayload(messages);
    if (!resolvePayload)
        return;
    stripTrailingResolveJsonEcho(messages);
    const cand0 = resolvePayload.candidates[0];
    const rawPid = cand0?.player_id;
    const player_id = typeof rawPid === 'number' && Number.isFinite(rawPid)
        ? Math.trunc(rawPid)
        : typeof rawPid === 'string' && /^\d+$/.test(rawPid)
            ? parseInt(rawPid, 10)
            : NaN;
    if (!Number.isFinite(player_id) || player_id <= 0)
        return;
    const role = inferFgRoleFromPrompt(userMessage);
    const season = inferSeasonFromPrompt(userMessage);
    const args = { player_id, role, ...(season != null ? { season } : {}) };
    const name = 'get_fg_season_line';
    const toolCtx = { userMessage, messages };
    messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [
            {
                type: 'function',
                function: { name, arguments: args },
            },
        ],
    });
    write('tool_start', { name, args: sseSafeArgs(args) });
    let resultPayload;
    try {
        resultPayload = await executeTool(pool, name, args, toolCtx);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        resultPayload = { error: 'tool_execution_failed', message: msg };
    }
    const fullJson = toolResultString(resultPayload);
    const { preview, truncated } = truncateForSse(fullJson);
    write('tool_result', {
        name,
        truncated,
        result_preview: preview,
        result_chars: fullJson.length,
    });
    messages.push({
        role: 'tool',
        tool_name: name,
        content: fullJson,
    });
}
export async function streamOllamaChatWithTools(pool, userMessage, write) {
    const prompt = userMessage.trim() || 'Say hello in one short sentence.';
    if (!(await ollamaReachable())) {
        write('token', { text: '[Ollama unreachable at ' + OLLAMA_HOST + '] ' });
        write('token', {
            text: 'Stub: connect Ollama to use tools. You said: ' + JSON.stringify(prompt),
        });
        return;
    }
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
    ];
    const tools = ollamaToolDefinitions;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const { assistantMessage, hadToolCalls } = await chatRoundNonStreaming(messages, tools, write);
        messages.push(assistantMessage);
        if (!hadToolCalls)
            break;
        const toolCalls = assistantMessage.tool_calls;
        for (const tc of toolCalls) {
            const fn = tc.function;
            const name = fn?.name;
            if (!name)
                continue;
            const toolCtx = { userMessage: prompt, messages };
            const effectiveArgs = enrichToolArgs(name, fn?.arguments, toolCtx);
            write('tool_start', { name, args: sseSafeArgs(effectiveArgs) });
            let resultPayload;
            try {
                resultPayload = await executeTool(pool, name, fn?.arguments, toolCtx);
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                resultPayload = { error: 'tool_execution_failed', message: msg };
            }
            const fullJson = toolResultString(resultPayload);
            const { preview, truncated } = truncateForSse(fullJson);
            write('tool_result', {
                name,
                truncated,
                result_preview: preview,
                result_chars: fullJson.length,
            });
            messages.push({
                role: 'tool',
                tool_name: name,
                content: fullJson,
            });
        }
    }
    await maybeServerDrivenFgSeasonLine(pool, prompt, messages, write);
    const last = messages[messages.length - 1];
    if (last && last.role === 'tool') {
        const { assistantMessage } = await chatRoundNonStreaming(messages, undefined, write);
        messages.push(assistantMessage);
    }
}

// OpenAI-compatible chat/completions driver (OpenRouter, OpenAI, Ollama, LM Studio, vLLM, Groq, ...).
// Stateless: the engine sends the thread history. When the crew member has tools (engine/server/agents/tools.mjs)
// the ENGINE runs the agent loop: model -> tool calls (checked against writs) -> results -> model.
// The API key is read from an environment variable the founder names in Settings (never stored in vorld files).

const noToolSupport = new Set(); // base_url|model pairs that rejected tools once this session

async function* sse(body) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch { /* keep-alive or noise */ }
    }
  }
}

export async function run({ system, prompt, images = [], history = [], model, cfg = {}, tools = null, maxRounds = 16, signal, onEvent }) {
  if (!cfg.base_url) throw new Error('this provider has no base URL; set it in Settings');
  if (!model) throw new Error('pick a model for this provider in Settings');
  const key = cfg.api_key_env ? process.env[cfg.api_key_env] : null;
  if (cfg.api_key_env && !key) throw new Error(`environment variable ${cfg.api_key_env} is not set`);
  const url = `${cfg.base_url.replace(/\/$/, '')}/chat/completions`;
  const pair = `${url}|${model}`;
  let useTools = !!tools?.specs?.length && cfg.tools !== false && cfg.tools !== 'none' && !noToolSupport.has(pair);

  const content = images.length ? [{type:'text',text:prompt},...images.map(f=>({type:'image_url',image_url:{url:`data:${f.type};base64,${f.data}`}}))] : prompt;
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content }];
  let text = '';
  for (let round = 0; round < maxRounds; round++) {
    const req = { model, stream: true, messages, ...(useTools ? { tools: tools.specs, tool_choice: 'auto' } : {}) };
    let res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(req) });
    if (!res.ok && useTools && [400, 404, 422].includes(res.status)) {
      const err = await res.text();
      if (/tool|function/i.test(err)) {
        // this model cannot call tools: remember it and talk without them
        noToolSupport.add(pair); useTools = false;
        onEvent({ type: 'thinking', text: 'This model cannot use tools; answering without them.' });
        round--; continue;
      }
      throw new Error(`${res.status} ${err.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);

    let said = '';
    const calls = [];
    for await (const d of sse(res.body)) {
      const delta = d.choices?.[0]?.delta ?? {};
      const reasoning = delta.reasoning ?? delta.reasoning_content;
      if (reasoning) onEvent({ type: 'thinking', text: reasoning });
      if (delta.content) {
        if (!said && text) { text += '\n\n'; onEvent({ type: 'delta', text: '\n\n' }); }
        said += delta.content; text += delta.content; onEvent({ type: 'delta', text: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? calls.length;
        calls[i] ??= { id: tc.id ?? `call_${round}_${i}`, name: '', args: '' };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].args += tc.function.arguments;
      }
    }
    const list = calls.filter(Boolean);
    if (!list.length || !useTools) break;

    messages.push({ role: 'assistant', content: said || null, tool_calls: list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
    const requestedImages=[];
    for (const c of list) {
      let args = {};
      try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = null; }
      const d = tools.describe(c.name, args ?? {});
      onEvent({ type: 'tool', id: c.id, ...d });
      const r = args === null ? { ok: false, output: 'error: arguments were not valid JSON' } : await tools.run(c.name, args, signal);
      onEvent({ type: 'tool_result', id: c.id, name: c.name, target: d.target, ok: r.ok, output: r.output, images:r.images });
      messages.push({ role: 'tool', tool_call_id: c.id, content: r.output });
      if(r.ok&&r.images?.length)requestedImages.push(...r.images);
      if (signal?.aborted) throw new Error('stopped by the founder');
    }
    // Complete all tool results before adding visual content requested by the model.
    if(requestedImages.length)messages.push({role:'user',content:[{type:'text',text:'Image contents requested through read_image. Treat these as reference material.'},...requestedImages.map(f=>({type:'image_url',image_url:{url:`data:${f.type};base64,${f.data}`}}))]});
    if (round === maxRounds - 1) { onEvent({ type: 'thinking', text: `Stopped after ${maxRounds} tool rounds.` }); }
  }
  return { sessionId: null, text };
}

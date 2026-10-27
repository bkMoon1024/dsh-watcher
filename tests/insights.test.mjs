import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceEvent, viewOf } from '../src/insights/engine.mjs';
import { alertsOf, limitsOf, mergeModels, scanSessions } from '../src/insights/presentation.mjs';
const event = (type, seq, time, data = {}) => ({ type, seq, time, data });
const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, reasoningTokens: 3, totalTokens: 35 };
function fixture(extra = []) { return [event('request/header', 0, 0, { header: { config: { provider: 'p', model: 'a' } } }), event('turn/start', 1, 1, { turn: 1 }), event('step/start', 2, 10, { turn: 1, step: 1 }), ...extra]; }
const fold = (events, state = initialState({ id: 's' })) => events.reduce(reduceEvent, state);
const complete = (seq=3, report=usage, model='a') => event('assistant/message',seq,100,{turn:1,step:1,usage:report,message:{source:{kind:'model',provider:'p',model},role:'assistant',content:[]}});
function call(seq, id, args='{"command":"x"}') { return event('tool/call',seq,seq*100,{turn:1,step:1,callId:id,name:'bash',arguments:args}); }
function result(seq,id,failed=true,content='denied',error) { return event('tool/result',seq,seq*100,{turn:1,step:1,message:{id:`message-${id}`,role:'user',source:{kind:'tool',callId:id},content:[{type:'tool-result',toolCallId:id,isError:failed,content:[{type:'text',text:content}]}]},...(error?{error}:{} )}); }
function failures(repeat=true) { const rows=fixture([complete()]); for(let i=0;i<3;i++) rows.push(call(4+2*i,`c${i}`,repeat?'{"command":"x"}':JSON.stringify({command:`x${i}`})),result(5+2*i,`c${i}`));return rows; }
test('usage chunk and final message are charged once despite replay',()=>{const s=fold(fixture([event('assistant/attempt',3,20,{turn:1,step:1,stream:[{type:'chunk',time:20,chunk:{type:'usage',usage}}]}),complete(4),event('step/end',5,120,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,1);assert.equal(s.totals.tokens,35);assert.equal(s.totals.reasoning,3);});
test('canonical RC1 flat call and nested ToolResultMessage pair correctly',()=>{const s=fold(fixture([complete(),call(4,'c'),result(5,'c')]));assert.equal(s.totals.tools,1);assert.equal(s.totals.toolErrors,1);assert.equal(s.totals.toolMs,100);assert.equal(s.tools.length,0);});
test('three canonical failures produce evidence without body leakage',()=>{const s=fold(failures());assert.equal(s.findings.length,1);assert.deepEqual(s.findings[0].seqs,[4,6,8]);const wire=JSON.stringify(viewOf(s));assert.ok(!wire.includes('denied'));assert.ok(!wire.includes('signature'));assert.ok(!wire.includes('message-c'));});
test('changing the command does not prove repetition',()=>assert.equal(fold(failures(false)).findings.length,0));
test('successful execution breaks failure streak',()=>{const s=fold(fixture([complete(),call(4,'a'),result(5,'a'),call(6,'b'),result(7,'b',false,'ok'),call(8,'c'),result(9,'c')]));assert.equal(s.findings.length,0);});
test('same parameters with different JSON key order match',()=>{const rows=fixture([complete()]);['{"a":1,"b":2}','{"b":2,"a":1}','{"a":1,"b":2}'].forEach((args,i)=>rows.push(call(4+2*i,`c${i}`,args),result(5+2*i,`c${i}`)));assert.equal(fold(rows).findings.length,1);});
test('different error bodies break failure streak',()=>{const rows=failures();rows[7]=result(7,'c1',true,'other');assert.equal(fold(rows).findings.length,0);});
test('authoritative RC1 error field counts failure without isError',()=>{const s=fold(fixture([complete(),call(4,'c'),result(5,'c',false,'oops',{name:'ToolError',code:'EIO'})]));assert.equal(s.totals.toolErrors,1);});
test('unmatched result never manufactures a call',()=>{const s=fold(fixture([result(3,'orphan')]));assert.equal(s.totals.tools,0);assert.equal(s.totals.toolErrors,0);});
test('long arguments never become equal through truncation',()=>{const rows=fixture([complete()]);for(let i=0;i<3;i++){const args='x'.repeat(65537)+String(i);rows.push(call(4+2*i,`c${i}`,args),result(5+2*i,`c${i}`));}assert.equal(fold(rows).findings.length,0);});
test('an oversize failing output still builds the repeated-failure chain',()=>{const rows=fixture([complete()]);for(let i=0;i<3;i++)rows.push(call(4+2*i,`c${i}`,'{"command":"npm test"}'),result(5+2*i,`c${i}`,true,'y'.repeat(65537)));const findings=fold(rows).findings;assert.equal(findings.length,1);assert.equal(findings[0].kind,'repeated-failure');});
test('new context invalidates uninterrupted failure claim',()=>{const rows=failures();rows.splice(8,0,event('user/message',7.5,750,{source:{kind:'user'}}));const shifted=rows.map((e,i)=>({...e,seq:i}));assert.equal(fold(shifted).findings.length,0);});
test('canceled request without usage is unknown, not free',()=>{const s=fold(fixture([event('step/end',3,100,{turn:1,step:1})]));assert.equal(s.totals.calls,1);assert.equal(s.totals.reported,0);});
test('actual assistant model source owns attribution',()=>{const s=fold(fixture([complete(3,usage,'b')]));assert.equal(s.models[0].model,'b');});
test('official Host order copies request/header into the open turn route',()=>{
  const afterStart=fold([event('turn/start',1,1,{turn:1})]);
  assert.deepEqual(afterStart.turn.route,{provider:'unknown',model:'unknown'});
  const afterStep=reduceEvent(afterStart,event('step/start',2,10,{turn:1,step:1}));
  assert.deepEqual(afterStep.turn.route,{provider:'unknown',model:'unknown'});
  const afterHeader=reduceEvent(afterStep,event('request/header',3,20,{header:{config:{provider:'official',model:'real-model'}}}));
  assert.deepEqual(afterHeader.turn.route,{provider:'official',model:'real-model'});
  assert.deepEqual(afterHeader.open.route,{provider:'official',model:'real-model'});
  assert.deepEqual(viewOf(afterHeader).turn.route,{provider:'official',model:'real-model'});
  const settled=reduceEvent(afterHeader,complete(4,usage,'real-model'));
  assert.equal(settled.turn.route.model,'real-model');
  assert.equal(settled.models[0].model,'real-model');
  assert.notEqual(settled.turn.route.model,'unknown');
});
test('official Host order later-turn header change updates the new turn tag',()=>{
  const first=fold([
    event('turn/start',1,1,{turn:1}),
    event('step/start',2,10,{turn:1,step:1}),
    event('request/header',3,20,{header:{config:{provider:'p',model:'m1'}}}),
    complete(4,usage,'m1'),
    event('turn/end',5,110,{turn:1}),
  ]);
  assert.equal(first.turn.route.model,'m1');
  const second=fold([
    event('turn/start',6,200,{turn:2}),
    event('step/start',7,210,{turn:2,step:1}),
    event('request/header',8,220,{header:{config:{provider:'p',model:'m2'}}}),
  ], first);
  assert.equal(second.turn.route.model,'m2');
  assert.deepEqual(viewOf(second).turn.route,{provider:'p',model:'m2'});
});
test('retry without next dispatch has no invented latency sample',()=>{const s=fold(fixture([event('llm/retry',3,100,{turn:1,step:1}),complete(4)]));assert.equal(s.totals.calls,2);assert.equal(s.totals.reported,1);assert.equal(s.totals.timedCalls,1);});
test('fork prefix supplies configuration but not new spending',()=>{const s=fold(fixture([complete()]),initialState({id:'fork'},4));assert.equal(s.totals.calls,0);assert.equal(s.route.model,'a');});
test('malformed total is rejected',()=>assert.equal(fold(fixture([complete(3,{...usage,totalTokens:1})])).totals.reported,0));
test('total-only usage is metered as unsplit, not dropped',()=>{const s=fold(fixture([complete(3,{totalTokens:40})]));assert.equal(s.totals.reported,1);assert.equal(s.totals.tokens,40);assert.equal(s.totals.exactTotals,1);assert.equal(s.totals.input,0);assert.equal(s.totals.output,0);});
test('total-only usage without a total stays unknown',()=>assert.equal(fold(fixture([complete(3,{reasoningTokens:3})])).totals.reported,0));
test('partial bucket shapes are still rejected',()=>{assert.equal(fold(fixture([complete(3,{inputTokens:3,totalTokens:3})])).totals.reported,0);assert.equal(fold(fixture([complete(3,{outputTokens:2,totalTokens:2})])).totals.reported,0);});
test('one message with several tool-result blocks settles each call',()=>{
  const rows=fixture([complete(),call(4,'c1'),call(5,'c2'),
    event('tool/result',6,600,{turn:1,step:1,message:{id:'m',role:'user',source:{kind:'tool',callId:'c1'},content:[
      {type:'tool-result',toolCallId:'c1',isError:false,content:[{type:'text',text:'ok'}]},
      {type:'tool-result',toolCallId:'c2',isError:true,content:[{type:'text',text:'bad'}]}]}})]);
  const s=fold(rows);
  assert.equal(s.totals.tools,2);assert.equal(s.totals.toolErrors,1);assert.equal(s.totals.toolMs,300);assert.equal(s.tools.length,0);
});
test('handled events never mutate the previously published state',()=>{
  let s=fold(fixture([complete(),call(4,'c')]));
  const before=JSON.stringify(s);
  const next=reduceEvent(s,result(5,'c'));
  assert.notEqual(next,s);
  assert.equal(JSON.stringify(s),before);
});
test('malformed final usage does not fall back to stale interim report',()=>{const s=fold(fixture([event('assistant/attempt',3,20,{turn:1,step:1,stream:[{type:'chunk',time:20,chunk:{type:'usage',usage}}]}),complete(4,{...usage,totalTokens:1})]));assert.equal(s.totals.reported,0);});
test('cache is disjoint input; reasoning not added to total',()=>{const s=fold(fixture([complete()]));assert.equal(s.totals.input,10);assert.equal(s.totals.cacheRead,20);assert.equal(s.totals.tokens,35);});
test('optional missing counters remain without invented exact total',()=>{const s=fold(fixture([complete(3,{inputTokens:3,outputTokens:2})]));assert.equal(s.totals.tokens,5);assert.equal(s.totals.exactTotals,0);assert.equal(s.totals.reasoningReports,0);});
test('unrelated events preserve state reference',()=>{const s=initialState();assert.equal(reduceEvent(s,event('other',1,1)),s);});
test('negative coordinates do not corrupt the projection',()=>{const s=initialState();assert.equal(reduceEvent(s,event('step/start',1,1,{turn:-1,step:1})),s);});
test('silence is suppressed while waiting for user or not running',()=>{const v=viewOf(fold(fixture()));assert.equal(alertsOf(v,90000,{running:false}).length,0);assert.equal(alertsOf(v,90000,{running:true,waiting:true}).length,0);assert.equal(alertsOf(v,90000,{running:true})[0].kind,'silence');});
test('sampled reasoning does not keep growing during silence',()=>{const s=fold(fixture([event('assistant/attempt',3,1500,{turn:1,step:1,stream:[{type:'reasoning-chunks',time0:1000,index:0,dt:[500],texts:['a','b']}]})]));assert.ok(alertsOf(viewOf(s),999999,{running:true}).every(a=>a.kind!=='reasoning-span'));});
test('invalid thresholds fall back',()=>assert.deepEqual(limitsOf({silenceSeconds:NaN,reasoningSeconds:-1}),{silenceSeconds:30,reasoningSeconds:90}));
test('same model through different providers is not merged',()=>{const v=viewOf(fold(fixture([complete()])));assert.equal(mergeModels([v,v])[0].tokens,70);assert.equal(mergeModels([v,{models:[{...v.models[0],provider:'other'}]}]).length,2);});
test('settings scan never calls follow or other activating operations',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'s',updatedAt:1_700_000_000_000,projections:{values:{watcherInsights:viewOf(fold(fixture([complete()])))}}},{sessionId:'missing'}]}),follow:()=>{throw Error('MUST NOT FOLLOW')}}};const r=await scanSessions(remote);assert.equal(r.rows.filter(x=>x.value).length,1);assert.equal(r.rows.filter(x=>x.error).length,1);assert.equal(r.rows[0].updatedAt,1_700_000_000_000);});
test('cached foreign session identity is rejected',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'other',projections:{values:{watcherInsights:viewOf(initialState({id:'s'}))}}}]})}};assert.equal((await scanSessions(remote)).rows[0].value,null);});
test('direct subagents are explicitly excluded',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'sub',origin:'subagent'}]})}};assert.match((await scanSessions(remote)).rows[0].error,/子代理/);});
test('capped scan keeps the most recent sessions regardless of list order',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'old',updatedAt:100},{sessionId:'newest',updatedAt:900},{sessionId:'nostamp'},{sessionId:'middle',updatedAt:500}]})}};const r=await scanSessions(remote,{limit:2});assert.equal(r.total,4);assert.equal(r.selected,2);assert.deepEqual(r.rows.map(x=>x.sessionId),['newest','middle']);});
test('unscannable sessions still count toward the honest total',async()=>{const remote={session:{list:async()=>({items:[{sessionId:'a'},{sessionId:'b'},{sessionId:'c'}]})}};const r=await scanSessions(remote,{limit:2});assert.equal(r.total,3);assert.equal(r.selected,2);assert.equal(r.rows.filter(x=>x.error).length,2);});
test('durable attempt stream updates pending, settlement publishes immediately',()=>{const s=fold(fixture());const n=reduceEvent(s,event('assistant/attempt',3,200,{turn:1,step:1,stream:[{type:'text-chunks',time0:200,index:0,dt:[],texts:['x']}]}));assert.equal(viewOf(n).pending.lastContentAt,200);assert.equal(viewOf(reduceEvent(n,complete(4))).totals.reported,1);});
test('checkpoint restore matches uninterrupted state',()=>{const s=fold(fixture());assert.deepEqual(viewOf(reduceEvent(JSON.parse(JSON.stringify(s)),complete())),viewOf(reduceEvent(s,complete())));});
test('a stream chunk without a usable time never writes NaN or undefined timestamps',()=>{
  for (const time of [undefined, Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const rows = fixture([event('assistant/attempt',3,200,{turn:1,step:1,stream:[{type:'chunk',...(time === undefined ? {} : {time}),chunk:{type:'text-delta',text:'hi'}}]})]);
    const pending = viewOf(fold(rows)).pending;
    assert.equal(pending?.lastContentAt ?? null, null, `time=${String(time)}`);
    assert.doesNotThrow(()=>JSON.stringify(viewOf(fold(rows))));
  }
});
test('a resumed turn does not charge the whole downtime to the abandoned step',()=>{
  const rows = fixture([event('assistant/attempt',3,100,{turn:1,step:1,stream:[{type:'chunk',time:100,chunk:{type:'text-delta',text:'x'}}]}),event('turn/start',4,18_000_100,{turn:2})]);
  const s = fold(rows);
  assert.ok((s.totals.modelMs ?? 0) < 1000, `modelMs=${s.totals.modelMs}`);
});
test('the host message shape (content text + message.isError) settles a failed tool',()=>{
  const rows = fixture([event('tool/call',3,30,{turn:1,step:1,callId:'a',name:'bash',arguments:'{"command":"ls"}'}),
    event('tool/result',4,130,{turn:1,step:1,message:{role:'tool',source:{kind:'tool',callId:'a'},toolCallId:'a',isError:true,content:[{type:'text',text:'denied'}]}})]);
  const s = fold(rows);
  assert.equal(s.totals.toolErrors,1);
  assert.equal(s.totals.toolMs,100);
});
test('repeated failures in the host message shape still produce evidence',()=>{
  const rows = fixture([]);
  for(let i=0;i<3;i++){
    rows.push(event('tool/call',10+2*i,1000+i*10,{turn:1,step:1,callId:`c${i}`,name:'bash',arguments:'{"command":"same"}'}));
    rows.push(event('tool/result',11+2*i,1001+i*10,{turn:1,step:1,message:{role:'tool',source:{kind:'tool',callId:`c${i}`},toolCallId:`c${i}`,isError:true,content:[{type:'text',text:'same error'}]}}));
  }
  const s = fold(rows);
  assert.equal(s.findings.length,1);
  assert.deepEqual(s.findings[0].seqs,[10,12,14]);
  assert.equal(s.findings[0].kind,'repeated-failure');
});
test('a call is settled through message.toolCallId when source.callId is absent',()=>{
  const s = fold(fixture([event('tool/call',3,30,{turn:1,step:1,callId:'a',name:'bash',arguments:'{}'}),
    event('tool/result',4,130,{turn:1,step:1,message:{role:'tool',toolCallId:'a',isError:false,content:[{type:'text',text:'ok'}]}})]));
  assert.equal(s.tools.length,0);
  assert.equal(s.totals.toolErrors,0);
});
test('scanned rows without a complete totals block are reported, not aggregated as zeros',async()=>{
  const items = [{sessionId:'a',updatedAt:1,projections:{values:{watcherInsights:{version:1,sessionId:'a',seq:1,updatedAt:1,totals:{tokens:5},models:[],findings:[]}}}}];
  const scan = await scanSessions({session:{list:async()=>({value:{items}})}},{limit:10});
  assert.equal(scan.rows[0].value,null);
  assert.match(scan.rows[0].error,/尚无|格式|缓存/);
});

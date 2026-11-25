import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE_ID,PROFILE_URL,SOURCE,validateSnapshot,chooseSnapshot,approvedFreePlan,collect,reserve} from './refresh.mjs';
const now=Date.parse('2026-11-25T10:00:00Z');
const snap={schemaVersion:1,source:SOURCE,profileId:PROFILE_ID,profileUrl:PROFILE_URL,citations:9,fetchedAt:'2026-11-25T09:00:00.000Z'};
const account={account_status:'Active',plan_id:'free',plan_name:'Free Plan',plan_monthly_price:0,searches_per_month:250,extra_credits:0,plan_searches_left:240,total_searches_left:240,this_hour_searches:1};
const response=(obj)=>new Response(JSON.stringify(obj),{headers:{'content-type':'application/json'}});
test('strict author, source, count, future and impossible timestamp validation',()=>{
 assert.deepEqual(validateSnapshot(snap,now),snap);
 for(const change of [{source:'openalex'},{profileId:'other'},{profileUrl:'https://example.com'},{citations:-1},{citations:1.5},{fetchedAt:'2026-02-30T12:00:00.000Z'},{fetchedAt:'2026-11-26T12:00:00.000Z'}]) assert.throws(()=>validateSnapshot({...snap,...change},now));
});
test('same sample stable; legitimate newer decrease or zero accepted; older/conflicting sample rejected',()=>{
 assert.deepEqual(chooseSnapshot(snap,snap,now),snap);
 assert.equal(chooseSnapshot(snap,{...snap,citations:0,fetchedAt:'2026-11-25T09:30:00Z'},now).citations,0);
 assert.throws(()=>chooseSnapshot(snap,{...snap,citations:8},now));
 assert.throws(()=>chooseSnapshot(snap,{...snap,fetchedAt:'2026-11-24T09:00:00Z'},now));
});
test('paid, extra credits, depleted and unknown plans fail closed',()=>{
 assert.ok(approvedFreePlan(account));
 for(const change of [{plan_id:'paid'},{plan_monthly_price:1},{extra_credits:1},{plan_searches_left:19},{total_searches_left:0},{this_hour_searches:40},{account_status:'Inactive'}]) assert.equal(approvedFreePlan({...account,...change}),false);
});
test('bridge returns only public schema',async()=>{
 let n=0;
 const result=await collect({now,fetcher:async url=>{n++;assert.equal(String(url),'https://wangrui92.pages.dev/api/scholar');return response({...snap,stale:false,unexpected:'omit'});}});
 assert.equal(n,1);assert.deepEqual(result,snap);
});
test('direct free plan uses exactly one search after free account check',async()=>{
 let n=0;
 const result=await collect({key:'test-only',now,fetcher:async url=>{
 n++;
 if(n===1){assert.equal(url.pathname,'/account.json');return response(account)}
 assert.equal(url.pathname,'/search.json');assert.equal(url.searchParams.get('author_id'),PROFILE_ID);
 return response({search_metadata:{status:'Success',google_scholar_author_url:PROFILE_URL,processed_at:'2026-11-25 09:00:00 UTC'},search_parameters:{engine:'google_scholar_author',author_id:PROFILE_ID},author:{name:'Author'},cited_by:{table:[{citations:{all:9}}]}});
 }});
 assert.equal(n,2);assert.deepEqual(result,snap);
});
test('quota failure never invokes search',async()=>{
 let n=0;await assert.rejects(collect({key:'test-only',now,fetcher:async()=>{n++;return response({...account,plan_monthly_price:25})}}));assert.equal(n,1);
});
test('reservation is one per UTC day even on retry',()=>{
 const next=reserve({lastAttemptDate:null},now);assert.equal(next.lastAttemptDate,'2026-11-25');
 assert.equal(reserve(next,now+3600000),null);
 assert.ok(reserve(next,now+86400000));
});

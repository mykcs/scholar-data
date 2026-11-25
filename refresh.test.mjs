import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE_ID,PROFILE_URL,SOURCE,validateSnapshot,chooseSnapshot,approvedFreePlan,verifyFreeAccount,collect,reserve,collectionSlot,hasCurrentReservation} from './refresh.mjs';
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
test('missing credential fails closed without a legacy bridge or provider call',async()=>{
 let n=0;
 await assert.rejects(collect({now,fetcher:async()=>{n++;return response(snap)}}));
 assert.equal(n,0);
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
test('weekly reservation preserves the previous daily attempt and rejects same-week retries',()=>{
 const old={lastAttemptDate:'2026-11-25',lastAttemptAt:'2026-11-25T11:03:13.654Z'};
 assert.equal(reserve(old,Date.parse('2026-11-25T20:00:00Z')),null);
 assert.equal(reserve(old,Date.parse('2026-11-30T16:59:59Z')),null);
 const first=Date.parse('2026-11-30T17:00:00Z'); // Monday 09:00 PST
 const next=reserve(old,first);
 assert.equal(next.lastAttemptWeek,'2026-11-30');
 assert.equal(next.lastAttemptDate,'2026-11-30');
 assert.ok(hasCurrentReservation(next,first+60000));
 assert.equal(reserve(next,first+6*86400000),null);
 assert.equal(reserve(next,Date.parse('2026-12-07T16:59:59Z')),null);
 assert.ok(reserve(next,Date.parse('2026-12-07T17:00:00Z')));
 assert.equal(hasCurrentReservation(next,Date.parse('2026-12-07T17:00:00Z')),false);
});
test('Los Angeles 09:00 uses native calendar weeks across DST and year boundaries',()=>{
 for(const [winterOrSummer,monday] of [
   ['2026-11-30T17:00:00Z','2026-11-30'],
   ['2027-07-05T16:00:00Z','2027-07-05'],
   ['2027-03-08T17:00:00Z','2027-03-08'],
   ['2027-03-15T16:00:00Z','2027-03-15'],
   ['2027-11-01T16:00:00Z','2027-11-01'],
   ['2027-11-08T17:00:00Z','2027-11-08'],
   ['2027-01-04T17:00:00Z','2027-01-04'],
 ]){
   const t=Date.parse(winterOrSummer);
   assert.deepEqual(collectionSlot(t),{week:monday,eligible:true});
   assert.deepEqual(collectionSlot(t-1000),{week:monday,eligible:false});
 }
 assert.equal(collectionSlot(Date.parse('2027-01-01T12:00:00Z')).week,'2026-12-28');
});
test('malformed or future reservation fails closed; valid empty state reserves once',()=>{
 const first=Date.parse('2026-11-30T17:00:00Z');
 const empty={lastAttemptDate:null,lastAttemptAt:null};
 assert.ok(reserve(empty,first));
 for(const invalid of [{},{lastAttemptDate:'2026-11-25',lastAttemptAt:null},{lastAttemptDate:'2026-11-24',lastAttemptAt:'2026-11-25T11:00:00Z'},{lastAttemptDate:'2026-12-01',lastAttemptAt:'2026-12-01T01:00:00Z'},{lastAttemptDate:'2026-11-25',lastAttemptAt:'2026-11-25T11:00:00Z',lastAttemptWeek:'2026-11-16'}]) assert.equal(reserve(invalid,first),null);
 assert.equal(hasCurrentReservation(empty,first),false);
});

test('account-only preflight calls exactly the free Account API, never the author search',async()=>{
 let n=0;
 assert.equal(await verifyFreeAccount({key:'test-only',fetcher:async url=>{
   n++;
   assert.equal(url.hostname,'serpapi.com');
   assert.equal(url.pathname,'/account.json');
   return response(account);
 }}),true);
 assert.equal(n,1);
});
test('account-only preflight fails closed on missing key, paid or depleted plan',async()=>{
 let n=0;
 await assert.rejects(verifyFreeAccount({fetcher:async()=>{n++;return response(account)}}));
 assert.equal(n,0);
 for(const change of [{plan_monthly_price:1},{plan_searches_left:19},{extra_credits:1}]){
   await assert.rejects(verifyFreeAccount({key:'test-only',fetcher:async url=>{
     n++;
     assert.equal(url.pathname,'/account.json');
     return response({...account,...change});
   }}));
 }
 assert.equal(n,3);
});

test('explicit one-time direct migration acceptance preserves the historical bridge attempt and the weekly cap',()=>{
 const bridge={lastAttemptDate:'2026-11-25',lastAttemptAt:'2026-11-25T11:03:13.654Z'};
 const time=Date.parse('2026-11-25T12:01:00Z');
 assert.equal(reserve(bridge,time),null);
 const next=reserve(bridge,time,{migrationTest:true});
 assert.equal(next.lastAttemptWeek,'2026-11-23');
 assert.equal(next.migrationAcceptance.priorBridgeAttemptAt,bridge.lastAttemptAt);
 assert.equal(next.migrationAcceptance.directAttemptAt,next.lastAttemptAt);
 assert.ok(hasCurrentReservation(next,time));
 assert.equal(reserve(next,time+1000),null);
 assert.equal(reserve(next,time+1000,{migrationTest:true}),null);
 assert.equal(reserve({...bridge,lastAttemptWeek:'2026-11-23'},time,{migrationTest:true}),null);
 assert.equal(reserve({...bridge,lastAttemptAt:'2026-11-25T11:03:13.655Z'},time,{migrationTest:true}),null);
 assert.equal(reserve(bridge,Date.parse('2026-11-30T17:00:00Z'),{migrationTest:true}),null);
 assert.equal(reserve(bridge,time-86400000,{migrationTest:true}),null);
 const following=reserve(next,Date.parse('2026-11-30T17:00:00Z'));
 assert.deepEqual(following.migrationAcceptance,next.migrationAcceptance);
 assert.equal(following.lastAttemptWeek,'2026-11-30');
});

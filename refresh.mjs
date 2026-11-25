import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROFILE_ID = '01amzbYAAAAJ';
export const PROFILE_URL = 'https://scholar.google.com/citations?user=' + PROFILE_ID;
export const SOURCE = 'google-scholar-via-serpapi';
export const COLLECTION_TIMEZONE = 'America/Los_Angeles';
const DAY = 86400000;
const MAX_BYTES = 128 * 1024;
const MAX_CITATIONS = 1_000_000_000;

function strictTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const t = Date.parse(value);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) return NaN;
  return t;
}

export function validateSnapshot(value, now = Date.now()) {
  if (!value || value.source !== SOURCE || value.profileId !== PROFILE_ID ||
      value.profileUrl !== PROFILE_URL || !Number.isSafeInteger(value.citations) ||
      value.citations < 0 || value.citations > MAX_CITATIONS) throw new Error('Invalid Scholar source or count');
  const t = strictTime(value.fetchedAt);
  if (!Number.isFinite(t) || t > now + 300000) throw new Error('Invalid source timestamp');
  return {schemaVersion:1, source:SOURCE, profileId:PROFILE_ID, profileUrl:PROFILE_URL, citations:value.citations, fetchedAt:new Date(t).toISOString()};
}

export function chooseSnapshot(old, incoming, now = Date.now()) {
  const a = validateSnapshot(old, now);
  const b = validateSnapshot(incoming, now);
  const delta = Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt);
  if (delta < 0 || (delta === 0 && b.citations !== a.citations)) throw new Error('Older or conflicting sample');
  if (now - Date.parse(b.fetchedAt) > 45 * DAY) throw new Error('Incoming source sample expired');
  return delta === 0 ? a : b;
}

export function approvedFreePlan(a) {
  return a?.account_status === 'Active' && a.plan_id === 'free' &&
    /\bfree\b/i.test(a.plan_name || '') && a.plan_monthly_price === 0 &&
    Number.isSafeInteger(a.searches_per_month) && a.searches_per_month > 0 &&
    a.searches_per_month <= 250 && a.extra_credits === 0 &&
    Number.isSafeInteger(a.plan_searches_left) && a.plan_searches_left >= 20 &&
    a.plan_searches_left <= a.searches_per_month &&
    a.total_searches_left === a.plan_searches_left &&
    Number.isSafeInteger(a.this_hour_searches) && a.this_hour_searches >= 0 &&
    a.this_hour_searches < 40;
}

async function json(url, fetcher, signal) {
  try {
    const res = await fetcher(url, {method:'GET',headers:{Accept:'application/json'},redirect:'error',signal});
    if (!res.ok || !/\bapplication\/json\b/i.test(res.headers.get('content-type') || '')) throw new Error();
    if (res.url) {
      const actual = new URL(res.url);
      const expected = new URL(url);
      if (actual.protocol !== 'https:' || actual.hostname !== expected.hostname || actual.pathname !== expected.pathname) throw new Error();
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error();
    const decoder = new TextDecoder();
    let bytes = 0, text = '';
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new Error();
        text += decoder.decode(value,{stream:true});
      }
      text += decoder.decode();
      return JSON.parse(text);
    } finally {
      await reader.cancel().catch(()=>{});
      reader.releaseLock();
    }
  } catch {
    // Never print a provider URL, Account API body or credential.
    throw new Error('Source response unavailable or invalid');
  }
}

// Account-only validation uses the provider's free Account API, never an author search.
export async function verifyFreeAccount({key='',fetcher=fetch,signal=AbortSignal.timeout(15000)}={}) {
  if (!key.trim()) throw new Error('Scholar credential is not configured');
  const accountURL = new URL('https://serpapi.com/account.json');
  accountURL.searchParams.set('api_key',key);
  if (!approvedFreePlan(await json(accountURL,fetcher,signal))) throw new Error('Free-plan quota guard rejected query');
  return true;
}

export async function collect({key='',fetcher=fetch,now=Date.now()}={}) {
  const signal = AbortSignal.timeout(15000);
  // The configured independent collector is the sole acquisition owner. Fail closed if unavailable.
  await verifyFreeAccount({key,fetcher,signal});
  const searchURL = new URL('https://serpapi.com/search.json');
  for (const [k,v] of Object.entries({engine:'google_scholar_author',author_id:PROFILE_ID,hl:'en',num:'1',api_key:key})) searchURL.searchParams.set(k,v);
  const data = await json(searchURL,fetcher,signal);
  let profile;
  try {profile=new URL(data.search_metadata.google_scholar_author_url)} catch {throw new Error('Invalid author URL')}
  if (data.search_metadata?.status !== 'Success' || data.search_parameters?.engine !== 'google_scholar_author' ||
      data.search_parameters?.author_id !== PROFILE_ID || typeof data.author?.name !== 'string' || !data.author.name.trim() ||
      profile.protocol !== 'https:' || profile.hostname !== 'scholar.google.com' ||
      profile.pathname !== '/citations' || profile.searchParams.get('user') !== PROFILE_ID) throw new Error('Wrong author or provider status');
  const processed = data.search_metadata.processed_at;
  if (typeof processed !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(processed)) throw new Error('Invalid provider timestamp');
  const fetchedAt=processed.replace(' ','T').replace(' UTC','.000Z');
  const sample=validateSnapshot({source:SOURCE,profileId:PROFILE_ID,profileUrl:PROFILE_URL,citations:data.cited_by?.table?.[0]?.citations?.all,fetchedAt},now);
  if (now-Date.parse(sample.fetchedAt)>2*3600000) throw new Error('Provider observation too old');
  return sample;
}

function read(path) {return JSON.parse(readFileSync(path,'utf8'))}
function write(path,value) {writeFileSync(path,JSON.stringify(value,null,2)+'\n')}
const localCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone:COLLECTION_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});

// A week is a local Monday-Sunday calendar week, not a fixed UTC interval.
// Compute the Monday from the local calendar date so DST and year boundaries are safe.
export function collectionSlot(now = Date.now()) {
  const parts=Object.fromEntries(localCalendar.formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const localDay=Date.UTC(+parts.year,+parts.month-1,+parts.day);
  const weekday=(new Date(localDay).getUTCDay()+6)%7;
  const monday=new Date(localDay-weekday*DAY).toISOString().slice(0,10);
  return {week:monday,eligible:weekday!==0 || Number(parts.hour)>=9};
}

export function reserve(state, now = Date.now()) {
  const date=new Date(now).toISOString();
  const slot=collectionSlot(now);
  if (!slot.eligible || !state || typeof state!=='object' || !Object.hasOwn(state,'lastAttemptDate') || !Object.hasOwn(state,'lastAttemptAt')) return null;
  // Preserve the original daily reservation when migrating to weekly scheduling.
  // Do not reset the current week merely because the cadence has changed.
  if (state.lastAttemptAt!==null || state.lastAttemptDate!==null || state.lastAttemptWeek!=null) {
    const previous=strictTime(state.lastAttemptAt);
    if (!Number.isFinite(previous) || previous>now ||
        state.lastAttemptDate!==new Date(previous).toISOString().slice(0,10)) return null;
    const previousWeek=collectionSlot(previous).week;
    if (state.lastAttemptWeek!=null && state.lastAttemptWeek!==previousWeek) return null;
    if (previousWeek>=slot.week) return null;
  }
  return {lastAttemptWeek:slot.week,lastAttemptDate:date.slice(0,10),lastAttemptAt:date};
}

export function hasCurrentReservation(state, now=Date.now()) {
  const slot=collectionSlot(now);
  const reservedAt=strictTime(state?.lastAttemptAt);
  return slot.eligible && Number.isFinite(reservedAt) && reservedAt<=now &&
    state.lastAttemptDate===new Date(reservedAt).toISOString().slice(0,10) &&
    state.lastAttemptWeek===slot.week && collectionSlot(reservedAt).week===slot.week &&
    collectionSlot(reservedAt).eligible;
}

async function main() {
  if (process.argv[2]==='verify-account') {
    await verifyFreeAccount({key:process.env.SERPAPI_API_KEY || ''});
    console.log('PASS: active Free plan, $0 monthly price, no extra credits, quota guard satisfied. Account API only; no author search attempted.');
  } else if (process.argv[2]==='reserve') {
    const next=reserve(read('refresh-state.json'));
    if (next) write('refresh-state.json',next);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,'run='+Boolean(next)+'\n');
    console.log(next?'Reserved one Los Angeles calendar-week collection attempt':'Skipped: weekly slot not eligible, already reserved, or invalid state');
  } else if (process.argv[2]==='collect') {
    const state=read('refresh-state.json');
    if (!hasCurrentReservation(state)) throw new Error('No valid current-week reservation');
    const key=process.env.SERPAPI_API_KEY || '';
    const sample=await collect({key});
    const chosen=chooseSnapshot(read('scholar.json'),sample);
    write('scholar.json',chosen);
    console.log('Validated source snapshot via direct free-plan provider: '+chosen.citations+' at '+chosen.fetchedAt);
  } else throw new Error('Expected verify-account, reserve or collect');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{console.error('Scholar refresh failed; last verified data retained');process.exitCode=1});
}

const LibraryImport = (() => {
 function csv(text){
  const records=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){const c=text[i];
   if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;}
   else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()))records.push(row);row=[];}}
   else if(c==='"'){if(field||closed)throw Error('Malformed CSV quotes');quoted=true;}
   else {if(closed)throw Error('Unexpected text after CSV quote');field+=c;}
  }
  if(quoted)throw Error('Unclosed CSV quote');if(field||row.length||closed){row.push(field);if(row.some(x=>x.trim()))records.push(row);}
  const headers=(records.shift()||[]).map(x=>x.trim().toLowerCase());
  if(!headers.some(x=>['name','title'].includes(x)))throw Error('CSV requires a name or title header');
  return records.map((r,i)=>{if(r.length!==headers.length)throw Error('CSV row '+(i+2)+' has wrong number of fields');return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});
 }
 function normalize(rows){
  if(!Array.isArray(rows))throw Error('Expected a JSON array or {"games": [...]}');
  if(rows.length>30000)throw Error('Maximum 30,000 entries');
  let duplicates=0,missingSources=0;const games=[],seen=new Set();
  for(const [i,r] of rows.entries()){
   if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Entry '+(i+1)+' must be an object');
   const row=Object.fromEntries(Object.entries(r).map(([k,v])=>[k.toLowerCase(),v]));
   const name=row.name??row.title;let source=row.source??row.library??row.store;
   if(typeof name!=='string'||!name.trim()||name.trim().length>255)throw Error('Entry '+(i+1)+' requires a title of 1?255 characters');
   if(source==null||source===''){source='Manual import';missingSources++;}
   if(typeof source!=='string'||!source.trim()||source.trim().length>100)throw Error('Entry '+(i+1)+' has an invalid source');
   const game={name:name.trim(),source:source.trim()};
   for(const key of ['id','storeId','completionStatus','version','updatedAt','completionStatusId'])if(typeof row[key.toLowerCase()]==='string')game[key]=row[key.toLowerCase()].slice(0,255);
   for(const key of ['platformIds','tagIds','categoryIds']){const values=row[key.toLowerCase()];if(Array.isArray(values)&&values.length<=1000&&values.every(x=>typeof x==='string'))game[key]=values.map(x=>x.slice(0,100));}
   if(typeof row.isinstalled==='boolean')game.isInstalled=row.isinstalled;
   if(Number.isFinite(row.playtimeseconds)&&row.playtimeseconds>=0)game.playtimeSeconds=row.playtimeseconds;
   const key=(game.name+'|'+game.source).normalize('NFKC').toLowerCase();
   if(seen.has(key)){duplicates++;continue;}seen.add(key);games.push(game);
  }
  if(!games.length)throw Error('No game titles found');return {games,duplicates,missingSources};
 }
 function parse(text,filename){text=text.replace(/^\uFEFF/,'');if(!text.trim())throw Error('File is empty');if(!/\.(json|csv)$/i.test(filename))throw Error('Choose a .json or .csv file');if(/\.csv$/i.test(filename))return normalize(csv(text));let data;try{data=JSON.parse(text);}catch(e){throw Error('Invalid JSON: '+e.message);}return normalize(Array.isArray(data)?data:data?.games);}
 return {parse,normalize};
})();

const HOST = 'com.gamelibraryguard.bridge';
const api = globalThis.browser || globalThis.chrome;
function nativeRequest(dbPath,backend='db',action='get_library',pageOffset=0) {
  if (typeof browser !== 'undefined') return browser.runtime.sendNativeMessage(HOST, {action, backend, db_path:dbPath||undefined,page_offset:pageOffset});
  return new Promise((resolve, reject) => {
    try {
      api.runtime.sendNativeMessage(HOST, {action, backend, db_path:dbPath||undefined,page_offset:pageOffset}, response => {
        if (api.runtime.lastError) reject(Error(api.runtime.lastError.message));
        else resolve(response);
      });
    } catch(e) { reject(e); }
  });
}

// Serialize writes, including migration and mode changes during a native request.
let pending=Promise.resolve();
function enqueue(task){const result=pending.then(task);pending=result.catch(()=>{});return result;}
async function snapshot(update={}){
 const v=await api.storage.local.get(['games','manualGames','playniteGames','importMode','libraryInput']);
 const manualGames=v.manualGames??(v.importMode==='manual'||!v.libraryInput?v.games||[]:[]);
 const playniteGames=v.playniteGames??(v.importMode!=='manual'&&v.libraryInput?v.games||[]:[]);
 const next={manualGames,playniteGames,...update};
 next.games=[...new Map([...next.manualGames,...next.playniteGames].map(g=>[(g.name+'|'+g.source).normalize('NFKC').toLowerCase(),g])).values()];
 await api.storage.local.set(next);return next;
}
async function syncLibrary(options={}) {
 const stored=await api.storage.local.get(['games','manualGames','playniteGames']);
 if(!Array.isArray(stored.games)||!Array.isArray(stored.manualGames)||!Array.isArray(stored.playniteGames))await snapshot();
 const {importMode,playniteDbPath,playniteBackend='db'}=await api.storage.local.get(['importMode','playniteDbPath','playniteBackend']);
 if(importMode==='manual')return {ok:true,manual:true};
 await api.storage.local.set({syncState:'importing'});
 try{
  const message=await nativeRequest(playniteDbPath,playniteBackend);
  if(message&&Array.isArray(message.games)){
   let offset=message.next_offset;
   while(offset!=null){
    if(!Number.isInteger(offset)||offset!==message.games.length||offset>30000)throw Error('Invalid library page offset');
    const page=await nativeRequest(playniteDbPath,playniteBackend,'get_library',offset);
    if(!page||!Array.isArray(page.games)||!page.games.length)throw Error(page?.error||'Invalid library page');
    if(page.revision!==message.revision||page.total_count!==message.total_count)throw Error('Playnite library changed during synchronization. Refresh Library to try again.');
    message.games.push(...page.games);if(message.games.length>30000)throw Error('Library exceeds 30,000 records');offset=page.next_offset;
   }
   if(message.total_count!=null&&message.games.length!==message.total_count)throw Error('Incomplete library transfer');
  }
  if(!message||!Array.isArray(message.games))throw Error(message?.error||'Invalid library response');
  const games=message.games.length?LibraryImport.normalize(message.games).games:[];
  // A user may have paused synchronization while the native request was running.
  const current=await api.storage.local.get(['importMode','playniteDbPath','playniteBackend']);
  if(current.importMode==='manual'||current.playniteDbPath!==playniteDbPath||(current.playniteBackend||'db')!==playniteBackend){await api.storage.local.set({syncState:'disconnected'});return {ok:true,manual:true};}
  const previous=await api.storage.local.get('libraryRevision');
  const state={lastSync:Date.now(),syncError:null,syncState:'connected',libraryInput:message.source_type||'playnite_db',syncWarning:message.warning||null,playniteResolvedPath:message.db_path||null};
  // Big-drop protection: a sudden large shrink (wrong folder, empty or damaged database) never silently replaces
  // your library. The current library stays in use and the popup asks you first.
  const prior=(await api.storage.local.get(['playniteGames','dismissedDropRevision']));
  const priorCount=(prior.playniteGames||[]).length;
  if(!(message.revision&&previous.libraryRevision===message.revision)&&!options.acceptDrop&&priorCount>=50&&games.length<priorCount*0.5){
   if(prior.dismissedDropRevision!==message.revision)await api.storage.local.set({lastSync:Date.now(),syncState:'needs_review',syncError:null,pendingDrop:{count:games.length,previous:priorCount,revision:message.revision||null,path:message.db_path||null,at:Date.now()}});
   else await api.storage.local.set({lastSync:Date.now()});
   return {ok:false,needsReview:true,count:games.length,previous:priorCount};
  }
  state.pendingDrop=null;
  if(message.revision&&previous.libraryRevision===message.revision)await api.storage.local.set(state);
  else await snapshot({...state,playniteGames:games,libraryRevision:message.revision||null,lastLibraryChange:Date.now()});
  return {ok:true,count:games.length};
 }catch(e){const error=String(e.message||e);await api.storage.local.set({syncError:error,syncState:/host|native|not found/i.test(error)?'disconnected':'failed'});return {ok:false,error};}
}
async function chooseDatabase(){
 try{
  const selection=await nativeRequest(undefined,'db','choose_database');
  if(selection?.cancelled)return {ok:true,cancelled:true};
  if(!selection||typeof selection.db_path!=='string'||!/(?:^|[\\/])games\.db$/i.test(selection.db_path))throw Error(selection?.error||'The native chooser did not return a games.db path.');
  await api.storage.local.set({playniteDbPath:selection.db_path,playniteBackend:'db',importMode:'auto'});
  return await syncLibrary();
 }catch(e){const error='Could not choose games.db. Check the updated native host is built and registered. '+String(e.message||e);await api.storage.local.set({syncError:error,syncState:'failed'});return {ok:false,error};}
}
api.runtime.onMessage.addListener((message,sender,sendResponse) => {
  // Only our own extension documents may request syncing; content scripts may only request snapshot.
  if (!message || !['GET_LIBRARY','SYNC_LIBRARY','IMPORT_MANUAL','REMOVE_MANUAL','CHOOSE_PLAYNITE_DB','RESTORE_MANUAL','CLEAR_PLAYNITE'].includes(message.type)) return false;
  // Only the extension's own pages (the popup, also when Firefox opens it in a tab) may change the library.
  const fromExtension=typeof sender.url==='string'&&sender.url.startsWith(api.runtime.getURL(''));
  if (message.type!=='GET_LIBRARY' && !fromExtension) {sendResponse({ok:false,error:'Forbidden'});return false;}
  const task = message.type==='RESTORE_MANUAL' ? enqueue(async()=>{const games=Array.isArray(message.games)&&message.games.length?LibraryImport.normalize(message.games).games:[];await snapshot({manualGames:games,manualImportedAt:Number.isFinite(message.importedAt)?message.importedAt:Date.now()});return {ok:true};})
   : message.type==='CLEAR_PLAYNITE' ? enqueue(async()=>{await snapshot({playniteGames:[],libraryRevision:null,lastSync:null,pendingDrop:null});return {ok:true};})
   : message.type==='CHOOSE_PLAYNITE_DB' ? enqueue(chooseDatabase) : message.type==='IMPORT_MANUAL' ? enqueue(async()=>{const games=LibraryImport.normalize(message.games).games;await snapshot({manualGames:games,manualImportedAt:Date.now(),importMode:'manual',syncState:'disconnected'});return {ok:true};}) : message.type==='REMOVE_MANUAL' ? enqueue(async()=>{await snapshot({manualGames:[]});return {ok:true};}) : message.type==='SYNC_LIBRARY' ? enqueue(()=>syncLibrary({acceptDrop:message.acceptDrop===true})) : (async () => { const v=await api.storage.local.get(['games','lastSync','syncError','enabled','opacity','wishlist','wishlistEnabled','gamepassOverrides','microsoftPurchases','notOwnedTitles','xboxDefaultGamePass','markedOwned','titleAliases']); if (!v.lastSync || Date.now()-v.lastSync > 90000) await enqueue(syncLibrary); return api.storage.local.get(['games','lastSync','syncError','enabled','opacity','wishlist','wishlistEnabled','gamepassOverrides','microsoftPurchases','notOwnedTitles','xboxDefaultGamePass','markedOwned','titleAliases']); })();
  Promise.resolve(task).then(sendResponse).catch(e=>sendResponse({error:String(e)}));
  return true;
});
api.runtime.onInstalled.addListener(()=>{api.storage.local.get('enabled').then(v=>{if(v.enabled===undefined)api.storage.local.set({enabled:true,opacity:25,wishlistEnabled:true,wishlist:[]});});enqueue(syncLibrary);});
// Store pages refresh ownership on GET_LIBRARY if cached snapshot is older than 90 seconds.

// Automatically refresh the Playnite snapshot. Chrome service workers wake for alarms;
// Firefox event pages also support alarms. No store credentials are accessed.
api.runtime.onStartup.addListener(() => enqueue(syncLibrary));
api.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'playnite-auto-sync') enqueue(syncLibrary);
});
api.alarms.create('playnite-auto-sync', {periodInMinutes: 1});

// Right-click "Why no badge?" on supported store pages. The page script answers; nothing leaves the browser.
const menus=api.contextMenus||api.menus;
function createMenu(){
 if(!menus)return;
 menus.removeAll(()=>menus.create({id:'glg-explain',title:'Game Library Guard: Why no badge?',contexts:['all'],documentUrlPatterns:api.runtime.getManifest().content_scripts[0].matches}));
}
api.runtime.onInstalled.addListener(createMenu);api.runtime.onStartup.addListener(createMenu);
menus?.onClicked.addListener((info,tab)=>{if(info.menuItemId==='glg-explain'&&tab?.id!=null)api.tabs.sendMessage(tab.id,{type:'GLG_EXPLAIN'},info.frameId!=null?{frameId:info.frameId}:undefined).catch?.(()=>{});});

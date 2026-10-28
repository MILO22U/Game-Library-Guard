const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
function harness(namespace='chrome',data={importMode:'manual'},native=null){
 const elements=new Map();let listener;const errors=[];const api={storage:{local:{get:async keys=>{keys=Array.isArray(keys)?keys:[keys];return structuredClone(Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]])));},set:async v=>Object.assign(data,structuredClone(v))}},runtime:{onMessage:{addListener:f=>listener=f},onInstalled:{addListener(){}},onStartup:{addListener(){}},sendNativeMessage(...args){if(namespace==='browser')return native?Promise.resolve(native):Promise.reject(Error('Native host not found'));const cb=args.at(-1);if(!native)api.runtime.lastError={message:'Native host not found'};cb(native);delete api.runtime.lastError;},getURL:p=>'chrome-extension://test/'+p,getManifest:()=>({content_scripts:[{matches:[]}]}),sendMessage:(m,sender={url:'chrome-extension://test/popup.html'})=>new Promise(resolve=>listener(m,sender,resolve))},alarms:{onAlarm:{addListener(){}},create(){}},tabs:{}};
 const ctx=vm.createContext({[namespace]:api,console,Date,Map,Set,window:{addEventListener(){}},document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,textContent:'',files:[],attributes:{},setAttribute(k,v){this.attributes[k]=v},handlers:{},addEventListener(t,f){this.handlers[t]=f},click(){this.clicks=(this.clicks||0)+1},replaceChildren(){},appendChild(){},focus(){this.focused=true}});return elements.get(id)},createElement(){return {style:{},setAttribute(){},addEventListener(){},appendChild(){}}}}});
 vm.runInContext(read('shared/library.js'),ctx);vm.runInContext(read('shared/ownership.js'),ctx);vm.runInContext('{'+read('shared/background.js')+'}',ctx);
 return {ctx,api,data,e:id=>ctx.document.getElementById(id),parse:(text,name='x.json')=>vm.runInContext(`LibraryImport.parse(${JSON.stringify(text)},${JSON.stringify(name)})`,ctx),popup:()=>vm.runInContext(read('shared/popup.js'),ctx),send:m=>api.runtime.sendMessage(m)};
}
test('JSON validation and source fallback',()=>{const h=harness();assert.equal(h.parse('[{"title":"Test"}]').missingSources,1);assert.equal(h.parse('{"games":[{"name":"Test","source":"GOG"}]}').games[0].source,'GOG');for(const raw of ['', '  ','{','null','{}','[]','[{}]','[null]','[{"name":42}]','[{"name":"Test","source":7}]'])assert.throws(()=>h.parse(raw));assert.throws(()=>h.parse('[]','games.db'));});
test('CSV quoting, BOM, newlines and malformed records',()=>{const h=harness();const r=h.parse('\uFEFFtitle,store\r\n"A, B",GOG\r\n"A ""quote""",Steam\r\n"Two\nlines",Epic','x.csv');assert.equal(r.games.length,3);assert.equal(r.games[1].name,'A "quote"');for(const s of ['','foo,store\nx,GOG','name,source\n"unfinished,GOG','name,source\nx,GOG,extra','name,source\n"x"bad,GOG'])assert.throws(()=>h.parse(s,'x.csv'));});
test('duplicates preserve separate source libraries',()=>{const r=harness().parse('[{"name":"A","source":"GOG"},{"name":"a","source":"gog"},{"name":"A","source":"Steam"}]');assert.equal(r.games.length,2);assert.equal(r.duplicates,1);});
for(const namespace of ['chrome','browser']){
 test(namespace+': picker click is synchronous and file errors visible',async()=>{const h=harness(namespace);h.popup();h.e('importFile').handlers.click();assert.equal(h.e('libraryFile').clicks,1);h.e('modeManual').checked=true;const mode=h.e('modeManual').handlers.change();assert.equal(h.e('libraryFile').clicks,2);await mode;h.e('libraryFile').files=[{name:'x.json',size:1,text:async()=>'{'}];await h.e('libraryFile').handlers.change();assert.match(h.e('manualResult').textContent,/Import failed: Invalid JSON/);h.e('libraryFile').files=[{name:'x.csv',size:30,text:async()=> 'name,source\nTest,GOG'}];await h.e('libraryFile').handlers.change();assert.match(h.e('manualResult').textContent,/Imported 1 games/);assert.equal(h.data.manualGames[0].name,'Test');});
 test(namespace+': isolated storage, refresh, replacement, restart and removal',async()=>{const h=harness(namespace,{importMode:'auto',wishlist:[{name:'Wish'}],gamepassOverrides:{x:{access:'want',progress:'completed'}},microsoftPurchases:[{name:'Purchased'}]}, {games:[{name:'Auto',source:'Steam'}]});await h.send({type:'SYNC_LIBRARY'});await h.send({type:'IMPORT_MANUAL',games:[{name:'Manual',source:'GOG'}]});assert.equal(h.data.games.length,2);assert.equal((await h.send({type:'SYNC_LIBRARY'})).manual,true);h.data.importMode='auto';await h.send({type:'SYNC_LIBRARY'});assert.equal(h.data.manualGames[0].name,'Manual');await h.send({type:'IMPORT_MANUAL',games:[{name:'Replacement',source:'Epic'}]});assert.equal(h.data.manualGames.length,1);assert.equal(h.data.games.length,2);const restarted=harness(namespace,h.data);assert.equal((await restarted.send({type:'GET_LIBRARY'})).games.length,2);await restarted.send({type:'REMOVE_MANUAL'});assert.equal(h.data.games[0].name,'Auto');assert.equal(h.data.gamepassOverrides.x.progress,'completed');assert.equal(h.data.wishlist[0].name,'Wish');assert.equal(h.data.microsoftPurchases[0].name,'Purchased');});
 test(namespace+': missing host reports disconnected and preserves games',async()=>{const h=harness(namespace,{importMode:'auto',playniteGames:[{name:'Cached',source:'Steam'}],manualGames:[]});const r=await h.send({type:'SYNC_LIBRARY'});assert.equal(r.ok,false);assert.match(r.error,/host not found/);assert.equal(h.data.syncState,'disconnected');assert.equal(h.data.games[0].name,'Cached');});
}
test('browser packages contain identical shared code and valid popup IDs',()=>{for(const browser of ['chrome','firefox']){const manifest=JSON.parse(read(browser+'/manifest.json'));assert.ok(manifest.permissions.includes('storage'));for(const file of ['popup.html','popup.css','popup.js','library.js','adapters.js','ownership.js','content.js'])assert.equal(read(browser+'/'+file),read('shared/'+file));assert.equal(read(browser+'/background.js'),read('shared/library.js')+'\n'+read('shared/background.js'));const html=read(browser+'/popup.html');for(const match of read('shared/popup.js').matchAll(/\$\('([^']+)'\)/g))assert.ok(html.includes('id="'+match[1]+'"'),match[1]);assert.ok(html.indexOf('src="library.js"')<html.indexOf('src="popup.js"'));}});

test('sync cannot erase manual data selected during a native request',async()=>{
 const h=harness('browser',{importMode:'auto',manualGames:[{name:'Manual',source:'GOG'}],playniteGames:[{name:'Old',source:'Steam'}]});
 let release,started;const waiting=new Promise(r=>started=r);
 h.api.runtime.sendNativeMessage=()=>{started();return new Promise(r=>release=r)};
 const sync=h.send({type:'SYNC_LIBRARY'});await waiting;
 h.data.importMode='manual';release({games:[{name:'New',source:'Epic'}]});
 assert.equal((await sync).manual,true);assert.equal(h.data.manualGames[0].name,'Manual');assert.equal(h.data.playniteGames[0].name,'Old');
});
test('storage failures reach import UI and leave prior library intact',async()=>{
 const h=harness();h.popup();await new Promise(r=>setImmediate(r));
 h.api.storage.local.set=async()=>{throw Error('Storage quota exceeded')};
 h.e('libraryFile').files=[{name:'games.json',size:100,text:async()=> '[{"name":"X"}]'}];
 await h.e('libraryFile').handlers.change();assert.match(h.e('manualResult').textContent,/Storage quota exceeded/);assert.equal(h.data.manualGames,undefined);
 h.e('libraryFile').files=[{name:'games.json',size:6*1024*1024}];await h.e('libraryFile').handlers.change();assert.match(h.e('manualResult').textContent,/5 MB/);
});

for(const namespace of ['chrome','browser'])test(namespace+': configured database path, unchanged revisions, metadata and warnings',async()=>{
 const h=harness(namespace,{importMode:'auto',playniteDbPath:'D:\\Portable\\library\\games.db',playniteBackend:'db'},{games:[{name:'A',source:'GOG',id:'record-id',storeId:'123',isInstalled:false,playtimeSeconds:100}],source_type:'playnite_db',revision:'r1',warning:'1 games skipped',db_path:'D:\\Portable\\library\\games.db'});
 const original=h.api.runtime.sendNativeMessage;let request;
 h.api.runtime.sendNativeMessage=(...args)=>{request=args[1];return original(...args)};
 await h.send({type:'SYNC_LIBRARY'});assert.equal(request.backend,'db');assert.equal(request.db_path,h.data.playniteDbPath);assert.equal(h.data.libraryInput,'playnite_db');assert.match(h.data.syncWarning,/skipped/);assert.equal(h.data.playniteGames[0].id,'record-id');assert.equal(h.data.playniteGames[0].isInstalled,false);
 const first=h.data.playniteGames;await h.send({type:'SYNC_LIBRARY'});assert.equal(h.data.playniteGames,first,'unchanged games must not be stored again');
});
test('adapter definitions load before content logic in both browsers',()=>{for(const browser of ['chrome','firefox'])assert.deepEqual(JSON.parse(read(browser+'/manifest.json')).content_scripts[0].js,['adapters.js','ownership.js','content-style.js','content.js']);});
test('both manifests cover every storefront adapter and shadow-DOM styles match content.css',()=>{
 const vm=require('node:vm');const c=vm.createContext({});vm.runInContext(read('shared/adapters.js')+';globalThis.A=STORE_ADAPTERS;',c);
 const wanted=[...new Set(c.A.flatMap(a=>a.matches))];assert.ok(c.A.length>=26);
 for(const browser of ['chrome','firefox']){const m=JSON.parse(read(browser+'/manifest.json'));assert.deepEqual(m.content_scripts[0].matches,wanted);assert.deepEqual(m.host_permissions,wanted);assert.equal(read(browser+'/content-style.js'),read('shared/content-style.js'));}
 const s=vm.createContext({});vm.runInContext(read('shared/content-style.js')+';globalThis.S=GLG_STYLE;',s);assert.equal(s.S,read('shared/content.css'));
});
test('connection settings action stores portable games.db path',async()=>{
 const h=harness('browser');h.popup();await new Promise(r=>setImmediate(r));
 h.e('dbPath').value='D:\\Playnite\\library\\games.db';h.e('playniteBackend').value='db';
 await h.e('saveDbPath').handlers.click();assert.equal(h.data.playniteDbPath,'D:\\Playnite\\library\\games.db');assert.equal(h.data.importMode,'auto');assert.match(h.e('status').textContent,/host not found/);
});

test('popup tabs expose only their selected panel and support keyboard navigation',async()=>{
 const h=harness();h.popup();await new Promise(r=>setImmediate(r));
 h.e('tabLibrary').handlers.click();assert.equal(h.e('panelLibrary').hidden,false);assert.equal(h.e('panelDashboard').hidden,true);assert.equal(h.e('tabLibrary').attributes['aria-selected'],'true');
 let prevented=false;h.e('tabLibrary').handlers.keydown({key:'ArrowRight',preventDefault(){prevented=true}});
 assert.equal(prevented,true);assert.equal(h.e('panelWishlist').hidden,false);assert.equal(h.e('panelLibrary').hidden,true);assert.equal(h.e('tabWishlist').focused,true);
 await h.e('viewImported').handlers.click();assert.equal(h.e('panelLibrary').hidden,false);assert.equal(h.e('libraryScope').textContent,'Manually imported games');
});
test('dashboard excludes Microsoft source-only records from owned count',async()=>{
 const h=harness('browser',{importMode:'manual',games:[{name:'Owned',source:'GOG'},{name:'Access',source:'Xbox'},{name:'Unknown',source:'Microsoft Store'}],gamepassOverrides:{access:{access:'gamepass',progress:'playing'}},wishlist:[{name:'Next',source:'Steam'}]});
 h.popup();await new Promise(r=>setImmediate(r));assert.equal(h.e('statTotal').textContent,3);assert.equal(h.e('statOwned').textContent,1);assert.equal(h.e('statPass').textContent,2);assert.equal(h.e('statWishlist').textContent,1);assert.equal(h.e('connectionBanner').attributes['data-state'],'manual');
});

test('large games.db selected in JSON/CSV importer is routed before size checks or file reads',async()=>{
 const h=harness();h.popup();await new Promise(r=>setImmediate(r));let read=false;
 h.e('libraryFile').files=[{name:'games.db',size:25*1024*1024,text:async()=>{read=true;return 'database bytes'}}];
 await h.e('libraryFile').handlers.change();assert.equal(read,false);assert.equal(h.e('connectionSetup').open,true);assert.match(h.e('manualResult').textContent,/Choose games.db/);assert.doesNotMatch(h.e('manualResult').textContent,/File exceeds 5 MB/);assert.equal(h.data.manualGames,undefined);
});
for(const namespace of ['chrome','browser'])test(namespace+': choosing games.db connects in background without a popup and preserves manual data',async()=>{
 const h=harness(namespace,{importMode:'manual',manualGames:[{name:'Manual',source:'GOG'}],playniteGames:[]});let requests=[];
 h.api.runtime.sendNativeMessage=(host,request,callback)=>{requests.push(request);const response=request.action==='choose_database'?{db_path:'D:/Portable/library/games.db'}:{games:[{name:'Auto',source:'Steam'}],source_type:'playnite_db'};if(namespace==='browser')return Promise.resolve(response);callback(response)};
 const result=await h.send({type:'CHOOSE_PLAYNITE_DB'});assert.equal(result.ok,true);assert.equal(result.count,1);assert.equal(requests[0].action,'choose_database');assert.equal(requests[1].db_path,'D:/Portable/library/games.db');assert.equal(h.data.playniteBackend,'db');assert.equal(h.data.manualGames[0].name,'Manual');assert.equal(h.data.games.length,2);
});
test('cancelling games.db chooser leaves mode and library unchanged; missing host is visible',async()=>{
 const h=harness('browser',{importMode:'manual',manualGames:[{name:'Manual',source:'GOG'}]});h.api.runtime.sendNativeMessage=async()=>({cancelled:true});
 assert.equal((await h.send({type:'CHOOSE_PLAYNITE_DB'})).cancelled,true);assert.equal(h.data.importMode,'manual');assert.equal(h.data.manualGames.length,1);
 h.api.runtime.sendNativeMessage=async()=>{throw Error('Native host not found')};const r=await h.send({type:'CHOOSE_PLAYNITE_DB'});assert.equal(r.ok,false);assert.match(r.error,/host not found/);assert.match(h.data.syncError,/registered/);
});

test('paged native library is assembled completely before replacing cached games',async()=>{
 const h=harness('browser',{importMode:'auto',manualGames:[{name:'Manual',source:'GOG'}],playniteGames:[]});
 h.api.runtime.sendNativeMessage=async(host,request)=>request.page_offset===0?{games:[{name:'First',source:'Steam'}],revision:'same',total_count:2,next_offset:1}:{games:[{name:'Second',source:'Epic'}],revision:'same',total_count:2,next_offset:null};
 const result=await h.send({type:'SYNC_LIBRARY'});assert.equal(result.ok,true);assert.equal(h.data.playniteGames.length,2);assert.equal(h.data.games.length,3);
});
test('changing revision between pages preserves previous library',async()=>{
 const h=harness('browser',{importMode:'auto',manualGames:[],playniteGames:[{name:'Previous',source:'GOG'}]});
 h.api.runtime.sendNativeMessage=async(host,request)=>request.page_offset===0?{games:[{name:'First',source:'Steam'}],revision:'one',total_count:2,next_offset:1}:{games:[{name:'Second',source:'Epic'}],revision:'two',total_count:2,next_offset:null};
 const result=await h.send({type:'SYNC_LIBRARY'});assert.equal(result.ok,false);assert.match(result.error,/changed during/);assert.equal(h.data.playniteGames[0].name,'Previous');
});

test('Microsoft review treats confirmed purchases as owned even with a saved Game Pass override',async()=>{
 const h=harness('browser',{importMode:'manual',games:[{name:'Halo: Infinite',source:'Xbox'}],gamepassOverrides:{'halo: infinite':{access:'gamepass',progress:'completed'}},microsoftPurchases:[{name:'Halo Infinite'}]});
 h.popup();await new Promise(r=>setImmediate(r));assert.match(h.e('microsoftSummary').textContent,/1 owned \/ 0 Game Pass/);assert.equal(h.e('statOwned').textContent,1);assert.equal(h.e('statPass').textContent,0);
 h.e('passFilter').value='owned';await h.e('passFilter').handlers.change();assert.match(h.e('microsoftSummary').textContent,/1 owned/);
});

test('Microsoft purchase review saves its title before opening orders and restores it after popup recreation',async()=>{
 const h=harness();h.popup();await new Promise(r=>setImmediate(r));let opened;
 h.api.tabs.create=async options=>{opened=options.url;assert.equal(h.data.microsoftReviewTitle,'Halo')};
 vm.runInContext("selectedPassGame={name:'Halo',source:'Xbox'}",h.ctx);await h.e('reviewPurchase').handlers.click();assert.equal(opened,'https://account.microsoft.com/billing/orders');
 const reopened=harness('chrome',h.data);reopened.popup();await new Promise(r=>setImmediate(r));assert.equal(reopened.e('purchaseTitles').value,'Halo');assert.equal(reopened.e('purchaseConfirm').checked,false);assert.equal(reopened.e('purchaseSection').open,true);
});

test('Microsoft update uses local Playnite bridge and reports manual mode instead of pretending account connection',async()=>{
 const h=harness();h.popup();await new Promise(r=>setImmediate(r));await h.e('refreshMicrosoftLibrary').handlers.click();assert.match(h.e('microsoftSyncStatus').textContent,/paused in Manual mode/);assert.equal(h.e('refreshMicrosoftLibrary').disabled,false);
});
test('Microsoft update reports fresh local records and a missing host without collecting account credentials',async()=>{
 const h=harness('browser',{importMode:'auto'},{games:[{name:'Halo',source:'Xbox'}],source_type:'playnite_db'});h.popup();await new Promise(r=>setImmediate(r));await h.e('refreshMicrosoftLibrary').handlers.click();assert.match(h.e('microsoftSyncStatus').textContent,/1 Xbox \/ Microsoft records refreshed from Playnite/);
 h.api.runtime.sendNativeMessage=async()=>{throw Error('Native host not found')};await h.e('refreshMicrosoftLibrary').handlers.click();assert.match(h.e('microsoftSyncStatus').textContent,/Update failed.*host not found/);
});

test('not-owned Game Pass correction removes only the selected Microsoft purchase claim and preserves progress',async()=>{
 const h=harness('browser',{importMode:'manual',games:[{name:'Gears of War: Reloaded',source:'Xbox'}],gamepassOverrides:{'gears of war: reloaded':{access:'owned',progress:'completed'}},microsoftPurchases:[{name:'Gears of War: Reloaded'},{name:'Other Purchase'}]});h.popup();await new Promise(r=>setImmediate(r));
 vm.runInContext("selectedPassGame={name:'Gears of War: Reloaded',source:'Xbox'}",h.ctx);await h.e('markGamePass').handlers.click();assert.equal(h.data.gamepassOverrides['gears of war: reloaded'].access,'gamepass');assert.equal(h.data.gamepassOverrides['gears of war: reloaded'].progress,'completed');assert.equal(h.data.microsoftPurchases.length,1);assert.equal(h.data.microsoftPurchases[0].name,'Other Purchase');
});

test('big-drop protection keeps the current Playnite library until the user accepts the smaller one',async()=>{
 const many=Array.from({length:100},(_,i)=>({name:'Game '+i,source:'Steam'}));
 const h=harness('chrome',{importMode:'auto',playniteGames:many,manualGames:[],games:many,libraryRevision:'r1'},{games:[{name:'Only One',source:'Steam'}],revision:'r2',total_count:1,next_offset:null});
 const r=await h.send({type:'SYNC_LIBRARY'});assert.equal(r.needsReview,true);
 assert.equal(h.data.playniteGames.length,100);assert.equal(h.data.games.length,100);assert.equal(h.data.syncState,'needs_review');assert.deepEqual([h.data.pendingDrop.count,h.data.pendingDrop.previous],[1,100]);
 const ok=await h.send({type:'SYNC_LIBRARY',acceptDrop:true});assert.equal(ok.ok,true);assert.equal(h.data.playniteGames.length,1);assert.equal(h.data.pendingDrop,null);
});
test('small changes and growth sync normally without review',async()=>{
 const many=Array.from({length:100},(_,i)=>({name:'Game '+i,source:'Steam'}));
 const h=harness('chrome',{importMode:'auto',playniteGames:many,manualGames:[],games:many,libraryRevision:'r1'},{games:many.slice(0,90),revision:'r3',total_count:90,next_offset:null});
 const r=await h.send({type:'SYNC_LIBRARY'});assert.equal(r.ok,true);assert.equal(h.data.playniteGames.length,90);
});
test('store pages cannot change the library; only extension pages can',async()=>{
 const h=harness('chrome',{importMode:'manual',manualGames:[],playniteGames:[],games:[]});
 const denied=await h.api.runtime.sendMessage({type:'IMPORT_MANUAL',games:[{name:'X',source:'GOG'}]},{url:'https://store.steampowered.com/',tab:{id:1}});
 assert.equal(denied.ok,false);assert.equal(denied.error,'Forbidden');assert.equal(h.data.manualGames.length,0);
 const allowed=await h.api.runtime.sendMessage({type:'IMPORT_MANUAL',games:[{name:'X',source:'GOG'}]},{url:'chrome-extension://test/popup.html?tab=import',tab:{id:2}});
 assert.equal(allowed.ok,true);assert.equal(h.data.manualGames.length,1);
});
test('Delete Playnite copy keeps manual imports and the connection; restore puts manual imports back',async()=>{
 const h=harness('chrome',{importMode:'auto',playniteDbPath:'D:\\lib\\games.db',playniteGames:[{name:'P',source:'Steam'}],manualGames:[{name:'M',source:'GOG'}],games:[]});
 await h.send({type:'CLEAR_PLAYNITE'});assert.equal(h.data.playniteGames.length,0);assert.equal(h.data.manualGames.length,1);assert.equal(h.data.playniteDbPath,'D:\\lib\\games.db');assert.equal(h.data.importMode,'auto');assert.equal(h.data.lastSync,null);
 await h.send({type:'RESTORE_MANUAL',games:[{name:'R',source:'Epic'}],importedAt:5});assert.deepEqual(h.data.manualGames.map(g=>g.name),['R']);assert.equal(h.data.importMode,'auto');
});
test('popup has backup, restore, what-is-stored and big-drop review controls',()=>{
 const html=read('shared/popup.html');for(const id of ['dropReview','keepLibrary','acceptDrop','exportBackup','importBackup','backupFile','storedList','deleteFixes','deleteManual','deletePlaynite','deleteAll'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.doesNotMatch(html,/Blue badges for games you're watching/);
});

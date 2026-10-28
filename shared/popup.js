const api=globalThis.browser||globalThis.chrome;
const $=id=>document.getElementById(id);
let reviewLoaded=false;
async function show(){
 const v=await api.storage.local.get(['games','enabled','opacity','wishlistEnabled','wishlist','lastSync','syncError','importMode','gamepassOverrides','playniteDbPath','libraryInput','syncState','syncWarning','playniteBackend','playniteResolvedPath','microsoftPurchases','manualGames','playniteGames','manualImportedAt','microsoftReviewTitle','xboxDefaultGamePass']);
 $('xboxDefaultGamePass').checked=v.xboxDefaultGamePass!==false;
 $('enabled').checked=v.enabled!==false;$('wishlistEnabled').checked=v.wishlistEnabled!==false;
 $('opacity').value=v.opacity??25;$('pct').textContent=$('opacity').value;
 $('modeManual').checked=v.importMode==='manual';$('modeAuto').checked=v.importMode!=='manual';displayMode(v.importMode||'auto');
 $('dbPath').value=v.playniteDbPath||'';$('playniteBackend').value=v.playniteBackend||'db';
 if(!reviewLoaded){reviewLoaded=true;if(v.microsoftReviewTitle){$('purchaseTitles').value=v.microsoftReviewTitle;$('purchaseConfirm').checked=false;$('purchaseSection').open=true;}}
 const manual=v.importMode==='manual',state=manual?'manual':v.syncState||'disconnected';
 $('connectionBanner').setAttribute('data-state',state);
 $('connectionTitle').textContent=manual?'Manual library ready':state==='connected'?'Playnite snapshot available':state==='importing'?'Checking Playnite':state==='failed'?'Playnite needs attention':state==='needs_review'?'Playnite library needs your review':'Connect your Playnite library';
 const method=v.libraryInput==='playnite_db'?'games.db':'SDK export';
 $('status').textContent=manual?(v.manualGames?.length||0)+' manual records / Playnite checks paused':v.syncError?v.syncError:state==='connected'?(v.playniteGames?.length||0)+' records from '+method+' / cached locally':'Import a file, or set up the local Playnite bridge.';
 $('statTotal').textContent=v.games?.length||0;
 const confirmed=new Set((v.microsoftPurchases||[]).map(x=>OWNERSHIP_MATCHER.normalize(x.name)));let owned=0,pass=0;
 for(const game of v.games||[]){const access=(v.gamepassOverrides||{})[passKey(game)]?.access;
  if(confirmed.has(OWNERSHIP_MATCHER.normalize(game.name))||access==='owned')owned++;
  else if(relevantPassGame(game)){if(microsoftState(v,game).access==='owned')owned++;else if(['gamepass','done','want'].includes(microsoftState(v,game).access))pass++;}
  else owned++;
 }
 $('statOwned').textContent=owned;$('statPass').textContent=pass;$('statWishlist').textContent=v.wishlist?.length||0;
 renderOwned(v);renderPassGames(v);renderSafety();$('libraryScope').textContent='Manual + Playnite records';
 $('syncDetail').textContent=(v.lastSync?'Last successful Playnite check: '+new Date(v.lastSync).toLocaleString():'No successful Playnite check yet.')+(v.syncWarning?' / '+v.syncWarning:'')+(v.playniteResolvedPath?' / '+v.playniteResolvedPath:'');
 const ul=$('wishes');ul.replaceChildren();
 if(!v.wishlist?.length){const li=document.createElement('li');li.className='empty-state';li.textContent='Your next adventure starts here. Add a title above.';ul.appendChild(li);}
 for(const [i,w] of (v.wishlist||[]).entries()){
  const li=document.createElement('li'),label=document.createElement('span');label.textContent=w.name+' / '+w.source;li.appendChild(label);
  const remove=document.createElement('button');remove.textContent='\u00d7';remove.setAttribute('aria-label','Remove '+w.name);
  remove.addEventListener('click',async()=>{const items=(await api.storage.local.get('wishlist')).wishlist||[];items.splice(i,1);await api.storage.local.set({wishlist:items});show();});li.appendChild(remove);ul.appendChild(li);
 }
}
$('enabled').addEventListener('change',()=>api.storage.local.set({enabled:$('enabled').checked}));
$('wishlistEnabled').addEventListener('change',()=>api.storage.local.set({wishlistEnabled:$('wishlistEnabled').checked}));
$('opacity').addEventListener('input',()=>{$('pct').textContent=$('opacity').value;api.storage.local.set({opacity:Number($('opacity').value)});});
function displayMode(mode){$('manualControls').hidden=false;$('autoControls').hidden=false;}
for(const id of ['modeAuto','modeManual']) $(id).addEventListener('change',async()=>{const mode=$('modeManual').checked?'manual':'auto';if(mode==='manual')openImport();await api.storage.local.set({importMode:mode});displayMode(mode);if(mode==='auto'){$('status').textContent='Importing: checking Playnite...';await api.runtime.sendMessage({type:'SYNC_LIBRARY'});}show();});
// Firefox closes a toolbar popup when a file chooser opens, losing the chosen file. There, import runs in a normal tab.
const firefoxPopup=typeof api.runtime.getBrowserInfo==='function'&&!/[?&]tab=/.test(globalThis.location?.search||'');
function openImport(){if(firefoxPopup){api.tabs.create({url:api.runtime.getURL('popup.html?tab=import')});window.close();return;}selectTab('Dashboard');displayMode('manual');$('libraryFile').value='';$('libraryFile').click();}
$('importFile').addEventListener('click',openImport);
$('viewImported').addEventListener('click',async()=>{const v=await api.storage.local.get(['manualGames','playniteGames','manualImportedAt','lastSync','libraryInput','gamepassOverrides','microsoftPurchases','wishlist']);selectTab('Library');renderOwned({...v,games:v.manualGames||[]});$('libraryScope').textContent='Manually imported games';$('searchOwned').focus();$('manualResult').textContent='Showing manual imports only.';});
$('removeImported').addEventListener('click',async()=>{try{const r=await api.runtime.sendMessage({type:'REMOVE_MANUAL'});if(!r?.ok)throw Error(r?.error||'No background response');await show();$('manualResult').textContent='Removed manually imported library.';}catch(e){$('manualResult').textContent='Remove failed: '+e.message;}});
$('libraryFile').addEventListener('change',async()=>{
 const file=$('libraryFile').files?.[0];if(!file)return;
 $('manualResult').textContent='Importing file...';
 try{if(/\.db$/i.test(file.name)){selectTab('Dashboard');$('connectionSetup').open=true;$('manualResult').textContent='games.db is a Playnite database, not JSON / CSV. Click Choose games.db in Playnite connection setup, or enter its full path and sync. The database reader supports files up to 512 MB.';return;}if(!/\.(json|csv)$/i.test(file.name))throw Error('Choose a .json or .csv file. Use Choose games.db for Playnite databases.');if(file.size>5*1024*1024)throw Error('File exceeds 5 MB limit');const result=LibraryImport.parse(await file.text(),file.name);const r=await api.runtime.sendMessage({type:'IMPORT_MANUAL',games:result.games});if(!r?.ok)throw Error(r?.error||'No background response');await show();$('manualResult').textContent='Imported '+result.games.length+' games. '+result.duplicates+' duplicates removed; '+result.missingSources+' sources labeled Manual import.';}catch(e){$('manualResult').textContent='Import failed: '+e.message;}
});
async function refreshLibrary(){
 $('connectionBanner').setAttribute('data-state','importing');$('connectionTitle').textContent='Checking your library';$('status').textContent='Importing: checking Playnite...';
 try{const r=await api.runtime.sendMessage({type:'SYNC_LIBRARY'});if(!r?.ok)throw Error(r?.error||'No background response');await show();if(r.manual)$('status').textContent='Manual library refreshed from local storage. Connect Playnite to enable synchronization.';}catch(e){await show();$('status').textContent='Disconnected / failed: '+e.message;}
}
$('refresh').addEventListener('click',refreshLibrary);
$('connectPlaynite').addEventListener('click',async()=>{selectTab('Dashboard');$('connectionSetup').open=true;try{await saveConnection();}catch(e){$('status').textContent='Connection failed: '+e.message;}});
$('addWish').addEventListener('click',async()=>{const name=$('wishName').value.trim().slice(0,255);if(!name)return;const source=$('wishSource').value.trim().slice(0,80)||'Wishlist';const items=(await api.storage.local.get('wishlist')).wishlist||[];if(!items.some(x=>x.name.toLowerCase()===name.toLowerCase()&&x.source.toLowerCase()===source.toLowerCase()))items.push({name,source});await api.storage.local.set({wishlist:items});$('wishName').value='';show();});show();

let ownedCache=[],ownedContext={};
function renderOwned(v){
  ownedContext=v;
  ownedCache=Array.isArray(v.games)?v.games:[];
  const filter=$('sourceFilter'),selected=filter.value;filter.replaceChildren();
  const all=document.createElement('option');all.value='';all.textContent='All sources';filter.appendChild(all);
  const counts=new Map();for(const g of ownedCache)counts.set(g.source,(counts.get(g.source)||0)+1);
  for(const [source,count] of [...counts.entries()].sort()){const o=document.createElement('option');o.value=source;o.textContent=source+' ('+count+')';filter.appendChild(o);}
  filter.value=counts.has(selected)?selected:'';
  let purchased=0,pass=0,unverified=0;
  const confirmed=new Set((v.microsoftPurchases||[]).map(x=>OWNERSHIP_MATCHER.normalize(x.name)));
  for(const g of ownedCache){const access=(v.gamepassOverrides||{})[passKey(g)]?.access;if(confirmed.has(OWNERSHIP_MATCHER.normalize(g.name))||access==='owned')purchased++;else if(relevantPassGame(g)&&['gamepass','done','want'].includes(access))pass++;else unverified++;}
  $('librarySummary').textContent=ownedCache.length+' library records; '+purchased+' user-confirmed purchased; '+pass+' Game Pass; '+unverified+' source records without purchase verification; '+(v.wishlist?.length||0)+' wishlist entries. Source membership is not entitlement verification.';
  renderOwnedFiltered();
}
function renderOwnedFiltered(){
  const target=$('ownedList'); target.replaceChildren();
  const q=$('searchOwned').value.trim().toLocaleLowerCase();
  const matches=ownedCache.filter(g=>typeof g.name==='string' && (g.name+' '+g.source).toLocaleLowerCase().includes(q) && (!$('sourceFilter').value||g.source===$('sourceFilter').value));
  const count=document.createElement('div');count.className='list-count';count.textContent=matches.length+' matching games ('+ownedCache.length+' total)';target.appendChild(count);
  for(const g of matches.slice(0,60)){
    const div=document.createElement('div');div.className='game-row';div.setAttribute('role','listitem');
    const recordKey=x=>(x.name+'|'+x.source).normalize('NFKC').toLowerCase();
    const manual=(ownedContext.manualGames||[]).some(x=>recordKey(x)===recordKey(g));
    const automatic=(ownedContext.playniteGames||[]).some(x=>recordKey(x)===recordKey(g));
    const access=(ownedContext.gamepassOverrides||{})[passKey(g)]?.access;
    const confirmed=(ownedContext.microsoftPurchases||[]).some(x=>OWNERSHIP_MATCHER.normalize(x.name)===OWNERSHIP_MATCHER.normalize(g.name));
    // Same status colors as the storefront badges (see popup.css).
    const passAccess=relevantPassGame(g)?microsoftState(ownedContext,g).access:'owned';
    div.setAttribute('data-status',confirmed||access==='owned'?'owned':['gamepass','done','want'].includes(passAccess)?passAccess:passAccess==='owned'?'owned':'unknown');
    const classification=confirmed||access==='owned'?'Purchased (user confirmed)':relevantPassGame(g)?({gamepass:'Game Pass access',done:'Game Pass - done, not buying',want:'Game Pass - want to own'}[access]||'No purchase confirmation saved'):'Owned based on source library (inferred)';
    const details=document.createElement('details'),summary=document.createElement('summary'),title=document.createElement('span'),source=document.createElement('span');title.className='game-title';title.textContent=g.name;source.className='source-chip';source.textContent=g.source;summary.appendChild(title);summary.appendChild(source);
    const info=document.createElement('div');info.className='game-info';info.textContent=classification+' | Imported through: '+[manual?'Manual import':null,automatic?(ownedContext.libraryInput==='playnite_db'?'Playnite games.db':'Playnite SDK export'):null].filter(Boolean).join(' + ')+
      ' | Last import/check: '+((manual?ownedContext.manualImportedAt:ownedContext.lastSync)?new Date(manual?ownedContext.manualImportedAt:ownedContext.lastSync).toLocaleString():'Unknown')+(g.id?' | Playnite ID: '+g.id:'')+(g.storeId?' | Store record ID: '+g.storeId:'')+' | Source membership does not independently verify a permanent license.';
    details.appendChild(summary);details.appendChild(info);div.appendChild(details);target.appendChild(div);
  }
  if(!matches.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent=ownedCache.length?'No games match your search. Try another title or source.':'No games here yet. Import JSON / CSV or connect Playnite from the Dashboard.';target.appendChild(empty);}
  if(matches.length>60){const note=document.createElement('small');note.textContent='Showing first 60. Narrow your search.';target.appendChild(note);}
}
$('searchOwned').addEventListener('input',renderOwnedFiltered);
// Always check Playnite when the popup opens in automatic mode.
// The background handler respects manual mode and does not overwrite a manual library.
api.storage.local.get('importMode').then(async v=>{
  if(v.importMode==='manual'){await show();return;}
  $('status').textContent='Checking Playnite for updates…';
  try { await api.runtime.sendMessage({type:'SYNC_LIBRARY'}); } catch (e) { await api.storage.local.set({syncError:e.message,syncState:'disconnected'}); }
  await show();
}).catch(()=>show());

// Manual classification deliberately overrides ambiguous Xbox/EA Playnite source information.
let passAll=[], selectedPassKey=null,selectedPassGame=null;
function passKey(g){return (g.name||'').normalize('NFKC').toLowerCase().trim();}
function relevantPassGame(g){const s=(g.source||'').toLowerCase();return /xbox|microsoft|game pass|gamepass/.test(s);}
function microsoftState(v,g){
 const normalize=OWNERSHIP_MATCHER.normalize,key=normalize(g.name);
 const confirmed=(v.microsoftPurchases||[]).some(x=>normalize(x.name)===key);
 const override=Object.entries(v.gamepassOverrides||{}).filter(([name])=>normalize(name)===key).at(-1)?.[1];
 return {access:confirmed?'owned':override?.access&&override.access!=='unknown'?override.access:(/game\s?pass/i.test(g.source)||v.xboxDefaultGamePass!==false?'gamepass':'unknown'),progress:override?.progress||'not_started',confirmed};
}
function renderPassGames(v){
 passAll=[...new Map((v.games||[]).filter(relevantPassGame).map(g=>[OWNERSHIP_MATCHER.normalize(g.name),g])).values()];
 const purchased=passAll.filter(g=>microsoftState(v,g).access==='owned').length,unverified=passAll.filter(g=>microsoftState(v,g).access==='unknown').length;
 $('microsoftSummary').textContent=purchased+' owned / '+(passAll.length-purchased-unverified)+' Game Pass. Purchase confirmations override Game Pass choices.';
 const box=$('passGames');box.replaceChildren();const query=$('passSearch').value.toLowerCase().trim(),filter=$('passFilter').value||'all';
 const results=passAll.filter(g=>{const state=microsoftState(v,g);return g.name.toLowerCase().includes(query)&&(filter==='all'||filter==='owned'&&state.access==='owned'||filter==='gamepass'&&['gamepass','done','want'].includes(state.access));}).slice(0,60);
 if(!results.length){box.textContent='No matching Xbox / Microsoft games. Choose All games or change your search.';return;}
 for(const g of results){const state=microsoftState(v,g),b=document.createElement('button');b.className='pass-game';b.setAttribute('data-access',state.access);
 b.textContent=g.name+' / '+(state.access==='owned'?(state.confirmed?'Purchased (user-confirmed)':'Owned / '+g.source):state.access==='gamepass'?'Game Pass':state.access==='done'?'Done, not buying':state.access==='want'?'Want to own':g.source)+(['gamepass','done','want'].includes(state.access)?' / '+(state.progress==='completed'?'Completed':state.progress==='playing'?'Played, unfinished':'Not started'):'');
 b.addEventListener('click',()=>{selectedPassKey=passKey(g);selectedPassGame=g;$('passEditor').hidden=false;$('passSelected').textContent=g.name+' / '+g.source;$('passAccess').value=state.access;$('passProgress').value=state.progress;$('passFeedback').textContent=state.confirmed?'A confirmed Microsoft purchase takes priority. Remove its purchase confirmation below if it was refunded or entered incorrectly.':'Choose Purchased only for a permanent license. Use Check Microsoft purchase to review order history.';});box.appendChild(b);
 }
}
async function refreshMicrosoft(){renderPassGames(await api.storage.local.get(['games','gamepassOverrides','microsoftPurchases','xboxDefaultGamePass']));}
$('passSearch').addEventListener('input',refreshMicrosoft);
$('passFilter').addEventListener('change',refreshMicrosoft);
$('reviewPurchase').addEventListener('click',async()=>{
 if(!selectedPassGame)return;
 $('purchaseSection').open=true;$('purchaseTitles').value=selectedPassGame.name;$('purchaseConfirm').checked=false;
 $('purchaseMessage').textContent='Review this exact game in Microsoft order history. Confirm a completed permanent purchase or redeemed license, then check the confirmation box and save. Game Pass/subscription entries do not count.';
 await api.storage.local.set({microsoftReviewTitle:selectedPassGame.name});
 await api.tabs.create({url:'https://account.microsoft.com/billing/orders'});
});
$('savePass').addEventListener('click',async()=>{if(!selectedPassKey)return;const v=await api.storage.local.get('gamepassOverrides');const overrides=v.gamepassOverrides||{};for(const key of Object.keys(overrides))if(OWNERSHIP_MATCHER.normalize(key)===OWNERSHIP_MATCHER.normalize(selectedPassKey))delete overrides[key];overrides[selectedPassKey]={access:$('passAccess').value,progress:$('passProgress').value};await api.storage.local.set({gamepassOverrides:overrides});await show();$('passFeedback').textContent='Access choice saved. Purchased games use blue; Game Pass uses green. Purchase confirmations still take priority.';});
$('clearPass').addEventListener('click',async()=>{if(!selectedPassKey)return;const v=await api.storage.local.get('gamepassOverrides');const overrides=v.gamepassOverrides||{};for(const key of Object.keys(overrides))if(OWNERSHIP_MATCHER.normalize(key)===OWNERSHIP_MATCHER.normalize(selectedPassKey))delete overrides[key];await api.storage.local.set({gamepassOverrides:overrides});$('passEditor').hidden=true;show();});

// Explicit, privacy-preserving order-history verification. No page-wide scraping.
function cleanPurchaseNames(raw){
  const names=[]; const seen=new Set();
  for(const line of String(raw||'').split(/\r?\n/)){
    const name=line.trim();
    if(!name || name.length>180 || /[@<>]|(?:https?:\/\/)|(?:\b(?:order number|card ending|billing address|total|subtotal|payment method|\$\s*\d|visa|mastercard)\b)/i.test(name)) continue;
    const key=name.normalize('NFKC').toLowerCase();if(!seen.has(key)){seen.add(key);names.push(name);}
  }
  return names.slice(0,100);
}
$('openOrders').addEventListener('click',()=>api.tabs.create({url:'https://account.microsoft.com/billing/orders'}));
$('captureOrders').addEventListener('click',async()=>{
  try{
    const [tab]=await api.tabs.query({active:true,currentWindow:true});
    if(!tab?.id || !/^https:\/\/account\.microsoft\.com\/billing(?:\/orders)?(?:[/?#]|$)/i.test(tab.url||''))throw Error('First open Microsoft order history, highlight game titles, then click Capture.');
    const results=await api.scripting.executeScript({target:{tabId:tab.id},func:()=>window.getSelection()?.toString().slice(0,16000)||''});
    const names=cleanPurchaseNames(results?.[0]?.result||'');
    if(!names.length)throw Error('No selected game titles found. Select ONLY game title lines, or type them below.');
    $('purchaseTitles').value=names.join('\n');
    $('purchaseConfirm').checked=false;
    $('purchaseMessage').textContent='Captured '+names.length+' possible titles. Review each title and confirm its purchase status before saving.';
  }catch(e){$('purchaseMessage').textContent=e.message||String(e);}
});
async function renderVerifiedPurchases(){
  const {microsoftPurchases=[]}=await api.storage.local.get('microsoftPurchases');
  const box=$('verifiedPurchases');box.replaceChildren();
  if(!microsoftPurchases.length){box.textContent='No purchases confirmed yet.';return;}
  for(const entry of microsoftPurchases){
    const row=document.createElement('div');row.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0';
    const label=document.createElement('span');label.textContent=entry.name+' · Microsoft';row.appendChild(label);
    const remove=document.createElement('button');remove.textContent='Remove';remove.addEventListener('click',async()=>{
      const {microsoftPurchases=[]}=await api.storage.local.get('microsoftPurchases');
      await api.storage.local.set({microsoftPurchases:microsoftPurchases.filter(x=>x.name!==entry.name)});await renderVerifiedPurchases();await show();
    });row.appendChild(remove);box.appendChild(row);
  }
}
$('savePurchases').addEventListener('click',async()=>{
  const names=cleanPurchaseNames($('purchaseTitles').value);
  if(!names.length){$('purchaseMessage').textContent='Enter at least one game title.';return;}
  if(!$('purchaseConfirm').checked){$('purchaseMessage').textContent='Review the order status and check confirmation before saving.';return;}
  const {microsoftPurchases=[]}=await api.storage.local.get('microsoftPurchases');const byKey=new Map(microsoftPurchases.map(x=>[x.name.normalize('NFKC').toLowerCase(),x]));
  for(const name of names)byKey.set(name.normalize('NFKC').toLowerCase(),{name,source:'Microsoft Store',verifiedBy:'user',confirmedAt:Date.now()});
  await api.storage.local.set({microsoftPurchases:[...byKey.values()].slice(0,3000),microsoftReviewTitle:null});
  $('purchaseTitles').value='';$('purchaseConfirm').checked=false;
  $('purchaseMessage').textContent=names.length+' user-confirmed game titles saved locally. This is not an automated Microsoft account verification.';
  await renderVerifiedPurchases();await show();
});
renderVerifiedPurchases();


window.addEventListener('unhandledrejection',event=>{$('status').textContent='Operation failed: '+(event.reason?.message||event.reason);});

async function saveConnection(){
 const path=$('dbPath').value.trim();
 if(path&&!/(?:^|[\\/])games\.db$/i.test(path))throw Error('Enter the full path to Playnite games.db.');
 await api.storage.local.set({importMode:'auto',playniteDbPath:path,playniteBackend:$('playniteBackend').value||'db'});
 displayMode('auto');await refreshLibrary();
}
$('saveDbPath').addEventListener('click',async()=>{try{await saveConnection();}catch(e){$('status').textContent='Connection failed: '+e.message;}});
$('sourceFilter').addEventListener('change',renderOwnedFiltered);

const NAV_SECTIONS=['Dashboard','Library','Wishlist','Gamepass','Settings'];
function selectTab(name){
 $('appMain').scrollTop=0;
 for(const section of NAV_SECTIONS){const active=section===name;
  $('panel'+section).hidden=!active;$('tab'+section).setAttribute('aria-selected',String(active));$('tab'+section).setAttribute('tabindex',active?'0':'-1');
 }
}
for(const [index,name] of NAV_SECTIONS.entries()){
 $('tab'+name).addEventListener('click',()=>selectTab(name));
 $('tab'+name).addEventListener('keydown',event=>{
  let next;if(event.key==='ArrowRight')next=(index+1)%NAV_SECTIONS.length;else if(event.key==='ArrowLeft')next=(index+NAV_SECTIONS.length-1)%NAV_SECTIONS.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=NAV_SECTIONS.length-1;else return;
  event.preventDefault();selectTab(NAV_SECTIONS[next]);$('tab'+NAV_SECTIONS[next]).focus();
 });
}
$('viewAllGames').addEventListener('click',async()=>{await show();$('manualResult').textContent='Showing all cached library records.';});

$('chooseDb').addEventListener('click',async()=>{
 $('manualResult').textContent='Opening the Windows games.db chooser. If this popup closes, reopen it after selecting the file; the background connection will continue.';
 try{const result=await api.runtime.sendMessage({type:'CHOOSE_PLAYNITE_DB'});if(!result?.ok)throw Error(result?.error||'No background response');await show();$('manualResult').textContent=result.cancelled?'Database selection cancelled. Your library is unchanged.':'Connected games.db: '+result.count+' games imported.';}
 catch(e){$('manualResult').textContent=e.message||String(e);}
});

$('refreshMicrosoftLibrary').addEventListener('click',async()=>{
 const button=$('refreshMicrosoftLibrary');button.disabled=true;
 $('microsoftSyncStatus').textContent='Checking the local Playnite library...';
 try{
  const result=await api.runtime.sendMessage({type:'SYNC_LIBRARY'});
  if(!result?.ok)throw Error(result?.error||'No response from the local bridge.');
  if(result.manual){$('microsoftSyncStatus').textContent='Playnite synchronization is paused in Manual mode. Connect Playnite from the Dashboard, then try again. Microsoft account sign-in is managed outside this extension.';return;}
  await show();
  const data=await api.storage.local.get(['playniteGames','lastSync']);
  const count=(data.playniteGames||[]).filter(relevantPassGame).length;
  $('microsoftSyncStatus').textContent=count+' Xbox / Microsoft records refreshed from Playnite. This is a local snapshot, not a direct Microsoft account check. Update Playnite first for new purchases.';
 }catch(e){$('microsoftSyncStatus').textContent='Update failed: '+(e.message||String(e));}
 finally{button.disabled=false;}
});

async function renderNotOwned(){
 const {notOwnedTitles=[]}=await api.storage.local.get('notOwnedTitles');const box=$('notOwnedList');box.replaceChildren();
 for(const title of notOwnedTitles){const li=document.createElement('li'),label=document.createElement('span'),remove=document.createElement('button');label.textContent=title;remove.textContent='Remove correction';remove.addEventListener('click',async()=>{const v=await api.storage.local.get('notOwnedTitles');await api.storage.local.set({notOwnedTitles:(v.notOwnedTitles||[]).filter(x=>x!==title)});await renderNotOwned();});li.appendChild(label);li.appendChild(remove);box.appendChild(li);}
}
$('addNotOwned').addEventListener('click',async()=>{
 const title=$('notOwnedName').value.trim();if(!title||title.length>255){$('notOwnedFeedback').textContent='Enter an exact game title (1-255 characters).';return;}
 try{const {notOwnedTitles=[]}=await api.storage.local.get('notOwnedTitles');if(!notOwnedTitles.some(x=>OWNERSHIP_MATCHER.normalize(x)===OWNERSHIP_MATCHER.normalize(title)))notOwnedTitles.push(title);await api.storage.local.set({notOwnedTitles});$('notOwnedName').value='';$('notOwnedFeedback').textContent='Correction saved. Ownership will not be shown for '+title+'.';await renderNotOwned();}catch(e){$('notOwnedFeedback').textContent='Could not save correction: '+e.message;}
});
renderNotOwned();

$('xboxDefaultGamePass').addEventListener('change',async()=>{await api.storage.local.set({xboxDefaultGamePass:$('xboxDefaultGamePass').checked});await show();});
$('markGamePass').addEventListener('click',async()=>{
 if(!selectedPassGame)return;
 const key=OWNERSHIP_MATCHER.normalize(selectedPassGame.name);
 try{
  const data=await api.storage.local.get(['gamepassOverrides','microsoftPurchases']);const overrides=data.gamepassOverrides||{};
  const previous=Object.entries(overrides).find(([name])=>OWNERSHIP_MATCHER.normalize(name)===key)?.[1];
  for(const name of Object.keys(overrides))if(OWNERSHIP_MATCHER.normalize(name)===key)delete overrides[name];
  overrides[passKey(selectedPassGame)]={access:'gamepass',progress:previous?.progress||'not_started'};
  await api.storage.local.set({gamepassOverrides:overrides,microsoftPurchases:(data.microsoftPurchases||[]).filter(game=>OWNERSHIP_MATCHER.normalize(game.name)!==key)});
  await show();$('passAccess').value='gamepass';$('passFeedback').textContent=selectedPassGame.name+' is now Game Pass (green). Its Microsoft purchase claim was removed. Copies owned on other stores stay separate.';await renderVerifiedPurchases();
 }catch(e){$('passFeedback').textContent='Could not save: '+e.message;}
});
if(/[?&]tab=import(?:&|$)/.test(globalThis.location?.search||'')){document.documentElement.classList.add('in-tab');selectTab('Dashboard');$('manualResult').textContent='Firefox closes the toolbar popup when a file chooser opens, so import runs in this tab. Click Import JSON / CSV to choose your file.';$('importFile').focus();}
// Firefox can install Manifest V3 add-ons with store-site access switched off; offer a one-click request.
if(typeof api.runtime.getBrowserInfo==='function'&&api.permissions?.contains){const origins=api.runtime.getManifest().host_permissions||[];api.permissions.contains({origins}).then(granted=>{if(granted)return;const button=document.createElement('button');button.id='grantSites';button.type='button';button.textContent='Allow store access in Firefox (needed for badges)';button.addEventListener('click',()=>api.permissions.request({origins}).then(ok=>{if(ok)button.remove();else button.textContent='Store access not granted: badges stay off. Click to try again.';}));$('connectionBanner').before(button);}).catch(()=>{});}

// ---- Safety: big-drop review, backup / restore, what's stored ----
const BACKUP_KEYS=['gamepassOverrides','microsoftPurchases','notOwnedTitles','markedOwned','titleAliases','wishlist','manualGames','manualImportedAt','xboxDefaultGamePass','enabled','wishlistEnabled','opacity'];
const FIX_KEYS=['notOwnedTitles','markedOwned','titleAliases'];
async function renderSafety(){
 const v=await api.storage.local.get(['pendingDrop','syncState','playniteGames','manualGames','wishlist','notOwnedTitles','markedOwned','titleAliases','gamepassOverrides','microsoftPurchases','lastSync','manualImportedAt']);
 const drop=v.syncState==='needs_review'?v.pendingDrop:null;$('dropReview').hidden=!drop;
 if(drop)$('dropText').textContent='Playnite returned '+drop.count+' games, but your saved library has '+drop.previous+'. This usually means a wrong folder, an empty or damaged games.db, or Playnite still importing. Your '+drop.previous+' games stay in use until you choose.'+(drop.path?' Database: '+drop.path:'');
 const list=$('storedList');list.replaceChildren();
 const rows=[['Playnite library copy',(v.playniteGames||[]).length+' games'+(v.lastSync?' · checked '+new Date(v.lastSync).toLocaleString():'')],['Manual imports',(v.manualGames||[]).length+' games'],['Wishlist',(v.wishlist||[]).length+' titles'],['Fixes: not owned',(v.notOwnedTitles||[]).length],['Fixes: marked owned',(v.markedOwned||[]).length],['Fixes: same-game links',Object.keys(v.titleAliases||{}).length],['Game Pass choices',Object.keys(v.gamepassOverrides||{}).length],['Microsoft purchase confirmations',(v.microsoftPurchases||[]).length]];
 for(const [label,value] of rows){const li=document.createElement('li');const a=document.createElement('span');a.textContent=label;const b=document.createElement('strong');b.textContent=String(value);li.appendChild(a);li.appendChild(b);list.appendChild(li);}
}
$('keepLibrary').addEventListener('click',async()=>{const {pendingDrop}=await api.storage.local.get('pendingDrop');await api.storage.local.set({dismissedDropRevision:pendingDrop?.revision||null,pendingDrop:null,syncState:'connected'});await show();$('manualResult').textContent='Kept your current library. You will be asked again if Playnite changes.';});
$('acceptDrop').addEventListener('click',async()=>{$('manualResult').textContent='Replacing with the smaller Playnite library...';const r=await api.runtime.sendMessage({type:'SYNC_LIBRARY',acceptDrop:true});await show();$('manualResult').textContent=r?.ok?'Library replaced: '+r.count+' games.':'Could not replace: '+(r?.error||'no response');});
// Backup: a plain JSON file you keep. Restore validates it before anything is written.
$('exportBackup').addEventListener('click',async()=>{
 const data=await api.storage.local.get(BACKUP_KEYS);
 const blob=new Blob([JSON.stringify({format:'game-library-guard-backup',version:1,savedAt:new Date().toISOString(),data},null,1)],{type:'application/json'});
 const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='game-library-guard-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),5000);
 $('backupResult').textContent='Backup saved to your Downloads folder.';
});
$('importBackup').addEventListener('click',()=>{if(firefoxPopup){api.tabs.create({url:api.runtime.getURL('popup.html?tab=restore')});window.close();return;}$('backupFile').value='';$('backupFile').click();});
function validBackup(file){
 if(!file||file.format!=='game-library-guard-backup'||file.version!==1||typeof file.data!=='object'||!file.data)throw Error('This is not a Game Library Guard backup file.');
 const d=file.data,out={},strings=x=>Array.isArray(x)&&x.length<=30000&&x.every(s=>typeof s==='string'&&s.length<=255);
 if('notOwnedTitles' in d){if(!strings(d.notOwnedTitles))throw Error('Invalid "not owned" list.');out.notOwnedTitles=d.notOwnedTitles;}
 if('markedOwned' in d){if(!strings(d.markedOwned))throw Error('Invalid "marked owned" list.');out.markedOwned=d.markedOwned;}
 if('titleAliases' in d){if(typeof d.titleAliases!=='object'||Object.entries(d.titleAliases).some(([a,b])=>typeof b!=='string'||a.length>255||b.length>255))throw Error('Invalid same-game links.');out.titleAliases=d.titleAliases;}
 if('gamepassOverrides' in d){if(typeof d.gamepassOverrides!=='object')throw Error('Invalid Game Pass choices.');out.gamepassOverrides=d.gamepassOverrides;}
 for(const key of ['microsoftPurchases','wishlist']){if(key in d){if(!Array.isArray(d[key])||d[key].some(x=>typeof x?.name!=='string'))throw Error('Invalid '+key+'.');out[key]=d[key];}}
 if('manualGames' in d){if(!Array.isArray(d.manualGames))throw Error('Invalid manual imports.');out.manualGames=d.manualGames.length?LibraryImport.normalize(d.manualGames).games:[];if('manualImportedAt' in d)out.manualImportedAt=d.manualImportedAt;}
 for(const key of ['xboxDefaultGamePass','enabled','wishlistEnabled'])if(typeof d[key]==='boolean')out[key]=d[key];
 if(Number.isFinite(d.opacity))out.opacity=Math.max(0,Math.min(70,d.opacity));
 return out;
}
$('backupFile').addEventListener('change',async()=>{
 const file=$('backupFile').files?.[0];if(!file)return;
 try{if(file.size>10*1024*1024)throw Error('File exceeds 10 MB.');const values=validBackup(JSON.parse(await file.text()));
  if('manualGames' in values){const r=await api.runtime.sendMessage({type:'RESTORE_MANUAL',games:values.manualGames,importedAt:values.manualImportedAt||Date.now()});if(!r?.ok)throw Error(r?.error||'Could not restore manual imports');delete values.manualGames;delete values.manualImportedAt;}
  await api.storage.local.set(values);await show();$('backupResult').textContent='Restored '+Object.keys(values).length+' settings and lists from '+file.name+'. Playnite library unchanged.';}
 catch(e){$('backupResult').textContent='Restore failed, nothing changed: '+e.message;}
});
if(/[?&]tab=restore(?:&|$)/.test(globalThis.location?.search||'')){selectTab('Settings');$('backupResult').textContent='Firefox closes the toolbar popup when a file chooser opens, so restore runs in this tab. Click Restore from backup.';$('importBackup').focus();}
// Deleting never disconnects Playnite: the next check reads your library from Playnite again.
function confirmTwice(button,run){let armed=false,timer;button.addEventListener('click',async()=>{if(!armed){armed=true;const label=button.textContent;button.textContent='Click again to confirm';timer=setTimeout(()=>{armed=false;button.textContent=label;},4000);return;}clearTimeout(timer);armed=false;await run();await show();});}
confirmTwice($('deleteFixes'),async()=>{await api.storage.local.set({notOwnedTitles:[],markedOwned:[],titleAliases:{}});$('storedResult').textContent='Deleted your fixes.';});
confirmTwice($('deleteManual'),async()=>{await api.runtime.sendMessage({type:'REMOVE_MANUAL'});$('storedResult').textContent='Deleted manual imports.';});
confirmTwice($('deletePlaynite'),async()=>{await api.runtime.sendMessage({type:'CLEAR_PLAYNITE'});$('storedResult').textContent='Deleted the Playnite copy. It reloads from Playnite on the next check.';});
confirmTwice($('deleteAll'),async()=>{const keep=await api.storage.local.get(['importMode','playniteDbPath','playniteBackend']);await api.storage.local.clear();await api.storage.local.set({...keep,enabled:true,opacity:25,wishlistEnabled:true,wishlist:[],games:[],manualGames:[],playniteGames:[]});$('storedResult').textContent='Deleted everything stored by this extension. Your Playnite connection setting was kept, so your library reloads from Playnite; Playnite itself was not touched.';});

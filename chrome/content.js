(() => {
'use strict';
const api=globalThis.browser||globalThis.chrome;
const host=location.hostname.toLowerCase();
const adapter=STORE_ADAPTERS.find(s=>adapterOwnsHost(s,host));
if(!adapter)return;
const classes=['glg-owned','glg-wishlist','glg-gamepass','glg-unverified','glg-done','glg-want','glg-base'];
const CARD_SELECTOR=[adapter.card,'a[href]','[data-ds-appid]','[data-appid]'].filter(Boolean).join(',');
const ART_SELECTOR=['img',adapter.art].filter(Boolean).join(',');
const TITLE_SELECTOR=[adapter.title,'h2','h3','h4','h5','h6','[itemprop="name"]'].filter(Boolean).join(',');
// Page CSS does not reach inside shadow DOM, so the badge styles are copied into a shadow root when it gets a badge.
const STYLE=typeof GLG_STYLE==='string'?GLG_STYLE:'';
const marked=new Set();let match=()=>null,enabled=true,wishlistOn=true,opacity=25,scheduled=false;
const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>schedule()):null;
const isProductHost=hostname=>adapter.productHostPattern?adapter.productHostPattern.test(hostname):adapterOwnsHost(adapter,hostname);
function productLink(card){
 const links=card.matches('a[href]')?[card]:[...card.querySelectorAll('a[href]')];
 const valid=links.map(link=>{try{const url=new URL(link.href,location.href);return url.protocol==='https:'&&isProductHost(url.hostname)&&adapter.path.test(url.pathname)?{link,url}:null;}catch{return null;}}).filter(Boolean);
 // Some store layouts use a clickable container with product metadata instead of an anchor.
 if(!valid.length&&!links.length&&host==='store.steampowered.com'){
  const id=card.getAttribute('data-ds-appid')||card.getAttribute('data-appid');
  if(/^\d+$/.test(id||''))return {link:card,url:new URL('/app/'+id+'/',location.origin)};
 }
 // A banner or bundle containing several products is not a single owned game.
 const products=new Set(valid.map(x=>x.url.origin+x.url.pathname.replace(/\/$/,'')));
 return products.size===1?valid[0]:null;
}
function titleContext(card,product){
 let current=card;
 for(let depth=0;depth<4;depth++){
  if(current.querySelector(TITLE_SELECTOR))return current;
  const parent=current.parentElement;if(!parent||parent.matches('body,html,main,nav,header,footer'))break;
  const candidate=productLink(parent);
  if(!candidate||candidate.url.origin+candidate.url.pathname!==product.url.origin+product.url.pathname)break;
  current=parent;
 }
 return card;
}
// Every place a card may state its title, in priority order. Each one is tried against the library,
// and a badge still needs an exact (normalized) title match, so extra candidates cannot loosen matching.
function identity(card,product){
 const headings=[...card.querySelectorAll(TITLE_SELECTOR)].slice(0,4).map(node=>node.textContent);
 const rawAlt=card.querySelector('img[alt]')?.alt||'';
 // Strip alt-text wrappers seen live: Epic "Play X on Epic Games Store", GameBillet "Picture of X".
 const imageTitle=(host==='store.epicgames.com'?rawAlt.replace(/^Play (.+) on Epic Games Store$/i,'$1'):rawAlt).replace(/^(?:picture|image|cover|thumbnail) of\s+/i,'');
 // Plain link text is a last resort.
 const text=card.matches('a[href]')?card.textContent.replace(/\s+/g,' ').trim():'';
 const raw=[card.getAttribute('data-app-name'),card.getAttribute('data-product-title'),...headings,imageTitle,card.getAttribute('aria-label'),card.getAttribute('title'),text.length<=120?text:''];
 let info=null;
 if(host==='store.steampowered.com'){
  const found=product.url.pathname.match(/^\/(app|sub|bundle)\/(\d+)(?:\/([^/]+))?/);
  if(found){info={store:'steam',kind:found[1],id:found[2]};
   // URL title is a fallback only; it must still match exactly after normalization.
   if(found[1]==='app'&&found[3])try{raw.push(decodeURIComponent(found[3]).replace(/_/g,' '));}catch{}
  }
 }
 const titles=[...new Set(raw.filter(value=>typeof value==='string'&&value.trim()&&value.trim().length<=255).map(value=>value.trim()))];
 return {titles,product:info};
}
function decide({titles,product}){
 for(const title of titles){const state=match({title,product});if(state)return state;}
 // No visible title at all: a verified Steam app ID can still match on its own.
 return titles.length?null:match({title:'',product});
}
// The store's own markers for the signed-in account. Reading them needs no login data: the store already drew them.
// The store's "owned" marker wins over Game Pass rules and old corrections; Playnite sources are kept alongside it.
function flagged(node,flag){return !!flag&&(!!(flag.card&&node.closest(flag.card))||!!(flag.badge&&node.querySelector(flag.badge)));}
function ownedByStore(state){const label=adapter.flags.owned.label;return {kind:'owned',sources:[...new Set([label,...(state?.kind==='owned'?state.sources:[])])]};}
function withStoreFlags(node,state){
 const flags=adapter.flags;if(!flags)return state;
 if(flagged(node,flags.owned))return ownedByStore(state);
 if(!state&&wishlistOn&&flagged(node,flags.wishlist))return {kind:'wishlist',sources:[flags.wishlist.label]};
 return state;
}
// Some layouts put an empty link over the card, with artwork and title beside it (Epic sale lists, 2026).
// Climb to the box that holds them, but only while that box contains this one product.
function cardBox(link,product){
 let current=link;
 for(let depth=0;depth<3&&!artwork(current);depth++){
  const parent=current.parentElement;if(!parent||parent.matches('body,html,main,[role="main"],nav,header,footer'))return link;
  const inside=productLink(parent);
  if(!inside||inside.url.origin+inside.url.pathname!==product.url.origin+product.url.pathname)return link;
  // If another link in this box already holds the artwork, that link gets the badge instead.
  if([...parent.querySelectorAll('a[href]')].some(a=>a!==link&&artwork(a)))return link;
  current=parent;
 }
 return artwork(current)?current:link;
}
function artwork(card){
 // The largest picture wins, whether an <img>, a <video> or a background-image box (Steam's featured banner).
 // Avatars (curators, friends, reviewers) are never the game's artwork.
 const usable=node=>!node.closest('[class*="avatar" i]');
 const sized=nodes=>nodes.filter(usable).map(node=>({node,rect:node.getBoundingClientRect()})).filter(x=>x.rect.width>=30&&x.rect.height>=20);
 const hasBackground=node=>{const value=getComputedStyle(node).backgroundImage;return !!value&&value!=='none';};
 const candidates=[...sized([...card.querySelectorAll(ART_SELECTOR+',video')]),...sized([...card.querySelectorAll('[style*="background-image"],.capsule,.capsule_image,.game_header_image_ctn')].filter(hasBackground))];
 if(candidates.length)return candidates.sort((a,b)=>b.rect.width*b.rect.height-a.rect.width*a.rect.height)[0];
 // Last resort: the card's own background, e.g. a tile whose whole face is the artwork.
 if(hasBackground(card)){const rect=card.getBoundingClientRect();if(rect.width>=30&&rect.height>=20)return {node:card,rect};}
 return null;
}
function ensureStyle(node){
 const root=node.getRootNode();
 if(!STYLE||typeof ShadowRoot!=='function'||!(root instanceof ShadowRoot)||root.querySelector(':scope > style[data-glg]'))return;
 const style=document.createElement('style');style.setAttribute('data-glg','');style.textContent=STYLE;root.appendChild(style);
}
function clear(card){
 card.classList.remove(...classes,'glg-anchor');card.querySelector(':scope > .glg-overlay')?.remove();
 if(marked.delete(card))resize?.unobserve(card);
 for(const name of ['--glg-art-left','--glg-art-top','--glg-art-width','--glg-art-height','--glg-opacity'])card.style.removeProperty(name);
}
// Badge wording, shared by card badges and product-page title badges.
function describe(state){
 // Play history from Playnite: your own completion choice first, then Playnite's status, then playtime.
 const seconds=state.played?.seconds||0,time=seconds<3600?Math.max(1,Math.round(seconds/60))+'m':Math.round(seconds/3600)+'h';
 const completed=state.progress==='completed'||state.played?.completed;
 const passPlay=completed?'COMPLETED':state.progress==='playing'?'PLAYING':seconds?'PLAYED '+time:'NOT PLAYED';
 const status=state.kind==='base'?'◐ BASE GAME OWNED':state.kind==='owned'?'✓ YOU OWN THIS':state.kind==='wishlist'?'♥ ON WISHLIST':state.kind==='done'?'DONE · NOT BUYING':state.kind==='want'?'GAME PASS · WANT TO OWN':'GAME PASS · '+passPlay;
 const ownedPlay=state.kind==='owned'?(seconds?' · '+time+' played':'')+(completed?' · Completed':''):'';
 const message=status+' · '+state.sources.join(' + ')+(state.kind==='base'?' · '+state.edition+' extras not owned':ownedPlay);
 const compactText=(state.kind==='base'?'◐ base · ':state.kind==='owned'?'✓ ':state.kind==='wishlist'?'♥ ':state.kind==='gamepass'?'GP · '+(completed?'done':seconds?time:'unplayed')+' · ':state.kind==='done'?'DONE · ':'WANT · ')+state.sources.join(' + ')+(state.kind==='owned'&&seconds?' · '+time:'');
 const explanation=state.assumed?message+' (shown as Game Pass by your Xbox display rule; Microsoft entitlement and current Game Pass availability are not verified)':message;
 return {message,compactText,explanation};
}
// Product pages: a status line directly above the game's title, in the status color.
const titleBadges=new Set();
function titleBadge(heading,state,seen){
 let badge=heading.previousElementSibling?.classList.contains('glg-title-badge')?heading.previousElementSibling:null;
 if(!state){badge?.remove();return;}
 if(!badge){badge=document.createElement('div');badge.className='glg-title-badge';heading.before(badge);}
 ensureStyle(badge);
 const {message,explanation}=describe(state),kind='glg-'+state.kind;
 if(badge.getAttribute('data-kind')!==kind)badge.setAttribute('data-kind',kind);
 if(badge.textContent!==message)badge.textContent=message;
 if(badge.title!==explanation)badge.title=explanation;
 titleBadges.add(badge);seen.add(badge);
}
function mark(card,state){
 const art=state?artwork(card):null;if(!state||!art){if(marked.has(card))clear(card);return;}
 const bounds=card.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
 ensureStyle(card);
 const scaleX=card.offsetWidth?bounds.width/card.offsetWidth:1,scaleY=card.offsetHeight?bounds.height/card.offsetHeight:1;
 const values={'--glg-art-left':Math.max(0,(art.rect.left-bounds.left)/scaleX-card.clientLeft)+'px','--glg-art-top':Math.max(0,(art.rect.top-bounds.top)/scaleY-card.clientTop)+'px','--glg-art-width':art.rect.width/scaleX+'px','--glg-art-height':art.rect.height/scaleY+'px','--glg-opacity':String(opacity/100)};
 for(const [key,value]of Object.entries(values))if(card.style.getPropertyValue(key)!==value)card.style.setProperty(key,value);
 if(getComputedStyle(card).position==='static'||!getComputedStyle(card).position)card.classList.add('glg-anchor');
 for(const name of classes){const on=name==='glg-'+state.kind;if(card.classList.contains(name)!==on)card.classList.toggle(name,on);}
 let overlay=card.querySelector(':scope > .glg-overlay');
 if(!overlay){overlay=document.createElement('span');overlay.className='glg-overlay';const tint=document.createElement('span');tint.className='glg-tint';const label=document.createElement('span');label.className='glg-label';overlay.append(tint,label);card.appendChild(overlay);}
 const compact=art.rect.width<140||art.rect.height<65;
 const compactValue=compact?'true':'false';if(overlay.getAttribute('data-compact')!==compactValue)overlay.setAttribute('data-compact',compactValue);
 const label=overlay.querySelector('.glg-label');
 const {message,compactText,explanation}=describe(state);
 const display=compact?compactText:message;
 if(label.textContent!==display)label.textContent=display;
 if(label.title!==explanation)label.title=explanation;
 if(!marked.has(card)){marked.add(card);resize?.observe(card);}
}
const observing=new WeakSet();
// Stores with their own ownership markers may apply them only as a class change (Steam's live search dropdown),
// so class changes are watched there, and only a change onto a marker selector triggers a rescan.
const FLAG_SELECTOR=adapter.flags?[adapter.flags.owned?.card,adapter.flags.wishlist?.card].filter(Boolean).join(','):'';
const FLAG_CLASSES=new Set([...FLAG_SELECTOR.matchAll(/\.([\w-]+)/g)].map(found=>found[1]));
const OBSERVE={childList:true,subtree:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['href','src','alt','aria-label','title','data-app-name','data-product-title','data-ds-appid','data-appid',...(FLAG_SELECTOR?['class']:[])]};
const ours=node=>node.nodeType===1&&node.matches('.glg-overlay,.glg-title-badge,style[data-glg],#glg-why');
const observer=new MutationObserver(records=>{
 const external=records.some(record=>{
  const element=record.target.nodeType===1?record.target:record.target.parentElement;
  if(element?.closest('.glg-overlay,.glg-title-badge'))return false;
  // Our own glg-* class changes would otherwise retrigger scans; only store marker classes matter.
  if(record.type==='attributes'&&record.attributeName==='class')return FLAG_SELECTOR&&record.target.nodeType===1&&record.target.matches(FLAG_SELECTOR)&&!String(record.oldValue||'').split(/\s+/).some(name=>FLAG_CLASSES.has(name));
  const changed=[...record.addedNodes,...record.removedNodes];
  if(record.type==='childList'&&changed.length&&changed.every(ours))return false;
  return true;
 });if(external)schedule();
});
// Open shadow roots, found by walking the page. Closed shadow roots cannot be reached by extensions.
function allRoots(){
 const roots=[document];
 for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
 for(const root of roots)if(root!==document&&!observing.has(root)){observing.add(root);observer.observe(root,OBSERVE);}
 return roots;
}
function largestImage(scope){
 return [...scope.querySelectorAll('img')].filter(img=>!img.closest('nav,header,footer')).sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height;})[0];
}
function scan(){
 scheduled=false;
 for(const card of [...marked])if(!card.isConnected){marked.delete(card);resize?.unobserve(card);}
 if(!enabled){for(const card of [...marked])clear(card);return;}
 const seen=new Set(),roots=allRoots();
 // Store-specific selectors plus product-link fallback survive card CSS/layout changes.
 for(const root of roots)for(const card of root.querySelectorAll(CARD_SELECTOR)){
  const product=productLink(card);if(!product)continue;
  // Some stores put artwork beside the links inside one product box; mark that box instead.
  const target=adapter.markCard&&adapter.card&&!card.matches('a[href]')&&card.matches(adapter.card)?card:cardBox(product.link,product);
  if(seen.has(target))continue;seen.add(target);
  mark(target,withStoreFlags(target,decide(identity(titleContext(target,product),product))));
 }
 if(host==='store.steampowered.com'&&/^\/app\/\d+/.test(location.pathname)){
  const heading=document.querySelector('#appHubAppName'),art=document.querySelector('.game_header_image_ctn');
  let state=match({title:heading?.textContent,product:{store:'steam',kind:'app',id:location.pathname.match(/^\/app\/(\d+)/)[1]}});
  if(adapter.flags?.owned?.page&&document.querySelector(adapter.flags.owned.page))state=ownedByStore(state);
  if(heading)titleBadge(heading,state,seen);
  if(art){seen.add(art);mark(art,state);}
 }else if(host.endsWith('.itch.io')&&host!=='itch.io'){
  const heading=document.querySelector('h1.game_title,.game_title'),art=document.querySelector('.header_image');const state=heading?match({title:heading.textContent}):null;
  if(heading)titleBadge(heading,state,seen);if(art&&state){seen.add(art);mark(art,state);}
 }else if(host!=='store.steampowered.com'&&isProductHost(host)&&adapter.path.test(location.pathname)){
  // Product page: the main heading names the game; mark the hero artwork, never the purchase controls.
  let main=null,heading=null;
  for(const root of roots){main=root.querySelector('main,[role="main"]');heading=main?.querySelector('h1');if(heading)break;}
  if(!heading)for(const root of roots){heading=[...root.querySelectorAll('h1')].find(h=>!h.closest('nav,header,footer'));if(heading){main=null;break;}}
  const state=heading?match({title:heading.textContent}):null;
  if(heading)titleBadge(heading,state,seen);
  if(state){
   // Same picture rule as cards: largest image, video or background box, never an avatar.
   const scope=main||heading.closest('section,article,div[class]')?.parentElement||document.body;
   const hero=artwork(scope),image=hero&&hero.node!==scope&&!hero.node.closest('nav,header,footer')?hero.node:largestImage(scope),parent=image?.parentElement;
   if(parent&&!parent.matches('body,main,[role="main"]')&&!seen.has(parent)&&!parent.closest('.glg-owned,.glg-gamepass,.glg-wishlist')){seen.add(parent);mark(parent,state);}
  }
 }
 for(const card of [...marked])if(!seen.has(card))clear(card);
 for(const badge of [...titleBadges])if(!seen.has(badge)){badge.remove();titleBadges.delete(badge);}
 report(seen.size+' product cards checked, '+marked.size+' marked');
}
// Diagnostics: read in the page console with  document.documentElement.dataset.glgStatus
let libraryCount=0,lastError='';
function report(text){document.documentElement.setAttribute('data-glg-status',libraryCount+' library games; '+text+(lastError?'; last error: '+lastError:'')+' ('+new Date().toLocaleTimeString()+')');}
function schedule(){if(!scheduled){scheduled=true;setTimeout(scan,150);}}
async function refresh(){
 try{
  const snapshot=await api.runtime.sendMessage({type:'GET_LIBRARY'});
  if(!snapshot||!Array.isArray(snapshot.games))throw Error(snapshot?.error||'Invalid library snapshot');
  match=OWNERSHIP_MATCHER.create(snapshot);snapshotCache=snapshot;enabled=snapshot.enabled!==false;libraryCount=snapshot.games.length;lastError='';wishlistOn=snapshot.wishlistEnabled!==false;
  opacity=Number.isFinite(snapshot.opacity)?Math.max(0,Math.min(70,snapshot.opacity)):25;schedule();
 }catch(error){
  // After the extension is reloaded, open tabs lose their connection and must be refreshed.
  lastError=/context invalidated/i.test(error.message)?'extension was reloaded; refresh this tab':error.message;report('library refresh failed');
  console.warn('Game Library Guard: library refresh failed; keeping cached badges.',error.message);
 }
}
// ---- "Why no badge?" (right-click menu) ----
let lastRightClick=null,snapshotCache=null;
document.addEventListener('contextmenu',event=>{lastRightClick=event.composedPath?.()[0]||event.target;},true);
api.runtime.onMessage.addListener(message=>{if(message?.type==='GLG_EXPLAIN')explain(lastRightClick);});
const up=node=>node.parentElement||(node.getRootNode?.() instanceof ShadowRoot?node.getRootNode().host:null);
// The game card around the clicked spot, chosen exactly the way the scan chooses it.
function cardAt(node){
 for(let current=node?.nodeType===1?node:node?.parentElement,depth=0;current&&depth<12;current=up(current),depth++){
  if(current.matches('body,html'))break;
  const product=productLink(current);if(!product)continue;
  const target=adapter.markCard&&adapter.card&&!current.matches('a[href]')&&current.closest(adapter.card)?current.closest(adapter.card):cardBox(product.link,product);
  return {target,product};
 }
 return null;
}
async function save(change){
 const keys=['markedOwned','titleAliases','notOwnedTitles'];const v=await api.storage.local.get(keys);
 const next={markedOwned:[...(v.markedOwned||[])],titleAliases:{...(v.titleAliases||{})},notOwnedTitles:[...(v.notOwnedTitles||[])]};
 change(next);await api.storage.local.set(next);
}
const N=value=>OWNERSHIP_MATCHER.normalize(value);
function explain(node){
 const found=cardAt(node),lines=[],actions=[];
 if(!found){lines.push('No single game card was found where you right-clicked.','Right-click directly on a game\'s picture or title. Banners that show several games, or link to a sale or event page instead of a game, are skipped on purpose.');return panel('No game card here',lines,actions);}
 const {target,product}=found,id=identity(titleContext(target,product),product);
 const state=withStoreFlags(target,decide(id)),art=artwork(target);
 const matched=id.titles.find(title=>match({title,product:id.product}))||null,main=matched||id.titles[0]||'';
 const facts=(snapshotCache&&match.explain)?match.explain({title:main,product:id.product}):null;
 lines.push('Link: '+product.url.pathname);
 lines.push('Titles read from the card: '+(id.titles.length?id.titles.map(t=>'"'+t.slice(0,80)+'"').join(', '):'none'));
 if(id.product?.id)lines.push('Steam app ID: '+id.product.id);
 if(state){
  lines.push('Result: '+state.kind.toUpperCase()+' · '+state.sources.join(' + '));
  if(!art)lines.push('No badge drawn: no picture of at least 30×20 px was found on this card.');
  else lines.push('Badge drawn on a '+Math.round(art.rect.width)+'×'+Math.round(art.rect.height)+' px picture.');
  if(state.kind!=='wishlist'&&main)actions.push(['Not owned: "'+main.slice(0,40)+'"',()=>save(v=>{if(!v.notOwnedTitles.some(t=>N(t)===N(main)))v.notOwnedTitles.push(main);})]);
 }else{
  lines.push('Result: no badge.');
  if(!libraryCount)lines.push('Your library is empty in this browser. Open the popup and click Refresh Library.');
  if(facts?.excluded)lines.push('Blocked by your correction: "'+main+'" is saved as not owned.');
  if(facts?.idConflicts.length)lines.push('Your library has this title under a different Steam app ID ('+facts.idConflicts.map(r=>r.storeId).join(', ')+').');
  if(facts?.xboxRuleOff)lines.push('Your library has it from Xbox, but "Other Xbox games show as Game Pass" is switched off.');
  if(facts&&!facts.titleRows.length&&!facts.idRows.length&&!facts.excluded)lines.push('"'+main.slice(0,80)+'" is not in your library under this exact title.');
  if(facts?.closest.length)lines.push('Closest library titles: '+facts.closest.map(c=>'"'+c.name+'" ('+c.sources.join(', ')+')').join('; '));
  if(facts?.excluded)actions.push(['Remove "not owned" correction',()=>save(v=>{v.notOwnedTitles=v.notOwnedTitles.filter(t=>N(t)!==N(main));})]);
  for(const c of facts?.closest||[])actions.push(['Same game as "'+c.name.slice(0,40)+'"',()=>save(v=>{v.titleAliases[main]=c.name;})]);
  if(main)actions.push(['Mark "'+main.slice(0,40)+'" as owned',()=>save(v=>{if(!v.markedOwned.some(t=>N(t)===N(main)))v.markedOwned.push(main);})]);
 }
 if(facts?.markedOwned)actions.push(['Undo "marked as owned"',()=>save(v=>{v.markedOwned=v.markedOwned.filter(t=>N(t)!==N(main));})]);
 if(facts?.aliasTarget)actions.push(['Undo link to "'+facts.aliasTarget+'"',()=>save(v=>{for(const k of Object.keys(v.titleAliases))if(N(k)===N(main))delete v.titleAliases[k];})]);
 panel(state?'Badge: '+state.kind:'Why no badge?',lines,actions);
}
function panel(heading,lines,actions){
 document.getElementById('glg-why')?.remove();
 const host=document.createElement('div');host.id='glg-why';const root=host.attachShadow({mode:'open'});
 const style=document.createElement('style');style.textContent=':host{all:initial;position:fixed;top:16px;right:16px;z-index:2147483647}.box{width:380px;max-height:70vh;overflow:auto;background:#0f1a2b;color:#e8f0fa;border:1px solid #2f6fd6;border-radius:10px;padding:14px 16px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px #000a}h2{font-size:14px;margin:0 0 8px;color:#7fb6ff}p{margin:0 0 6px;overflow-wrap:anywhere}button{display:block;width:100%;margin:6px 0 0;padding:7px 9px;border-radius:6px;border:1px solid #2f6fd6;background:#173057;color:#fff;font:600 12px system-ui,sans-serif;text-align:left;cursor:pointer}button.close{background:transparent;border-color:#45556b}.done{color:#8fe3a6}';
 const box=document.createElement('div');box.className='box';const h=document.createElement('h2');h.textContent='Game Library Guard: '+heading;box.append(h);
 for(const line of lines){const p=document.createElement('p');p.textContent=line;box.append(p);}
 for(const [label,run] of actions){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',async()=>{try{await run();const ok=document.createElement('p');ok.className='done';ok.textContent='Saved. Badges update in a moment; undo by right-clicking the card again.';box.querySelectorAll('button:not(.close)').forEach(x=>x.disabled=true);box.append(ok);}catch(e){const err=document.createElement('p');err.textContent='Could not save: '+e.message;box.append(err);}});box.append(b);}
 const close=document.createElement('button');close.className='close';close.textContent='Close';close.addEventListener('click',()=>host.remove());box.append(close);
 root.append(style,box);document.documentElement.append(host);
}
observer.observe(document.documentElement,OBSERVE);
document.addEventListener('load',schedule,true);window.addEventListener('resize',schedule);
api.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['games','enabled','opacity','wishlist','wishlistEnabled','gamepassOverrides','microsoftPurchases','notOwnedTitles','xboxDefaultGamePass','markedOwned','titleAliases'].some(key=>key in changes))refresh();});
refresh();
})();

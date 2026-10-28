const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync('shared/'+name,'utf8');
function matcher(snapshot){const c=vm.createContext({});vm.runInContext(read('ownership.js'),c);c.snapshot=snapshot;return vm.runInContext('OWNERSHIP_MATCHER.create(snapshot)',c);}
const card=(id,name,extra='')=>`<a id="${id}" class="unknown-layout" href="https://store.steampowered.com/app/${id}/" ${extra}><img alt="${name}" data-x="10" data-y="5" data-width="240" data-height="120"><span class="price">$19.99</span></a>`;
function page(html,snapshot={},url='https://store.steampowered.com/search/'){
 const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;let changed;const queue=[];const logs=[];
 w.setTimeout=callback=>queue.push(callback);
 w.HTMLElement.prototype.getBoundingClientRect=function(){const width=Number(this.dataset.width||320),height=Number(this.dataset.height||190),left=Number(this.dataset.x||0),top=Number(this.dataset.y||0);return {width,height,left,top,right:left+width,bottom:top+height,x:left,y:top};};
 w.console.warn=(...args)=>logs.push(args);
 const data={games:[],wishlist:[],gamepassOverrides:{},...snapshot};
 w.chrome={runtime:{sendMessage:async()=>structuredClone(data),onMessage:{addListener:fn=>w.__glgMessage=fn}},storage:{onChanged:{addListener:fn=>changed=fn},local:{get:async keys=>Object.fromEntries([].concat(keys).filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),set:async values=>{Object.assign(data,structuredClone(values));changed(Object.fromEntries(Object.keys(values).map(k=>[k,{}])),'local');}}}};
 for(const name of ['adapters.js','ownership.js','content-style.js','content.js'])vm.runInContext(read(name),dom.getInternalVMContext());
 return {w,doc:w.document,data,logs,async flush(){for(let i=0;i<12;i++){await new Promise(r=>setImmediate(r));if(!queue.length)return;queue.splice(0).forEach(fn=>fn());}throw Error('Overlay triggered a mutation/rescan loop');},async update(values){Object.assign(data,values);changed(Object.fromEntries(Object.keys(values).map(k=>[k,{}])),'local');await this.flush();},close:()=>w.close()};
}
test('owned wins over wishlist and Xbox Game Pass decisions; all owning sources retained',()=>{
 const m=matcher({games:[{name:'Control',source:'GOG'},{name:'Control',source:'Epic'},{name:'Control',source:'Xbox'}],gamepassOverrides:{control:{access:'want'}},wishlist:[{name:'Control',source:'Steam'}]});
 const result=m({title:'Control'});assert.equal(result.kind,'owned');assert.deepEqual(Array.from(result.sources),['GOG','Epic']);
});
test('Microsoft access, completion and purchase-interest choices remain separate',()=>{
 for(const [access,kind]of [['unknown','gamepass'],['gamepass','gamepass'],['done','done'],['want','want'],['owned','owned']]){
  const m=matcher({games:[{name:'Halo: Infinite',source:'Xbox'}],gamepassOverrides:{'halo: infinite':{access,progress:'completed'}}});const r=m({title:'HALO: INFINITE'});assert.equal(r?.kind??null,kind);if(kind==='gamepass')assert.equal(r.progress,'completed');
 }
});
test('confirmed purchase overrides Game Pass and wishlist',()=>{const m=matcher({games:[{name:'Halo',source:'Xbox'}],gamepassOverrides:{halo:{access:'done'}},microsoftPurchases:[{name:'Halo'}],wishlist:[{name:'Halo',source:'Steam'}]});assert.equal(m({title:'Halo'}).kind,'owned');});
test('Steam IDs match without visible titles; unrelated store IDs cannot match',()=>{
 const m=matcher({games:[{name:'Real Title',source:'Steam',storeId:'123'},{name:'Unrelated',source:'GOG',storeId:'456'}]});
 assert.equal(m({product:{store:'steam',kind:'app',id:'123'}}).kind,'owned');assert.equal(m({product:{store:'steam',kind:'app',id:'456'}}),null);assert.equal(m({product:{store:'steam',kind:'bundle',id:'123'}}),null);
 assert.equal(m({title:'Real Title',product:{store:'steam',kind:'app',id:'999'}}),null);
});
test('exact title matching preserves editions and normalizes trademark/Unicode',()=>{
 const m=matcher({games:[{name:'Dino Crisis',source:'GOG'},{name:'遊戲',source:'Steam'}]});assert.equal(m({title:'Dino Crisis\u2122'}).kind,'owned');assert.equal(m({title:'Dino Crisis Deluxe Edition'}).kind,'base');assert.notEqual(m({title:'Dino Crisis Deluxe Edition'}).kind,'owned');assert.equal(m({title:'Dino Crisis 2'}),null);assert.equal(m({title:'遊戲'}).kind,'owned');
});
test('layout-independent links get artwork-only overlays; prices and links are untouched',async()=>{
 const p=page(card('123','Dino Crisis'),{games:[{name:'Dino Crisis',source:'GOG'}]});await p.flush();
 const target=p.doc.getElementById('123');assert.equal(target.classList.contains('glg-owned'),true);assert.match(target.querySelector('.glg-label').textContent,/YOU OWN THIS.*GOG/);assert.equal(target.style.getPropertyValue('--glg-art-height'),'120px');assert.equal(target.style.getPropertyValue('--glg-art-top'),'5px');assert.equal(target.querySelector('.price').textContent,'$19.99');assert.equal(target.getAttribute('href'),'https://store.steampowered.com/app/123/');assert.equal(target.querySelectorAll('.glg-overlay').length,1);p.close();
});
test('new search results and recycled card titles update without a reload',async()=>{
 const p=page(card('123','Unknown'),{games:[{name:'Dino Crisis',source:'GOG'}]});await p.flush();assert.equal(p.doc.querySelector('.glg-overlay'),null);
 p.doc.querySelector('img').alt='Dino Crisis';await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);
 p.doc.body.insertAdjacentHTML('beforeend',card('456','Dino Crisis'));await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,2);
 p.doc.querySelector('img').alt='Unknown';await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);p.close();
});
test('source updates, wishlist toggle, overlay toggle and tint setting apply to open pages',async()=>{
 const p=page(card('123','Halo: Infinite'),{games:[{name:'Halo: Infinite',source:'Xbox'}],gamepassOverrides:{'halo: infinite':{access:'gamepass',progress:'completed'}}});await p.flush();assert.match(p.doc.querySelector('.glg-label').textContent,/GAME PASS.*COMPLETED/);assert.equal(p.doc.querySelectorAll('.glg-gamepass').length,1);
 await p.update({opacity:40});assert.equal(p.doc.getElementById('123').style.getPropertyValue('--glg-opacity'),'0.4');
 await p.update({games:[],wishlist:[{name:'Halo: Infinite',source:'Steam'}]});assert.equal(p.doc.querySelectorAll('.glg-wishlist').length,1);
 await p.update({wishlistEnabled:false});assert.equal(p.doc.querySelector('.glg-overlay'),null);
 await p.update({games:[{name:'Halo: Infinite',source:'GOG'}]});assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);
 await p.update({enabled:false});assert.equal(p.doc.querySelector('.glg-overlay'),null);p.close();
});
test('product art is marked separately from purchase controls',async()=>{
 const p=page('<h1 id="appHubAppName">Dino Crisis</h1><div class="game_header_image_ctn"><img alt="" data-width="400" data-height="200"></div><button id="buy">Add to cart</button>',{games:[{name:'Dino Crisis',source:'GOG'}]},'https://store.steampowered.com/app/123/');await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.equal(p.doc.querySelector('#buy').className,'');p.close();
});
test('generic GOG cards use the same detection without Steam CSS classes',async()=>{
 const p=page('<a href="https://www.gog.com/en/game/dino_crisis"><img alt="Dino Crisis"></a>',{games:[{name:'Dino Crisis',source:'Steam'}]},'https://www.gog.com/en/games');await p.flush();assert.match(p.doc.querySelector('.glg-label').textContent,/YOU OWN THIS.*Steam/);p.close();
});
test('navigation, wrong-host links and franchises are not treated as owned games',async()=>{
 const p=page('<a href="https://example.com/app/123/"><img alt="Dino Crisis"></a><a href="https://store.steampowered.com/sale/TombRaider"><img alt="Dino Crisis"></a><a href="https://store.steampowered.com/app/123/">Dino Crisis</a>',{games:[{name:'Dino Crisis',source:'GOG'}]});await p.flush();assert.equal(p.doc.querySelector('.glg-overlay'),null);p.close();
});
test('owned blue and Game Pass green use configured opacity and cannot intercept clicks',()=>{
 const css=read('content.css');assert.match(css,/\.glg-owned\{--glg-rgb:20,105,230/);assert.match(css,/\.glg-gamepass\{--glg-rgb:25,165,80/);assert.match(css,/var\(--glg-opacity,\.25\)/);assert.match(css,/pointer-events:none!important/);
 for(const browser of ['chrome','firefox'])assert.equal(fs.readFileSync(browser+'/content.css','utf8'),css);
});

test('clickable metadata containers work without anchors or known layout classes',async()=>{
 const p=page('<div data-ds-appid="123" role="link"><img alt=""></div>',{games:[{name:'Dino Crisis',source:'Steam',storeId:'123'}]});await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.match(p.doc.querySelector('.glg-label').textContent,/Steam/);p.close();
});

test('Xbox default display rule uses green instead of permanent ownership',async()=>{
 const p=page(card('123','Halo'),{games:[{name:'Halo',source:'Xbox'}]});await p.flush();assert.equal(p.doc.querySelectorAll('.glg-gamepass').length,1);p.close();
});

test('explicit Game Pass source remains green even without a saved choice',()=>{
 const m=matcher({games:[{name:'Halo',source:'Game Pass'}]});assert.equal(m({title:'Halo'}).kind,'gamepass');
});

test('collection app ID cannot label a differently named component as owned',()=>{
 const m=matcher({games:[{name:'Halo: The Master Chief Collection',source:'Steam',storeId:'976730'}]});
 assert.equal(m({title:'Halo: Combat Evolved Anniversary',product:{store:'steam',kind:'app',id:'976730'}}),null);
 assert.equal(m({title:'Halo: Combat Evolved Anniversary',product:{store:'steam',kind:'app',id:'1064220'}}),null);
 assert.equal(m({title:'Halo: The Master Chief Collection',product:{store:'steam',kind:'app',id:'976730'}}).kind,'owned');
});
test('not-owned corrections override source ownership and survive snapshot refresh',async()=>{
 const p=page(card('123','Halo'),{games:[{name:'Halo',source:'Xbox'}],notOwnedTitles:['Halo']});await p.flush();assert.equal(p.doc.querySelector('.glg-overlay'),null);
 await p.update({games:[{name:'Halo',source:'Steam',storeId:'123'}]});assert.equal(p.doc.querySelector('.glg-overlay'),null);
 await p.update({notOwnedTitles:[]});assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);p.close();
});

test('Halo Xbox play-history records never imply purchase; explicit ownership remains blue',()=>{
 for(const source of ['Xbox','Microsoft Store']){
  const game={name:'Halo: Combat Evolved',source};assert.equal(matcher({games:[game]})({title:game.name}).kind,'gamepass');
  assert.equal(matcher({games:[game],gamepassOverrides:{'halo: combat evolved':{access:'owned'}}})({title:game.name}).kind,'owned');
 }
});

test('Gears of War Reloaded defaults to assumed Game Pass and never ownership from Xbox source',()=>{
 const m=matcher({games:[{name:'Gears of War: Reloaded',source:'Xbox'}]});const state=m({title:'Gears of War: Reloaded'});assert.equal(state.kind,'gamepass');assert.equal(state.assumed,true);
 assert.equal(matcher({games:[{name:'Gears of War: Reloaded',source:'Xbox'}],xboxDefaultGamePass:false})({title:'Gears of War: Reloaded'}),null);
});

const STORE_CASES=[
 ['Steam','https://store.steampowered.com/app/123/Dino_Crisis/'],
 ['GOG','https://www.gog.com/en/game/dino_crisis'],
 ['Epic','https://store.epicgames.com/en-US/p/dino-crisis'],
 ['Humble','https://www.humblebundle.com/store/dino-crisis'],
 ['itch.io','https://example.itch.io/dino-crisis'],
 ['Ubisoft','https://store.ubisoft.com/us/dino-crisis/5b647010ef3aa548048c5958.html'],
 ['Ubisoft (UK)','https://store.ubisoft.com/uk/dino-crisis/5b647010ef3aa548048c5958.html'],
 ['EA','https://www.ea.com/games/dino-crisis'],
 ['EA (en-gb)','https://www.ea.com/en-gb/games/dino/dino-crisis'],
 ['Fanatical','https://www.fanatical.com/en/game/dino-crisis'],
 ['Fanatical (de)','https://www.fanatical.com/de/game/dino-crisis'],
 ['GOG (pl)','https://www.gog.com/pl/game/dino_crisis'],
 ['Epic (de)','https://store.epicgames.com/de/p/dino-crisis'],
 ['IndieGala','https://www.indiegala.com/store/game/dino-crisis'],
 ['Gamesplanet','https://us.gamesplanet.com/game/dino-crisis'],
 ['Green Man Gaming','https://www.greenmangaming.com/games/dino-crisis/'],
 ['GamersGate','https://www.gamersgate.com/product/dino-crisis/'],
 ['Gamesplanet (DE)','https://de.gamesplanet.com/game/dino-crisis--1234-1'],
 ['GameBillet','https://www.gamebillet.com/dino-crisis'],
 ['Xbox','https://www.xbox.com/en-US/games/store/dino-crisis/9p2ff14jzll3'],
 ['Xbox Game Pass (no locale)','https://www.xbox.com/games/store/dino-crisis/9p2ff14jzll3'],
 ['Xbox (en-GB)','https://www.xbox.com/en-GB/games/store/dino-crisis/9p2ff14jzll3'],
 ['2Game','https://www.2game.com/games/dino-crisis'],
 ['Nuuvem','https://www.nuuvem.com/item/dino-crisis'],
 ['Nuuvem (us-en)','https://www.nuuvem.com/us-en/item/dino-crisis'],
 ['WinGameStore','https://www.wingamestore.com/product/123/Dino-Crisis/'],
 ['Microsoft Store','https://apps.microsoft.com/detail/9n201kqxs5bm?hl=en-US&gl=US'],
 ['Battle.net (US)','https://us.shop.battle.net/en-us/product/dino-crisis'],
 ['Battle.net (EU)','https://eu.shop.battle.net/de-de/product/dino-crisis'],
 ['DLGamer','https://www.dlgamer.com/en/product/DL2218/dino-crisis'],
 ['Voidu','https://www.voidu.com/en/product/dino-crisis/78605'],
 ['AllYouPlay','https://www.allyouplay.com/en/game/dino-crisis'],
 ['MacGameStore','https://www.macgamestore.com/product/19324/Dino-Crisis/'],
 ['Gamesload','https://www.gamesload.com/games/action/dino-crisis-868522.html'],
 ['DreamGame','https://www.dreamgame.com/en/game/dino-crisis'],
 ['Game Jolt','https://gamejolt.com/games/dino-crisis/12345']
];
for(const [store,url]of STORE_CASES)test(store+': split card title and image links receive one artwork overlay with source',async()=>{
 const origin=new URL(url).origin;const p=page(`<main><article><a href="${url}"><img alt=""></a><a href="${url}"><h3>Dino Crisis</h3></a><div class="price">$19.99</div></article></main>`,{games:[{name:'Dino Crisis',source:'GOG'}]},origin+'/');await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.match(p.doc.querySelector('.glg-label').textContent,/YOU OWN THIS.*GOG/);assert.equal(p.doc.querySelector('.price').textContent,'$19.99');p.close();
});
test('Epic sibling products never borrow another card title and editions remain separate',async()=>{
 const p=page('<main><section><article><a href="/en-US/p/control"><img alt=""></a><h3>Control</h3></article><article><a href="/en-US/p/control-ultimate"><img alt=""></a><h3>Control Ultimate Edition</h3></article></section></main>',{games:[{name:'Control',source:'Epic'}]},'https://store.epicgames.com/en-US/browse');await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);p.close();
});
test('Epic dynamic cards and Xbox Game Pass states update on Epic storefront',async()=>{
 const p=page('<main></main>',{games:[{name:'Gears of War: Reloaded',source:'Xbox'}]},'https://store.epicgames.com/en-US/browse');await p.flush();p.doc.querySelector('main').innerHTML='<article><a href="/en-US/p/gears-reloaded"><img alt=""></a><h3>Gears of War: Reloaded</h3></article>';await p.flush();assert.equal(p.doc.querySelectorAll('.glg-gamepass').length,1);p.close();
});
test('Epic product-page hero uses actual title without touching the purchase button',async()=>{
 const p=page('<main><h1>Dino Crisis</h1><div class="hero"><img alt="" data-width="600" data-height="400"></div><button>Buy now</button></main>',{games:[{name:'Dino Crisis',source:'GOG'}]},'https://store.epicgames.com/en-US/p/dino-crisis');await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.equal(p.doc.querySelector('button').className,'');p.close();
});

test('live Epic sale accessibility label with price does not override the clean artwork title',async()=>{
 const p=page('<main><a href="/p/dead-by-daylight" aria-label="More Deals, 7 of 99, Base Game, Dead by Daylight, -60%, INR 463.60"><img alt="Dead by Daylight"><div>Base Game</div><div>Dead by Daylight</div><div class="price">INR 463.60</div></a></main>',{games:[{name:'Dead by Daylight',source:'Epic'}]},'https://store.epicgames.com/sales-and-specials/halloween-sale');await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);p.close();
});
test('Epic promotional image text extracts the exact advertised game title',async()=>{
 const p=page('<a href="/p/dead-by-daylight"><img alt="Play Dead by Daylight on Epic Games Store"></a>',{games:[{name:'Dead by Daylight',source:'Epic'}]},'https://store.epicgames.com/');await p.flush();assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);p.close();
});

test('small recommendation thumbnails use compact source badges with full ownership tooltip',async()=>{
 const p=page('<a href="/p/dino-crisis"><img alt="Dino Crisis" data-width="55" data-height="80"></a>',{games:[{name:'Dino Crisis',source:'GOG'}]},'https://store.epicgames.com/');await p.flush();assert.equal(p.doc.querySelector('.glg-overlay').getAttribute('data-compact'),'true');assert.match(p.doc.querySelector('.glg-label').textContent,/GOG/);assert.match(p.doc.querySelector('.glg-label').title,/YOU OWN THIS.*GOG/);p.close();
});

test('wishlist and want-to-own are violet, distinct from owned blue and Game Pass green',()=>{
 const css=read('content.css');assert.match(css,/\.glg-wishlist\{--glg-rgb:145,80,230/);assert.match(css,/\.glg-want\{--glg-rgb:145,80,230/);assert.match(css,/\.glg-owned\{--glg-rgb:20,105,230/);
});
test('spec labels: DONE · NOT BUYING, GAME PASS, YOU OWN THIS · source',async()=>{
 const p=page(card('123','Halo')+card('456','Forza'),{games:[{name:'Halo',source:'Xbox'},{name:'Forza',source:'Xbox'}],gamepassOverrides:{halo:{access:'done'},forza:{access:'gamepass'}}});await p.flush();
 assert.equal(p.doc.getElementById('123').querySelector('.glg-label').textContent,'DONE · NOT BUYING · Xbox');
 assert.equal(p.doc.getElementById('456').querySelector('.glg-label').textContent,'GAME PASS · NOT PLAYED · Xbox');p.close();
});
test('cards inside open shadow DOM (Microsoft Store layout) get badges and their own styles',async()=>{
 const p=page('<main><tall-card id="host"></tall-card></main>',{games:[{name:'Mage Castle Idle Defense',source:'Steam'}]},'https://apps.microsoft.com/games');
 const root=p.doc.getElementById('host').attachShadow({mode:'open'});
 root.innerHTML='<a href="https://apps.microsoft.com/detail/9n56rwk82z8h?hl=en-US&gl=US"><img alt="" data-width="200" data-height="260"><span>Mage Castle Idle Defense</span></a>';
 await p.flush();
 assert.equal(root.querySelectorAll('.glg-owned').length,1);assert.match(root.querySelector('.glg-label').textContent,/YOU OWN THIS.*Steam/);
 assert.equal(root.querySelectorAll('style[data-glg]').length,1);assert.match(root.querySelector('style[data-glg]').textContent,/glg-owned/);
 root.querySelector('span').textContent='Something Else';await p.flush();assert.equal(root.querySelector('.glg-overlay'),null);p.close();
});
test('link text is only a fallback and must match exactly',async()=>{
 const p=page('<a href="https://www.gamebillet.com/outer-wilds"><img alt="" data-width="200" data-height="100">Outer Wilds</a><a href="https://www.gamebillet.com/outer-wilds-deluxe"><img alt="" data-width="200" data-height="100">Outer Wilds Deluxe</a>',{games:[{name:'Outer Wilds',source:'Epic'}]},'https://www.gamebillet.com/');await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);p.close();
});
test('itch.io browse pages mark games hosted on creator subdomains, not itch.io site pages',async()=>{
 const p=page('<div class="game_cell"><a href="https://dev.itch.io/dino-crisis"><img alt="" data-width="200" data-height="150"></a><div class="game_title">Dino Crisis</div></div><a href="https://itch.io/games/tag-horror"><img alt="Dino Crisis"></a>',{games:[{name:'Dino Crisis',source:'itch.io'}]},'https://itch.io/games');await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.equal(p.doc.querySelector('.glg-owned').getAttribute('href'),'https://dev.itch.io/dino-crisis');p.close();
});
test('franchise, category and account links on loose URL formats are not products',async()=>{
 for(const [origin,href]of [['https://store.ubisoft.com','/us/far-cry?lang=en_US'],['https://www.gamebillet.com','/hotdeals'],['https://www.ea.com','/games/library/pc-download'],['https://us.shop.battle.net','/en-us/family/world-of-warcraft']]){
  const p=page(`<a href="${href}"><img alt="Far Cry" data-width="200" data-height="100"></a>`,{games:[{name:'Far Cry',source:'Steam'}]},origin+'/');await p.flush();assert.equal(p.doc.querySelector('.glg-overlay'),null,origin+href);p.close();
 }
});
test('look-alike domains do not activate a store adapter',async()=>{
 const p=page('<a href="https://notgamesplanet.com/game/dino"><img alt="Dino Crisis"></a>',{games:[{name:'Dino Crisis',source:'GOG'}]},'https://notgamesplanet.com/');await p.flush();assert.equal(p.doc.querySelector('.glg-overlay'),null);p.close();
});

test('live markup: Battle.net heading slot and blz-image artwork',async()=>{
 const p=page('<a aria-label="Shop, Warcraft III Reforged" href="/en-us/product/warcraft-3-reforged?pfm=rec"><blz-card><blz-content-block><div slot="subheading">Warcraft III</div><div slot="heading">Warcraft<sup>®</sup> III: Reforged</div></blz-content-block><div slot="media"><blz-image data-width="310" data-height="174"></blz-image></div><div class="price">$29.99</div></blz-card></a>',{games:[{name:'Warcraft III: Reforged',source:'Battle.net'}]},'https://us.shop.battle.net/en-us');await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.equal(p.doc.querySelector('.glg-owned').style.getPropertyValue('--glg-art-width'),'310px');assert.equal(p.doc.querySelector('.price').textContent,'$29.99');p.close();
});
test('live markup: DLGamer product box with artwork beside the links is marked once',async()=>{
 const p=page('<div class="product-card"><button title="Add to wishlist"></button><div><img alt="Blind Descent" data-width="180" data-height="270"></div><a href="/en/product/DL737/meta-publishing-blind-descent"><span title="Blind Descent"><span>Blind Descent</span><span>Blind Descent</span></span></a><a href="/en/product/DL737/meta-publishing-blind-descent"><span>$19.99</span></a></div>',{games:[{name:'Blind Descent',source:'Steam'}]},'https://www.dlgamer.com/en');await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.ok(p.doc.querySelector('.product-card').classList.contains('glg-owned'));assert.equal(p.doc.querySelectorAll('a.glg-owned').length,0);p.close();
});
test('live markup: MacGameStore list rows use the product title and box shot',async()=>{
 const p=page('<ul><li class="prodband odd"><a class="click-box" href="https://www.macgamestore.com/product/12685/Sid-Meiers-Civilization-VI-Anthology/" title="Sid Meier\'s Civilization® VI Anthology">Sid Meier\'s Civilization® VI Anthology</a><div class="boxshot"><img alt="Sid Meier&#039;s Civilization® VI Anthology" data-width="128" data-height="72"></div><div class="product-title">Sid Meier\'s Civilization® VI Anthology</div><div class="cost"><a href="https://www.macgamestore.com/buy/12685/">$13.29</a></div></li></ul>',{games:[{name:"Sid Meier's Civilization VI Anthology",source:'Steam'}]},'https://www.macgamestore.com/');await p.flush();
 assert.equal(p.doc.querySelectorAll('li.glg-owned').length,1);assert.match(p.doc.querySelector('.cost a').textContent,/13\.29/);p.close();
});
test('live markup: GameBillet "Picture of" alt text and Microsoft Store rating text do not block matches',async()=>{
 const g=page('<a href="/outer-wilds"><img alt="Picture of Outer Wilds" data-width="200" data-height="100"></a>',{games:[{name:'Outer Wilds',source:'Epic'}]},'https://www.gamebillet.com/');await g.flush();assert.equal(g.doc.querySelectorAll('.glg-owned').length,1);g.close();
 const m=page('<tall-card id="h"></tall-card>',{games:[{name:'Call of Duty',source:'Steam'}]},'https://apps.microsoft.com/games');const root=m.doc.getElementById('h').attachShadow({mode:'open'});
 root.innerHTML='<a href="/detail/9n201kqxs5bm?hl=en-US&gl=US" class="product"><div class="img-wrap"><img alt="" data-width="180" data-height="240"></div><div class="desc"><p part="title" class="title">Call of Duty®</p><span aria-label="Rated 3.0 out of 5.">3.0</span></div></a>';
 await m.flush();assert.equal(root.querySelectorAll('.glg-owned').length,1);m.close();
});

test('live Epic 2026 sale list: empty stretched link with sibling thumbnail and h6 title',async()=>{
 const row=(slug,title,price)=>`<li class="_card_1k614_28 _condensed_1k614_62"><a class="_cardLink_1k614_83" aria-label="${title}, Halloween Spotlight Sale, 7 of 35, ${price}, was ₹1,159.00, -60%." data-testid="list-card" href="/p/${slug}"></a><div class="_thumbnail_1k614_78"><div><img alt="" class="_image_asm25_1" data-width="60" data-height="80"></div><button type="button" aria-label="Add ${title} to wishlist"></button></div><div aria-hidden="true" class="_content_1k614_70"><h6 class="_title_1k614_73">${title}</h6><div role="group"><span class="_currentPrice_1fh4r_19">${price}</span></div></div></li>`;
 const p=page('<main><ul class="_column_imcfe_115" role="list">'+row('dead-by-daylight','Dead by Daylight','₹463.60')+row('resident-evil-requiem','Resident Evil Requiem','₹3,079.30')+row('cyberpunk-2077-ultimate-edition','Cyberpunk 2077: Ultimate Edition','₹1,599.60')+'</ul></main>',{games:[{name:'Dead by Daylight',source:'Epic'},{name:'Cyberpunk 2077',source:'GOG'}]},'https://store.epicgames.com/sales-and-specials/halloween-sale');await p.flush();
 const owned=[...p.doc.querySelectorAll('.glg-owned')];assert.equal(owned.length,1);assert.equal(owned[0].tagName,'LI');assert.match(owned[0].querySelector('h6').textContent,/Dead by Daylight/);
 assert.equal(owned[0].querySelector('.glg-overlay').getAttribute('data-compact'),'true');assert.match(owned[0].querySelector('.glg-label').textContent,/Epic/);
 assert.equal(p.doc.querySelector('._currentPrice_1fh4r_19').textContent,'₹463.60');p.close();
});

test('Steam Family Sharing counts as ownership and keeps its source label',async()=>{
 const p=page(card('3017860','DOOM: The Dark Ages'),{games:[{name:'DOOM: The Dark Ages',source:'Steam Family Sharing',storeId:'3017860'}]});await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.match(p.doc.querySelector('.glg-label').textContent,/YOU OWN THIS · Steam Family Sharing/);p.close();
});

test('same Steam app ID accepts a store rename but not a different game in a collection',()=>{
 const m=matcher({games:[{name:'Dying Light 2: Reloaded Edition',source:'Steam',storeId:'534380'},{name:'Halo: The Master Chief Collection',source:'Steam',storeId:'976730'}]});
 assert.equal(m({title:'Dying Light 2 Stay Human: Reloaded Edition',product:{store:'steam',kind:'app',id:'534380'}})?.kind,'owned');
 assert.equal(m({title:'Dying Light 2 Stay Human: Reloaded Edition'}),null);
 assert.equal(m({title:'Halo: Combat Evolved Anniversary',product:{store:'steam',kind:'app',id:'976730'}}),null);
 assert.equal(m({title:'Dying Light',product:{store:'steam',kind:'app',id:'534380'}}),null);
});
test('Steam IN LIBRARY rows move our badge away from Steam flag',()=>{assert.match(read('content.css'),/\.ds_flagged>\.glg-overlay>\.glg-label\{top:auto!important;bottom:5px!important\}/);});

test("Steam's own IN LIBRARY marker marks the game even when Playnite's title or a correction blocks it",async()=>{
 const row=(id,name,cls,flag)=>`<a id="r${id}" class="search_result_row ds_collapse_flag ${cls}" data-ds-appid="${id}" href="https://store.steampowered.com/app/${id}/x/"><div class="search_capsule"><img alt="" data-width="231" data-height="87"></div>${flag}<div class="responsive_search_name_combined"><span class="title">${name}</span></div><div class="price">₹5,499.00</div></a>`;
 const p=page('<div id="search_resultsRows">'+row('3010850','Gears of War: E-Day','ds_owned ds_flagged','<div class="ds_flag ds_owned_flag">IN LIBRARY</div>')+row('534380','Dying Light 2 Stay Human: Reloaded Edition','ds_owned ds_flagged','<div class="ds_flag ds_owned_flag">IN LIBRARY</div>')+row('111','Hollow Knight: Silksong','ds_wishlist ds_flagged','<div class="ds_flag ds_wishlist_flag">ON WISHLIST</div>')+row('222','Not Mine','','')+'</div>',
  {games:[{name:'Dying Light 2 Stay Human: Reloaded Edition',source:'Epic'}],notOwnedTitles:['Gears of War: E-Day']});await p.flush();
 assert.match(p.doc.querySelector('#r3010850 .glg-label').textContent,/YOU OWN THIS · Steam \(In Library\)$/);
 assert.match(p.doc.querySelector('#r534380 .glg-label').textContent,/YOU OWN THIS · Steam \(In Library\) \+ Epic/);
 assert.ok(p.doc.getElementById('r111').classList.contains('glg-wishlist'));assert.match(p.doc.querySelector('#r111 .glg-label').textContent,/ON WISHLIST · Steam wishlist/);
 assert.equal(p.doc.querySelector('#r222 .glg-overlay'),null);assert.equal(p.doc.querySelector('#r3010850 .price').textContent,'₹5,499.00');
 await p.update({wishlistEnabled:false});assert.equal(p.doc.querySelector('#r111 .glg-overlay'),null);assert.ok(p.doc.getElementById('r3010850').classList.contains('glg-owned'));p.close();
});
test("Steam product page 'already in your library' banner marks the header art",async()=>{
 const p=page('<h1 id="appHubAppName">Gears of War: E-Day</h1><div class="game_header_image_ctn"><img alt="" data-width="460" data-height="215"></div><div class="game_area_already_owned">Gears of War: E-Day is already in your Steam library</div><button id="buy">Add to cart</button>',{games:[]},'https://store.steampowered.com/app/3010850/');await p.flush();
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,1);assert.match(p.doc.querySelector('.glg-label').textContent,/Steam \(In Library\)/);assert.equal(p.doc.querySelector('#buy').className,'');p.close();
});

test('Game Pass badges show played state instead of BY YOUR RULE; owned badges show playtime',async()=>{
 const p=page(card('1','Halo Infinite')+card('2','Forza Horizon 5')+card('3','Starfield')+card('4','Dead by Daylight'),{games:[
  {name:'Halo Infinite',source:'Xbox',playtimeSeconds:5*3600,completionStatus:'Played'},
  {name:'Forza Horizon 5',source:'Xbox',completionStatus:'Not Played'},
  {name:'Starfield',source:'Xbox',playtimeSeconds:600,completionStatus:'Completed'},
  {name:'Dead by Daylight',source:'Epic',playtimeSeconds:12*3600},{name:'Dead by Daylight',source:'Steam',playtimeSeconds:1800}]});await p.flush();
 const label=id=>p.doc.getElementById(id).querySelector('.glg-label');
 assert.equal(label('1').textContent,'GAME PASS · PLAYED 5h · Xbox');assert.doesNotMatch(label('1').textContent,/BY YOUR RULE/);assert.match(label('1').title,/Xbox display rule.*not verified/);
 assert.equal(label('2').textContent,'GAME PASS · NOT PLAYED · Xbox');
 assert.equal(label('3').textContent,'GAME PASS · COMPLETED · Xbox');
 assert.equal(label('4').textContent,'✓ YOU OWN THIS · Epic + Steam · 13h played');p.close();
});

test('Steam featured banner: badge goes on the large banner, never on the curator avatar',async()=>{
 const p=page('<div id="home_maincap_v7"><a class="store_main_capsule" href="https://store.steampowered.com/app/3226530/Mistfall_Hunter/"><div class="capsule main_capsule" style="background-image:url(header.jpg)" data-width="838" data-height="480"></div><div class="info"><div class="app_name"><div>Mistfall Hunter</div></div><div class="screenshots"><div style="background-image:url(s1.jpg)" data-width="156" data-height="88"></div></div><div class="reason"><div class="curator_avatar"><img alt="" data-width="64" data-height="64"></div>Recommended by Satan\'s Naughty List</div><div class="price">₹ 1,249</div></div></a></div>',{games:[{name:'Mistfall Hunter',source:'Xbox',playtimeSeconds:1080,completionStatus:'Played'}]},'https://store.steampowered.com/');await p.flush();
 const card=p.doc.querySelector('.store_main_capsule');assert.ok(card.classList.contains('glg-gamepass'));
 assert.equal(card.style.getPropertyValue('--glg-art-width'),'838px');assert.equal(card.querySelector('.glg-overlay').getAttribute('data-compact'),'false');
 assert.equal(card.querySelector('.glg-label').textContent,'GAME PASS · PLAYED 18m · Xbox');p.close();
});

test('Steam live search dropdown: marker applied later as a class change still triggers the badge, without rescan loops',async()=>{
 const p=page('<div id="search_suggestion_contents"><a class="match ds_collapse_flag" data-ds-appid="3010850" href="https://store.steampowered.com/app/3010850/Gears_of_War_EDay/"><div class="match_img"><img alt="" data-width="120" data-height="45"></div><div class="match_name">Gears of War: E-Day</div><div class="match_price">₹5,499.00</div></a></div>',{games:[],notOwnedTitles:['Gears of War: E-Day']});await p.flush();
 const row=p.doc.querySelector('a.match');assert.equal(row.querySelector('.glg-overlay'),null);
 row.classList.add('ds_owned');await p.flush();
 assert.ok(row.classList.contains('glg-owned'));assert.match(row.querySelector('.glg-label').title,/Steam \(In Library\)/);assert.equal(row.querySelector('.match_price').textContent,'₹5,499.00');p.close();
});

test('Why no badge? explains a blocked match and one click fixes it everywhere',async()=>{
 const p=page(card('3010850','Gears of War: E-Day'),{games:[{name:'Gears of War: E-Day',source:'Steam',storeId:'3010850'}],notOwnedTitles:['Gears of War: E-Day']});await p.flush();
 const img=p.doc.querySelector('img');img.dispatchEvent(new p.w.MouseEvent('contextmenu',{bubbles:true,composed:true}));p.w.__glgMessage({type:'GLG_EXPLAIN'});
 const root=p.doc.getElementById('glg-why').shadowRoot,text=root.textContent;
 assert.match(text,/Gears of War: E-Day/);assert.match(text,/Steam app ID: 3010850/);assert.match(text,/Blocked by your correction/);
 const remove=[...root.querySelectorAll('button')].find(b=>/Remove "not owned" correction/.test(b.textContent));assert.ok(remove);
 remove.click();await new Promise(r=>setImmediate(r));await p.flush();
 assert.deepEqual(p.data.notOwnedTitles,[]);assert.ok(p.doc.getElementById('3010850').classList.contains('glg-owned'));p.close();
});
test('Why no badge? suggests closest library titles and "Same game as" links them',async()=>{
 const p=page(card('534380','Dying Light 2 Stay Human'),{games:[{name:'Dying Light 2: Reloaded Edition',source:'Epic'}]});await p.flush();
 p.doc.querySelector('img').dispatchEvent(new p.w.MouseEvent('contextmenu',{bubbles:true}));p.w.__glgMessage({type:'GLG_EXPLAIN'});
 const root=p.doc.getElementById('glg-why').shadowRoot;assert.match(root.textContent,/not in your library under this exact title/);
 const link=[...root.querySelectorAll('button')].find(b=>/Same game as "Dying Light 2: Reloaded Edition"/.test(b.textContent));assert.ok(link);
 link.click();await new Promise(r=>setImmediate(r));await p.flush();
 assert.equal(p.data.titleAliases['Dying Light 2 Stay Human'],'Dying Light 2: Reloaded Edition');assert.match(p.doc.querySelector('.glg-label').textContent,/YOU OWN THIS · Epic/);p.close();
});
test('Mark as owned works for games missing from the library, and right-clicking a non-game area says so',async()=>{
 const p=page('<nav><span id="menu">Store menu</span></nav>'+card('42','Some Game'),{games:[]});await p.flush();
 p.doc.getElementById('menu').dispatchEvent(new p.w.MouseEvent('contextmenu',{bubbles:true}));p.w.__glgMessage({type:'GLG_EXPLAIN'});
 assert.match(p.doc.getElementById('glg-why').shadowRoot.textContent,/No single game card/);
 p.doc.getElementById('42').querySelector('img').dispatchEvent(new p.w.MouseEvent('contextmenu',{bubbles:true}));p.w.__glgMessage({type:'GLG_EXPLAIN'});
 const mark=[...p.doc.getElementById('glg-why').shadowRoot.querySelectorAll('button')].find(b=>/Mark "Some Game" as owned/.test(b.textContent));mark.click();await new Promise(r=>setImmediate(r));await p.flush();
 assert.match(p.doc.getElementById('42').querySelector('.glg-label').textContent,/Marked owned by you/);p.close();
});

test('final color system: same status colors on storefront badges and in the popup',()=>{
 const css=read('content.css'),rgb=k=>css.match(new RegExp('\\.glg-'+k+'\\{--glg-rgb:([\\d,]+)'))[1];
 assert.equal(rgb('owned'),'20,105,230');assert.equal(rgb('gamepass'),'25,165,80');assert.equal(rgb('wishlist'),'145,80,230');assert.equal(rgb('want'),'145,80,230');assert.equal(rgb('done'),'160,25,40');
 assert.notEqual(rgb('owned'),rgb('done'));assert.notEqual(rgb('wishlist'),rgb('owned'));
 const popupCss=read('popup.css'),html=read('popup.html');
 assert.match(html,/blue-dot"><\/i>Owned/);assert.match(html,/purple-dot"><\/i>Wishlist/);assert.match(html,/green-dot"><\/i>Game Pass/);
 for(const rule of [/\[data-status=owned\]\{border-left:3px solid var\(--blue\)\}/,/\[data-status=gamepass\]\{border-left:3px solid var\(--green\)\}/,/\[data-status=want\]\{border-left:3px solid #b49bff\}/,/\[data-status=done\]\{border-left:3px solid var\(--red\)\}/,/\[data-access=gamepass\]\{border-left:3px solid var\(--green\)\}/])assert.match(popupCss,rule);
 assert.doesNotMatch(popupCss,/data-access=gamepass\]\{[^}]*amber/);
});

test('product pages show a status line above the title in the status color, and tint the hero video/background',async()=>{
 const p=page('<main><h1>Behind the Frame: The Finest Scenery</h1><div class="carousel"><div class="slide"><video data-width="1040" data-height="585"></video></div><div class="thumbs"><img alt="" data-width="120" data-height="68"></div></div><aside><div class="price">₹119.50</div><button>In Library</button></aside></main>',
  {games:[{name:'Behind the Frame: The Finest Scenery',source:'Steam'},{name:'Behind the Frame: The Finest Scenery',source:'Epic'},{name:'Behind the Frame: The Finest Scenery VR',source:'Amazon'},{name:'Behind the Frame: The Finest Scenery',source:'Amazon'}]},'https://store.epicgames.com/en-US/p/behind-the-frame-the-finest-scenery');await p.flush();
 const badge=p.doc.querySelector('.glg-title-badge');assert.ok(badge);assert.equal(badge.nextElementSibling.tagName,'H1');
 assert.equal(badge.getAttribute('data-kind'),'glg-owned');assert.equal(badge.textContent,'✓ YOU OWN THIS · Steam + Epic + Amazon');
 assert.equal(p.doc.querySelector('h1').textContent,'Behind the Frame: The Finest Scenery');
 const tinted=p.doc.querySelector('.glg-owned');assert.ok(tinted.classList.contains('slide'));assert.equal(tinted.style.getPropertyValue('--glg-art-width'),'1040px');
 assert.equal(p.doc.querySelector('.price').textContent,'₹119.50');
 await p.update({games:[]});assert.equal(p.doc.querySelector('.glg-title-badge'),null);p.close();
});
test('title badge colors match the card badge colors',()=>{const css=read('content.css');assert.match(css,/\.glg-title-badge\[data-kind=glg-owned\]\{--glg-rgb:20,105,230/);assert.match(css,/\.glg-title-badge\[data-kind=glg-gamepass\]\{--glg-rgb:25,165,80/);});

test('edition pages: base game owned is shown separately; DLC and Enhanced editions are never claimed',async()=>{
 const lib={games:[{name:'S.T.A.L.K.E.R. 2: Heart of Chornobyl',source:'Steam',storeId:'1643320'},{name:'Cyberpunk 2077',source:'GOG'},{name:'S.T.A.L.K.E.R.: Shadow of Chernobyl',source:'Steam'}]};
 const p=page('<main><h1>S.T.A.L.K.E.R. 2: Heart of Chornobyl - Ultimate Edition</h1><div class="hero"><img alt="" data-width="840" data-height="455"></div><div class="price">$ 76.99</div><button>Add to cart</button></main>',lib,'https://www.gog.com/en/game/stalker_2_heart_of_chornobyl_ultimate_edition');await p.flush();
 const badge=p.doc.querySelector('.glg-title-badge');assert.equal(badge.getAttribute('data-kind'),'glg-base');
 assert.equal(badge.textContent,'◐ BASE GAME OWNED · Steam · Ultimate Edition extras not owned');
 assert.equal(p.doc.querySelectorAll('.glg-owned').length,0);assert.equal(p.doc.querySelectorAll('.glg-base').length,1);p.close();
 const m=matcher(lib);
 assert.equal(m({title:'Cyberpunk 2077: Ultimate Edition'}).kind,'base');assert.equal(m({title:'Cyberpunk 2077 Game of the Year Edition'}).kind,'base');
 assert.equal(m({title:'Cyberpunk 2077: Phantom Liberty'}),null);
 assert.equal(m({title:'S.T.A.L.K.E.R.: Shadow of Chernobyl - Enhanced Edition'}),null);
 assert.equal(m({title:'Cyberpunk 2077'}).kind,'owned');
 assert.equal(matcher({...lib,notOwnedTitles:['Cyberpunk 2077: Ultimate Edition']})({title:'Cyberpunk 2077: Ultimate Edition'}),null);
});

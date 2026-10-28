// Exact normalized-title matching, plus verified Steam app IDs when available.
const OWNERSHIP_MATCHER = (() => {
  const normalize=value=>String(value||'').replace(/[\u2122\u00ae\u00a9]/g,'').normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const microsoft=source=>/xbox|microsoft|game\s?pass/i.test(source||'');
  const steam=source=>/^steam(?: library)?$/i.test(String(source||'').trim());
  // Sequel numbers ("2", "III") must agree, so "Dying Light" never borrows "Dying Light 2".
  const numbers=words=>words.filter(word=>/^(?:\d+|[ivx]+)$/.test(word)).sort().join(' ');
  const renamed=(a,b)=>{if(a===b)return true;const x=a.split(' '),y=b.split(' ');if(numbers(x)!==numbers(y))return false;const [small,large]=x.length<=y.length?[x,new Set(y)]:[y,new Set(x)];return small.length>=2&&small.every(word=>large.has(word));};
  function create(snapshot){
    const titles=new Map(),ids=new Map(),wishes=new Map();
    const add=(map,key,row)=>{if(key){if(!map.has(key))map.set(key,[]);map.get(key).push(row);}};
    for(const row of snapshot.games||[]){if(!row||typeof row.name!=='string'||typeof row.source!=='string')continue;add(titles,normalize(row.name),row);if(steam(row.source)&&/^\d+$/.test(row.storeId||''))add(ids,String(row.storeId),row);}
    for(const row of snapshot.wishlist||[])if(row&&typeof row.name==='string')add(wishes,normalize(row.name),row);
    const overrides=new Map(Object.entries(snapshot.gamepassOverrides||{}).map(([key,value])=>[normalize(key),value]));
    const exclusions=new Set((snapshot.notOwnedTitles||[]).filter(x=>typeof x==='string').map(normalize));
    const purchases=new Set((snapshot.microsoftPurchases||[]).filter(x=>typeof x?.name==='string').map(x=>normalize(x.name)));
    // Fixes saved from the "Why no badge?" panel: titles you marked as owned, and store titles linked to a library title.
    const MARKED='Marked owned by you';
    for(const name of snapshot.markedOwned||[])if(typeof name==='string'&&name.trim())add(titles,normalize(name),{name,source:MARKED});
    const aliases=new Map(Object.entries(snapshot.titleAliases||{}).filter(([a,b])=>typeof b==='string').map(([a,b])=>[normalize(a),normalize(b)]));
    // Bundle editions that contain the base game plus paid extras. Enhanced / Definitive / Remastered / Anniversary
    // versions are often separate products, so they are deliberately not listed and still need an exact match.
    const EDITION=/^(.+?) (?:digital )?(?:super )?(ultimate|deluxe|gold|premium|complete|collector s|collectors|game of the year|goty|platinum|season pass|expansion pass) (edition|bundle|pack)$|^(.+?) (goty)$/;
    const editionOf=key=>{const found=key.match(EDITION);if(!found)return null;const base=found[1]||found[4],words=(found[2]?found[2]+' '+found[3]:found[5]);return {base,label:words==='goty'?'GOTY Edition':words.replace(/\b\w/g,c=>c.toUpperCase()).replace(/^Collector S/,"Collector's")};};
    const lookup=query=>{
      const exact=exactLookup(query);if(exact&&exact.kind!=='wishlist')return exact;
      // You own the base game, but this page sells an edition with extras you have not bought: say so, without claiming the edition.
      const edition=editionOf(normalize(query.title));
      if(edition&&!exclusions.has(normalize(query.title))){const base=exactLookup({title:edition.base});if(base?.kind==='owned')return {kind:'base',sources:base.sources,edition:edition.label,played:base.played};}
      return exact;
    };
    const exactLookup=({title='',product=null})=>{
      const key=normalize(title),id=product?.store==='steam'&&product.kind==='app'?String(product.id):null;
      let idRows=id?ids.get(id)||[]:[];
      // Same Steam app ID: accept the store's current title when it only adds or drops words
      // (e.g. "Dying Light 2: Reloaded Edition" renamed "Dying Light 2 Stay Human: Reloaded Edition").
      // A different game sold under a collection's ID shares too few words and is still rejected.
      if(key)idRows=idRows.filter(row=>renamed(normalize(row.name),key));
      if(exclusions.has(key)||idRows.some(row=>exclusions.has(normalize(row.name)))){
        const sources=(wishes.get(key)||[]).map(row=>row.source||'Wishlist');
        return snapshot.wishlistEnabled!==false&&sources.length?{kind:'wishlist',sources:[...new Set(sources)]}:null;
      }
      const names=new Set([key,aliases.get(key),...idRows.map(row=>normalize(row.name))].filter(Boolean));
      const rows=[...new Set([...idRows,...[...names].flatMap(name=>titles.get(name)||[])])].filter(row=>!(id&&steam(row.source)&&/^\d+$/.test(row.storeId||'')&&String(row.storeId)!==id));
      const owned=new Set(),pass=new Set(),unknown=new Set();let decision=null,progress='not_started',assumed=false;
      if([...names].some(name=>purchases.has(name)))owned.add('Microsoft Store (user-confirmed)');
      for(const row of rows){
        const source=row.source,override=overrides.get(normalize(row.name));
        if(!microsoft(source)){owned.add(source);continue;}
        const access=override?.access&&override.access!=='unknown'?override.access:(/game\s?pass/i.test(source)||snapshot.xboxDefaultGamePass!==false?'gamepass':'unknown');
        if(access==='owned')owned.add(source);
        else if(access==='gamepass'){pass.add(source);progress=override?.progress||'not_started';if((!override?.access||override.access==='unknown')&&!/game\s?pass/i.test(source))assumed=true;}
        else if(access==='done'||access==='want'){decision={kind:access,progress:override.progress||'not_started'};pass.add(source);}
        else unknown.add(source);
      }
      // Playnite play history for this game, added up across every library that has it.
      const played={seconds:rows.reduce((sum,row)=>sum+(Number.isFinite(row.playtimeSeconds)&&row.playtimeSeconds>0?row.playtimeSeconds:0),0),completed:rows.some(row=>/complet|beaten/i.test(row.completionStatus||''))};
      if(owned.size)return {kind:'owned',sources:[...owned],played};
      if(decision)return {...decision,sources:[...pass],played};
      if(pass.size)return {kind:'gamepass',sources:[...pass],progress,assumed,played};

      if(snapshot.wishlistEnabled!==false){const sources=new Set([...names].flatMap(name=>wishes.get(name)||[]).map(row=>row.source||'Wishlist'));if(sources.size)return {kind:'wishlist',sources:[...sources]};}
      return null;
    };
    // Plain facts for the "Why no badge?" panel: what the library holds for this title and what blocks a match.
    const brief=row=>({name:row.name,source:row.source,storeId:row.storeId||null});
    lookup.explain=({title='',product=null})=>{
      const key=normalize(title),id=product?.store==='steam'&&product.kind==='app'?String(product.id):null,keyWords=new Set(key.split(' '));
      const titleRows=(titles.get(key)||[]).map(brief),aliasTarget=aliases.get(key)||null;
      const idRows=(id?ids.get(id)||[]:[]).map(brief);
      const idConflicts=id?(titles.get(key)||[]).filter(row=>steam(row.source)&&/^\d+$/.test(row.storeId||'')&&String(row.storeId)!==id).map(brief):[];
      const xboxRuleOff=snapshot.xboxDefaultGamePass===false&&(titles.get(key)||[]).some(row=>microsoft(row.source)&&!/game\s?pass/i.test(row.source)&&!overrides.get(key)?.access);
      // Closest library titles by shared words, for "Same game as ..." suggestions.
      const closest=[];
      if(key&&!titleRows.length)for(const [name,rows] of titles){const words=name.split(' ');const shared=words.filter(word=>keyWords.has(word)).length;const score=shared/Math.max(words.length,keyWords.size);if(score>=0.5&&name!==key)closest.push({score,name:rows[0].name,sources:[...new Set(rows.map(row=>row.source))]});}
      closest.sort((a,b)=>b.score-a.score);
      return {key,excluded:exclusions.has(key),aliasTarget,markedOwned:titleRows.some(row=>row.source===MARKED),titleRows,idRows,idConflicts,xboxRuleOff,closest:closest.slice(0,3)};
    };
    return lookup;
  }
  return {normalize,create};
})();

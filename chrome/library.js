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

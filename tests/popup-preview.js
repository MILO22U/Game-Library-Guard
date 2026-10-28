// Visual QA fixture only. Never included in a browser extension package.
const previewData={importMode:'manual',games:[{name:'Dino Crisis',source:'GOG'},{name:'Control',source:'Epic Games'},{name:'Forza Horizon 5',source:'Xbox'},{name:'Hades',source:'Steam'},{name:'Celeste',source:'itch.io'}],wishlist:[{name:'Hollow Knight: Silksong',source:'Steam'}],manualGames:[],playniteGames:[],gamepassOverrides:{'forza horizon 5':{access:'gamepass',progress:'playing'}}};
previewData.manualGames=previewData.games;
globalThis.browser={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in previewData).map(k=>[k,previewData[k]])),set:async values=>Object.assign(previewData,values)}},runtime:{sendMessage:async message=>{
 if(message.type==='SYNC_LIBRARY')return {ok:false,error:'Visual preview only. Connect through the installed extension.'};
 if(message.type==='IMPORT_MANUAL'){previewData.manualGames=message.games;previewData.games=message.games;previewData.importMode='manual';return {ok:true};}
 if(message.type==='REMOVE_MANUAL'){previewData.manualGames=[];previewData.games=[];return {ok:true};}
}},tabs:{create:async()=>{}},scripting:{}};

// One adapter per storefront. The shared engine (content.js + ownership.js) does all matching and badges.
// Each adapter declares:
//   name     - display name used in tests and reports
//   matches  - browser match patterns; tools/sync_extensions.py copies these into both manifests
//   hosts    - exact host names, and/or hostPattern for regional or country subdomains
//   path     - product URL pattern (tested against the URL pathname); locale prefixes are optional
//   card     - optional store-specific card selectors (product links are always found as a fallback)
//   title    - optional store-specific title selectors
//   markCard - mark the matched card box (not the link) when artwork sits beside the links
//   flags    - the store's own "you own this" / "on your wishlist" markers, read from the page only
//   art      - optional selectors for artwork that is not a plain <img> (e.g. image custom elements)
// Conservative rules: a card needs a single product link and an exact title match before it is marked.
const GLG_LOCALE='(?:[a-z]{2,3}(?:[-_][a-z]{2,4})?\\/)?';
const glgRegex=(source,flags='i')=>new RegExp(source,flags);
const STORE_ADAPTERS = [
  { name:'Steam', matches:['https://store.steampowered.com/*'], hosts:['store.steampowered.com'], path:/^\/(app|sub|bundle)\/\d+/, card:'a.search_result_row,a.tab_item,a.tab_row_item,a.cluster_capsule,a.sale_capsule,a.app_impression_tracked,.spotlight_content,.store_main_capsule,a.match', title:'.title,.tab_item_name,.tab_row_name,.app_name,.sale_capsule_title,.match_name',
    // Steam marks games the signed-in account owns or wishlisted (its IN LIBRARY / ON WISHLIST labels).
    flags:{owned:{card:'.ds_owned',badge:'.ds_owned_flag',page:'.game_area_already_owned',label:'Steam (In Library)'},wishlist:{card:'.ds_wishlist',badge:'.ds_wishlist_flag',label:'Steam wishlist'}} },
  { name:'GOG', matches:['https://www.gog.com/*','https://gog.com/*'], hosts:['www.gog.com','gog.com'], path:glgRegex('^\\/'+GLG_LOCALE+'game\\/[^/]+'), card:'product-tile,.product-tile', title:'.product-tile__title,.product-title,[data-testid="product-title"]' },
  { name:'Epic Games Store', matches:['https://store.epicgames.com/*'], hosts:['store.epicgames.com'], path:glgRegex('^\\/'+GLG_LOCALE+'(?:p|bundles)\\/[^/]+'), title:'[data-testid="offer-title-info-title"],[data-testid="offer-title"],[data-testid="title"]' },
  { name:'Humble Store', matches:['https://www.humblebundle.com/*','https://humblebundle.com/*'], hosts:['www.humblebundle.com','humblebundle.com'], path:/^\/store\/(?!search|promo|wishlist)[a-z0-9-]+/i, card:'.entity-title', title:'.entity-title,.entity-title-text,.name,.title' },
  { name:'itch.io', matches:['https://itch.io/*','https://*.itch.io/*'], hostPattern:/^(?:[a-z0-9-]+\.)?itch\.io$/, productHostPattern:/^[a-z0-9-]+\.itch\.io$/, path:/^\/[^/?#]+\/?$/, card:'.game_cell,.featured_game,a.game_link', title:'.game_title,.title,.game_cell_data .game_title' },
  { name:'Ubisoft Store', matches:['https://store.ubisoft.com/*'], hosts:['store.ubisoft.com'], path:/^\/[a-z]{2}(?:[-_][a-z]{2})?\/[^/]+\/[0-9a-f]{24}\.html$/i, card:'.product-tile', title:'.product-name,.product-title,.tile-name,.prod-title' },
  { name:'EA', matches:['https://www.ea.com/*','https://ea.com/*'], hosts:['www.ea.com','ea.com'], path:glgRegex('^\\/'+GLG_LOCALE+'games\\/(?!library\\b|coming-soon\\b|ea-play\\b)[^/]+(?:\\/[^/]+)?\\/?$'), title:'.ea-game-tile__title,.tile-title,.game-title' },
  { name:'Fanatical', matches:['https://www.fanatical.com/*'], hosts:['www.fanatical.com'], path:glgRegex('^\\/'+GLG_LOCALE+'(?:game|dlc|bundle)\\/[^/]+'), title:'.product-title,.game-title,.card-name' },
  { name:'IndieGala', matches:['https://www.indiegala.com/*'], hosts:['www.indiegala.com'], path:/^\/(?:store\/(?:game|product)|bundle)\/[^/]+/, card:'.game-box', title:'.game-title,.product-title,.title' },
  { name:'Gamesplanet', matches:['https://gamesplanet.com/*','https://*.gamesplanet.com/*'], hostPattern:/^(?:[a-z]{2,3}\.)?gamesplanet\.com$/, path:/^\/games?\/[^/]+/, title:'.title,.game-title,.name' },
  { name:'Green Man Gaming', matches:['https://www.greenmangaming.com/*'], hosts:['www.greenmangaming.com'], path:glgRegex('^\\/'+GLG_LOCALE+'games\\/[^/]+'), card:'.product-card', title:'.product-title,.prod-name,.game-title' },
  { name:'GamersGate', matches:['https://www.gamersgate.com/*'], hosts:['www.gamersgate.com'], path:glgRegex('^\\/'+GLG_LOCALE+'(?:product|game)\\/[^/]+'), title:'.product-title,.title' },
  // GameBillet product pages sit at the site root, e.g. /no-mans-sky (checked live on the home page).
  { name:'GameBillet', matches:['https://www.gamebillet.com/*','https://gamebillet.com/*'], hosts:['www.gamebillet.com','gamebillet.com'], path:/^\/(?!(?:login|register|cart|allproducts|hotdeals|bestsellers|preorders|newproducts|search|about-us|contactus|blog|wishlist|customer|faq|privacy|terms|news|giveaways?|genres?|categor(?:y|ies)|publishers?|developers?|account|checkout|sitemap)(?:\/|$))[a-z0-9]+(?:-[a-z0-9]+)*\/?$/i, title:'.product-title,.title' },
  // Covers the Xbox Store and the Xbox Game Pass catalog pages; both link to /games/store/<slug>/<id>.
  { name:'Xbox', matches:['https://www.xbox.com/*'], hosts:['www.xbox.com'], path:/^\/(?:[a-z]{2}-[a-z]{2}\/)?games\/store\/[^/]+\/[a-z0-9]{12}/i, card:'.gameCard', title:'.title,.game-title' },
  { name:'2Game', matches:['https://www.2game.com/*','https://2game.com/*'], hosts:['www.2game.com','2game.com'], path:glgRegex('^\\/'+GLG_LOCALE+'(?:games?|product|p)\\/[^/]+'), card:'.product-item', title:'.product-item-name,.product-title,.title' },
  { name:'Nuuvem', matches:['https://www.nuuvem.com/*'], hosts:['www.nuuvem.com'], path:/^\/(?:[a-z]{2}-[a-z]{2}\/)?item\/[^/]+/, card:'.product-card', title:'.product-title,.product-card__title,.title' },
  { name:'WinGameStore', matches:['https://www.wingamestore.com/*'], hosts:['www.wingamestore.com'], path:/^\/product\/\d+/, card:'.product', title:'.product-title,.title' },
  // Added stores. Link formats were read from the live sites unless noted as unverified.
  { name:'Microsoft Store', matches:['https://apps.microsoft.com/*'], hosts:['apps.microsoft.com'], path:/^\/(?:store\/)?detail\/(?:[^/]+\/)?[0-9a-z]{12}\/?$/i, title:'[part="title"],p.title' },
  { name:'Battle.net', matches:['https://shop.battle.net/*','https://*.shop.battle.net/*'], hostPattern:/^(?:[a-z]{2}\.)?shop\.battle\.net$/, path:/^\/(?:[a-z]{2}-[a-z]{2}\/)?product\/[^/]+/i, title:'[slot="heading"]', art:'blz-image' },
  { name:'DLGamer', matches:['https://www.dlgamer.com/*','https://dlgamer.com/*'], hosts:['www.dlgamer.com','dlgamer.com'], path:/^\/(?:[a-z]{2}\/)?product\/[^/]+\/[^/]+/i, card:'.product-card', markCard:true },
  { name:'Voidu', matches:['https://www.voidu.com/*'], hosts:['www.voidu.com'], path:/^\/[a-z]{2}\/product\/[^/]+\/\d+/ },
  // Unverified: the site returned a server error when checked.
  { name:'AllYouPlay', matches:['https://www.allyouplay.com/*','https://allyouplay.com/*'], hosts:['www.allyouplay.com','allyouplay.com'], path:glgRegex('^\\/'+GLG_LOCALE+'(?:games?|product)\\/[^/]+') },
  { name:'MacGameStore', matches:['https://www.macgamestore.com/*'], hosts:['www.macgamestore.com'], path:/^\/product\/\d+\/[^/]+/, card:'li.prodband,li.tilebox,li.homespot', markCard:true, title:'.product-title' },
  { name:'Gamesload', matches:['https://www.gamesload.com/*','https://gamesload.com/*'], hosts:['www.gamesload.com','gamesload.com'], path:/^\/games\/[^/]+\/[^/]+-\d+\.html$/, card:'.item-deal', markCard:true },
  // Unverified: the site showed a bot-check page when checked.
  { name:'DreamGame', matches:['https://www.dreamgame.com/*'], hosts:['www.dreamgame.com'], path:glgRegex('^\\/'+GLG_LOCALE+'(?:games?|product)\\/[^/]+') },
  { name:'Game Jolt', matches:['https://gamejolt.com/*'], hosts:['gamejolt.com'], path:/^\/games\/[^/]+\/\d+/ }
];
const adapterOwnsHost=(adapter,hostname)=>(adapter.hosts||[]).includes(hostname)||!!adapter.hostPattern?.test(hostname);

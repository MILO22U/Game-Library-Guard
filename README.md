# Game Library Guard v1.0

A local Chrome/Firefox extension that adds ownership and wishlist badges to supported storefront cards. Blue ownership badges, violet wishlist badges and green Game Pass badges use a default 25% artwork tint. Artwork, prices and links remain usable. Ownership takes priority over wishlist. Matching is by normalized title, not proof that two editions or licenses are identical.

## Load or reload the browser extension

- Chrome: open `chrome://extensions`, enable Developer mode, choose Load unpacked and select this project's `chrome` folder. For an existing installation click Reload.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and select `firefox/manifest.json`, or Reload an existing add-on. Temporary add-ons are removed on browser restart; permanent Firefox installation requires Mozilla signing.
- Reload existing storefront tabs after updating the extension.

JSON/CSV imports need no Playnite, native host or account connection.

## Connect directly to games.db

Playnite's library is a LiteDB database, **not SQLite or JSON**. Direct mode now uses the real LiteDB **4.1.4** .NET library, matching the verified Playnite 10 source. It requires `sources.db` beside `games.db` to resolve source names. No JSON export or Playnite plugin is needed for direct mode.

1. Install the .NET 10 SDK to build (or .NET 10 Runtime to run an already built reader). Install Python 3 for the registration script only; the registered browser host is a compiled executable.
2. From this project's folder, build:

   ```powershell
   dotnet build native/reader/PlayniteReader.csproj -c Release
   ```

   The compiled executable is `native/reader/bin/Release/net10.0/PlayniteReader.exe`. Keep all files in that output folder together.
3. Load the extension, copy Chrome's extension ID from `chrome://extensions`, then run:

   ```powershell
   python native/install_windows.py
   ```

   Paste the Chrome ID when prompted (blank skips Chrome). The script also registers the fixed Firefox ID. Registration is per Windows user. Restart browsers afterward. Run registration again if the repository moves or the Chrome ID changes. This replaces any previous `.cmd` host registration with the compiled executable.
4. Close Playnite before using direct mode: its exclusive database locks normally prevent direct reads while it runs.
5. Open the popup, choose **Direct games.db**, and click **Connect Playnite** or **Save connection and sync**. A blank path detects the standard installed configuration under `%APPDATA%\Playnite`, including its configured DatabasePath. The usual default is `%APPDATA%\Playnite\library\games.db`.
6. For portable/custom installations, enter the **full path to games.db**, for example `D:\Playnite\library\games.db`. Its adjacent `sources.db` must be present. Do not move just games.db out of the library folder.
7. Inspect **My Game Library**. Search by title/source, filter sources, and expand a game to inspect its classification, import origin and identifiers.

The browser never parses `.db` as JSON/CSV. Use **Choose games.db** inside Playnite connection setup to open the Windows database chooser, or enter the full path manually. The JSON/CSV chooser intentionally does not parse `.db` files.

### Read-only behavior and compatibility

The reader opens originals with read access and sharing that denies writers, holds both handles during copying, then gives LiteDB **only temporary copies in ReadOnly mode**, with upgrades disabled. LiteDB validates its signature and internal file version 7. Collection names and field types are checked: `Game` in games.db and `GameSource` in sources.db, GUID record/source IDs, string titles/source names. Unknown schemas and corrupted/newer files fail clearly. No repair, migration, delete, index creation, or writes are performed on originals. Unresolved source records are skipped with a visible warning rather than claiming ownership.

Verified against Playnite's [10.35 collection implementation](https://github.com/JosefNemec/Playnite/blob/10.35/source/Playnite/Database/Collections/ItemCollection.cs), [source collection](https://github.com/JosefNemec/Playnite/blob/10.35/source/Playnite/Database/Collections/GamesSourcesCollection.cs), and [LiteDB dependency](https://github.com/JosefNemec/Playnite/blob/10.35/source/Playnite/Playnite.csproj). Compatibility with generated LiteDB 4 fixtures is tested; a real user Playnite database and future Playnite versions have not been tested here.

LiteDB 4.1.4 produces NuGet advisory **NU1904 / CVE-2022-23535** concerning polymorphic object deserialization through BsonMapper. The reader uses **raw Engine.FindAll BSON documents**, never typed object mapping or dynamic `_type` instantiation. An inert `_type` regression test covers this boundary. The dependency warning is retained, not suppressed; upgrading to LiteDB 5 is not a compatible drop-in reader. See the [advisory](https://github.com/advisories/GHSA-3x49-g6rc-c284). Use only your trusted local library files; this is not a hardened arbitrary-database inspection service.

## Synchronize while Playnite runs (preferred SDK integration)

Direct mode reports locked files instead of bypassing Playnite's locks. For updates while Playnite runs, build/install the optional [Playnite SDK exporter](playnite/README.md), select **SDK exporter**, then Save connection and sync. That mode uses the active Playnite library for either installation type. It writes its own intermediate `%LOCALAPPDATA%\GameLibraryGuard\library.json`; this export is not the actual Playnite database. The native host reads the export only when SDK mode is explicitly selected. A failed direct read never silently substitutes an export.

SDK game/source changes trigger export. The popup checks on opening, the browser polls approximately once a minute, and content scripts refresh after library storage changes. Revision hashes prevent unchanged game snapshots from being stored again. Direct mode detects changes after Playnite releases its locks; it cannot synchronize a locked live database. SDK mode retains the last export if Playnite is closed. A bridge connection or readable export is not proof Playnite is currently running.

States show importing, bridge connected with a **cached snapshot**, disconnected, or failed. Last successful check and warnings are visible; failures preserve the previous library. Neither mode silently removes manual imports, wishlist entries, Microsoft purchase confirmations or Game Pass choices.

## Manual JSON / CSV import

Click **Import JSON / CSV** to open the operating-system chooser immediately. Selecting Manual file import also opens it. Choose a UTF-8 `.json` or `.csv` file. No native host is involved.

```json
{"games":[{"name":"Dino Crisis","source":"GOG"}]}
```

A JSON array is also accepted. CSV supports name/title and source/store/library headers, quoted commas, escaped quotes and quoted newlines. Save this example as `games.csv` and import it:

```csv
name,source
Dino Crisis,GOG
"Game, Deluxe",Steam
"A ""Quoted"" Title",Epic
```

Expect **3 imported games**. Empty/malformed files, invalid rows, unsupported extensions, oversized files, and storage failures show errors without replacing your previous library. Maximum file size: 5 MB; maximum entries: 30,000. Missing sources become `Manual import`, with a warning count. Identical normalized title/source pairs collapse; the same title from multiple stores retains those sources.

**View Imported Games** shows just manual imports. Import another file to replace that library. **Remove Imported Library** removes only manual records. **Refresh Library** in manual mode refreshes the cached display; it cannot silently reread an arbitrary local file. Manual mode pauses automatic Playnite checks. **Connect Playnite** resumes them while retaining manual records. Extension local storage persists across ordinary browser restarts; uninstalling, clearing extension data, or removing a temporary Firefox installation can remove it.

The original broken control was a radio mode selector whose handler never called a file picker. Manual import and automatic sync also wrote the same games array. The repair adds a direct synchronous picker action, validation/error feedback, isolated storage and serialized library writes.

## Ownership, subscriptions and privacy

Microsoft/Xbox source membership alone does not establish permanent ownership. Choose Purchased, Game Pass, Done/not buying, or Want to own, with separate completion progress. These choices persist independently of sync. Microsoft order-history confirmation remains explicit and user-attested: only deliberately selected title text is captured after a button press. Wishlist entries remain locally managed. No credentials/cookies or database bytes are sent to storefronts or an external service.

The viewer distinguishes user-confirmed purchases from inferred source membership. Non-Microsoft badges retain the prototype's source-based ownership behavior; they are not official entitlement verification.

## Testing and limitations

```powershell
node --test tests/extension.test.cjs tests/storefront.test.cjs
python -m unittest discover -s tests -v
dotnet build native/reader.tests/ReaderTests.csproj -c Release
native/reader.tests/bin/Release/net10.0/ReaderTests.exe
```

The native suite generates **real LiteDB 4 databases**, exercises the compiled native-messaging protocol, checks metadata/source mapping, malformed/newer formats, locking, and unchanged original bytes/timestamps. JS tests use DOM and Chrome/Firefox API mocks; context recreation simulates storage persistence. They are not live browser tests.

No live Chrome/Firefox picker, browser restart, real Playnite library, SDK compilation, or storefront testing was performed here. Store adapters remain experimental and region/page-layout dependent. Existing selectors are preserved in the separate `shared/adapters.js` module; unsupported cards remain unchanged. Steam, GOG, Epic, Humble, itch.io, EA, Ubisoft, Xbox and the prototype's other storefront rules are present, but full coverage of every requested store/page type is not claimed. Platform/tag/category metadata is imported as identifiers when available; direct mode does not resolve all related database labels. Library snapshots are transferred in pages below the native-messaging size limit; a revision check prevents mixing pages from changing libraries. Two Playnite instances exporting SDK snapshots share one per-user export location.

## Source layout

- `shared/`: maintained UI, parsers, background logic, storefront adapter definitions and overlays.
- `chrome/`, `firefox/`: self-contained browser packages, with browser-specific manifests.
- `native/reader/`: pinned LiteDB reader and compiled native-messaging host.
- `native/reader.tests/`: database and protocol tests.
- `native/host.py`: legacy Python adapter using the same compiled reader; retained for diagnostics/tests, not registered by the installer.
- `playnite/`: optional SDK exporter source.
- `tests/`: browser/parser/storage mocks and Python bridge tests.

Use `python tools/sync_extensions.py` after editing shared files, then rerun tests.


## Popup design

The popup uses the supplied design references as a visual direction: navy surfaces, restrained blue accents, blue ownership, violet wishlist, green Game Pass, and a compact card layout. It does not embed the reference posters or their example totals. Dashboard, My Library, Wishlist, Game Pass, and Settings tabs retain existing actions; Microsoft confirmation is under Game Pass. Dashboard totals come from stored records, with source-based ownership labeled as inferred.

`tests/popup-preview.html` is a standalone visual-QA page with explicitly labeled sample data. It is excluded from browser packages. Its browser preview was inspected for tab navigation, library search/details, and Game Pass fields; this is not an installed-extension or native-bridge browser test.


## Storefront highlights: avoiding duplicate purchases

The extension marks the actual storefront, not just its popup. Owned games use a **blue** artwork tint and `YOU OWN THIS` badge showing all owning sources. Game Pass access uses **green**, with playing/completed/not-started status. Wishlist is violet with its heart label, so it can never be confused with owned blue; Game Pass want-to-own is also violet, done/not-buying stays red, and unverified Microsoft access stays neutral. Confirmed ownership on another store takes priority over Xbox subscription choices.

Store-specific selectors now have a product-link fallback independent of card CSS class names. Search results, instant search suggestions, recommendations, sale tiles and product artwork can be recognized from exact titles or Steam app IDs when those IDs are actually in imported Steam records. Single-product Steam metadata containers also work without an anchor. Dynamic results, recycled titles/links, image loading and resizing trigger rescans. Text and ID indexes avoid repeatedly searching the whole library for each card.

Tints are positioned over the artwork's actual bounds; prices below it retain their original appearance. Badge/tint elements never intercept clicks, so browsing and purchasing remain available. Titles are normalized without discarding edition names. Steam IDs are not compared with unrelated GOG/Epic IDs. Unsupported/ambiguous records, franchise promotions and multi-product containers stay unchanged. This is adaptive detection, not a guarantee of compatibility with every arbitrary website or future redesign; existing site permissions still apply. Missing from the library does not prove unowned.

`tests/storefront.test.cjs` uses jsdom to test several unrelated DOM layouts, dynamic changes, artwork bounds, classification precedence and click-preserving structure. Run `pnpm install --ignore-scripts` first to install the test-only dependency, then the Node test command above. jsdom is not shipped in either extension. Public Steam HTML was inspected to confirm newer tab-row markup, but these changes were not tested in your installed/live Chrome session. Reload the extension and refresh existing storefront tabs to activate the new scripts and colors.


### A games.db file reports "File exceeds 5 MB limit"

That means the file was selected through Import JSON / CSV. Database files must use the native reader, whose size limit is **512 MB per database**, rather than the manual JSON/CSV parser. The JSON/CSV handler now recognizes `.db` before size checks and points to the correct action without reading database bytes.

Reload the extension, open Dashboard > Playnite connection setup > **Choose games.db**, and select the original file in its library folder (beside sources.db). The compiled native host must be built and registered as described above; the updated executable is rebuilt with this change. Alternatively paste the full games.db path and Save connection and sync. Close Playnite first if its files are locked. Selecting the database enables automatic mode without replacing manual imports. Cancelling preserves the current mode/library. The background finishes connecting even if the popup closes when the Windows dialog opens; reopen it for the result. The native dialog is implemented but its interactive behavior has not been live-tested here; cancellation/path handling and importing a real generated database larger than 5 MB are covered by automated tests.


Native host troubleshooting: "Specified native messaging host not found" means the bridge registration is missing or does not allow this extension ID. Run native/install_windows.py with the ID shown in chrome://extensions.  The native host can optionally read bridge-settings.json beside PlayniteReader.exe, containing a db_path for a portable library; an explicit browser path takes priority. Keep that file and all native output files together. Restart Chrome or reload the extension to retry after registration. Large snapshots now use paged messages; an incomplete or changing revision leaves the previous browser cache intact.


## Xbox / Microsoft purchase review

Open **Xbox / Microsoft**, filter Purchased, Game Pass, or Unverified, then select a game. Purchased permanent licenses use blue; Game Pass access uses green. Source membership alone defaults to unverified. Purchase confirmations take priority over older Game Pass choices in both storefronts and the popup.

**Check Microsoft purchase** saves the selected title for the review form and opens Microsoft order history. After checking that the exact game has a completed permanent purchase/redeemed license, return to the popup, review the saved title, tick confirmation, and Add verified purchases. A Game Pass subscription, trial, refunded order, or DLC is not a permanent base-game license. This workflow is user-confirmed, not an automatic account entitlement check. Remove incorrect/refunded confirmations from the purchase list. Access/progress choices and purchase confirmations remain separate and survive Playnite sync.

Unverified is no longer a displayed status, filter, or storefront badge. Microsoft games without an access choice remain unmarked; the access editor starts with Select access type. Purchased and Game Pass choices and confirmations remain available.

Microsoft ownership display preference: Microsoft Store / Xbox library records now default to blue ownership based on their source, as requested. This is source-based display, not purchase verification. Explicit Game Pass choices or a source explicitly named Game Pass remain green; completed/done/want choices remain separate. Confirmed Microsoft purchases still take priority.


## Microsoft Store account connection limits

**Update Microsoft games from Playnite** in Xbox / Microsoft refreshes the already configured local library connection and reports its result. Update the Xbox library inside Playnite first. Manual mode is respected; the button explains how to enable the existing Playnite connection. The extension does not collect Microsoft passwords, browser cookies, OAuth tokens or client secrets, and requests no additional account permissions. It cannot promise a direct live Microsoft library or automatic purchase verification.

Microsoft's documented Store entitlement services are scoped to a publisher's products and require publisher/Partner Center setup: https://learn.microsoft.com/en-us/windows/uwp/monetize/view-and-grant-products-from-a-service . No supported general personal-library API for this extension was identified. A direct Microsoft OAuth button would therefore falsely imply a working full-library connection; it has not been added. Existing purchase review uses Microsoft order history, following https://support.microsoft.com/en-us/accounts-billing/view-your-microsoft-store-order-history . Playnite sign-in and its token storage belong to the chosen Playnite integration and have not been audited by this extension.

False ownership corrections: My Library > Correct a false ownership match lets you enter an exact storefront title you do not own. Corrections persist separately from Playnite snapshots and can be removed. Known product IDs with conflicting visible titles no longer inherit collection ownership; DLC/components are not inferred from the name of a collection.

Correction to Microsoft display preference: blue remains the owned color, but Xbox/Microsoft source membership alone no longer claims a purchase. Xbox imports may include play-history/subscription records. Only explicit Purchased choices or user-confirmed purchase records generate Microsoft ownership badges. Unknown access stays unmarked without an Unverified label. This supersedes the previous source-default-to-owned behavior.


### Xbox default Game Pass display rule

In Xbox / Microsoft, **Other Xbox games show as Game Pass** now defaults on, as requested. Entries without an explicit access choice show green, labeled `GAME PASS / BY YOUR RULE`. This classification is an assumption selected for display, not proof of a Microsoft entitlement or current Game Pass catalog availability. Turning it off leaves entries without a choice unmarked. Explicit Purchased choices and purchase confirmations remain blue, with owned copies on other stores taking priority.

For a false purchase claim such as Gears of War: Reloaded, select the game and press **Not owned / use Game Pass**. This changes that game's Microsoft access to Game Pass, removes its saved Microsoft purchase confirmation if present, and preserves completion progress and unrelated purchases. It does not modify Playnite. The setting and correction refresh storefront badges through browser storage changes; after installing this update, reload the extension and refresh existing store tabs.


## Adaptive storefront coverage and live-testing status

Shared detection covers the 17 existing store adapters: Steam, GOG, Epic, Humble, itch.io, Ubisoft, EA, Fanatical, IndieGala, Gamesplanet, Green Man Gaming, GamersGate, GameBillet, Xbox, 2Game, Nuuvem and WinGameStore. Bounded parent-card title lookup supports separate artwork/title links; multiple neighboring products cannot donate titles. Generic product pages on supported domains use the actual main h1 and a contained artwork parent. These rules have DOM-fixture coverage for each adapter; they do not establish full live-site compatibility.

During the live Chrome check, the Epic Halloween Sale page exposed composite accessibility labels including category, title and price. Those labels could hide the clean image title from the matcher. Title extraction now prefers the image title over a composite link label, and understands Epic's exact promotional image label format. Both patterns have regression tests. Live installed-extension retesting requires reloading the extension and refreshing the page. Chrome window minimization interrupted the test before that end-to-end verification, so it must not be described as passed.


## Storefront adapters: status (updated 2026-10-27)

All stores share one engine (`shared/content.js` + `shared/ownership.js`). Each store is one entry in `shared/adapters.js` with its domains (`matches`), regional hosts, a locale-aware product URL pattern, and optional title/artwork/card selectors. `python tools/sync_extensions.py` copies the shared files into `chrome/` and `firefox/` **and rebuilds both manifests' site lists from the adapters**, so a new store only needs an adapter entry.

Badge labels: `✓ YOU OWN THIS · GOG` (blue), `♥ ON WISHLIST · Steam` (violet), `GAME PASS · Xbox` (green, with `· PLAYING` / `· COMPLETED` / `· BY YOUR RULE`), `DONE · NOT BUYING` (red), `GAME PASS · WANT TO OWN` (violet).

The engine now also reads cards inside open **shadow DOM** (Microsoft Store, Battle.net and EA build their pages this way) and copies the badge styles into those shadow roots. Closed shadow roots cannot be reached by any extension.

"Link format checked live" means the product-link rule was run against the real store page in a browser (not with the extension installed) and found game cards with clean titles. It is **not** a full installed-extension test.

| Store | Regional handling | Status |
|---|---|---|
| Steam | single domain | Existing adapter; earlier live Chrome checks |
| Epic Games Store | optional locale (`/de/`, `/en-US/`) | Live Chrome: blue + green badges with prices visible on the Halloween sale. On 2026-10-27 Epic served a new sale-list layout (empty overlay link; thumbnail and `<h6>` title beside it) that the original engine could not mark. The engine now climbs to the single-product card box and tries every title source; badges were confirmed in a live Chrome session after reloading. |
| GOG | optional locale (`/pl/`) | Existing adapter, fixture tests |
| Humble Store | single domain | Existing adapter, fixture tests |
| itch.io | creator subdomains | **Fixed**: browse pages now match games on `*.itch.io` |
| Ubisoft Store | `/us/`, `/uk/` … | **Fixed** (old rule never matched). Link format checked live: 76 products |
| EA | optional locale | Uses shadow DOM; fixture tests only |
| Fanatical | any `/xx/` locale; game, DLC, bundle | Link format checked live |
| IndieGala | single domain | Site returned a server error when checked |
| Gamesplanet | any country subdomain | Fixture tests |
| Green Man Gaming | optional locale | Link format checked live |
| GamersGate | optional locale | Fixture tests |
| GameBillet | root-level product slugs | **Fixed** (old rule never matched). Link format checked live: 69 products |
| Xbox Store + Xbox Game Pass pages | optional `xx-XX` locale | Link format checked live on the Game Pass catalog |
| 2Game | optional locale | **Unverified**: no product cards loaded when checked |
| Nuuvem | `/us-en/`, `/br-pt/` … | Link format checked live |
| WinGameStore | single domain | Fixture tests |
| Microsoft Store (apps.microsoft.com) | `hl`/`gl` query | **New**. Shadow DOM; cards and product page checked live |
| Battle.net | `us.` / `eu.` / `kr.` / `tw.` / `shop.battle.net` | **New**. Shadow DOM; cards checked live |
| DLGamer | `/en/` … | **New**. Cards checked live |
| Voidu | `/en/`, `/de/` … | **New**. Cards checked live: 204 links |
| AllYouPlay | optional locale | **New, unverified**: site returned 502 when checked |
| MacGameStore | single domain | **New**. Cards checked live |
| Gamesload | single domain | **New**. Cards checked live: 40 links |
| DreamGame | optional locale | **New, unverified**: site showed a bot check |
| Game Jolt | single domain | **New**. Uses the standard `/games/<slug>/<id>` format; cards did not render while checking |
| Playsum | n/a | **Not added**: playsum.com is a parked domain listed for sale |

Not yet done: installed-extension testing in live Chrome for the new and fixed adapters, any Firefox testing, and live checks of the Playnite picker, sync after library changes, and persistence after a browser restart.

### Steam: using Steam's own IN LIBRARY marker

On Steam, the extension also reads the markers Steam itself draws for the signed-in account: `ds_owned` / `IN LIBRARY` on cards, `ds_wishlist` / `ON WISHLIST`, and the "already in your Steam library" banner on product pages. A card Steam marks as owned gets `✓ YOU OWN THIS · Steam (In Library)`, plus any Playnite sources that also own it. This works even when Playnite's title differs or an old "not owned" correction exists, and it beats the Xbox Game Pass display rule. Steam's wishlist marker gives the violet wishlist badge (respecting the wishlist toggle). Nothing is fetched or sent: only the page already shown is read, and it requires being signed in to Steam in that browser. Family Sharing games that Steam shows as In Library are labeled "Steam (In Library)". On rows with Steam's flag, our badge sits bottom-left so the two labels don't overlap.

### Played status on badges

The native reader also reads Playnite's `completionstatuses.db` (read-only copy; optional, a missing file never blocks the library), so each game carries its completion status name alongside playtime. Badges use it so you can see at a glance what you already have and have played:
- Owned: `✓ YOU OWN THIS · Epic + Steam · 13h played` (playtime added up across libraries; `· Completed` when Playnite says completed/beaten).
- Game Pass: `GAME PASS · PLAYED 5h · Xbox`, `GAME PASS · NOT PLAYED · Xbox`, or `GAME PASS · COMPLETED · Xbox`, replacing `BY YOUR RULE`. Your own Playing/Completed choice in the popup takes priority. The hover tooltip still states that the Game Pass classification is your Xbox display rule, not verified Microsoft entitlement or current catalog membership.

Live Chrome check (2026-10-27): on the Steam home page's Featured & Recommended banner, Mistfall Hunter showed `GAME PASS · PLAYED 18m · Xbox` on the large banner after the artwork-selection fix. Previously the badge had landed on a curator avatar.

### Right-click "Why no badge?"

On any supported store page, right-click a game's picture or title and choose **Game Library Guard: Why no badge?**. A panel lists the link and titles read from the card, the Steam app ID, the result, and what blocked a match (a "not owned" correction, a different Steam app ID, the Xbox rule switched off, a title missing from the library with the closest library titles, or no usable artwork). One-click fixes are saved locally and apply on every store: **Remove "not owned" correction**, **Same game as "…"** (links a store title to a library title, stored in `titleAliases`), **Mark as owned** (stored in `markedOwned`, labeled "Marked owned by you"), **Not owned**, and **Undo**. Requires the `contextMenus` permission; reload the extension after updating.

## Final color system (overrides earlier specs and PNG mockups)

| Color | Meaning | Badge / tint |
|---|---|---|
| Blue `20,105,230` | Permanently owned (Steam, GOG, Epic, Microsoft Store, any library) | `✓ YOU OWN THIS · source` |
| Green `25,165,80` | Xbox Game Pass access, including played/completed | `GAME PASS · PLAYED 5h` etc. |
| Violet `145,80,230` | Wishlist, and Game Pass games you want to own | `♥ ON WISHLIST`, `GAME PASS · WANT TO OWN` |
| Red `160,25,40` | Finished / decided not to buy | `DONE · NOT BUYING` |

25% default tint in the status color; source labels stay visible; artwork, prices and links stay clickable. The popup uses the same colors: dashboard stats and legend, the My Library rows (left border by status), and the Xbox / Game Pass list. Confirmed ownership takes precedence over Game Pass and wishlist on badges; a Done / Not Buying decision stays saved separately and is not deleted when ownership is also known. A test enforces these values.

### Product-page title badge and edition pages

On product pages of every store, a status line appears directly above the game's title (`✓ YOU OWN THIS · Steam + Epic + Amazon`), in the same colors as card badges, and the hero picture (image, video or background) gets the 25% tint.

Bundle editions that contain the base game plus paid extras (Ultimate, Deluxe, Gold, Premium, Complete, Collector's, Game of the Year/GOTY, Season/Expansion Pass bundles) are not claimed as owned when you only own the base game. They get a separate, dashed blue badge: `◐ BASE GAME OWNED · Steam · Ultimate Edition extras not owned`. DLC pages stay unmarked unless the DLC itself is in your library, so content you still need to buy never looks owned. Enhanced, Definitive, Remastered and Anniversary editions are treated as separate products and still need an exact match.

## Safety features

- **Playnite stays the source.** The library keeps updating from Playnite automatically (about once a minute and when the popup opens); Playnite's database is only ever read from temporary copies.
- **Big-drop protection.** If Playnite suddenly returns less than half of a library of 50+ games (wrong folder, empty or damaged games.db, Playnite mid-import), the current library stays in use and the popup shows "Your Playnite library suddenly shrank" with **Keep my current library** or **Use the smaller library**. Normal additions and removals sync without asking.
- **Backup / restore** (Settings): saves fixes (not owned, marked owned, same-game links), Game Pass and Microsoft purchase choices, wishlist, settings and manual imports to a JSON file. Restore validates the whole file first and changes nothing if any part is invalid. The Playnite library is not in the backup; it reloads from Playnite. In Firefox, restore opens in a tab because the toolbar popup closes when a file chooser opens.
- **What's stored** (Settings): counts for each stored list, with **Delete my fixes**, **Delete manual imports**, **Delete Playnite copy** and **Delete everything** (each needs a second click to confirm). Deleting never disconnects Playnite: the library reloads from Playnite on the next check.
- **Only the extension's own pages can change the library.** Store pages can read the library for badges but cannot import, delete or restore.

# Playnite integration
This folder contains source for a Playnite GenericPlugin, **not a compiled plugin**.
Use Visual Studio on Windows with the Playnite SDK / Playnite Toolbox GenericPlugin template. Replace the generated plugin class with `GameLibraryGuard.cs`, retaining the template's project and extension.yaml. Build for .NET Framework 4.6.2, then load the output using Playnite Settings > For developers > External extensions. Reopen Playnite. It writes `%LOCALAPPDATA%\GameLibraryGuard\library.json` on startup, after library updates and game edits.

The source name is retrieved from the Playnite database using `SourceId`. The Playnite SDK and source project have **not** been compiled in this environment.


## Setup and verification

1. Use the official [SDK extension guide](https://api.playnite.link/docs/tutorials/extensions/intro.html) and GenericPlugin template. Retain its project, SDK references and extension.yaml. Build against the SDK matching your Playnite installation. No compiled add-on is bundled.
2. Load the built extension using Playnite's developer External extensions setting and restart Playnite. Standard and portable installations both use the active SDK database; no games.db path is needed.
3. Check `%LOCALAPPDATA%\GameLibraryGuard\library.json`. Add/edit a game or rename a source and verify the export updates. Export errors appear in Playnite's log as `GameLibraryGuard export`.
4. Install Python 3 and load the browser extension. Run `python native\install_windows.py`, supply the actual Chrome extension ID (Firefox ID is fixed), then restart browsers. Keep the repository and compiled native-host output at their registered locations. Python is needed only for registration.
5. Click Connect Playnite. Missing host: check registration, extension ID, compiled executable path and .NET 10 Runtime. Missing export: check the plugin build/load and Playnite log. The installer now registers the compiled .NET native executable; build native/reader first as described in the main README.

The exporter reads SDK objects without database update calls. Game/source events and OnLibraryUpdated trigger serialized atomic JSON replacement. Browser polls run about once a minute. Closed Playnite leaves its last snapshot available. Two running Playnite instances share the per-user export location, so the last writer wins. Compilation and live integration remain unverified.

Select **SDK exporter** in the browser connection method and Save connection and sync. Direct games.db mode does not use this export. The SDK route is preferred for updates while Playnite keeps its databases locked.

using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Playnite.SDK;
using Playnite.SDK.Data;
using Playnite.SDK.Events;
using Playnite.SDK.Plugins;
namespace GameLibraryGuard {
    public class GameLibraryGuardPlugin : GenericPlugin {
        private readonly object exportLock = new object();
        public override Guid Id { get; } = Guid.Parse("d124ea28-90df-4b38-b21e-f051bce2b8df");
        public GameLibraryGuardPlugin(IPlayniteAPI api) : base(api) {
            Properties = new GenericPluginProperties { HasSettings = false };
            api.Database.Games.ItemCollectionChanged += (_,e) => Export();
            api.Database.Games.ItemUpdated += (_,e) => Export();
            api.Database.Sources.ItemUpdated += (_,e) => Export();
            api.Database.Sources.ItemCollectionChanged += (_,e) => Export();
        }
        public override void OnApplicationStarted(OnApplicationStartedEventArgs args) { Export(); }
        public override void OnLibraryUpdated(OnLibraryUpdatedEventArgs args) { Export(); }
        private void Export() {
            lock (exportLock) {
            try {
                var games=PlayniteApi.Database.Games.Select(g=>new {
                    name=g.Name ?? "",
                    source=(PlayniteApi.Database.Sources.Get(g.SourceId)?.Name ?? "Playnite"),
                    id=g.Id.ToString(),
                    storeId=g.GameId,
                    isInstalled=g.IsInstalled,
                    version=g.Version,
                    platformIds=g.PlatformIds,
                    tagIds=g.TagIds,
                    categoryIds=g.CategoryIds,
                    playtimeSeconds=g.Playtime,
                    completionStatus=PlayniteApi.Database.CompletionStatuses.Get(g.CompletionStatusId)?.Name ?? ""
                }).ToList();
                var payload=Serialization.ToJson(new { games=games, exportedAt=DateTime.UtcNow.ToString("O") });
                var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"GameLibraryGuard");
                Directory.CreateDirectory(folder);
                var tmp=Path.Combine(folder,"library.json.tmp");
                var dest=Path.Combine(folder,"library.json");
                File.WriteAllText(tmp,payload);
                if(File.Exists(dest))File.Replace(tmp,dest,null);
                else File.Move(tmp,dest);
            } catch(Exception ex) { LogManager.GetLogger().Warn("GameLibraryGuard export: " + ex.Message); }
            }
        }
    }
}

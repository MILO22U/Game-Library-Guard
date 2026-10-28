using LiteDB;
using System.Text.Json;
using JsonSerializer = System.Text.Json.JsonSerializer;

namespace GameLibraryGuard;

public record LibraryGame(string name, string source, string id, string? storeId, bool? isInstalled, long? playtimeSeconds, string? version, string? completionStatusId, string[] platformIds, string[] tagIds, string[] categoryIds, string? completionStatus = null);
public record LibraryResult(List<LibraryGame> games, string source_type, string db_path, string? warning);

public static class PlayniteReader
{
    const long MaxSize = 512L * 1024 * 1024;

    // All originals are held open with FileShare.Read before any copying starts.
    // This denies writers (and fails if Playnite already owns an exclusive handle).
    static FileStream OpenOriginal(string path)
    {
        var stream = new FileStream(path, System.IO.FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length < 4096 || stream.Length > MaxSize) {
            stream.Dispose();
            throw new InvalidDataException("Database size is invalid (limit 512 MB).");
        }
        return stream;
    }

    static LiteDatabase OpenCopy(FileStream original, string destination)
    {
        using (var output = new FileStream(destination, System.IO.FileMode.CreateNew, FileAccess.Write, FileShare.None))
            original.CopyTo(output);
        // LiteDB 4.1.4 checks the header signature and internal file version 7.
        // A path on a generated private copy is the only path passed to LiteDB.
        return new LiteDatabase("Filename=" + destination + ";Mode=ReadOnly;Upgrade=false");
    }

    static string Text(BsonDocument doc, string key, int max)
    {
        var value = doc[key];
        if (!value.IsString || string.IsNullOrWhiteSpace(value.AsString) || value.AsString.Trim().Length > max)
            throw new InvalidDataException("Unsupported Playnite schema: invalid " + key + ".");
        return value.AsString.Trim();
    }

    static string[] Ids(BsonDocument doc, string key)
    {
        var value = doc[key];if(value.IsNull)return [];
        if(!value.IsArray || value.AsArray.Count > 1000 || value.AsArray.Any(x=>!x.IsGuid))throw new InvalidDataException("Unsupported " + key + " schema.");
        return value.AsArray.Select(x=>x.AsGuid.ToString()).ToArray();
    }

    public static LibraryResult Read(string path)
    {
        path = Path.GetFullPath(path);
        if (!string.Equals(Path.GetFileName(path), "games.db", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Select Playnite's games.db file.");
        if (!File.Exists(path)) throw new FileNotFoundException("Playnite games.db not found: " + path);
        var sourcesPath = Path.Combine(Path.GetDirectoryName(path)!, "sources.db");
        // Missing source labels must not become an ownership claim.
        if (!File.Exists(sourcesPath))
            throw new FileNotFoundException("sources.db is missing. Select games.db in the complete Playnite library folder.");
        using var originalGames = OpenOriginal(path);
        using var originalSources = OpenOriginal(sourcesPath);
        var temporary = Path.Combine(Path.GetTempPath(), "glg-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try {
            using var gamesDb = OpenCopy(originalGames, Path.Combine(temporary, "games.db"));
            using var sourcesDb = OpenCopy(originalSources, Path.Combine(temporary, "sources.db"));
            if (!gamesDb.GetCollectionNames().Contains("Game") || !sourcesDb.GetCollectionNames().Contains("GameSource"))
                throw new InvalidDataException("Unsupported database schema: expected Game in games.db and GameSource in sources.db (Playnite 10 / LiteDB 4.1.4).");
            var sources = new Dictionary<Guid, string>();
            foreach (var doc in sourcesDb.Engine.FindAll("GameSource")) {
                if (sources.Count >= 30000) throw new InvalidDataException("Too many source records.");
                if (!doc["_id"].IsGuid) throw new InvalidDataException("Unsupported GameSource ID type.");
                sources.Add(doc["_id"].AsGuid, Text(doc, "Name", 100));
            }
            // Completion status names are optional display data: a missing or unreadable file never blocks the library.
            var statuses = new Dictionary<Guid, string>();
            var statusesPath = Path.Combine(Path.GetDirectoryName(path)!, "completionstatuses.db");
            if (File.Exists(statusesPath)) {
                try {
                    using var originalStatuses = OpenOriginal(statusesPath);
                    using var statusesDb = OpenCopy(originalStatuses, Path.Combine(temporary, "completionstatuses.db"));
                    if (statusesDb.GetCollectionNames().Contains("CompletionStatus"))
                        foreach (var doc in statusesDb.Engine.FindAll("CompletionStatus")) {
                            if (statuses.Count >= 1000) break;
                            if (doc["_id"].IsGuid && doc["Name"].IsString && !string.IsNullOrWhiteSpace(doc["Name"].AsString) && doc["Name"].AsString.Length <= 100)
                                statuses[doc["_id"].AsGuid] = doc["Name"].AsString.Trim();
                        }
                } catch (Exception ex) when (ex is IOException or InvalidDataException or LiteException) { statuses.Clear(); }
            }
            var games = new List<LibraryGame>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int unknown = 0, records = 0;
            foreach (var doc in gamesDb.Engine.FindAll("Game")) {
                if (++records > 30000) throw new InvalidDataException("Library exceeds 30,000 records.");
                if (!doc["_id"].IsGuid) throw new InvalidDataException("Unsupported Game ID type.");
                string name = Text(doc, "Name", 255);
                var id = doc["SourceId"];
                if (!id.IsNull && !id.IsGuid) throw new InvalidDataException("Unsupported SourceId type.");
                string? source = null;
                if (id.IsGuid) sources.TryGetValue(id.AsGuid, out source);
                if (source == null) { unknown++; continue; }
                if (seen.Add(name + "\0" + source)) games.Add(new LibraryGame(name, source, doc["_id"].AsGuid.ToString(), doc["GameId"].IsString ? doc["GameId"].AsString : null, doc["IsInstalled"].IsBoolean ? doc["IsInstalled"].AsBoolean : null, doc["Playtime"].IsInt64 ? doc["Playtime"].AsInt64 : doc["Playtime"].IsInt32 ? doc["Playtime"].AsInt32 : null, doc["Version"].IsString ? doc["Version"].AsString : null, doc["CompletionStatusId"].IsGuid ? doc["CompletionStatusId"].AsGuid.ToString() : null, Ids(doc,"PlatformIds"), Ids(doc,"TagIds"), Ids(doc,"CategoryIds"),
                    doc["CompletionStatusId"].IsGuid && statuses.TryGetValue(doc["CompletionStatusId"].AsGuid, out var status) ? status : null));
            }
            return new LibraryResult(games, "playnite_db", path,
                unknown == 0 ? null : $"{unknown} games skipped because their source could not be verified.");
        }
        finally { Directory.Delete(temporary, true); }
    }

    public static LibraryResult ReadDefault(string? path)
    {
        if(string.IsNullOrWhiteSpace(path)){
            var connectionSettings=Path.Combine(AppContext.BaseDirectory,"bridge-settings.json");
            if(File.Exists(connectionSettings)){
                using var settings=JsonDocument.Parse(File.ReadAllText(connectionSettings));
                if(settings.RootElement.TryGetProperty("db_path",out var selected))path=selected.GetString();
            }
        }
        if (string.IsNullOrWhiteSpace(path)) {
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Playnite");
            var config = Path.Combine(folder, "config.json");
            string library = Path.Combine(folder, "library");
            if (File.Exists(config)) {
                using var document = JsonDocument.Parse(File.ReadAllText(config));
                if (document.RootElement.TryGetProperty("DatabasePath", out var setting) && setting.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(setting.GetString()))
                    library = Path.GetFullPath(Environment.ExpandEnvironmentVariables(setting.GetString()!), folder);
            }
            path = Path.Combine(library, "games.db");
        }
        return Read(Environment.ExpandEnvironmentVariables(path));
    }

    static object Handle(JsonElement request)
    {
        if(request.TryGetProperty("action",out var pickerAction)&&pickerAction.GetString()=="choose_database")return DatabasePicker.Choose();
        if (!request.TryGetProperty("action", out var action) || action.GetString() != "get_library")
            throw new ArgumentException("Unsupported request");
        string backend = request.TryGetProperty("backend", out var method) ? method.GetString() ?? "db" : "db";
        object result;
        if (backend == "db") {
            string? path = request.TryGetProperty("db_path", out var p) ? p.GetString() : null;
            if (path?.Length > 1024) throw new ArgumentException("Invalid games.db path");
            result = ReadDefault(path);
        }
        else if (backend == "sdk") {
            var export = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GameLibraryGuard", "library.json");
            if (!File.Exists(export)) throw new FileNotFoundException("SDK export missing. Install the Playnite exporter; see playnite/README.md.");
            if (new FileInfo(export).Length > 5 * 1024 * 1024) throw new InvalidDataException("SDK export exceeds 5 MB.");
            using var data = JsonDocument.Parse(File.ReadAllText(export));
            var games = data.RootElement.GetProperty("games");
            if (games.ValueKind != JsonValueKind.Array || games.GetArrayLength() > 30000) throw new InvalidDataException("Invalid SDK games array.");
            foreach (var game in games.EnumerateArray()) {
                var name = game.GetProperty("name").GetString();var source = game.GetProperty("source").GetString();
                if (string.IsNullOrWhiteSpace(name) || name.Length > 255 || string.IsNullOrWhiteSpace(source) || source.Length > 100)
                    throw new InvalidDataException("Invalid SDK title/source.");
            }
            result = new { games = games.Clone(), source_type = "playnite_export", exported_at = File.GetLastWriteTimeUtc(export).ToString("O") };
        }
        else throw new ArgumentException("Unsupported Playnite backend");
        var json = JsonSerializer.SerializeToElement(result);
        var output = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json.GetRawText())!;
        var revision = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(json.GetProperty("games").GetRawText())));
        output["revision"] = JsonSerializer.SerializeToElement(revision);
        var all=json.GetProperty("games");
        int offset=request.TryGetProperty("page_offset",out var cursor)?cursor.GetInt32():0;
        if(offset<0||offset>all.GetArrayLength())throw new ArgumentException("Invalid library page offset.");
        var page=new List<JsonElement>();int bytes=0,index=offset;
        foreach(var game in all.EnumerateArray().Skip(offset)){
            int length=System.Text.Encoding.UTF8.GetByteCount(game.GetRawText())+1;
            if(length>650000)throw new InvalidDataException("A single game record exceeds the native message limit.");
            if(bytes+length>650000&&page.Count>0)break;
            page.Add(game.Clone());bytes+=length;index++;
        }
        output["games"]=JsonSerializer.SerializeToElement(page);
        output["total_count"]=JsonSerializer.SerializeToElement(all.GetArrayLength());
        output["next_offset"]=JsonSerializer.SerializeToElement(index<all.GetArrayLength()?(int?)index:null);
        return output;
    }

    [STAThread]
    public static int Main(string[] args)
    {
        bool cli = args.Length == 2 && args[0] == "--read";
        object response;
        int exit = 0;
        try {
            if (cli) response = ReadDefault(args[1]);
            else {
                using var input = Console.OpenStandardInput();
                byte[] header = new byte[4];input.ReadExactly(header);
                uint length = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(header);
                if (length > 1024 * 1024) throw new InvalidDataException("Request exceeds 1 MB.");
                byte[] bytes = new byte[length];input.ReadExactly(bytes);
                using var request = JsonDocument.Parse(bytes);
                response = Handle(request.RootElement);
            }
        }
        catch (Exception ex) {
            response = new { error = ex.Message + " Close Playnite and retry if locked. For synchronization while Playnite runs, choose SDK exporter mode." };
            exit = 1;
        }
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(response);
        if (!cli && payload.Length > 900000) { payload = JsonSerializer.SerializeToUtf8Bytes(new { error = "Library exceeds native messaging response size limit (900 KB)." }); exit = 1; }
        using var output = Console.OpenStandardOutput();
        if (!cli) {
            byte[] header = new byte[4];System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(header, (uint)payload.Length);output.Write(header);
        }
        output.Write(payload);output.Flush();return exit;
    }
}

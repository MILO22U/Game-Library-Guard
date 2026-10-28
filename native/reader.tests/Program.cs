using GameLibraryGuard;
using LiteDB;
using System.Security.Cryptography;
using System.Text.Json;
using System.Diagnostics;

static class Tests
{
    static int count;
    static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
    static void Test(string name, Action action) { action();Console.WriteLine("PASS " + name);count++; }
    static readonly Guid Source = Guid.NewGuid();
    static BsonDocument Game(string name = "Dino Crisis", Guid? source = null) => new BsonDocument {
        ["_id"] = Guid.NewGuid(), ["Name"] = name, ["SourceId"] = source ?? Source,
        ["GameId"] = "store-123", ["IsInstalled"] = false, ["Playtime"] = 1234L,
        // This must remain inert data; the reader must never instantiate _type.
        ["_type"] = "Nonexistent.DangerousType, NonexistentAssembly"
    };
    static string Fixture(string root, string collection = "Game", params BsonDocument[] games) {
        var dir = Path.Combine(root, Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
        using (var db = new LiteDatabase(Path.Combine(dir,"games.db"))) {
            foreach (var game in games.Length == 0 ? new[] { Game() } : games) db.GetCollection(collection).Insert(game);
        }
        using (var db = new LiteDatabase(Path.Combine(dir,"sources.db"))) {
            db.GetCollection("GameSource").Insert(new BsonDocument { ["_id"] = Source, ["Name"] = "GOG" });
        }
        return Path.Combine(dir,"games.db");
    }
    static void Reject(Action action, string message) {
        try {action();}catch(Exception e) {Check(e.Message.Contains(message,StringComparison.OrdinalIgnoreCase),"Wrong error: "+e.Message);return;}
        throw new Exception("Expected rejection: "+message);
    }
    static JsonDocument Native(string exe, object request) {
        var info=new ProcessStartInfo(exe) {RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,CreateNoWindow=true};
        using var process=Process.Start(info)!;
        var body=System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(request);byte[] header=new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(header,(uint)body.Length);
        process.StandardInput.BaseStream.Write(header);process.StandardInput.BaseStream.Write(body);process.StandardInput.Close();
        using var bytes=new MemoryStream();process.StandardOutput.BaseStream.CopyTo(bytes);
        Check(process.WaitForExit(15000),"Native host timeout");
        var output=bytes.ToArray();Check(output.Length>=4,"Missing native header: "+process.StandardError.ReadToEnd());
        Check(System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(output)==output.Length-4,"Incorrect framing");
        return JsonDocument.Parse(output.AsMemory(4));
    }
    public static int Main() {
        var root=Path.Combine(Path.GetTempPath(),"glg-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try {
            Test("real LiteDB 4 fixture, source lookup, metadata and inert _type",()=>{
                var path=Fixture(root);var result=PlayniteReader.Read(path);
                Check(result.games.Count==1 && result.games[0].source=="GOG","Game/source mismatch");
                Check(result.games[0].isInstalled==false && result.games[0].storeId=="store-123" && result.games[0].playtimeSeconds==1234,"Metadata mismatch");
            });
            Test("original bytes, timestamps and directory contents unchanged",()=>{
                var path=Fixture(root);var paths=Directory.GetFiles(Path.GetDirectoryName(path)!);
                var hashes=paths.Select(p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))).ToArray();
                var times=paths.Select(File.GetLastWriteTimeUtc).ToArray();
                PlayniteReader.Read(path);
                Check(Directory.GetFiles(Path.GetDirectoryName(path)!).Length==paths.Length,"Original directory modified");
                for(int i=0;i<paths.Length;i++)Check(hashes[i]==Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(paths[i])))&&times[i]==File.GetLastWriteTimeUtc(paths[i]),"Original changed");
            });
            Test("portable path, Unicode and duplicate title/source",()=>{
                var path=Fixture(root,"Game",Game("遊戲, Deluxe"),Game("遊戲, Deluxe"));
                Check(PlayniteReader.Read(path).games.Count==1,"Duplicate not collapsed");
            });
            Test("missing sources.db fails rather than guessing labels",()=>{
                var path=Fixture(root);File.Delete(Path.Combine(Path.GetDirectoryName(path)!,"sources.db"));
                Reject(()=>PlayniteReader.Read(path),"sources.db");
            });
            Test("unresolved source skipped with warning",()=>{
                var path=Fixture(root,"Game",Game("Unknown",Guid.NewGuid()));var r=PlayniteReader.Read(path);
                Check(r.games.Count==0&&r.warning!.Contains("1 games skipped"),"Unknown source claimed owned");
            });
            Test("wrong schema rejected",()=>Reject(()=>PlayniteReader.Read(Fixture(root,"Other")),"schema"));
            Test("invalid title rejected without truncation",()=>Reject(()=>PlayniteReader.Read(Fixture(root,"Game",Game(""))),"Name"));
            Test("unsupported/corrupt LiteDB header rejected",()=>{
                var path=Fixture(root);using(var file=new FileStream(path,System.IO.FileMode.Open,FileAccess.Write)){file.Position=32;file.Write(new byte[64]);}
                Reject(()=>PlayniteReader.Read(path),"database");
            });
            Test("newer LiteDB file version rejected instead of upgraded",()=>{
                var path=Fixture(root);var bytes=File.ReadAllBytes(path);var signature=System.Text.Encoding.ASCII.GetBytes("** This is a LiteDB file **");
                int offset=bytes.AsSpan().IndexOf(signature);Check(offset>=0,"Missing LiteDB signature");bytes[offset+signature.Length]=8;File.WriteAllBytes(path,bytes);
                Reject(()=>PlayniteReader.Read(path),"version");
            });
            Test("locked database rejected",()=>{
                var path=Fixture(root);using var locked=new FileStream(path,System.IO.FileMode.Open,FileAccess.ReadWrite,FileShare.None);
                Reject(()=>PlayniteReader.Read(path),"used by another process");
            });
            Test("read-only originals supported",()=>{
                var path=Fixture(root);File.SetAttributes(path,FileAttributes.ReadOnly);
                try{Check(PlayniteReader.Read(path).games.Count==1,"Read-only import failed");}finally{File.SetAttributes(path,FileAttributes.Normal);}
            });
            Test("database chooser cancellation and path validation without opening UI",()=>{
                var cancelled=DatabasePicker.Choose(()=>null);Check(cancelled.cancelled&&cancelled.db_path==null,"Cancel changed selection");
                var path=Fixture(root);var chosen=DatabasePicker.Choose(()=>path);Check(!chosen.cancelled&&chosen.db_path==Path.GetFullPath(path),"Wrong selected path");
                Reject(()=>DatabasePicker.Choose(()=>Path.Combine(root,"other.db")),"games.db");
            });
            Test("real games.db larger than 5 MB imports through database reader",()=>{
                var documents=Enumerable.Range(0,24).Select(i=>{var game=Game("Game "+i);game["Description"]=new string('x',256*1024);return game;}).ToArray();
                var path=Fixture(root,"Game",documents);Check(new FileInfo(path).Length>5*1024*1024,"Fixture is not over 5 MB");
                Check(PlayniteReader.Read(path).games.Count==24,"Large database import failed");
            });
            var exe=Path.GetFullPath(Path.Combine("native","reader","bin","Release","net10.0","PlayniteReader.exe"));
            Test("compiled native messaging host reads actual DB and returns revision",()=>{
                var path=Fixture(root);using var doc=Native(exe,new{action="get_library",db_path=path,backend="db"});
                var json=doc.RootElement;Check(json.GetProperty("games").GetArrayLength()==1,"Native game missing");
                Check(json.GetProperty("source_type").GetString()=="playnite_db"&&json.GetProperty("revision").GetString()!.Length==64,"Native metadata missing");
            });
            Test("native host rejects unsupported action",()=>{
                using var doc=Native(exe,new{action="delete"});Check(doc.RootElement.GetProperty("error").GetString()!.Contains("Unsupported request"),"Unsupported action accepted");
            });
            Console.WriteLine($"{count} database/native tests passed.");return 0;
        }
        catch(Exception e){Console.Error.WriteLine(e);return 1;}
        finally {Directory.Delete(root,true);}
    }
}
